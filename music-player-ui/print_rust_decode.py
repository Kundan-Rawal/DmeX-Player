import sys
with open('src-tauri/src/lib.rs', 'r') as f:
    text = f.read()

idx = text.find('pub extern "C" fn rust_decode_file')
if idx != -1:
    print(text[idx:idx+2500])
