import sys

with open('../audio-engine-cpp/EngineCore.cpp', 'r') as f:
    text = f.read()

target = '''    g_limiterNode.releaseCoef = expf(-1.0f / (0.150f * (float)sr));
    g_limiterNode.delaySamples = (int)(0.002f * sr); // 2ms lookahead
    memset(g_limiterNode.dlyL, 0, sizeof(g_limiterNode.dlyL));
    memset(g_limiterNode.dlyR, 0, sizeof(g_limiterNode.dlyR));
    g_limiterNode.osDetect.init(sr);
    g_limiterNode.sr = sr;'''

replacement = '''    g_limiterNode.releaseCoef = expf(-1.0f / (0.150f * (float)sr));
    g_limiterNode.delaySamples = (int)(0.002f * sr); // 2ms lookahead
    if (g_limiterNode.delaySamples >= LIMITER_LOOKAHEAD_SAMPLES) {
        g_limiterNode.delaySamples = LIMITER_LOOKAHEAD_SAMPLES - 1;
    }
    memset(g_limiterNode.dlyL, 0, sizeof(g_limiterNode.dlyL));
    memset(g_limiterNode.dlyR, 0, sizeof(g_limiterNode.dlyR));
    g_limiterNode.osDetect.init();
    g_limiterNode.sr = sr;'''

if target in text:
    text = text.replace(target, replacement)
    with open('../audio-engine-cpp/EngineCore.cpp', 'w') as f:
        f.write(text)
    print("Fixed EngineCore.cpp limiter init")
else:
    print("Not found in EngineCore.cpp")

