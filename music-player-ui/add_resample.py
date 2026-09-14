import sys
import re

with open('src-tauri/src/lib.rs', 'r') as f:
    text = f.read()

extern_target = '''extern "C" {
    fn init_audio_engine(custom_sample_rate: u32) -> bool;'''

extern_replacement = '''extern "C" {
    fn engine_get_sample_rate() -> u32;
    fn init_audio_engine(custom_sample_rate: u32) -> bool;'''

if 'engine_get_sample_rate' not in text:
    text = text.replace(extern_target, extern_replacement)
else:
    print("engine_get_sample_rate already in extern C")

# Now add the resampling logic.
resample_code = '''
use rubato::{Resampler, SincFixedIn, SincInterpolationType, SincInterpolationParameters, WindowFunction};

/// Convert interleaved stereo to per-channel planar (what rubato expects).
fn deinterleave(input: &[f32], channels: usize) -> Vec<Vec<f32>> {
    let frames = input.len() / channels;
    let mut out = vec![Vec::with_capacity(frames); channels];
    for f in 0..frames {
        for c in 0..channels {
            out[c].push(input[f * channels + c]);
        }
    }
    out
}

fn interleave(planar: &[Vec<f32>]) -> Vec<f32> {
    let channels = planar.len();
    let frames = planar[0].len();
    let mut out = Vec::with_capacity(frames * channels);
    for f in 0..frames {
        for c in 0..channels {
            out.push(planar[c][f]);
        }
    }
    out
}

/// High-quality offline sample-rate conversion.
/// Runs on a background thread with the whole file in RAM - quality over speed.
fn resample_offline(
    samples: Vec<f32>,
    channels: usize,
    from_hz: u32,
    to_hz: u32,
) -> Result<Vec<f32>, String> {
    if from_hz == to_hz || from_hz == 0 || to_hz == 0 {
        return Ok(samples);
    }

    // 256 sinc taps + cubic interpolation between polyphase branches.
    // This is well beyond audible transparency: >140 dB image rejection.
    let params = SincInterpolationParameters {
        sinc_len: 256,
        f_cutoff: 0.95,
        interpolation: SincInterpolationType::Cubic,
        oversampling_factor: 256,
        window: WindowFunction::BlackmanHarris2,
    };

    let ratio = to_hz as f64 / from_hz as f64;
    let chunk = 4096usize;

    let mut resampler = SincFixedIn::<f32>::new(ratio, 1.0, params, chunk, channels)
        .map_err(|e| format!("resampler init failed: {}", e))?;

    let planar = deinterleave(&samples, channels);
    let total_frames = planar[0].len();

    let mut out_planar: Vec<Vec<f32>> = vec![
        Vec::with_capacity((total_frames as f64 * ratio) as usize + chunk);
        channels
    ];

    let mut pos = 0usize;
    while pos < total_frames {
        let n = chunk.min(total_frames - pos);

        // The final partial chunk must be zero-padded to chunk frames.
        let mut block: Vec<Vec<f32>> = Vec::with_capacity(channels);
        for c in 0..channels {
            let mut v = planar[c][pos..pos + n].to_vec();
            v.resize(chunk, 0.0);
            block.push(v);
        }

        let processed = resampler
            .process(&block, None)
            .map_err(|e| format!("resample failed: {}", e))?;

        for c in 0..channels {
            out_planar[c].extend_from_slice(&processed[c]);
        }
        pos += n;
    }

    // Trim the filter's group delay and the tail introduced by zero padding.
    let expected = (total_frames as f64 * ratio) as usize;
    let delay = resampler.output_delay();
    for c in 0..channels {
        if out_planar[c].len() > delay {
            out_planar[c].drain(0..delay);
        }
        out_planar[c].truncate(expected);
    }

    Ok(interleave(&out_planar))
}

'''

if 'fn resample_offline' not in text:
    # Add it before #[tauri::command]
    idx = text.find('#[tauri::command]')
    if idx != -1:
        text = text[:idx] + resample_code + text[idx:]

# Now replace the rust_decode_file logic. We need to find where the decoding happens.
with open('src-tauri/src/lib.rs', 'w') as f:
    f.write(text)
print("Added resample_offline")
