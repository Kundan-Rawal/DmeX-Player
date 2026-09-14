import os
import re

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'r') as f:
    text = f.read()

# Fix g_coef.sr
text = text.replace('g_coef.sr', '((float)engine_get_sample_rate())')
text = text.replace('g_coef.compLookahead', '(int)(0.001f * engine_get_sample_rate())')
text = text.replace('#include "DSP_Coeffs.h"', 'extern "C" int engine_get_sample_rate();')

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'w') as f:
    f.write(text)
print("Replaced g_coef usage in DSP_Nodes.cpp")
