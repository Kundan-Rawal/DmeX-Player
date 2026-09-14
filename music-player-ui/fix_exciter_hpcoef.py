import re

with open('../audio-engine-cpp/DSP_Nodes.h', 'r') as f:
    text = f.read()

target = '''        memset(dryDelayR, 0, sizeof(dryDelayR));
        dryIdx = 0;
    }'''
replacement = '''        memset(dryDelayR, 0, sizeof(dryDelayR));
        dryIdx = 0;
        float sr = (sampleRate > 0) ? sampleRate : 44100.0f;
        hpCoef = 1.0f - std::exp(-2.0f * 3.14159265f * 3600.0f / sr);
    }'''

text = text.replace(target, replacement)

with open('../audio-engine-cpp/DSP_Nodes.h', 'w') as f:
    f.write(text)

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'r') as f:
    text = f.read()

text = text.replace('g_coef.exciterHP', 'n->hpCoef')

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'w') as f:
    f.write(text)
