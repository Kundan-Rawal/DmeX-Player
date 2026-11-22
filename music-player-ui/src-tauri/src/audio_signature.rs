use crate::audio_stream::AudioStream;
use rustfft::{num_complex::Complex, Fft, FftPlanner};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, Metadata, OpenOptions},
    hash::{Hash, Hasher},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant, UNIX_EPOCH},
};

const VERSION: u32 = 1;
const RATE: u32 = 22_050;
const FFT_SIZE: usize = 2048;
const MAX_SECONDS: u64 = 12;
const BUDGET: Duration = Duration::from_secs(2);
const INTRO_CONFIDENCE_CAP: f64 = 0.65;
const ACTIVE_POWER: f64 = 1e-7;
const CACHE_LIMIT: usize = 256;
const CACHE_BYTES: u64 = 16_384;
const CACHE_PREFIX: &str = "signature-v1-";
static WORKER: Mutex<()> = Mutex::new(());
static TEMP_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Signature {
    pub version: u32,
    pub confidence: f64,
    pub active_seconds: f64,
    pub sampled_seconds: f64,
    pub rms_dbfs: f64,
    pub peak_dbfs: f64,
    pub crest_db: f64,
    pub correlation: f64,
    /// E(side) / (E(mid) + E(side)): mono 0, unrelated channels ~0.5, opposite phase 1.
    pub side_ratio: f64,
    pub bass_ratio: f64,
    pub low_mid_ratio: f64,
    pub presence_ratio: f64,
    /// Fraction of power above 5 kHz, limited by the 22.05 kHz analysis rate.
    pub high_ratio: f64,
    pub high_flatness: f64,
}

impl Signature {
    pub fn valid(&self) -> bool {
        let ratios = [
            self.confidence,
            self.side_ratio,
            self.bass_ratio,
            self.low_mid_ratio,
            self.presence_ratio,
            self.high_ratio,
            self.high_flatness,
        ];
        self.version == VERSION
            && ratios
                .iter()
                .all(|v| v.is_finite() && (0.0..=1.0).contains(v))
            && self.sampled_seconds.is_finite()
            && self.sampled_seconds > 0.0
            && self.sampled_seconds <= MAX_SECONDS as f64 + 1e-9
            && self.active_seconds.is_finite()
            && (0.0..=self.sampled_seconds).contains(&self.active_seconds)
            && self.rms_dbfs.is_finite()
            && self.peak_dbfs.is_finite()
            && self.crest_db.is_finite()
            && self.crest_db >= 0.0
            && self.peak_dbfs + 1e-9 >= self.rms_dbfs
            && (self.crest_db - (self.peak_dbfs - self.rms_dbfs)).abs() < 1e-6
            && self.correlation.is_finite()
            && (-1.0..=1.0).contains(&self.correlation)
            && self.bass_ratio + self.low_mid_ratio + self.presence_ratio + self.high_ratio
                <= 1.0 + 1e-9
    }
}

struct Measurements {
    frames: u64,
    active_frames: u64,
    energy: f64,
    peak: f64,
    l2: f64,
    r2: f64,
    lr: f64,
    side: f64,
    bands: [f64; 5],
    flatness: f64,
    spectral_frames: u64,
}

impl Measurements {
    fn new() -> Self {
        Self {
            frames: 0,
            active_frames: 0,
            energy: 0.0,
            peak: 0.0,
            l2: 0.0,
            r2: 0.0,
            lr: 0.0,
            side: 0.0,
            bands: [0.0; 5],
            flatness: 0.0,
            spectral_frames: 0,
        }
    }

    fn observe(
        &mut self,
        samples: &[f32],
        channels: usize,
        fft: &dyn Fft<f64>,
        work: &mut [Complex<f64>],
        scratch: &mut [Complex<f64>],
        power: &mut [f64],
    ) -> Result<(), String> {
        if !(1..=2).contains(&channels)
            || samples.is_empty()
            || samples.len() % channels != 0
            || samples.len() / channels > FFT_SIZE
        {
            return Err("Invalid signature PCM block".into());
        }
        if samples.iter().any(|v| !v.is_finite()) {
            return Err("Non-finite signature PCM".into());
        }
        let frames = samples.len() / channels;
        let mut means = [0.0; 2];
        let mut energy = 0.0;
        for frame in samples.chunks_exact(channels) {
            let l = frame[0] as f64;
            let r = frame[channels - 1] as f64;
            means[0] += l;
            means[1] += r;
            energy += (l * l + r * r) * 0.5;
            self.peak = self.peak.max(l.abs()).max(r.abs());
        }
        self.frames += frames as u64;
        means.iter_mut().for_each(|v| *v /= frames as f64);
        let mut l2 = 0.0;
        let mut r2 = 0.0;
        let mut lr = 0.0;
        let mut side = 0.0;
        for frame in samples.chunks_exact(channels) {
            let l = frame[0] as f64 - means[0];
            let r = frame[channels - 1] as f64 - means[1];
            l2 += l * l;
            r2 += r * r;
            lr += l * r;
            side += (l - r) * (l - r);
        }
        // Gate on AC channel energy, not the mid signal: anti-phase is not silence.
        if (l2 + r2) / (2.0 * frames as f64) < ACTIVE_POWER || frames < 2 {
            return Ok(());
        }
        self.active_frames += frames as u64;
        self.energy += energy;
        self.l2 += l2;
        self.r2 += r2;
        self.lr += lr;
        self.side += side;
        power.fill(0.0);
        let mut window_energy = 0.0;
        for channel in 0..channels {
            work.fill(Complex::default());
            for i in 0..frames {
                let window =
                    0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / (frames - 1) as f64).cos();
                if channel == 0 {
                    window_energy += window * window;
                }
                work[i].re = (samples[i * channels + channel] as f64 - means[channel]) * window;
            }
            fft.process_with_scratch(work, scratch);
            // Sum independent L/R powers, never FFT(L+R), which cancels opposite phase.
            for (bin, value) in power.iter_mut().enumerate().skip(1) {
                *value += work[bin].norm_sqr() * if bin == FFT_SIZE / 2 { 1.0 } else { 2.0 };
            }
        }
        let normalization = window_energy.max(1e-20) * channels as f64;
        let mut high_sum = 0.0;
        let mut high_count = 0;
        for (bin, &value) in power.iter().enumerate().skip(1) {
            let hz = bin as f64 * RATE as f64 / FFT_SIZE as f64;
            if hz < 40.0 {
                continue;
            }
            let band = if hz < 160.0 {
                0
            } else if hz < 500.0 {
                1
            } else if hz < 1800.0 {
                2
            } else if hz < 5000.0 {
                3
            } else {
                4
            };
            self.bands[band] += value / normalization * frames as f64;
            if band == 4 {
                high_sum += value;
                high_count += 1;
            }
        }
        if high_sum > power.iter().sum::<f64>() * 1e-8 && high_count > 0 {
            let mean = high_sum / high_count as f64;
            let floor = mean * 1e-12;
            let log_mean = power
                .iter()
                .enumerate()
                .filter(|(bin, _)| *bin as f64 * RATE as f64 / FFT_SIZE as f64 >= 5000.0)
                .map(|(_, value)| (value + floor).ln())
                .sum::<f64>()
                / high_count as f64;
            self.flatness += (log_mean.exp() / (mean + floor)).clamp(0.0, 1.0) * frames as f64;
            self.spectral_frames += frames as u64;
        }
        Ok(())
    }

    fn finish(&self) -> Signature {
        let sampled_seconds = self.frames as f64 / RATE as f64;
        let active_seconds = self.active_frames as f64 / RATE as f64;
        let db = |amplitude: f64| 20.0 * amplitude.max(1e-10).log10();
        let rms_dbfs = db((self.energy / self.active_frames.max(1) as f64).sqrt());
        let peak_dbfs = db(self.peak);
        let total = self.bands.iter().sum::<f64>();
        let ratio = |band: usize| {
            if total > 1e-20 {
                (self.bands[band] / total).clamp(0.0, 1.0)
            } else {
                0.0
            }
        };
        Signature {
            version: VERSION,
            // Sequential intro coverage cannot establish whole-track representativeness.
            confidence: (active_seconds / 9.0).clamp(0.0, 1.0) * INTRO_CONFIDENCE_CAP,
            active_seconds,
            sampled_seconds,
            rms_dbfs,
            peak_dbfs,
            crest_db: (peak_dbfs - rms_dbfs).max(0.0),
            correlation: if self.l2 > 1e-20 && self.r2 > 1e-20 {
                (self.lr / (self.l2 * self.r2).sqrt()).clamp(-1.0, 1.0)
            } else {
                0.0
            },
            side_ratio: if self.l2 + self.r2 > 1e-20 {
                (self.side / (2.0 * (self.l2 + self.r2))).clamp(0.0, 1.0)
            } else {
                0.0
            },
            bass_ratio: ratio(0),
            low_mid_ratio: ratio(1),
            presence_ratio: ratio(3),
            high_ratio: ratio(4),
            high_flatness: self.flatness / self.spectral_frames.max(1) as f64,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct Fingerprint {
    length: u64,
    modified: Duration,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
}

fn fingerprint(metadata: &Metadata, identity: &str) -> Option<Fingerprint> {
    let modified = metadata.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    // Some content providers expose a placeholder epoch instead of modification data.
    if !metadata.is_file()
        || metadata.len() == 0
        || (identity.starts_with("content://") && modified.is_zero())
    {
        return None;
    }
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;
    Some(Fingerprint {
        length: metadata.len(),
        modified,
        #[cfg(unix)]
        device: metadata.dev(),
        #[cfg(unix)]
        inode: metadata.ino(),
    })
}

fn cache_path(cache: &Path, identity: &str, fingerprint: &Fingerprint) -> PathBuf {
    let mut key = std::collections::hash_map::DefaultHasher::new();
    VERSION.hash(&mut key);
    RATE.hash(&mut key);
    FFT_SIZE.hash(&mut key);
    MAX_SECONDS.hash(&mut key);
    identity.hash(&mut key);
    fingerprint.hash(&mut key);
    cache.join(format!("{CACHE_PREFIX}{:016x}.json", key.finish()))
}

fn read_cache(path: &Path) -> Option<Signature> {
    let input = File::open(path).ok()?;
    if input.metadata().ok()?.len() > CACHE_BYTES {
        return None;
    }
    let mut bytes = Vec::new();
    input.take(CACHE_BYTES + 1).read_to_end(&mut bytes).ok()?;
    if bytes.len() as u64 > CACHE_BYTES {
        return None;
    }
    let value: Signature = serde_json::from_slice(&bytes).ok()?;
    value.valid().then_some(value)
}

fn persist(cache: &Path, path: &Path, value: &Signature, current: &impl Fn() -> bool) {
    if !current() || !value.valid() || fs::create_dir_all(cache).is_err() {
        return;
    }
    let Ok(bytes) = serde_json::to_vec(value) else {
        return;
    };
    if bytes.len() as u64 > CACHE_BYTES {
        return;
    }
    let temporary = path.with_extension(format!(
        "{}-{}.tmp",
        std::process::id(),
        TEMP_ID.fetch_add(1, Ordering::Relaxed)
    ));
    let mut created = false;
    let result = (|| -> std::io::Result<()> {
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        created = true;
        output.write_all(&bytes)?;
        output.flush()?;
        drop(output);
        if !current() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                "Signature superseded",
            ));
        }
        // Windows cannot rename over an existing file. Remove only a rejected cache;
        // a valid winner from another process can remain in place.
        if path.exists() {
            if read_cache(path).is_some() {
                return Ok(());
            }
            fs::remove_file(path)?;
        }
        fs::rename(&temporary, path)
    })();
    if created {
        let _ = fs::remove_file(&temporary);
    }
    if result.is_err() || !current() {
        return;
    }
    let mut entries: Vec<_> = fs::read_dir(cache)
        .into_iter()
        .flatten()
        .take_while(|_| current())
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with(CACHE_PREFIX) && name.ends_with(".json"))
        })
        .filter_map(|entry| {
            entry
                .metadata()
                .ok()
                .filter(|meta| meta.is_file())
                .map(|meta| (entry.path(), meta.modified().ok()))
        })
        .collect();
    entries.sort_by_key(|entry| entry.1);
    let mut remaining = entries.len();
    for (old, _) in entries {
        if remaining <= CACHE_LIMIT || !current() {
            break;
        }
        if old != path && fs::remove_file(old).is_ok() {
            remaining -= 1;
        }
    }
}

/// Bounded, pre-DSP signature of the first twelve seconds. No playback seeks or locks.
/// The deadline is cooperative: AudioStream::open/read and filesystem I/O can block
/// internally. The caller must run this on a background worker, never await it to play.
/// Spectrum and peaks describe 22.05 kHz PCM, not full-band or true-peak loudness.
pub fn analyze(
    path: &str,
    identity: &str,
    cache: &Path,
    current: impl Fn() -> bool,
) -> Result<Signature, String> {
    let started = Instant::now();
    let guard = || {
        if current() {
            Ok(())
        } else {
            Err("Signature superseded".to_string())
        }
    };
    guard()?;
    let before = fs::metadata(path)
        .ok()
        .and_then(|meta| fingerprint(&meta, identity));
    let cached_path = before
        .as_ref()
        .map(|value| cache_path(cache, identity, value));
    if let Some(value) = cached_path.as_deref().and_then(read_cache) {
        guard()?;
        let after = fs::metadata(path)
            .ok()
            .and_then(|meta| fingerprint(&meta, identity));
        guard()?;
        if before == after {
            return Ok(value);
        }
        return Err("Signature source changed".into());
    }
    guard()?;
    // Fail fast instead of queuing blocking tasks behind another track's analysis.
    let _worker = WORKER.try_lock().map_err(|_| "Signature worker busy")?;
    if started.elapsed() >= BUDGET {
        return Err("Signature time budget exhausted".into());
    }
    let mut stream = AudioStream::open(path, RATE)?;
    guard()?;
    let fft = FftPlanner::<f64>::new().plan_fft_forward(FFT_SIZE);
    let mut work = vec![Complex::default(); FFT_SIZE];
    let mut scratch = vec![Complex::default(); fft.get_inplace_scratch_len()];
    let mut power = vec![0.0; FFT_SIZE / 2 + 1];
    let mut samples = vec![0.0; FFT_SIZE * stream.channels];
    let mut measurements = Measurements::new();
    let limit = RATE as u64 * MAX_SECONDS;
    let mut complete = false;
    while measurements.frames < limit {
        guard()?;
        if started.elapsed() >= BUDGET {
            break;
        }
        let requested = (limit - measurements.frames).min(FFT_SIZE as u64) as usize;
        let count = stream.read(requested, Some(&mut samples))?;
        guard()?;
        if count == 0 {
            complete = true;
            break;
        }
        measurements.observe(
            &samples[..count * stream.channels],
            stream.channels,
            fft.as_ref(),
            &mut work,
            &mut scratch,
            &mut power,
        )?;
        guard()?;
        if count < requested {
            complete = true;
            break;
        }
        std::thread::yield_now();
    }
    guard()?;
    if measurements.frames == 0 {
        return Err("No signature PCM within time budget".into());
    }
    let result = measurements.finish();
    if !result.valid() {
        return Err("Invalid audio signature".into());
    }
    let after = fs::metadata(path)
        .ok()
        .and_then(|meta| fingerprint(&meta, identity));
    guard()?;
    if before != after {
        return Err("Signature source changed".into());
    }
    // Do not permanently cache a machine-speed-dependent timeout fragment.
    if (complete || measurements.frames == limit) && started.elapsed() < BUDGET {
        if let Some(path) = cached_path {
            persist(cache, &path, &result, &|| {
                current() && started.elapsed() < BUDGET
            });
        }
    }
    guard()?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn measure(channels: usize, blocks: usize, signal: impl Fn(usize) -> (f32, f32)) -> Signature {
        let fft = FftPlanner::<f64>::new().plan_fft_forward(FFT_SIZE);
        let mut work = vec![Complex::default(); FFT_SIZE];
        let mut scratch = vec![Complex::default(); fft.get_inplace_scratch_len()];
        let mut power = vec![0.0; FFT_SIZE / 2 + 1];
        let mut measurements = Measurements::new();
        for block in 0..blocks {
            let mut samples = Vec::with_capacity(FFT_SIZE * channels);
            for i in 0..FFT_SIZE {
                let (l, r) = signal(block * FFT_SIZE + i);
                samples.push(l);
                if channels == 2 {
                    samples.push(r);
                }
            }
            measurements
                .observe(
                    &samples,
                    channels,
                    fft.as_ref(),
                    &mut work,
                    &mut scratch,
                    &mut power,
                )
                .unwrap();
        }
        let value = measurements.finish();
        assert!(value.valid(), "{value:?}");
        value
    }

    fn tone(i: usize, hz: f64) -> f32 {
        (0.5 * (std::f64::consts::TAU * hz * i as f64 / RATE as f64).sin()) as f32
    }

    #[test]
    fn mono_duplicate_near_mono_and_antiphase_are_distinct() {
        let mono = measure(1, 16, |i| (tone(i, 900.0), 0.0));
        let duplicate = measure(2, 16, |i| (tone(i, 900.0), tone(i, 900.0)));
        let near = measure(2, 16, |i| {
            (
                tone(i, 900.0),
                0.99 * tone(i, 900.0) + 0.01 * tone(i, 3100.0),
            )
        });
        let anti = measure(2, 16, |i| (tone(i, 900.0), -tone(i, 900.0)));
        for value in [&mono, &duplicate, &near] {
            assert!(value.correlation > 0.999);
            assert!(value.side_ratio < 0.001);
        }
        assert!(anti.correlation < -0.999 && anti.side_ratio > 0.999);
        assert!((duplicate.rms_dbfs - anti.rms_dbfs).abs() < 1e-9);
        assert!((mono.rms_dbfs - duplicate.rms_dbfs).abs() < 1e-9);
        assert!(anti.active_seconds > 1.0);
    }

    #[test]
    fn independent_channels_and_single_sided_material_are_not_mono() {
        let stereo = measure(2, 16, |i| (tone(i, 700.0), tone(i, 3000.0)));
        assert!(stereo.correlation.abs() < 0.02);
        assert!((stereo.side_ratio - 0.5).abs() < 0.01);
        let single = measure(2, 16, |i| (tone(i, 700.0), 0.0));
        assert_eq!(single.correlation, 0.0);
        assert!((single.side_ratio - 0.5).abs() < 1e-9);
    }

    #[test]
    fn bands_use_independent_channel_power_and_share_one_denominator() {
        for (hz, band) in [(80.0, 0), (300.0, 1), (3000.0, 2), (7000.0, 3)] {
            let value = measure(2, 8, |i| (tone(i, hz), -tone(i, hz)));
            let ratios = [
                value.bass_ratio,
                value.low_mid_ratio,
                value.presence_ratio,
                value.high_ratio,
            ];
            assert!(ratios[band] > 0.98, "{hz}: {value:?}");
        }
        let mixed = measure(2, 8, |i| (tone(i, 80.0), tone(i, 7000.0)));
        assert!((mixed.bass_ratio - 0.5).abs() < 0.02);
        assert!((mixed.high_ratio - 0.5).abs() < 0.02);
        let omitted_mid = measure(1, 8, |i| (tone(i, 900.0), 0.0));
        assert!(
            omitted_mid.bass_ratio
                + omitted_mid.low_mid_ratio
                + omitted_mid.presence_ratio
                + omitted_mid.high_ratio
                < 0.01
        );
    }

    #[test]
    fn silence_dc_and_rms_crest_are_finite() {
        let silent = measure(2, 4, |_| (0.0, 0.0));
        assert_eq!(silent.confidence, 0.0);
        assert_eq!(silent.active_seconds, 0.0);
        assert_eq!(silent.rms_dbfs, -200.0);
        let dc = measure(2, 4, |_| (0.2, -0.2));
        assert_eq!(dc.active_seconds, 0.0);
        let sine = measure(2, 16, |i| (tone(i, 1000.0), tone(i, 1000.0)));
        assert!((sine.rms_dbfs + 9.0309).abs() < 0.02);
        assert!((sine.peak_dbfs + 6.0206).abs() < 0.02);
        assert!((sine.crest_db - 3.0103).abs() < 0.02);
    }

    #[test]
    fn broadband_noise_has_more_high_flatness_than_a_tone() {
        let narrow = measure(1, 16, |i| (tone(i, 7000.0), 0.0));
        let noise = measure(1, 16, |i| {
            let mut x = (i as u64).wrapping_add(1).wrapping_mul(0x9e3779b97f4a7c15);
            x ^= x >> 30;
            x = x.wrapping_mul(0xbf58476d1ce4e5b9);
            x ^= x >> 27;
            x = x.wrapping_mul(0x94d049bb133111eb);
            x ^= x >> 31;
            ((x as u32 as f64 / u32::MAX as f64 - 0.5) as f32, 0.0)
        });
        assert!(noise.high_flatness > 0.3);
        assert!(noise.high_flatness > narrow.high_flatness + 0.2);
    }

    #[test]
    fn confidence_is_capped_and_serde_is_camel_case() {
        let value = measure(1, 120, |i| (tone(i, 900.0), 0.0));
        assert_eq!(value.confidence, INTRO_CONFIDENCE_CAP);
        let json = serde_json::to_value(&value).unwrap();
        assert!(json.get("rmsDbfs").is_some() && json.get("sideRatio").is_some());
        assert!(json.get("rms_dbfs").is_none());
        let mut invalid = value.clone();
        invalid.high_ratio = f64::NAN;
        assert!(!invalid.valid());
        invalid = value.clone();
        invalid.side_ratio = 1.01;
        assert!(!invalid.valid());
        invalid = value.clone();
        invalid.version = 2;
        assert!(!invalid.valid());
        invalid = value;
        invalid.active_seconds = 20.0;
        assert!(!invalid.valid());
    }

    #[test]
    fn cancellation_precedes_source_io() {
        assert!(
            analyze("missing", "missing", Path::new("missing-cache"), || false)
                .unwrap_err()
                .contains("superseded")
        );
    }

    #[test]
    fn invalid_pcm_is_rejected_and_partial_blocks_are_counted() {
        let fft = FftPlanner::<f64>::new().plan_fft_forward(FFT_SIZE);
        let mut work = vec![Complex::default(); FFT_SIZE];
        let mut scratch = vec![Complex::default(); fft.get_inplace_scratch_len()];
        let mut power = vec![0.0; FFT_SIZE / 2 + 1];
        let mut measurements = Measurements::new();
        assert!(measurements
            .observe(
                &[f32::NAN, 0.0],
                2,
                fft.as_ref(),
                &mut work,
                &mut scratch,
                &mut power
            )
            .is_err());
        assert!(measurements
            .observe(&[0.0], 0, fft.as_ref(), &mut work, &mut scratch, &mut power)
            .is_err());
        let samples: Vec<_> = (0..317).map(|i| tone(i, 3000.0)).collect();
        measurements
            .observe(
                &samples,
                1,
                fft.as_ref(),
                &mut work,
                &mut scratch,
                &mut power,
            )
            .unwrap();
        let value = measurements.finish();
        assert!(value.valid());
        assert_eq!(value.sampled_seconds, 317.0 / RATE as f64);
        assert!(value.presence_ratio > 0.95);
    }

    fn write_fixture(path: &Path, frames: u32) {
        let bytes = frames * 2 * 4;
        let mut file = std::io::BufWriter::new(File::create(path).unwrap());
        file.write_all(b"RIFF").unwrap();
        file.write_all(&(bytes + 36).to_le_bytes()).unwrap();
        file.write_all(b"WAVEfmt ").unwrap();
        file.write_all(&16u32.to_le_bytes()).unwrap();
        file.write_all(&3u16.to_le_bytes()).unwrap();
        file.write_all(&2u16.to_le_bytes()).unwrap();
        file.write_all(&RATE.to_le_bytes()).unwrap();
        file.write_all(&(RATE * 8).to_le_bytes()).unwrap();
        file.write_all(&8u16.to_le_bytes()).unwrap();
        file.write_all(&32u16.to_le_bytes()).unwrap();
        file.write_all(b"data").unwrap();
        file.write_all(&bytes.to_le_bytes()).unwrap();
        for i in 0..frames as usize {
            let sample = tone(i, 80.0);
            file.write_all(&sample.to_le_bytes()).unwrap();
            file.write_all(&(-sample).to_le_bytes()).unwrap();
        }
    }

    #[test]
    fn decode_cache_cancellation_invalidation_and_eviction() {
        use std::cell::Cell;
        let root = std::env::temp_dir().join(format!(
            "dmex-signature-{}-{}",
            std::process::id(),
            TEMP_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("source.wav");
        let cache = root.join("cache");
        write_fixture(&source, RATE / 2 + 13);
        let path = source.to_str().unwrap();
        let first = analyze(path, "test-track", &cache, || true).unwrap();
        assert!(first.bass_ratio > 0.98 && first.correlation < -0.99);
        assert!((first.sampled_seconds - (RATE / 2 + 13) as f64 / RATE as f64).abs() < 1e-9);
        assert_eq!(fs::read_dir(&cache).unwrap().count(), 1);
        let calls = Cell::new(0);
        let canceled = analyze(path, "test-track", &cache, || {
            calls.set(calls.get() + 1);
            calls.get() < 2
        });
        assert!(canceled.unwrap_err().contains("superseded"));
        let cached = analyze(path, "test-track", &cache, || true).unwrap();
        let expected = serde_json::to_value(&first).unwrap();
        let actual = serde_json::to_value(&cached).unwrap();
        for (key, value) in expected.as_object().unwrap() {
            assert!(
                (value.as_f64().unwrap() - actual[key].as_f64().unwrap()).abs() < 1e-12,
                "{key}"
            );
        }
        let key = cache_path(
            &cache,
            "test-track",
            &fingerprint(&source.metadata().unwrap(), "test-track").unwrap(),
        );
        fs::write(&key, b"broken cache").unwrap();
        assert!(analyze(path, "test-track", &cache, || true)
            .unwrap()
            .valid());
        fs::write(&key, vec![0; CACHE_BYTES as usize + 1]).unwrap();
        assert!(read_cache(&key).is_none());
        assert!(analyze(path, "test-track", &cache, || true)
            .unwrap()
            .valid());
        write_fixture(&source, RATE / 2 + 113);
        let changed = analyze(path, "test-track", &cache, || true).unwrap();
        assert!(changed.sampled_seconds > first.sampled_seconds);
        assert_eq!(fs::read_dir(&cache).unwrap().count(), 2);
        let no_cache = root.join("canceled-cache");
        calls.set(0);
        assert!(analyze(path, "canceled-track", &no_cache, || {
            calls.set(calls.get() + 1);
            calls.get() < 5
        })
        .unwrap_err()
        .contains("superseded"));
        assert!(!no_cache.exists());
        let modified = UNIX_EPOCH + Duration::from_secs(1);
        let fake = Fingerprint {
            length: 1,
            modified: modified.duration_since(UNIX_EPOCH).unwrap(),
            #[cfg(unix)]
            device: 0,
            #[cfg(unix)]
            inode: 0,
        };
        for i in 0..CACHE_LIMIT + 3 {
            fs::write(
                cache_path(&cache, &format!("old-{i}"), &fake),
                serde_json::to_vec(&first).unwrap(),
            )
            .unwrap();
        }
        fs::write(cache.join("unrelated.json"), b"keep").unwrap();
        let destination = cache_path(&cache, "winner", &fake);
        persist(&cache, &destination, &changed, &|| true);
        let entries: Vec<_> = fs::read_dir(&cache).unwrap().map(Result::unwrap).collect();
        assert_eq!(
            entries
                .iter()
                .filter(|e| e.file_name().to_str().unwrap().starts_with(CACHE_PREFIX))
                .count(),
            CACHE_LIMIT
        );
        assert!(entries
            .iter()
            .all(|e| e.path().extension().and_then(|v| v.to_str()) != Some("tmp")));
        assert!(destination.exists() && cache.join("unrelated.json").exists());
        calls.set(0);
        let canceled_write = cache_path(&cache, "canceled-write", &fake);
        persist(&cache, &canceled_write, &changed, &|| {
            calls.set(calls.get() + 1);
            calls.get() < 2
        });
        assert!(!canceled_write.exists());
        assert!(fs::read_dir(&cache).unwrap().map(Result::unwrap).all(|e| e
            .path()
            .extension()
            .and_then(|v| v.to_str())
            != Some("tmp")));
        write_fixture(&source, RATE * 15);
        let bounded = analyze(path, "long-track", &cache, || true).unwrap();
        assert!(bounded.sampled_seconds <= MAX_SECONDS as f64);
        assert!(bounded.confidence <= INTRO_CONFIDENCE_CAP);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unknown_content_modification_time_disables_persistence() {
        let root = std::env::temp_dir().join(format!(
            "dmex-signature-weak-{}-{}",
            std::process::id(),
            TEMP_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("source.wav");
        write_fixture(&source, 128);
        let file = OpenOptions::new().write(true).open(&source).unwrap();
        file.set_times(fs::FileTimes::new().set_modified(UNIX_EPOCH))
            .unwrap();
        assert!(fingerprint(&file.metadata().unwrap(), "content://test/1").is_none());
        assert!(fingerprint(&file.metadata().unwrap(), "desktop-track").is_some());
        drop(file);
        fs::remove_dir_all(root).unwrap();
    }
}
