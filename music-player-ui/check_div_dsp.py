import sys

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'r') as f:
    for i, line in enumerate(f):
        if '/' in line:
            print(f"DSP_Nodes.cpp:{i+1}: {line.strip()}")
