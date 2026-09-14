import os
import re

with open('../audio-engine-cpp/DSP_Nodes.h', 'r') as f:
    text = f.read()

target = r'    DirectionalBands bandsMid, bandsSide;'
replace = '''    DirectionalBands bandsMid, bandsSide;
    float lastDepth = -1.0f;'''

text = re.sub(target, replace, text)

with open('../audio-engine-cpp/DSP_Nodes.h', 'w') as f:
    f.write(text)
print("Added lastDepth to PsychoacousticNode")
