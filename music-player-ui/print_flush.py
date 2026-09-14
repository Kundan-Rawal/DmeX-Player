import sys

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'r') as f:
    text = f.read()

idx = text.find('dsp_flush_all_state')
print(text[idx:idx+2000])
