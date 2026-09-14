import re

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'r') as f:
    text = f.read()

target = '''    memset(g_reverbNode.combL, 0, sizeof(g_reverbNode.combL));
    memset(g_reverbNode.combR, 0, sizeof(g_reverbNode.combR));
    memset(g_reverbNode.apL,   0, sizeof(g_reverbNode.apL));
    memset(g_reverbNode.apR,   0, sizeof(g_reverbNode.apR));'''

replacement = '''    for (int i = 0; i < 8; ++i) {
        memset(g_reverbNode.combL[i].buf, 0, sizeof(g_reverbNode.combL[i].buf));
        g_reverbNode.combL[i].idx = 0;
        g_reverbNode.combL[i].store = 0;
        memset(g_reverbNode.combR[i].buf, 0, sizeof(g_reverbNode.combR[i].buf));
        g_reverbNode.combR[i].idx = 0;
        g_reverbNode.combR[i].store = 0;
    }
    for (int i = 0; i < 4; ++i) {
        memset(g_reverbNode.apL[i].buf, 0, sizeof(g_reverbNode.apL[i].buf));
        g_reverbNode.apL[i].idx = 0;
        memset(g_reverbNode.apR[i].buf, 0, sizeof(g_reverbNode.apR[i].buf));
        g_reverbNode.apR[i].idx = 0;
    }'''

if target in text:
    text = text.replace(target, replacement)
    with open('../audio-engine-cpp/DSP_Nodes.cpp', 'w') as f:
        f.write(text)
    print("Reverb memset fixed.")
else:
    print("Could not find target memset in dsp_flush_all_state.")
