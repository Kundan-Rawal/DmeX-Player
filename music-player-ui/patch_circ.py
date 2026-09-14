import os
import re

with open('../audio-engine-cpp/DirectionalBands.h', 'r') as f:
    db = f.read()
db = db.replace('#include "DSP_Nodes.h"', '')
with open('../audio-engine-cpp/DirectionalBands.h', 'w') as f:
    f.write(db)

with open('../audio-engine-cpp/DSP_Nodes.h', 'r') as f:
    text = f.read()

text = text.replace('#include "DirectionalBands.h"', '')

target = r'struct BiquadPeak\s*\{.*?\};\n'
match = re.search(target, text, re.DOTALL)
if match:
    text = text[:match.end()] + '#include "DirectionalBands.h"\n' + text[match.end():]

with open('../audio-engine-cpp/DSP_Nodes.h', 'w') as f:
    f.write(text)
print("Fixed circular include for DirectionalBands")
