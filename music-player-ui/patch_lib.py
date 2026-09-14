import sys

with open('src-tauri/src/lib.rs', 'r') as f:
    text = f.read()

target = '''fn audio_metrics() -> Vec<f32> {
    let mut data = vec![0.0f32; 10]; 
    let mut level: f32 = 0.0;
    
    unsafe {
        get_audio_metrics(data.as_mut_ptr(), &mut level);
    }
    
    let finished = if data[0] > 0.0 && data[1] > 0.0 && data[0] >= (data[1] - 0.5) {
        1.0 
    } else { 
        0.0 
    };

    vec![
        data[0], data[1], data[2], data[3], data[4], data[5], 
        data[6], data[7], data[8], data[9], level, finished
    ]
}'''

replacement = '''fn audio_metrics() -> Vec<f32> {
    let mut data = vec![0.0f32; 11]; 
    let mut level: f32 = 0.0;
    
    unsafe {
        get_audio_metrics(data.as_mut_ptr(), &mut level);
    }
    
    let finished = if data[0] > 0.0 && data[1] > 0.0 && data[0] >= (data[1] - 0.5) {
        1.0 
    } else { 
        0.0 
    };

    vec![
        data[0], data[1], data[2], data[3], data[4], data[5], 
        data[6], data[7], data[8], data[9], data[10], level, finished
    ]
}'''

if target in text:
    text = text.replace(target, replacement)
    with open('src-tauri/src/lib.rs', 'w') as f:
        f.write(text)
    print("Replaced lib.rs")
else:
    print("Not found in lib.rs")

