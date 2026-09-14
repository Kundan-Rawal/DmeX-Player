import os
import re

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'r') as f:
    text = f.read()

target = r'        float wetL = oLoL \+ oMidL \+ oHiL;\s*float wetR = oLoR \+ oMidR \+ oHiR;\s*// Energy compensation'
replace = '''        // Energy compensation'''

text = re.sub(target, replace, text)

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'w') as f:
    f.write(text)
print("Removed duplicate wetL/wetR")
