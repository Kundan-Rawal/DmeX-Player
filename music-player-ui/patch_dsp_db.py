import os
import re

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'r') as f:
    text = f.read()

target = r'        // 1\. The 5\.1 Extraction Matrix\s*float center = \(inL \+ inR\) \* 0\.5f;\s*float sideL  = \(inL - inR\) \* 0\.5f;\s*float sideR  = \(inR - inL\) \* 0\.5f; '
replace = '''        // 1. The 5.1 Extraction Matrix
        float center = (inL + inR) * 0.5f;
        float sideL  = (inL - inR) * 0.5f;
        
        // T15: Apply Blauert Directional Bands
        float depth = p->depthAmount.next();
        p->bandsMid.setPosition(0.7f, 0.0f, depth);
        p->bandsSide.setPosition(-0.5f, 0.0f, depth);
        
        center = p->bandsMid.process(center);
        sideL = p->bandsSide.process(sideL);
        float sideR  = -sideL; '''

text = re.sub(target, replace, text)

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'w') as f:
    f.write(text)
print("Applied DirectionalBands to psychoacoustic_process")
