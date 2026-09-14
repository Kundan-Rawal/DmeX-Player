import os
import re

with open('current_EngineCore.cpp', 'r') as f:
    cur_cpp = f.read()
with open('old_EngineCore.cpp', 'r') as f:
    old_cpp = f.read()

# I want to copy the initialization of g_audiophileEQNode, g_subwooferNode, g_compressorNode from old to cur
def extract_init(text, var_name):
    match = re.search(r'    ' + var_name + r'\..*?(?=\n    g_|\n    ma_node_init)', text, re.DOTALL)
    if not match:
        # maybe it's just one line or different
        match = re.search(r'    ' + var_name + r'\..*?\n', text)
    return match.group(0) if match else None

for var in ['g_audiophileEQNode', 'g_subwooferNode', 'g_compressorNode']:
    old_init = extract_init(old_cpp, var)
    cur_init = extract_init(cur_cpp, var)
    if old_init and cur_init:
        cur_cpp = cur_cpp.replace(cur_init, old_init)

with open('../audio-engine-cpp/EngineCore.cpp', 'w') as f:
    f.write(cur_cpp)
print("Restored EQ, Sub, Comp initializations in EngineCore")
