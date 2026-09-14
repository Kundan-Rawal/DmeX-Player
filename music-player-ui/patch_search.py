import os
import re

with open('../audio-engine-cpp/DSP_Nodes.h', 'r') as f:
    text = f.read()

match = re.search(r'[^\{]*?SmoothedParam.*?\}', text, re.DOTALL)
if match:
    print(match.group(0))
else:
    print("Not found")
