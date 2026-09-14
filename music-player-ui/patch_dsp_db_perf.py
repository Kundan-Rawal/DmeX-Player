import os
import re

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'r') as f:
    text = f.read()

target = r'        // T15: Apply Blauert Directional Bands\s*float depth = p->depthAmount\.next\(\);\s*p->bandsMid\.setPosition\(0\.7f, 0\.0f, depth\);\s*p->bandsSide\.setPosition\(-0\.5f, 0\.0f, depth\);\s*center = p->bandsMid\.process\(center\);\s*sideL = p->bandsSide\.process\(sideL\);\s*float sideR  = -sideL;'
replace = '''        // T15: Apply Blauert Directional Bands
        float depth = p->depthAmount.next();
        center = p->bandsMid.process(center);
        sideL = p->bandsSide.process(sideL);
        float sideR  = -sideL;'''

# Add setPosition outside the loop
target_loop = r'    float intensity = p->spatialIntensity\.next\(\);\s*if \(intensity < 0\.001f\)'
replace_loop = '''    // T15: Update Directional Bands (once per block is fine for coefficients)
    float currentDepth = p->depthAmount.getTarget(); // using getTarget to avoid per-sample powf
    p->bandsMid.setPosition(0.7f, 0.0f, currentDepth);
    p->bandsSide.setPosition(-0.5f, 0.0f, currentDepth);

    float intensity = p->spatialIntensity.next();

    if (intensity < 0.001f)'''

text = re.sub(target, replace, text)
text = re.sub(target_loop, replace_loop, text)

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'w') as f:
    f.write(text)
print("Moved setPosition out of per-sample loop")
