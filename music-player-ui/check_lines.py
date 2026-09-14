import sys

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'r') as f:
    lines = f.readlines()

print(f"Line 40: {lines[39].strip()}")
print(f"Line 413: {lines[412].strip()}")
