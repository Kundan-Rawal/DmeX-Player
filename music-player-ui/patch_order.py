import os
import re

with open('../audio-engine-cpp/EngineCore.cpp', 'r') as f:
    text = f.read()

target = r'    ma_node_attach_output_bus\(&g_convolutionNode, 0, &g_audiophileEQNode, 0\);\s*ma_node_attach_output_bus\(&g_audiophileEQNode, 0, &g_compressorNode, 0\);\s*ma_node_attach_output_bus\(&g_compressorNode, 0, &g_subwooferNode, 0\);\s*ma_node_attach_output_bus\(&g_subwooferNode, 0, &g_exciterNode, 0\);\s*ma_node_attach_output_bus\(&g_exciterNode, 0, &g_widenerNode, 0\);'

replace = '''    ma_node_attach_output_bus(&g_convolutionNode, 0, &g_audiophileEQNode, 0);
    ma_node_attach_output_bus(&g_audiophileEQNode, 0, &g_subwooferNode, 0);
    ma_node_attach_output_bus(&g_subwooferNode, 0, &g_exciterNode, 0);
    ma_node_attach_output_bus(&g_exciterNode, 0, &g_compressorNode, 0);
    ma_node_attach_output_bus(&g_compressorNode, 0, &g_widenerNode, 0);'''

text = re.sub(target, replace, text)

with open('../audio-engine-cpp/EngineCore.cpp', 'w') as f:
    f.write(text)
print("Updated node attachment order")
