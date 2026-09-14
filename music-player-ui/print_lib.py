import sys
with open('src-tauri/src/lib.rs', 'r') as f:
    text = f.read()

idx = text.find('fn get_metrics')
if idx != -1:
    print(text[idx:idx+1000])
