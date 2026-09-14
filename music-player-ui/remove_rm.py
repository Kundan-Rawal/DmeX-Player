import sys

with open('../audio-engine-cpp/EngineCore.cpp', 'r') as f:
    text = f.read()

text = text.replace('engineConfig.resourceManager = NULL;\n', '')

with open('../audio-engine-cpp/EngineCore.cpp', 'w') as f:
    f.write(text)
print("Removed resourceManager lines")
