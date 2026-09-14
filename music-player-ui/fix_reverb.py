import sys

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'r') as f:
    text = f.read()

target = '''    for (int i = 0; i < 8; ++i) {
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

replacement = '''    for (int i = 0; i < 4; ++i) {
        memset(g_reverbNode.combL[i].buf, 0, sizeof(g_reverbNode.combL[i].buf));
        g_reverbNode.combL[i].idx = 0;
        g_reverbNode.combL[i].store = 0;
        memset(g_reverbNode.combR[i].buf, 0, sizeof(g_reverbNode.combR[i].buf));
        g_reverbNode.combR[i].idx = 0;
        g_reverbNode.combR[i].store = 0;
    }
    for (int i = 0; i < 2; ++i) {
        memset(g_reverbNode.apL[i].buf, 0, sizeof(g_reverbNode.apL[i].buf));
        g_reverbNode.apL[i].idx = 0;
        memset(g_reverbNode.apR[i].buf, 0, sizeof(g_reverbNode.apR[i].buf));
        g_reverbNode.apR[i].idx = 0;
    }'''

if target in text:
    text = text.replace(target, replacement)
    with open('../audio-engine-cpp/DSP_Nodes.cpp', 'w') as f:
        f.write(text)
    print("Fixed!")
else:
    print("Target not found.")

