import os
import re

with open('../audio-engine-cpp/EngineCore.cpp', 'r') as f:
    text = f.read()

# Replace AudiophileEQNode initialization
old_eq_init = '''    g_audiophileEQNode.crossBassL.init((float)sr, 80.0f);
    g_audiophileEQNode.crossBassR.init((float)sr, 80.0f);
    g_audiophileEQNode.crossMidBassL.init((float)sr, 180.0f);
    g_audiophileEQNode.crossMidBassR.init((float)sr, 180.0f);
    g_audiophileEQNode.crossTrebleL.init((float)sr, 8000.0f);
    g_audiophileEQNode.crossTrebleR.init((float)sr, 8000.0f);'''
new_eq_init = '''    g_audiophileEQNode.xoverL.init((float)sr, 178.0f, 2031.0f);
    g_audiophileEQNode.xoverR.init((float)sr, 178.0f, 2031.0f);'''
text = text.replace(old_eq_init, new_eq_init)

# Replace SubwooferNode initialization
old_sub_init = '''    g_subwooferNode.crossBassL.init((float)sr, 80.0f);
    g_subwooferNode.crossBassR.init((float)sr, 80.0f);
    g_subwooferNode.crossMidBassL.init((float)sr, 180.0f);
    g_subwooferNode.crossMidBassR.init((float)sr, 180.0f);'''
new_sub_init = '''    g_subwooferNode.xoverL.init((float)sr, 78.0f, 180.0f);
    g_subwooferNode.xoverR.init((float)sr, 78.0f, 180.0f);'''
text = text.replace(old_sub_init, new_sub_init)

# Check for MultibandCompressorNode initialization
old_comp_init = '''    g_compressorNode.crossL.init((float)sr, 150.0f);
    g_compressorNode.crossR.init((float)sr, 150.0f);'''
new_comp_init = '''    g_compressorNode.xoverL.init((float)sr, 106.0f, 2500.0f);
    g_compressorNode.xoverR.init((float)sr, 106.0f, 2500.0f);
    g_compressorNode.bandLo.init((float)sr, 10.0f, 150.0f, 1.67f, 1.0f, 1.0f);
    g_compressorNode.bandMid.init((float)sr, 5.0f, 100.0f, 1.5f, 1.0f, 1.0f);
    g_compressorNode.bandHi.init((float)sr, 1.0f, 60.0f, 1.3f, 1.0f, 1.0f);'''
text = text.replace(old_comp_init, new_comp_init)

with open('../audio-engine-cpp/EngineCore.cpp', 'w') as f:
    f.write(text)
print("Updated EngineCore.cpp initializations")
