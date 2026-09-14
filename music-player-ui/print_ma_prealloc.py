import sys

with open('../audio-engine-cpp/miniaudio.h', 'r') as f:
    text = f.read()

idx = text.find('MA_API ma_result ma_node_init_preallocated(')
if idx != -1:
    print(text[idx:idx+2000])
