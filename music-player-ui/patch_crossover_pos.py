import os
import re

with open('../audio-engine-cpp/DSP_Nodes.h', 'r') as f:
    text = f.read()

# Extract Crossover3 definition
crossover_match = re.search(r'// Phase-coherent 3-way Linkwitz-Riley crossover.*?struct Crossover3 \{.*?\};\n', text, re.DOTALL)
if crossover_match:
    crossover_code = crossover_match.group(0)
    text = text.replace(crossover_code, '')
    
    # insert before DynamicSpatializerNode (which uses LinkwitzRiley4 and is near the top)
    insert_pos = text.find('struct DynamicSpatializerNode')
    if insert_pos == -1:
        insert_pos = text.find('struct StereoWidenerNode')
    text = text[:insert_pos] + crossover_code + '\n' + text[insert_pos:]

with open('../audio-engine-cpp/DSP_Nodes.h', 'w') as f:
    f.write(text)
print("Moved Crossover3 to top of DSP_Nodes.h")
