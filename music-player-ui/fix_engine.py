import re

with open('../audio-engine-cpp/EngineCore.cpp', 'r') as f:
    text = f.read()

# Fix memset for g_exciterNode
text = text.replace('memset(&g_exciterNode, 0, sizeof(g_exciterNode));', 'g_exciterNode.hpStateL = 0; g_exciterNode.hpStateR = 0; g_exciterNode.os.reset();')

with open('../audio-engine-cpp/EngineCore.cpp', 'w') as f:
    f.write(text)
