import sys

with open('../audio-engine-cpp/EngineCore.cpp', 'r') as f:
    for i, line in enumerate(f):
        if '/' in line:
            print(f"EngineCore.cpp:{i+1}: {line.strip()}")
