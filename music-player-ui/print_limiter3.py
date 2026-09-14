import sys
with open('../audio-engine-cpp/DSP_Nodes.cpp', 'r') as f:
    text = f.read()

idx = text.find('static void limiter_process')
if idx != -1:
    print(text[idx:idx+2500])
