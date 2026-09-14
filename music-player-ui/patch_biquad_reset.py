import os
import re

with open('../audio-engine-cpp/DSP_Nodes.h', 'r') as f:
    text = f.read()

target = r'struct BiquadPeak\s*\{\s*float b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;\s*float x1 = 0, x2 = 0, y1 = 0, y2 = 0;'
replace = '''struct BiquadPeak
{
    float b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
    float x1 = 0, x2 = 0, y1 = 0, y2 = 0;

    inline void reset() { x1 = x2 = y1 = y2 = 0.0f; }'''

text = re.sub(target, replace, text)

with open('../audio-engine-cpp/DSP_Nodes.h', 'w') as f:
    f.write(text)
print("Added reset() to BiquadPeak")
