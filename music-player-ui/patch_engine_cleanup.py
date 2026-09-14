import os
import re

with open('../audio-engine-cpp/EngineCore.cpp', 'r') as f:
    text = f.read()

target = r'    g_compressorNode\.attackCoef = expf\(-1\.0f / \(0\.005f \* \(float\)sr\)\);\s*g_compressorNode\.releaseCoef = expf\(-1\.0f / \(0\.150f \* \(float\)sr\)\);\s*g_compressorNode\.delayLpStateL = 0\.0f;\s*g_compressorNode\.delayLpStateR = 0\.0f;'
text = re.sub(target, '', text)

target2 = r'    g_compressorNode\.delaySamples = \(int\)\(0\.001f \* sr\); // 1ms lookahead\s*'
text = re.sub(target2, '', text)

with open('../audio-engine-cpp/EngineCore.cpp', 'w') as f:
    f.write(text)
print("Removed old variable initializations from EngineCore")
