import os
import re

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'r') as f:
    text = f.read()

# 1. Update dsp_flush_all_state for MultibandCompressorNode
target_flush = r'    g_compressorNode\.envLow  = 0\.0f;\s*g_compressorNode\.envHigh = 0\.0f;\s*g_compressorNode\.lpStateL = 0\.0f;\s*g_compressorNode\.lpStateR = 0\.0f;\s*g_compressorNode\.delayLpStateL = 0\.0f;\s*g_compressorNode\.delayLpStateR = 0\.0f;'
replace_flush = '''    g_compressorNode.bandLo.env = 0.0f;
    g_compressorNode.bandMid.env = 0.0f;
    g_compressorNode.bandHi.env = 0.0f;
    g_compressorNode.xoverL.reset();
    g_compressorNode.xoverR.reset();'''
text = re.sub(target_flush, replace_flush, text)

# Also flush xoverL / xoverR for AudiophileEQ and Subwoofer!
# Instead of crossBassL, crossMidBassL, etc
target_eq_flush = r'    g_audiophileEQNode\.crossBassL\.reset\(\);\s*g_audiophileEQNode\.crossBassR\.reset\(\);\s*g_audiophileEQNode\.crossMidBassL\.reset\(\);\s*g_audiophileEQNode\.crossMidBassR\.reset\(\);\s*g_audiophileEQNode\.crossTrebleL\.reset\(\);\s*g_audiophileEQNode\.crossTrebleR\.reset\(\);'
replace_eq_flush = '''    g_audiophileEQNode.xoverL.reset();
    g_audiophileEQNode.xoverR.reset();'''
text = re.sub(target_eq_flush, replace_eq_flush, text)

target_sub_flush = r'    g_subwooferNode\.crossBassL\.reset\(\);\s*g_subwooferNode\.crossBassR\.reset\(\);\s*g_subwooferNode\.crossMidBassL\.reset\(\);\s*g_subwooferNode\.crossMidBassR\.reset\(\);'
replace_sub_flush = '''    g_subwooferNode.xoverL.reset();
    g_subwooferNode.xoverR.reset();'''
text = re.sub(target_sub_flush, replace_sub_flush, text)

# 2. Add #include "DSP_Coeffs.h" at the top of DSP_Nodes.cpp if missing
if '#include "DSP_Coeffs.h"' not in text:
    text = '#include "DSP_Coeffs.h"\n' + text

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'w') as f:
    f.write(text)
print("Updated flush and includes in DSP_Nodes.cpp")
