use rubato::{
    Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};
use std::{
    collections::VecDeque,
    ffi::{c_char, c_void, CStr},
    fs::File,
    path::Path,
    sync::Mutex,
};
use symphonia::core::{
    audio::SampleBuffer,
    codecs::{Decoder, DecoderOptions},
    errors::Error,
    formats::{FormatOptions, FormatReader, SeekMode, SeekTo},
    probe::Hint,
    units::TimeBase,
};

const BLOCK: usize = 4096;
pub struct AudioStream {
    path: String,
    seek_from_start: bool,
    format: Box<dyn FormatReader>,
    decoder: Box<dyn Decoder>,
    id: u32,
    pub rate: u32,
    pub channels: usize,
    source_rate: u32,
    time_base: TimeBase,
    length: Option<u64>,
    cursor: u64,
    source_frames: u64,
    generated: u64,
    converter: Option<SincFixedIn<f32>>,
    planar: Vec<Vec<f32>>,
    ready: VecDeque<f32>,
    first: Option<Vec<f32>>,
    eof: bool,
    source_skip: u64,
}

impl AudioStream {
    pub fn open(path: &str, target: u32) -> Result<Self, String> {
        let mut hint = Hint::new();
        if let Some(ext) = Path::new(path).extension().and_then(|v| v.to_str()) {
            hint.with_extension(ext);
        }
        let mut format = crate::media_source::probe(
            File::open(path).map_err(|e| e.to_string())?,
            &hint,
            &FormatOptions {
                enable_gapless: true,
                ..Default::default()
            },
        )?
        .0
        .format;
        let track =
            crate::media_source::audio_track(format.as_ref()).ok_or("No supported audio stream")?;
        let id = track.id;
        let params = track.codec_params.clone();
        let mut decoder = symphonia::default::get_codecs()
            .make(&params, &DecoderOptions::default())
            .map_err(|e| e.to_string())?;
        let (source_rate, channels, first) = loop {
            let packet = format.next_packet().map_err(|e| e.to_string())?;
            if packet.track_id() != id {
                continue;
            }
            let decoded = decoder.decode(&packet).map_err(|e| e.to_string())?;
            if decoded.frames() == 0 {
                continue;
            }
            let (rate, channels) = (decoded.spec().rate, decoded.spec().channels.count());
            let mut buffer = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
            buffer.copy_interleaved_ref(decoded);
            break (rate, channels, buffer.samples().to_vec());
        };
        if channels != 1 && channels != 2 {
            return Err("Only mono and stereo sources are supported".into());
        }
        if !(8000..=384000).contains(&source_rate) {
            return Err("Unsupported source sample rate".into());
        }
        if target == 0 && !(22050..=96000).contains(&source_rate) {
            return Err("Native rate is not supported by Raw Stereo".into());
        }
        let rate = if target == 0 { source_rate } else { target };
        let time_base = params.time_base.unwrap_or(TimeBase::new(1, source_rate));
        let length = params.n_frames.map(|frames| {
            let time = time_base.calc_time(frames);
            ((time.seconds as f64 + time.frac) * rate as f64).round() as u64
        });
        let converter = if rate != source_rate {
            Some(
                SincFixedIn::<f32>::new(
                    rate as f64 / source_rate as f64,
                    1.0,
                    SincInterpolationParameters {
                        sinc_len: 128,
                        f_cutoff: 0.95,
                        interpolation: SincInterpolationType::Cubic,
                        oversampling_factor: 128,
                        window: WindowFunction::BlackmanHarris2,
                    },
                    BLOCK,
                    channels,
                )
                .map_err(|e| e.to_string())?,
            )
        } else {
            None
        };
        let seek_from_start = params.codec == symphonia::core::codecs::CODEC_TYPE_VORBIS;
        Ok(Self {
            path: path.to_owned(),
            seek_from_start,
            format,
            decoder,
            id,
            rate,
            channels,
            source_rate,
            time_base,
            length,
            cursor: 0,
            source_frames: 0,
            generated: 0,
            converter,
            planar: vec![Vec::new(); channels],
            ready: VecDeque::new(),
            first: Some(first),
            eof: false,
            source_skip: 0,
        })
    }

    fn emit(&mut self, channels: &[Vec<f32>], limit: u64) -> Result<(), String> {
        let count = channels[0]
            .len()
            .min(limit.saturating_sub(self.generated) as usize);
        for index in 0..count {
            for channel in channels {
                let sample = channel[index];
                if !sample.is_finite() {
                    return Err("Non-finite source sample".into());
                }
                self.ready.push_back(sample);
            }
        }
        self.generated += count as u64;
        Ok(())
    }

    fn fill(&mut self) -> Result<(), String> {
        if self.eof {
            return Ok(());
        }
        let samples = if let Some(first) = self.first.take() {
            Some(first)
        } else {
            loop {
                let packet = match self.format.next_packet() {
                    Ok(packet) => packet,
                    Err(Error::IoError(error))
                        if error.kind() == std::io::ErrorKind::UnexpectedEof =>
                    {
                        break None
                    }
                    Err(error) => return Err(error.to_string()),
                };
                if packet.track_id() != self.id {
                    continue;
                }
                let decoded = self.decoder.decode(&packet).map_err(|e| e.to_string())?;
                if decoded.spec().rate != self.source_rate
                    || decoded.spec().channels.count() != self.channels
                {
                    return Err("Mid-stream format changes are not supported".into());
                }
                let mut buffer =
                    SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
                buffer.copy_interleaved_ref(decoded);
                break Some(buffer.samples().to_vec());
            }
        };
        if let Some(mut samples) = samples {
            let skipped = self.source_skip.min((samples.len() / self.channels) as u64);
            samples.drain(..skipped as usize * self.channels);
            self.source_skip -= skipped;
            if samples.iter().any(|sample| !sample.is_finite()) {
                return Err("Non-finite source sample".into());
            }
            self.source_frames += (samples.len() / self.channels) as u64;
            if self.converter.is_some() {
                for frame in samples.chunks_exact(self.channels) {
                    for (channel, sample) in frame.iter().enumerate() {
                        self.planar[channel].push(*sample);
                    }
                }
                while self.planar[0].len() >= BLOCK {
                    let block: Vec<Vec<f32>> = self
                        .planar
                        .iter_mut()
                        .map(|channel| channel.drain(..BLOCK).collect())
                        .collect();
                    let converted = self
                        .converter
                        .as_mut()
                        .unwrap()
                        .process(&block, None)
                        .map_err(|e| e.to_string())?;
                    self.emit(&converted, u64::MAX)?;
                }
            } else {
                self.generated += (samples.len() / self.channels) as u64;
                self.ready.extend(samples);
            }
        } else {
            let expected =
                (self.source_frames as u128 * self.rate as u128 / self.source_rate as u128) as u64;
            if self.converter.is_some() {
                if !self.planar[0].is_empty() {
                    let converted = self
                        .converter
                        .as_mut()
                        .unwrap()
                        .process_partial(Some(&self.planar), None)
                        .map_err(|e| e.to_string())?;
                    self.emit(&converted, expected)?;
                    for channel in &mut self.planar {
                        channel.clear();
                    }
                }
                while self.generated < expected {
                    let converted = self
                        .converter
                        .as_mut()
                        .unwrap()
                        .process_partial::<Vec<f32>>(None, None)
                        .map_err(|e| e.to_string())?;
                    self.emit(&converted, expected)?;
                }
            }
            self.eof = true;
            if self.cursor == 0 && self.generated == 0 {
                return Err("No audio frames".into());
            }
        }
        Ok(())
    }

    pub fn read(&mut self, frames: usize, mut output: Option<&mut [f32]>) -> Result<usize, String> {
        let mut count = 0;
        while count < frames {
            while self.ready.is_empty() && !self.eof {
                self.fill()?;
            }
            let available = (self.ready.len() / self.channels).min(frames - count);
            if available == 0 {
                break;
            }
            for index in 0..available * self.channels {
                let sample = self.ready.pop_front().unwrap();
                if let Some(buffer) = output.as_deref_mut() {
                    buffer[count * self.channels + index] = sample;
                }
            }
            count += available;
        }
        self.cursor += count as u64;
        Ok(count)
    }

    pub fn seek(&mut self, frame: u64) -> Result<(), String> {
        if self.length.is_some_and(|length| frame > length) {
            return Err("Seek beyond audio end".into());
        }
        // Vorbis packet overlap is not sample-aligned after the container's
        // seek/reset. Decode from its beginning to retain exact PCM timing.
        if self.seek_from_start {
            return self.seek_by_decoding(frame);
        }
        let source_frame = (frame as u128 * self.source_rate as u128 / self.rate as u128) as u64;
        // Restart the sinc converter on its original output-sample grid, not
        // at an arbitrary codec packet boundary (which shifts seeked audio).
        let mut a = self.source_rate;
        let mut b = self.rate;
        while b != 0 {
            let remainder = a % b;
            a = b;
            b = remainder;
        }
        let quantum = (self.source_rate / a) as u64;
        let anchor = source_frame.saturating_sub((BLOCK * 2) as u64) / quantum * quantum;
        let seconds = anchor as f64 / self.source_rate as f64;
        let timestamp =
            (seconds * self.time_base.denom as f64 / self.time_base.numer as f64).floor() as u64;
        let seek = match self.format.seek(
            SeekMode::Accurate,
            SeekTo::TimeStamp {
                ts: timestamp,
                track_id: self.id,
            },
        ) {
            Ok(seek) => seek,
            Err(_) => return self.seek_by_decoding(frame),
        };
        self.decoder.reset();
        if let Some(converter) = self.converter.as_mut() {
            converter.reset();
        }
        for channel in &mut self.planar {
            channel.clear();
        }
        self.ready.clear();
        self.first = None;
        self.eof = false;
        self.source_frames = 0;
        self.generated = 0;
        let actual = self.time_base.calc_time(seek.actual_ts);
        let actual_source =
            ((actual.seconds as f64 + actual.frac) * self.source_rate as f64).round() as u64;
        if actual_source > anchor {
            return Err("Decoder cannot seek before the requested sample".into());
        }
        self.source_skip = anchor - actual_source;
        self.cursor = (anchor as u128 * self.rate as u128 / self.source_rate as u128) as u64;
        let mut remaining = frame.saturating_sub(self.cursor);
        while remaining > 0 {
            let count = self.read(remaining.min(BLOCK as u64) as usize, None)?;
            if count == 0 {
                return Err("Seek beyond audio end".into());
            }
            remaining -= count as u64;
        }
        Ok(())
    }

    fn seek_by_decoding(&mut self, frame: u64) -> Result<(), String> {
        let mut replacement = Self::open(&self.path, self.rate)?;
        let mut remaining = frame;
        while remaining > 0 {
            let count = replacement.read(remaining.min(BLOCK as u64) as usize, None)?;
            if count == 0 {
                return Err("Seek beyond audio end".into());
            }
            remaining -= count as u64;
        }
        *self = replacement;
        Ok(())
    }
}

#[repr(C)]
pub struct StreamInfo {
    rate: u32,
    channels: u32,
    length: u64,
    cursor: u64,
}
type Handle = Mutex<AudioStream>;
#[no_mangle]
pub unsafe extern "C" fn rust_stream_open(path: *const c_char, rate: u32) -> *mut c_void {
    if path.is_null() {
        return std::ptr::null_mut();
    }
    std::panic::catch_unwind(|| {
        let path = CStr::from_ptr(path).to_str().ok()?;
        match AudioStream::open(path, rate) {
            Ok(stream) => Some(Box::into_raw(Box::new(Mutex::new(stream))) as *mut c_void),
            Err(error) => {
                eprintln!("[Audio stream] {error}");
                None
            }
        }
    })
    .ok()
    .flatten()
    .unwrap_or(std::ptr::null_mut())
}
#[no_mangle]
pub unsafe extern "C" fn rust_stream_close(handle: *mut c_void) {
    if !handle.is_null() {
        drop(Box::from_raw(handle as *mut Handle));
    }
}
#[no_mangle]
pub unsafe extern "C" fn rust_stream_info(handle: *mut c_void, info: *mut StreamInfo) -> i32 {
    if handle.is_null() || info.is_null() {
        return -1;
    }
    match (*(handle as *mut Handle)).lock() {
        Ok(stream) => {
            info.write(StreamInfo {
                rate: stream.rate,
                channels: stream.channels as u32,
                length: stream.length.unwrap_or(u64::MAX),
                cursor: stream.cursor,
            });
            0
        }
        Err(_) => -1,
    }
}
#[no_mangle]
pub unsafe extern "C" fn rust_stream_read(
    handle: *mut c_void,
    output: *mut f32,
    frames: u64,
) -> i64 {
    if handle.is_null() || frames > 1_048_576 {
        return -1;
    }
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut stream = (*(handle as *mut Handle))
            .lock()
            .map_err(|_| "Stream lock interrupted".to_string())?;
        let output = if output.is_null() {
            None
        } else {
            Some(std::slice::from_raw_parts_mut(
                output,
                frames as usize * stream.channels,
            ))
        };
        stream
            .read(frames as usize, output)
            .map(|count| count as i64)
    }))
    .ok()
    .and_then(Result::ok)
    .unwrap_or(-1)
}
#[no_mangle]
pub unsafe extern "C" fn rust_stream_seek(handle: *mut c_void, frame: u64) -> i32 {
    if handle.is_null() {
        return -1;
    }
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        (*(handle as *mut Handle))
            .lock()
            .map_err(|_| "Stream lock interrupted".to_string())?
            .seek(frame)
    }))
    .ok()
    .and_then(Result::ok)
    .map(|_| 0)
    .unwrap_or(-1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        io::Write,
        path::PathBuf,
        sync::atomic::{AtomicUsize, Ordering},
    };
    static ID: AtomicUsize = AtomicUsize::new(0);
    fn root() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "dmex-stream-{}-{}",
            std::process::id(),
            ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }
    fn fixture(path: &Path, frames: usize) -> Vec<f32> {
        let samples: Vec<f32> = (0..frames)
            .flat_map(|i| {
                [
                    0.25 * (i as f32 * 0.07).sin(),
                    -0.12 * (i as f32 * 0.11).cos(),
                ]
            })
            .collect();
        let bytes = (samples.len() * 4) as u32;
        let mut file = File::create(path).unwrap();
        for chunk in [
            b"RIFF".as_slice(),
            &(bytes + 36).to_le_bytes(),
            b"WAVEfmt ",
            &16u32.to_le_bytes(),
            &3u16.to_le_bytes(),
            &2u16.to_le_bytes(),
            &44100u32.to_le_bytes(),
            &352800u32.to_le_bytes(),
            &8u16.to_le_bytes(),
            &32u16.to_le_bytes(),
            b"data",
            &bytes.to_le_bytes(),
        ] {
            file.write_all(chunk).unwrap();
        }
        let data: Vec<u8> = samples
            .iter()
            .flat_map(|value| value.to_le_bytes())
            .collect();
        file.write_all(&data).unwrap();
        samples
    }
    fn all(stream: &mut AudioStream) -> Vec<f32> {
        let mut result = Vec::new();
        let mut block = vec![0.0; 997 * stream.channels];
        loop {
            let count = stream.read(997, Some(&mut block)).unwrap();
            if count == 0 {
                break;
            }
            result.extend_from_slice(&block[..count * stream.channels]);
        }
        assert_eq!(stream.read(997, Some(&mut block)).unwrap(), 0);
        result
    }
    #[test]
    fn streamed_formats_match_existing_high_quality_decoder() {
        let root = root();
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/audio");
        for ext in [
            "wav", "flac", "mp3", "m4a", "mp4", "ogg", "aac", "aiff", "caf",
        ] {
            let path = fixtures.join(format!("metadata.{ext}"));
            let mut stream = AudioStream::open(path.to_str().unwrap(), 48000).unwrap();
            let actual = all(&mut stream);
            let reference =
                crate::audio_decode::prepare(path.to_str().unwrap(), 48000, &root.join("pcm"))
                    .unwrap();
            let bytes = fs::read(reference).unwrap();
            let expected: Vec<f32> = bytes[44..]
                .chunks_exact(4)
                .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
                .collect();
            assert_eq!(
                actual, expected,
                "{ext} must keep the same PCM and sinc quality"
            );
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn native_custom_backend_keeps_format_analysis_working() {
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/audio");
        for ext in [
            "wav", "flac", "mp3", "m4a", "mp4", "ogg", "aac", "aiff", "caf",
        ] {
            let path =
                std::ffi::CString::new(fixtures.join(format!("metadata.{ext}")).to_str().unwrap())
                    .unwrap();
            let (mut sc, mut cf, mut zcr, mut rms) = (0.0, 0.0, 0.0, 0.0);
            assert!(
                unsafe {
                    crate::analyze_audio_file_cpp(
                        path.as_ptr(),
                        &mut sc,
                        &mut cf,
                        &mut zcr,
                        &mut rms,
                    )
                },
                "Native custom decoder: {ext}"
            );
            assert!(
                sc.is_finite() && cf.is_finite() && zcr.is_finite() && rms > 0.0,
                "Analysis: {ext}"
            );
        }
    }
    #[test]
    fn supported_formats_seek_without_losing_alignment() {
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/audio");
        for ext in [
            "wav", "flac", "mp3", "m4a", "mp4", "ogg", "aac", "aiff", "caf",
        ] {
            let path = fixtures.join(format!("metadata.{ext}"));
            let mut stream = AudioStream::open(path.to_str().unwrap(), 48000).unwrap();
            let expected = all(&mut stream);
            for frame in [24000, 100, 0] {
                stream
                    .seek(frame)
                    .unwrap_or_else(|error| panic!("{ext} seek {frame}: {error}"));
                let mut block = vec![0.0; 512 * stream.channels];
                assert_eq!(stream.read(512, Some(&mut block)).unwrap(), 512);
                let max_error = block
                    .iter()
                    .zip(&expected[frame as usize * stream.channels..])
                    .map(|(a, b)| (a - b).abs())
                    .fold(0.0_f32, f32::max);
                assert!(max_error < 0.0001, "{ext} seek {frame}: {max_error}");
            }
        }
    }
    #[test]
    fn extensionless_android_style_sources_use_the_same_decoder() {
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/audio");
        let root = root();
        let path = root.join("fd-source");
        for ext in [
            "wav", "flac", "mp3", "m4a", "mp4", "ogg", "aac", "aiff", "caf",
        ] {
            fs::copy(fixtures.join(format!("metadata.{ext}")), &path).unwrap();
            let mut stream = AudioStream::open(path.to_str().unwrap(), 48000)
                .unwrap_or_else(|error| panic!("extensionless {ext}: {error}"));
            assert!(!all(&mut stream).is_empty(), "extensionless {ext}");
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn raw_stream_and_seeks_preserve_pcm() {
        let root = root();
        let path = root.join("source.wav");
        let expected = fixture(&path, 44100 * 4 + 13);
        let mut stream = AudioStream::open(path.to_str().unwrap(), 0).unwrap();
        assert_eq!(stream.rate, 44100);
        assert_eq!(all(&mut stream), expected);
        for frame in [80001, 100, 0, 170003] {
            stream.seek(frame).unwrap();
            let mut block = vec![0.0; 512];
            assert_eq!(stream.read(256, Some(&mut block)).unwrap(), 256);
            assert_eq!(
                block,
                expected[frame as usize * 2..frame as usize * 2 + 512],
                "seek {frame}"
            );
        }
        drop(stream);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn sinc_stream_drains_short_tails_and_seeks() {
        let root = root();
        let path = root.join("source.wav");
        for frames in [1, 4095, 4096, 4097, 8192, 44100 * 4 + 13] {
            fixture(&path, frames);
            let mut stream = AudioStream::open(path.to_str().unwrap(), 48000).unwrap();
            let expected = all(&mut stream);
            assert_eq!(expected.len() / 2, frames * 48000 / 44100);
            if frames > 100000 {
                for frame in [96000, 100, 0] {
                    stream.seek(frame).unwrap();
                    let mut block = vec![0.0; 512];
                    assert_eq!(stream.read(256, Some(&mut block)).unwrap(), 256);
                    let max_error = block
                        .iter()
                        .zip(&expected[frame as usize * 2..])
                        .map(|(a, b)| (a - b).abs())
                        .fold(0.0_f32, f32::max);
                    assert!(max_error < 0.0001, "resampled seek {frame}: {max_error}");
                }
            }
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn startup_does_not_decode_the_whole_song() {
        let root = root();
        let path = root.join("long.wav");
        fixture(&path, 1);
        let mut file = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
        use std::io::{Seek, SeekFrom};
        let bytes = 44100u32 * 600 * 8;
        file.seek(SeekFrom::Start(4)).unwrap();
        file.write_all(&(bytes + 36).to_le_bytes()).unwrap();
        file.seek(SeekFrom::Start(40)).unwrap();
        file.write_all(&bytes.to_le_bytes()).unwrap();
        file.set_len(bytes as u64 + 44).unwrap();
        drop(file);
        let start = std::time::Instant::now();
        let mut stream = AudioStream::open(path.to_str().unwrap(), 48000).unwrap();
        let mut buffer = vec![0.0; 96000 * 2];
        assert_eq!(stream.read(96000, Some(&mut buffer)).unwrap(), 96000);
        assert!(
            stream.source_frames < 44100 * 3,
            "startup must remain bounded regardless of track length"
        );
        eprintln!(
            "Ten-minute source: first two seconds ready in {:?}; {} source frames decoded",
            start.elapsed(),
            stream.source_frames
        );
        drop(stream);
        fs::remove_dir_all(root).unwrap();
    }
}
