import sys

with open('../audio-engine-cpp/CommandParser.cpp', 'r') as f:
    lines = f.readlines()

print(f"Line 299: {lines[298].strip()}")
print(f"Line 300: {lines[299].strip()}")
