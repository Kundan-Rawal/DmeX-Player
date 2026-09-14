import sys
import re

with open('src-tauri/src/lib.rs', 'r') as f:
    text = f.read()

target = '''    if all_samples.is_empty() { return std::ptr::null_mut(); }

    all_samples.shrink_to_fit();
    let total_samples = all_samples.len() as u64;
    let capacity = all_samples.capacity() as u64; // <-- CRITICAL: Capture exact allocator capacity
    let data_ptr = all_samples.as_mut_ptr();
    std::mem::forget(all_samples); 

    let buf = Box::new(RustAudioBuffer {
        data: data_ptr, total_samples, capacity, channels, sample_rate // <-- Pass it here
    });'''

replacement = '''    if all_samples.is_empty() { return std::ptr::null_mut(); }

    let engine_sr = unsafe { engine_get_sample_rate() };

    let (mut final_samples, final_rate) = if engine_sr > 0 && engine_sr != sample_rate {
        match resample_offline(all_samples, channels as usize, sample_rate, engine_sr) {
            Ok(rs) => (rs, engine_sr),
            Err(e) => {
                eprintln!("[DmeX] offline resample failed ({}); falling back to miniaudio", e);
                return std::ptr::null_mut();
            }
        }
    } else {
        (all_samples, sample_rate)
    };

    final_samples.shrink_to_fit();
    let total_samples = final_samples.len() as u64;
    let capacity = final_samples.capacity() as u64;
    let data_ptr = final_samples.as_mut_ptr();
    std::mem::forget(final_samples);

    let buf = Box::new(RustAudioBuffer {
        data: data_ptr, total_samples, capacity, channels, sample_rate: final_rate 
    });'''

if target in text:
    text = text.replace(target, replacement)
    with open('src-tauri/src/lib.rs', 'w') as f:
        f.write(text)
    print("Replaced rust_decode_file")
else:
    print("Not found")

