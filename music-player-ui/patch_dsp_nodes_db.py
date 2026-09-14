import os
import re

with open('../audio-engine-cpp/DSP_Nodes.h', 'r') as f:
    text = f.read()

# Add #include "DirectionalBands.h" at the top
if 'DirectionalBands.h' not in text:
    text = text.replace('#include "miniaudio.h"', '#include "miniaudio.h"\n#include "DirectionalBands.h"')

# Add bands to PsychoacousticNode
target = r'    SmoothedParam spatialIntensity;\n\};'
replace = '''    SmoothedParam spatialIntensity;
    SmoothedParam depthAmount;
    DirectionalBands bandsMid, bandsSide;
};'''

text = re.sub(target, replace, text)

with open('../audio-engine-cpp/DSP_Nodes.h', 'w') as f:
    f.write(text)
print("Updated DSP_Nodes.h with DirectionalBands")
