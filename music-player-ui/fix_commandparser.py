import re

with open('../audio-engine-cpp/CommandParser.cpp', 'r') as f:
    text = f.read()

text = text.replace('g_exciterNode.targetDrive = val * 4.0f;', 'g_exciterNode.drive.set(val * 4.0f);')

with open('../audio-engine-cpp/CommandParser.cpp', 'w') as f:
    f.write(text)
