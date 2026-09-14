import sys
with open('../audio-engine-cpp/DSP_Nodes.cpp', 'r') as f:
    text = f.read()

idx = text.find('limiter_process(')
if idx != -1:
    print(text[idx:idx+1500])
