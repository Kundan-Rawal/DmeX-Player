import os
import re

with open('../audio-engine-cpp/DSP_Nodes.h', 'r') as f:
    text = f.read()

tau_func = '''inline float tauCoef(float timeMs, float sr) {
    if (timeMs <= 0.001f) return 1.0f;
    return 1.0f - expf(-1.0f / (timeMs * 0.001f * sr));
}
'''
if 'tauCoef(float timeMs' not in text:
    text = text.replace('#define DSP_NODES_H', '#define DSP_NODES_H\n#include <math.h>\n' + tau_func)
    # just in case it doesn't have the include guard
    if 'tauCoef' not in text:
        text = '#include <math.h>\n' + tau_func + text

with open('../audio-engine-cpp/DSP_Nodes.h', 'w') as f:
    f.write(text)
print("Added tauCoef to DSP_Nodes.h")
