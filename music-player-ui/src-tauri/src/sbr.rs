use rustfft::{FftPlanner, num_complex::Complex};
use std::f32::consts::TAU;

// A simple PRNG to avoid bringing in the rand crate if not needed
fn next_rand(seed: &mut u32) -> f32 {
    *seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
    (*seed as f32) / (u32::MAX as f32)
}

/// Detects a lossy codec's low-pass cutoff. Returns None if the file is full-band.
pub fn detect_cutoff(spectrum_db: &[f32], sample_rate: u32, fft_size: usize) -> Option<f32> {
    let bin_hz = sample_rate as f32 / fft_size as f32;

    // Noise floor from the top 5% of bins (above any plausible cutoff).
    let start = (spectrum_db.len() as f32 * 0.95) as usize;
    if start >= spectrum_db.len() || spectrum_db.len() == 0 { return None; }
    let noise_floor: f32 =
        spectrum_db[start..].iter().sum::<f32>() / (spectrum_db.len() - start) as f32;

    // Highest bin that is meaningfully above the noise floor.
    let mut cutoff_bin = 0usize;
    for k in (1..spectrum_db.len()).rev() {
        if spectrum_db[k] > noise_floor + 6.0 {
            cutoff_bin = k;
            break;
        }
    }
    if cutoff_bin == 0 { return None; }

    // A real codec cutoff is a CLIFF, not a gentle rolloff. Require a steep drop.
    let below = (cutoff_bin as f32 * 0.9) as usize;
    if below == 0 || cutoff_bin <= below { return None; }
    let slope = (spectrum_db[below] - spectrum_db[cutoff_bin])
              / (cutoff_bin - below) as f32;
    if slope < 3.0 { return None; }        // dB per bin - gentle means natural rolloff

    Some(cutoff_bin as f32 * bin_hz)
}

pub fn detect_cutoff_stable(frames: &[Vec<f32>], sr: u32, n: usize) -> Option<f32> {
    let mut hits: Vec<f32> = frames.iter()
        .filter_map(|f| detect_cutoff(f, sr, n))
        .collect();
    if hits.len() < frames.len() / 5 { return None; }   // fewer than 20% agree -> no
    hits.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median = hits[hits.len() / 2];
    if median >= 19_000.0 { None } else { Some(median) }
}

pub fn replicate_band(
    spectrum: &mut [Complex<f32>],
    cutoff_hz: f32,
    sample_rate: u32,
    fft_size: usize,
    strength: f32,
    seed: &mut u32
) {
    let bin_hz = sample_rate as f32 / fft_size as f32;
    let cutoff_bin = (cutoff_hz / bin_hz) as usize;
    let nyquist_bin = fft_size / 2;
    if cutoff_bin == 0 || cutoff_bin * 2 > nyquist_bin { return; }

    // --- Envelope slope over the octave below the cutoff ---
    let lo = cutoff_bin / 4;
    let hi = cutoff_bin;
    let mut sum_lo = 0.0f32;
    let mut sum_hi = 0.0f32;
    let mid = (lo + hi) / 2;
    for k in lo..mid { sum_lo += spectrum[k].norm(); }
    for k in mid..hi { sum_hi += spectrum[k].norm(); }
    let n_half = (mid - lo).max(1) as f32;
    let avg_lo = (sum_lo / n_half).max(1e-9);
    let avg_hi = (sum_hi / n_half).max(1e-9);

    // dB per octave, clamped to a physically plausible range.
    let slope_db = 20.0 * (avg_hi / avg_lo).log10();
    let slope_db = slope_db.clamp(-18.0, -3.0);

    // Flatness measure to blend tonal and noise
    let mut spec_sum = 0.0f32;
    let mut spec_log_sum = 0.0f32;
    let num_bins = (hi - lo) as f32;
    for k in lo..hi {
        let mag = spectrum[k].norm().max(1e-9);
        spec_sum += mag;
        spec_log_sum += mag.ln();
    }
    let arithmetic_mean = spec_sum / num_bins;
    let geometric_mean = (spec_log_sum / num_bins).exp();
    let flatness = (geometric_mean / arithmetic_mean.max(1e-9)).clamp(0.0, 1.0);

    for k in cutoff_bin..std::cmp::min(cutoff_bin * 2, nyquist_bin) {
        let src_k = k / 2;
        let src_mag = spectrum[src_k].norm();

        // Extrapolate envelope
        let octaves_above = ((k as f32) / (cutoff_bin as f32)).log2();
        let env_db = slope_db * octaves_above;
        let env = 10.0f32.powf(env_db / 20.0);

        // Blend tonal transposition with shaped noise.
        let noise_mag = src_mag * (0.5 + 0.5 * next_rand(seed));
        let mag = src_mag * (1.0 - flatness) + noise_mag * flatness;

        // Randomised phase: a coherent copy would sound like a ring modulator.
        let phase = next_rand(seed) * std::f32::consts::TAU;

        // Deliberate 4 dB safety margin. Too much HF is far worse than too little.
        let final_mag = mag * env * strength * 0.63;

        spectrum[k] = Complex::from_polar(final_mag, phase);
        if k > 0 && fft_size - k < fft_size {
            spectrum[fft_size - k] = spectrum[k].conj();   // keep it real-valued
        }
    }
}

pub fn apply_sbr_offline(samples: &mut [f32], channels: u32, sample_rate: u32) -> Option<f32> {
    if channels == 0 || samples.is_empty() { return None; }
    
    // We only process stereo for now, or we can process channels independently.
    // Let's do mono processing independently per channel.
    let fft_size = 4096;
    let hop_size = 1024; // 75% overlap
    if samples.len() < fft_size * channels as usize { return None; }

    let mut planner = FftPlanner::new();
    let fft = planner.plan_fft_forward(fft_size);
    let ifft = planner.plan_fft_inverse(fft_size);

    let num_frames = (samples.len() / channels as usize - fft_size) / hop_size;
    if num_frames == 0 { return None; }

        
    let hann_window: Vec<f32> = (0..fft_size)
        .map(|i| 0.5 * (1.0 - ((2.0 * std::f32::consts::PI * i as f32) / (fft_size as f32 - 1.0)).cos()))
        .collect();

    // To prevent processing multiple times if already processed or lossless
    // We sample up to 100 frames to detect cutoff
    let frames_to_check = std::cmp::min(num_frames, 100);
    let mut spectra_db = Vec::with_capacity(frames_to_check);
    
    // Channel 0 for detection
    for f in 0..frames_to_check {
        let mut frame_complex = vec![Complex::new(0.0, 0.0); fft_size];
        let offset = f * hop_size * channels as usize;
        for i in 0..fft_size {
            frame_complex[i] = Complex::new(samples[offset + i * channels as usize] * hann_window[i], 0.0);
        }
        fft.process(&mut frame_complex);
        let mut db_spec = vec![0.0f32; fft_size / 2];
        for i in 0..fft_size / 2 {
            db_spec[i] = 20.0 * frame_complex[i].norm().max(1e-9).log10();
        }
        spectra_db.push(db_spec);
    }

    let cutoff_hz = detect_cutoff_stable(&spectra_db, sample_rate, fft_size)?;

    // If it's a lossless/high-quality track, we do no harm
    if cutoff_hz >= 19_000.0 {
        return Some(cutoff_hz);
    }

    // Now we do the actual processing
    let mut seed = 12345;
    
    // We need an output buffer to overlap-add into
    let mut out_buffer = vec![0.0f32; samples.len()];
    
    for ch in 0..channels as usize {
        let mut prev_spectrum = vec![0.0f32; fft_size / 2];
        
        for f in 0..num_frames {
            let mut frame_complex = vec![Complex::new(0.0, 0.0); fft_size];
            let offset = f * hop_size * channels as usize;
            
            for i in 0..fft_size {
                frame_complex[i] = Complex::new(samples[offset + i * channels as usize] * hann_window[i], 0.0);
            }
            
            fft.process(&mut frame_complex);
            
            // Transient detection
            let mut curr_spectrum = vec![0.0f32; fft_size / 2];
            for i in 0..fft_size / 2 {
                curr_spectrum[i] = frame_complex[i].norm();
            }
            
            let flux: f32 = curr_spectrum.iter().zip(prev_spectrum.iter())
                .map(|(c, p)| (c - p).max(0.0))
                .sum();
                
            let mut strength = 1.0f32;
            let transient_threshold = 50.0; // Needs tuning, let's pick a reasonable number for flux
            if flux > transient_threshold {
                strength *= 0.3;
            }
            
            replicate_band(&mut frame_complex, cutoff_hz, sample_rate, fft_size, strength, &mut seed);
            
            ifft.process(&mut frame_complex);
            
            // Overlap add
            // Because IFFT in rustfft is unscaled, we must divide by fft_size
            let scale = 1.0 / (fft_size as f32);
            for i in 0..fft_size {
                // To properly reconstruct with 75% overlap Hann window, we need a normalization factor
                // but since we just modified it, we can just overlap add and the energy should be preserved
                // Wait, standard OLA with Hann window and 75% overlap requires a specific gain.
                // Sum of 4 shifted Hann windows is 1.5. So we divide by 1.5.
                let ola_scale = scale / 2.0;
                out_buffer[offset + i * channels as usize] += frame_complex[i].re * hann_window[i] * ola_scale;
            }
            
            prev_spectrum = curr_spectrum;
        }
    }
    
    // Copy back
    // Note: the overlap-add will leave the edges slightly faded, we can copy just the processed part
    let start_idx = fft_size * channels as usize;
    let end_idx = num_frames * hop_size * channels as usize;
    for i in start_idx..end_idx {
        samples[i] = out_buffer[i];
    }
    
    Some(cutoff_hz)
}
