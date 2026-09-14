import sys
with open('../audio-engine-cpp/EngineCore.cpp', 'r') as f:
    text = f.read()

idx = text.find('g_exciterNode.hpStateL')
if idx != -1:
    print(text[max(0, idx-200):idx+200])
