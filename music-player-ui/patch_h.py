import os
import re

with open('current_DSP_Nodes.h', 'r') as f:
    cur_h = f.read()
with open('old_DSP_Nodes.h', 'r') as f:
    old_h = f.read()

# Extract Crossover3 and tauCoef from cur_h
tau_coef_match = re.search(r'inline float tauCoef\(.*?\)\s*\{.*?\}', cur_h, re.DOTALL)
crossover3_match = re.search(r'// Phase-coherent 3-way Linkwitz-Riley crossover.*?struct Crossover3\s*\{.*?\};\n', cur_h, re.DOTALL)

# Extract new StereoWidenerNode from cur_h
widener_node_match = re.search(r'struct StereoWidenerNode\s*\{.*?\};\n', cur_h, re.DOTALL)

# Replace old StereoWidenerNode in old_h
old_h = re.sub(r'struct StereoWidenerNode\s*\{.*?\};\n', widener_node_match.group(0), old_h, flags=re.DOTALL)

# Add tauCoef and Crossover3 to old_h
# find LinkwitzRiley4 definition in old_h
lr4_idx = old_h.find('struct DynamicSpatializerNode')
if lr4_idx != -1:
    old_h = old_h[:lr4_idx] + crossover3_match.group(0) + '\n' + old_h[lr4_idx:]

if tau_coef_match and 'tauCoef' not in old_h:
    old_h = old_h.replace('#define DSP_NODES_H', '#define DSP_NODES_H\n#include <math.h>\n' + tau_coef_match.group(0) + '\n')

with open('../audio-engine-cpp/DSP_Nodes.h', 'w') as f:
    f.write(old_h)
print("Restored old DSP_Nodes.h with new Widener and Crossover3")

