import sys

with open('src-tauri/src/lib.rs', 'r') as f:
    text = f.read()

target = '''    let (mut final_samples, final_rate) = if engine_sr > 0 && engine_sr != sample_rate {
        match resample_offline(all_samples, channels as usize, sample_rate, engine_sr) {'''

replacement = '''    const MAX_OFFLINE_RESAMPLE_BYTES: usize = 120 * 1024 * 1024;
    let (mut final_samples, final_rate) = if engine_sr > 0 && engine_sr != sample_rate && (all_samples.len() * 4 * 2 <= MAX_OFFLINE_RESAMPLE_BYTES) {
        match resample_offline(all_samples, channels as usize, sample_rate, engine_sr) {'''

if target in text:
    text = text.replace(target, replacement)
    with open('src-tauri/src/lib.rs', 'w') as f:
        f.write(text)
    print("Added MAX_OFFLINE_RESAMPLE_BYTES check")
else:
    print("Not found")
