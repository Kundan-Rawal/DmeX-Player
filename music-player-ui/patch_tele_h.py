import sys

with open('../audio-engine-cpp/Telemetry.h', 'r') as f:
    text = f.read()

target = '''extern std::atomic<float> g_tLvl, g_tPan, g_tPhase;'''
replacement = '''extern std::atomic<float> g_tLvl, g_tPan, g_tPhase;
extern std::atomic<float> g_limiterGR;'''

if target in text:
    text = text.replace(target, replacement)
    with open('../audio-engine-cpp/Telemetry.h', 'w') as f:
        f.write(text)
    print("Replaced Telemetry.h")
else:
    print("Not found in Telemetry.h")
