import os
import re

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'r') as f:
    text = f.read()

text = text.replace('if (g_widenGate.fullyOff()) { memcpy(out, in, sizeof(float) * N * 2); return; }', 'if (!g_isWidenOn) { memcpy(out, in, sizeof(float) * N * 2); return; }')
text = text.replace('float gate = g_widenGate.next();', 'float gate = 1.0f;')

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'w') as f:
    f.write(text)
print("Fixed widener_process bypass logic")
