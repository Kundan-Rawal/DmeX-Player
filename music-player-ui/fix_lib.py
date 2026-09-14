import sys

with open('src-tauri/src/lib.rs', 'r') as f:
    text = f.read()

target = '''extern "C" {
    fn init_audio_engine();'''

replacement = '''extern "C" {
    fn engine_get_sample_rate() -> u32;
    fn init_audio_engine();'''

text = text.replace(target, replacement)

# also fix type annotations
target2 = '''    let (mut final_samples, final_rate) = if engine_sr > 0 && engine_sr != sample_rate && (all_samples.len() * 4 * 2 <= MAX_OFFLINE_RESAMPLE_BYTES) {'''

replacement2 = '''    let (mut final_samples, final_rate): (Vec<f32>, u32) = if engine_sr > 0 && engine_sr != sample_rate && (all_samples.len() * 4 * 2 <= MAX_OFFLINE_RESAMPLE_BYTES) {'''

text = text.replace(target2, replacement2)

with open('src-tauri/src/lib.rs', 'w') as f:
    f.write(text)
print("Fixed lib.rs errors")
