import sys

with open('../audio-engine-cpp/miniaudio.h', 'r') as f:
    text = f.read()

idx = text.find('#define MA_ZERO_OBJECT')
print(text[idx:idx+200])
