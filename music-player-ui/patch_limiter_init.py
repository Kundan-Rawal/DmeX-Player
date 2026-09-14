import sys

with open('../audio-engine-cpp/EngineCore.cpp', 'r') as f:
    text = f.read()

target = '''    g_limiterNode.boost.init(1.0f);
    g_limiterNode.gainEnv = 1.0f;
    g_limiterNode.peakEnv = 0.0f;
    g_limiterNode.attackCoef = expf(-1.0f / (0.0005f * (float)sr)); // Ultra-fast attack to prevent DAC hard-clipping
    g_limiterNode.releaseCoef = expf(-1.0f / (0.150f * (float)sr));
    g_limiterNode.delaySamples = (int)(0.002f * sr); // 2ms lookahead
    memset(g_limiterNode.dlyL, 0, sizeof(g_limiterNode.dlyL));
    memset(g_limiterNode.dlyR, 0, sizeof(g_limiterNode.dlyR));'''

replacement = '''    g_limiterNode.boost.init(1.0f);
    g_limiterNode.gainEnv = 1.0f;
    g_limiterNode.gainSmooth = 1.0f;
    g_limiterNode.peakEnv = 0.0f;
    g_limiterNode.attackCoef = expf(-1.0f / (0.0005f * (float)sr)); // Ultra-fast attack to prevent DAC hard-clipping
    g_limiterNode.releaseCoef = expf(-1.0f / (0.150f * (float)sr));
    g_limiterNode.delaySamples = (int)(0.002f * sr); // 2ms lookahead
    memset(g_limiterNode.dlyL, 0, sizeof(g_limiterNode.dlyL));
    memset(g_limiterNode.dlyR, 0, sizeof(g_limiterNode.dlyR));
    g_limiterNode.osDetect.init(sr);
    g_limiterNode.sr = sr;'''

if target in text:
    text = text.replace(target, replacement)
    with open('../audio-engine-cpp/EngineCore.cpp', 'w') as f:
        f.write(text)
    print("Replaced limiter init")
else:
    print("Not found")

