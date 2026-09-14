import sys

with open('../audio-engine-cpp/miniaudio.h', 'r') as f:
    text = f.read()

idx = text.find('MA_API ma_result ma_node_init_preallocated(')
idx2 = text.find('MA_API ma_result ma_node_init_preallocated(', idx+100)
if idx2 != -1:
    print(text[idx2:idx2+1500])
