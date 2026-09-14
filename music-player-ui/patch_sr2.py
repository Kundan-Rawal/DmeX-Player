import os
import re

with open('../audio-engine-cpp/EngineCore.cpp', 'r') as f:
    text = f.read()

target = r'extern "C" void init_audio_engine\(\)'
replace = '''extern "C" int engine_get_sample_rate()
{
    if (!g_engineInitialized) return 48000;
    return ma_engine_get_sample_rate(&g_engine);
}

extern "C" void init_audio_engine()'''

text = re.sub(target, replace, text)

with open('../audio-engine-cpp/EngineCore.cpp', 'w') as f:
    f.write(text)
print("Added engine_get_sample_rate")
