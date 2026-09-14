import os
import re

with open('../audio-engine-cpp/EngineCore.cpp', 'r') as f:
    text = f.read()

target = r'extern "C"\s*\{\s*void engine_init\(\)\s*\{'
replace = '''extern "C" {

int engine_get_sample_rate()
{
    if (!g_soundInitialized) return 48000;
    return ma_engine_get_sample_rate(&g_engine);
}

void engine_init()
{'''

text = re.sub(target, replace, text)

with open('../audio-engine-cpp/EngineCore.cpp', 'w') as f:
    f.write(text)
print("Restored engine_get_sample_rate to EngineCore.cpp")
