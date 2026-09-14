import sys

with open('../audio-engine-cpp/CommandParser.cpp', 'r') as f:
    text = f.read()

func = '''
extern "C" unsigned int engine_get_sample_rate(void)
{
    return (g_device.pContext != nullptr) ? g_device.sampleRate : 0u;
}
'''

if 'engine_get_sample_rate' not in text:
    text += func
    with open('../audio-engine-cpp/CommandParser.cpp', 'w') as f:
        f.write(text)
    print("Added engine_get_sample_rate")
else:
    print("Already exists")
