import sys

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'r') as f:
    text = f.read()

target = '''        for (ma_uint32 i = 0; i < fc; ++i)
        {
            float L = pIn[i * 2] * p->boost;
            float R = pIn[i * 2 + 1] * p->boost;'''

replacement = '''        for (ma_uint32 i = 0; i < fc; ++i)
        {
            float b = p->boost.next();
            float L = pIn[i * 2] * b;
            float R = pIn[i * 2 + 1] * b;'''

if target in text:
    text = text.replace(target, replacement)
    with open('../audio-engine-cpp/DSP_Nodes.cpp', 'w') as f:
        f.write(text)
    print("Fixed Android boost error")
else:
    print("Target not found")
