import os
import re

with open('../audio-engine-cpp/EngineCore.cpp', 'r') as f:
    text = f.read()

target = r'    g_widenerNode\.width\.init\(1\.0f\);'
replace = '''    g_widenerNode.width.init(1.0f);
    g_widenerNode.xoverL.init((float)sr, 200.0f, 4000.0f);
    g_widenerNode.xoverR.init((float)sr, 200.0f, 4000.0f);
    g_widenerNode.corrEnv = 1.0f;'''

text = re.sub(target, replace, text)

with open('../audio-engine-cpp/EngineCore.cpp', 'w') as f:
    f.write(text)
print("Initialized g_widenerNode crossovers in EngineCore")
