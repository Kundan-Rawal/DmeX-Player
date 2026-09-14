import sys

with open('../audio-engine-cpp/Telemetry.cpp', 'r') as f:
    text = f.read()

target = '''std::atomic<float> g_tLvl{0.0f}, g_tPan{0.0f}, g_tPhase{1.0f};'''
replacement = '''std::atomic<float> g_tLvl{0.0f}, g_tPan{0.0f}, g_tPhase{1.0f};
std::atomic<float> g_limiterGR{1.0f};'''

if target in text:
    text = text.replace(target, replacement)
    with open('../audio-engine-cpp/Telemetry.cpp', 'w') as f:
        f.write(text)
    print("Replaced Telemetry.cpp")
else:
    print("Not found in Telemetry.cpp")
