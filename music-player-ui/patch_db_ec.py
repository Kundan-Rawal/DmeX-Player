import os
import re

with open('../audio-engine-cpp/EngineCore.cpp', 'r') as f:
    text = f.read()

target = r'    g_spatializerNode\.crossSubwooferL\.init\(\(float\)sr, 180\.0f\);\s*g_spatializerNode\.crossSubwooferR\.init\(\(float\)sr, 180\.0f\);'
replace = '''    g_spatializerNode.crossSubwooferL.init((float)sr, 180.0f);
    g_spatializerNode.crossSubwooferR.init((float)sr, 180.0f);
    g_spatializerNode.depthAmount.init(0.0f);
    g_spatializerNode.bandsMid.init((float)sr);
    g_spatializerNode.bandsSide.init((float)sr);'''

text = re.sub(target, replace, text)

with open('../audio-engine-cpp/EngineCore.cpp', 'w') as f:
    f.write(text)
print("Updated EngineCore.cpp with directional bands init")
