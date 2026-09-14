import os
import re

with open('../audio-engine-cpp/DSP_Nodes.h', 'r') as f:
    text = f.read()

target = r'struct StereoWidenerNode\s*\{\s*ma_node_base baseNode;\s*SmoothedParam width;\s*\};'
replace = '''struct StereoWidenerNode
{
    ma_node_base baseNode;
    SmoothedParam width;
    Crossover3 xoverL, xoverR;
    float corrEnv = 1.0f;
};'''

text = re.sub(target, replace, text)

with open('../audio-engine-cpp/DSP_Nodes.h', 'w') as f:
    f.write(text)
print("Updated StereoWidenerNode definition")
