import sys

with open('../audio-engine-cpp/Oversampler.h', 'r') as f:
    for i, line in enumerate(f):
        if '/' in line:
            print(f"Oversampler.h:{i+1}: {line.strip()}")
