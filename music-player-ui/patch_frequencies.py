import os
import re

with open('../audio-engine-cpp/EngineCore.cpp', 'r') as f:
    text = f.read()

# Fix AudiophileEQNode frequencies
text = text.replace('g_audiophileEQNode.xoverL.init((float)sr, 178.0f, 2031.0f);', 'g_audiophileEQNode.xoverL.init((float)sr, 180.0f, 8000.0f);')
text = text.replace('g_audiophileEQNode.xoverR.init((float)sr, 178.0f, 2031.0f);', 'g_audiophileEQNode.xoverR.init((float)sr, 180.0f, 8000.0f);')

# Fix MultibandCompressorNode frequencies and ratio
text = text.replace('g_compressorNode.xoverL.init((float)sr, 106.0f, 2500.0f);', 'g_compressorNode.xoverL.init((float)sr, 150.0f, 2500.0f);')
text = text.replace('g_compressorNode.xoverR.init((float)sr, 106.0f, 2500.0f);', 'g_compressorNode.xoverR.init((float)sr, 150.0f, 2500.0f);')

# Change bandLo ratio to 1.0f to bypass bass compression
target_band_lo = r'g_compressorNode\.bandLo\.init\(\(float\)sr, 10\.0f, 150\.0f, 1\.67f, 1\.0f, 1\.0f\);'
replace_band_lo = 'g_compressorNode.bandLo.init((float)sr, 10.0f, 150.0f, 1.0f, 1.0f, 1.0f); // 1.0 ratio = uncompressed bass (MAX THUMP)'
text = re.sub(target_band_lo, replace_band_lo, text)

with open('../audio-engine-cpp/EngineCore.cpp', 'w') as f:
    f.write(text)
print("Updated EngineCore.cpp frequencies to restore original voicing and bass thump")
