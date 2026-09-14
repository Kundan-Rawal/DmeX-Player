import os
import re

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'r') as f:
    text = f.read()

# I previously removed the setPosition calls and added a block above the loop. I need to revert that and put it in the loop with the threshold check.

# 1. Remove the block above the loop
target_loop_remove = r'    // T15: Update Directional Bands.*?float intensity = p->spatialIntensity\.next\(\);\s*if \(intensity < 0\.001f\)'
replace_loop_remove = '''    float intensity = p->spatialIntensity.next();

    if (intensity < 0.001f)'''

text = re.sub(target_loop_remove, replace_loop_remove, text, flags=re.DOTALL)

# 2. Add back into the loop with threshold
target_loop_add = r'        // T15: Apply Blauert Directional Bands\s*float depth = p->depthAmount\.next\(\);\s*center = p->bandsMid\.process\(center\);\s*sideL = p->bandsSide\.process\(sideL\);\s*float sideR  = -sideL;'
replace_loop_add = '''        // T15: Apply Blauert Directional Bands
        float depth = p->depthAmount.next();
        if (fabs(depth - p->lastDepth) > 0.005f) {
            p->bandsMid.setPosition(0.7f, 0.0f, depth);
            p->bandsSide.setPosition(-0.5f, 0.0f, depth);
            p->lastDepth = depth;
        }
        center = p->bandsMid.process(center);
        sideL = p->bandsSide.process(sideL);
        float sideR  = -sideL;'''

text = re.sub(target_loop_add, replace_loop_add, text)

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'w') as f:
    f.write(text)
print("Updated psychoacoustic_process with efficient T15 processing")
