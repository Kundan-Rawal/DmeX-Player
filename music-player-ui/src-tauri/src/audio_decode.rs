use std::fs::{self, File};
use std::hash::{Hash, Hasher};
use std::io::{BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use rubato::{Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error;
use symphonia::core::formats::FormatOptions;
use symphonia::core::probe::Hint;
static PREPARATION: std::sync::Mutex<()> = std::sync::Mutex::new(());

struct PcmWriter {
    output: BufWriter<File>,
    samples: u64,
    channels: u16,
    rate: u32,
    gain: f32,
}
impl PcmWriter {
    fn new(path: &Path, channels: u16, rate: u32) -> Result<Self, String> {
        let mut output = BufWriter::new(File::create(path).map_err(|e| e.to_string())?);
        output.write_all(&[0; 44]).map_err(|e| e.to_string())?;
        Ok(Self { output, samples: 0, channels, rate, gain: 1.0 })
    }
    fn write(&mut self, input: &[f32]) -> Result<(), String> {
        if self.samples + input.len() as u64 > (u32::MAX as u64 - 36) / 4 {
            return Err("Decoded track exceeds the WAV cache format limit".into());
        }
        for &sample in input {
            let sample = sample * self.gain;
            if !sample.is_finite() { return Err("Source contains a non-finite sample".into()); }
            self.output.write_all(&sample.to_le_bytes()).map_err(|e| e.to_string())?;
        }
        self.samples += input.len() as u64;
        Ok(())
    }
    fn finish(mut self) -> Result<(), String> {
        let bytes = (self.samples * 4) as u32;
        let mut header = Vec::with_capacity(44);
        header.extend_from_slice(b"RIFF"); header.extend_from_slice(&(bytes + 36).to_le_bytes());
        header.extend_from_slice(b"WAVEfmt "); header.extend_from_slice(&16u32.to_le_bytes());
        header.extend_from_slice(&3u16.to_le_bytes()); header.extend_from_slice(&self.channels.to_le_bytes());
        header.extend_from_slice(&self.rate.to_le_bytes());
        header.extend_from_slice(&(self.rate * self.channels as u32 * 4).to_le_bytes());
        header.extend_from_slice(&(self.channels * 4).to_le_bytes()); header.extend_from_slice(&32u16.to_le_bytes());
        header.extend_from_slice(b"data"); header.extend_from_slice(&bytes.to_le_bytes());
        self.output.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
        self.output.write_all(&header).map_err(|e| e.to_string())?;
        self.output.flush().map_err(|e| e.to_string())
    }
}

pub fn prepare(path: &str, target_rate: u32, cache: &Path) -> Result<PathBuf, String> {
    prepare_mode(path,target_rate,cache,false)
}
pub fn prepare_impulse(path: &str, target_rate: u32, cache: &Path) -> Result<PathBuf, String> {
    prepare_mode(path,target_rate,cache,true)
}
fn prepare_mode(path: &str, target_rate: u32, cache: &Path, impulse: bool) -> Result<PathBuf, String> {
    let _worker = PREPARATION.lock().map_err(|_| "Audio preparation worker was interrupted")?;
    let original = Path::new(path);
    let metadata = original.metadata().map_err(|e| e.to_string())?;
    let mut key = std::collections::hash_map::DefaultHasher::new();
    original.hash(&mut key); metadata.len().hash(&mut key); metadata.modified().ok().hash(&mut key);
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        metadata.dev().hash(&mut key); metadata.ino().hash(&mut key);
    }
    target_rate.hash(&mut key); 6u32.hash(&mut key); impulse.hash(&mut key);
    fs::create_dir_all(cache).map_err(|e| e.to_string())?;
    let completed = cache.join(format!("{:016x}.wav", key.finish()));
    if valid_cache(&completed) { return Ok(completed); }
    if completed.exists() { fs::remove_file(&completed).map_err(|e| e.to_string())?; }
    let temporary = completed.with_extension("partial");
    let result = decode(original, target_rate, &temporary, impulse);
    if let Err(error) = result { let _ = fs::remove_file(&temporary); return Err(error); }
    fs::rename(&temporary, &completed).map_err(|e| e.to_string())?;
    // Eviction runs on the preparation worker, never on the audio callback.
    let mut entries: Vec<_> = fs::read_dir(cache).map_err(|e| e.to_string())?
        .filter_map(Result::ok).filter(|e| e.path().extension().and_then(|v| v.to_str()) == Some("wav"))
        .filter_map(|e| e.metadata().ok().map(|m| (e.path(), m.len(), m.modified().ok()))).collect();
    entries.sort_by_key(|e| e.2);
    let mut size: u64 = entries.iter().map(|e| e.1).sum();
    for (old, bytes, _) in entries {
        if size <= 512 * 1024 * 1024 { break; }
        if old != completed && fs::remove_file(old).is_ok() { size = size.saturating_sub(bytes); }
    }
    Ok(completed)
}

fn valid_cache(path: &Path) -> bool {
    let Ok(mut input) = File::open(path) else { return false; };
    let mut header = [0u8; 44];
    if input.read_exact(&mut header).is_err() { return false; }
    let data_size = u32::from_le_bytes(header[40..44].try_into().unwrap()) as u64;
    header[..4] == *b"RIFF" && header[8..16] == *b"WAVEfmt " && header[36..40] == *b"data" &&
        header[20..22] == 3u16.to_le_bytes() && data_size > 0 &&
        input.metadata().map(|m| m.len() == data_size + 44).unwrap_or(false)
}

fn decode(path: &Path, target: u32, output: &Path, impulse: bool) -> Result<(), String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|v| v.to_str()) { hint.with_extension(extension); }
    let options = FormatOptions { enable_gapless: true, ..Default::default() };
    let mut format = crate::media_source::probe(file, &hint, &options)?.0.format;
    let track = crate::media_source::audio_track(format.as_ref()).ok_or("No supported audio track")?;
    let id = track.id;
    let mut decoder = symphonia::default::get_codecs().make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| e.to_string())?;
    // AAC and some container formats only expose a complete layout after the first decoded frame.
    let (rate, channels, first_samples) = loop {
        let packet = format.next_packet().map_err(|e| format!("Cannot read first audio frame: {e}"))?;
        if packet.track_id() != id { continue; }
        let decoded = decoder.decode(&packet).map_err(|e| format!("Audio decode failed: {e}"))?;
        if decoded.frames() == 0 { continue; }
        let rate = decoded.spec().rate;
        let channels = decoded.spec().channels.count();
        let mut buffer = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
        buffer.copy_interleaved_ref(decoded);
        break (rate, channels, buffer.samples().to_vec());
    };
    if channels != 1 && channels != 2 { return Err("Only mono and stereo sources are supported".into()); }
    if !(8000..=384000).contains(&rate) { return Err("Source sample rate is outside 8-384 kHz".into()); }
    if target == 0 && !(22050..=96000).contains(&rate) { return Err("Raw stereo requires an output rate supported by the engine (22.05-96 kHz). Disable Raw Stereo to resample this source.".into()); }
    let output_rate = if target == 0 { rate } else { target };
    let mut writer = PcmWriter::new(output, channels as u16, output_rate)?;
    if impulse { writer.gain = rate as f32 / output_rate as f32; }
    let mut converter = if output_rate != rate {
        Some(SincFixedIn::<f32>::new(output_rate as f64 / rate as f64, 1.0,
            SincInterpolationParameters { sinc_len: 128, f_cutoff: 0.95,
                interpolation: SincInterpolationType::Cubic, oversampling_factor: 128,
                window: WindowFunction::BlackmanHarris2 }, 4096, channels).map_err(|e| e.to_string())?)
    } else { None };
    let padding = if impulse { 128 } else { 0 };
    let mut pending: Vec<Vec<f32>> = vec![vec![0.0; padding]; channels];
    if converter.is_none() && padding > 0 { writer.write(&vec![0.0; padding*channels])?; }
    let mut source_frames = padding as u64;
    let mut decoded_frames = 0u64;
    // SincFixedIn's batch output is already centered on input time. Its
    // lookahead is not leading silence; impulse tests verify this alignment.
    let mut skip = 0;
    let mut emitted = 0u64;
    let mut first_samples = Some(first_samples);
    loop {
        let buffer = if let Some(samples) = first_samples.take() { samples } else {
            let packet = match format.next_packet() {
                Ok(packet) => packet,
                Err(Error::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
                Err(e) => return Err(e.to_string()),
            };
            if packet.track_id() != id { continue; }
            let decoded = decoder.decode(&packet).map_err(|e| format!("Audio decode failed: {e}"))?;
            if decoded.spec().rate != rate || decoded.spec().channels.count() != channels {
                return Err("Mid-stream format changes are not supported".into());
            }
            let mut buffer = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
            buffer.copy_interleaved_ref(decoded);
            buffer.samples().to_vec()
        };
        let samples = buffer.as_slice();
        source_frames += (samples.len() / channels) as u64;
        decoded_frames += (samples.len() / channels) as u64;
        if impulse && decoded_frames > rate as u64 * 4 { return Err("Impulse response exceeds four seconds".into()); }
        if let Some(resampler) = converter.as_mut() {
            for frame in samples.chunks_exact(channels) {
                for ch in 0..channels { pending[ch].push(frame[ch]); }
            }
            while pending[0].len() >= 4096 {
                let block: Vec<Vec<f32>> = pending.iter_mut().map(|v| v.drain(..4096).collect()).collect();
                let processed = resampler.process(&block, None).map_err(|e| e.to_string())?;
                emit(&mut writer, &processed, &mut skip, &mut emitted, u64::MAX)?;
            }
        } else { writer.write(samples)?; }
    }
    if decoded_frames == 0 { return Err("Source contains no audio frames".into()); }
    if impulse {
        source_frames += padding as u64;
        if converter.is_some() { for channel in &mut pending { channel.extend(std::iter::repeat(0.0).take(padding)); } }
        else { writer.write(&vec![0.0; padding*channels])?; }
    }
    if let Some(resampler) = converter.as_mut() {
        let expected = (source_frames as u128 * output_rate as u128 / rate as u128) as u64;
        if !pending[0].is_empty() {
            let processed = resampler.process_partial(Some(&pending), None).map_err(|e| e.to_string())?;
            emit(&mut writer, &processed, &mut skip, &mut emitted, expected)?;
        }
        while emitted < expected {
            let processed = resampler.process_partial::<Vec<f32>>(None, None).map_err(|e| e.to_string())?;
            emit(&mut writer, &processed, &mut skip, &mut emitted, expected)?;
        }
    }
    writer.finish()
}

fn emit(writer: &mut PcmWriter, planar: &[Vec<f32>], skip: &mut usize, emitted: &mut u64, limit: u64) -> Result<(), String> {
    let start = (*skip).min(planar[0].len()); *skip -= start;
    let count = (planar[0].len() - start).min(limit.saturating_sub(*emitted) as usize);
    let mut interleaved = Vec::with_capacity(count * planar.len());
    for i in start..start + count { for channel in planar { interleaved.push(channel[i]); } }
    writer.write(&interleaved)?;
    *emitted += count as u64;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static ID: AtomicUsize = AtomicUsize::new(0);
    fn fixture(frames: usize) -> (PathBuf, PathBuf, Vec<f32>) {
        let root = std::env::temp_dir().join(format!("dmex-decode-test-{}-{}", std::process::id(), ID.fetch_add(1,Ordering::Relaxed)));
        fs::create_dir_all(&root).unwrap();
        let input = root.join("source.wav");
        let samples: Vec<f32> = (0..frames).flat_map(|i| [0.25*(i as f32*0.07).sin(), -0.12*(i as f32*0.11).cos()]).collect();
        let mut writer = PcmWriter::new(&input,2,44100).unwrap();
        writer.write(&samples).unwrap(); writer.finish().unwrap();
        (root,input,samples)
    }
    #[test]
    fn raw_decode_keeps_original_pcm() {
        let (root,input,samples)=fixture(8192);
        let output=prepare(input.to_str().unwrap(),0,&root.join("cache")).unwrap();
        let bytes=fs::read(output).unwrap();
        let actual:Vec<f32>=bytes[44..].chunks_exact(4).map(|b| f32::from_le_bytes(b.try_into().unwrap())).collect();
        assert_eq!(actual,samples);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn damaged_cache_is_regenerated() {
        let (root,input,samples)=fixture(1024);
        let cache=root.join("cache");
        let output=prepare(input.to_str().unwrap(),0,&cache).unwrap();
        fs::write(&output,b"invalid cache").unwrap();
        assert_eq!(prepare(input.to_str().unwrap(),0,&cache).unwrap(),output);
        assert!(valid_cache(&output));
        assert_eq!(fs::metadata(output).unwrap().len(),44+samples.len() as u64*4);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn impulse_conversion_preserves_gain_and_pre_response() {
        let (root,input,_)=fixture(1024);
        let mut impulse=vec![0.0;2048]; impulse[0]=1.0; impulse[1]=-0.5;
        impulse[2046]=0.25; impulse[2047]=-0.125;
        let mut writer=PcmWriter::new(&input,2,44100).unwrap();
        writer.write(&impulse).unwrap(); writer.finish().unwrap();
        for rate in [44100,48000,96000] {
            let output=prepare_impulse(input.to_str().unwrap(),rate,&root.join("cache")).unwrap();
            let bytes=fs::read(output).unwrap();
            let samples:Vec<f32>=bytes[44..].chunks_exact(4).map(|b|f32::from_le_bytes(b.try_into().unwrap())).collect();
            let left:f32=samples.iter().step_by(2).sum();
            let right:f32=samples.iter().skip(1).step_by(2).sum();
            assert!((left-1.25).abs()<0.002 && (right+0.625).abs()<0.001, "IR gain {rate}: {left}, {right}");
            assert_eq!(samples.len()/2,1280*rate as usize/44100);
            if rate != 44100 {
                let onset=128*rate as usize/44100;
                assert!(samples[..(onset-4)*2].iter().any(|v|v.abs()>0.0001));
                let tail=1152*rate as usize/44100;
                let peak=samples.chunks_exact(2).take(512).enumerate().max_by(|a,b|a.1[0].abs().total_cmp(&b.1[0].abs())).unwrap().0;
                assert!(peak.abs_diff(onset)<=2, "IR timing {rate}: {peak} vs {onset}");
                assert!(samples[tail*2..].iter().any(|v|v.abs()>0.00001));
            }
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn sinc_conversion_preserves_impulse_alignment() {
        let (root,input,_)=fixture(4096);
        let mut impulse=vec![0.0;8192]; impulse[512]=1.0; impulse[513]=-0.5;
        let mut writer=PcmWriter::new(&input,2,44100).unwrap();
        writer.write(&impulse).unwrap(); writer.finish().unwrap();
        for rate in [48000,96000] {
            let output=prepare(input.to_str().unwrap(),rate,&root.join("cache")).unwrap();
            let bytes=fs::read(output).unwrap();
            let samples:Vec<f32>=bytes[44..].chunks_exact(4).map(|b|f32::from_le_bytes(b.try_into().unwrap())).collect();
            let peak=samples.chunks_exact(2).enumerate().max_by(|a,b|a.1[0].abs().total_cmp(&b.1[0].abs())).unwrap().0;
            let expected=256*rate as usize/44100;
            assert!(peak.abs_diff(expected)<=2, "Track timing {rate}: {peak} vs {expected}");
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn sinc_conversion_drains_tail_and_keeps_exact_length() {
        for frames in [4095,4096,4097,8192] {
            let (root,input,_)=fixture(frames);
            let output=prepare(input.to_str().unwrap(),48000,&root.join("cache")).unwrap();
            let bytes=fs::read(output).unwrap();
            assert_eq!((bytes.len()-44)/8,frames*48000/44100);
            let samples:Vec<f32>=bytes[44..].chunks_exact(4).map(|b| f32::from_le_bytes(b.try_into().unwrap())).collect();
            assert!(samples.iter().all(|v| v.is_finite()));
            assert!(samples[samples.len()-200..].iter().any(|v| v.abs()>0.001));
            fs::remove_dir_all(root).unwrap();
        }
    }
}
