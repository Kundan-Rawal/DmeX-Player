import os
import re

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'r') as f:
    text = f.read()

target_eq = '''        // 1. Isolate the full Bass band up to 180Hz (Sub-bass + Kick Punch + Bass Guitar)
        float bassBandL, nonBassL, bassBandR, nonBassR;
        p->crossMidBassL.process(L, bassBandL, nonBassL);
        p->crossMidBassR.process(R, bassBandR, nonBassR);

        // 2. Isolate the Mids from the Treble (8000Hz LR4 Crossover)
        float midL, trebleL, midR, trebleR;
        p->crossTrebleL.process(nonBassL, midL, trebleL);
        p->crossTrebleR.process(nonBassR, midR, trebleR);'''

replace_eq = '''        // Phase-coherent 3-way Linkwitz-Riley crossover
        float bassBandL, midL, trebleL;
        p->xoverL.process(L, bassBandL, midL, trebleL);
        float bassBandR, midR, trebleR;
        p->xoverR.process(R, bassBandR, midR, trebleR);'''

text = text.replace(target_eq, replace_eq)

target_sub = '''        // 1. Isolate everything below 180Hz (The entire bass range)
        float totalBassL, nonBassL, totalBassR, nonBassR;
        p->crossMidBassL.process(L, totalBassL, nonBassL);
        p->crossMidBassR.process(R, totalBassR, nonBassR);

        // 2. Split the Bass into Sub-Bass (0-80Hz) and Mid-Bass (80-180Hz)
        float subL, midBassL, subR, midBassR;
        p->crossBassL.process(totalBassL, subL, midBassL);
        p->crossBassR.process(totalBassR, subR, midBassR);'''

replace_sub = '''        // Phase-coherent 3-way split: 0-78Hz (sub), 78-180Hz (mid-bass), 180Hz+ (non-bass)
        float subL, midBassL, nonBassL;
        p->xoverL.process(L, subL, midBassL, nonBassL);
        float subR, midBassR, nonBassR;
        p->xoverR.process(R, subR, midBassR, nonBassR);'''

text = text.replace(target_sub, replace_sub)

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'w') as f:
    f.write(text)
print("Updated DSP_Nodes.cpp for EQ and Subwoofer")
