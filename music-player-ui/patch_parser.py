import sys

with open('../audio-engine-cpp/CommandParser.cpp', 'r') as f:
    text = f.read()

target = '''    if (!g_soundInitialized || !g_engineInitialized)
    {
        memset(out_data, 0, 10 * sizeof(float));
        out_data[6] = 1.0f;
        out_data[9] = 1.0f;
        *out_level = 0.0f;
        return;
    }'''

replacement = '''    if (!g_soundInitialized || !g_engineInitialized)
    {
        memset(out_data, 0, 11 * sizeof(float));
        out_data[6] = 1.0f;
        out_data[9] = 1.0f;
        out_data[10] = 1.0f; // No gain reduction when stopped
        *out_level = 0.0f;
        return;
    }'''

text = text.replace(target, replacement)

target2 = '''    out_data[8] = g_tPan.load(std::memory_order_relaxed);
    out_data[9] = g_tPhase.load(std::memory_order_relaxed);
    *out_level = g_audioLevel.load(std::memory_order_relaxed);
}'''

replacement2 = '''    out_data[8] = g_tPan.load(std::memory_order_relaxed);
    out_data[9] = g_tPhase.load(std::memory_order_relaxed);
    extern std::atomic<float> g_limiterGR;
    out_data[10] = g_limiterGR.load(std::memory_order_relaxed);
    *out_level = g_audioLevel.load(std::memory_order_relaxed);
}'''

if target2 in text:
    text = text.replace(target2, replacement2)
    with open('../audio-engine-cpp/CommandParser.cpp', 'w') as f:
        f.write(text)
    print("Replaced CommandParser.cpp")
else:
    print("Not found in CommandParser.cpp")

