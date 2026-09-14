import sys

with open('../audio-engine-cpp/CommandParser.cpp', 'r') as f:
    text = f.read()

target = '''
extern "C" unsigned int engine_get_sample_rate(void)
{
    return (g_device.pContext != nullptr) ? g_device.sampleRate : 0u;
}
'''
text = text.replace(target, '')
with open('../audio-engine-cpp/CommandParser.cpp', 'w') as f:
    f.write(text)

with open('../audio-engine-cpp/EngineCore.cpp', 'r') as f:
    text2 = f.read()

if 'engine_get_sample_rate' not in text2:
    text2 += target
    with open('../audio-engine-cpp/EngineCore.cpp', 'w') as f:
        f.write(text2)

print("Moved engine_get_sample_rate to EngineCore.cpp")
