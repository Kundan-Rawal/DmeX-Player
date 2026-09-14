import sys

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'r') as f:
    text = f.read()

idx = text.find('exciter_process')
print(text[idx:idx+1500])
