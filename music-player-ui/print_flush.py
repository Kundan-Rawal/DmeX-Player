import sys
with open('../audio-engine-cpp/DSP_Nodes.cpp', 'r') as f:
    text = f.read()

idx = text.find('g_exciterNode.hpStateL')
print(text[idx:idx+1000])
