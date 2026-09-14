import sys

with open('../audio-engine-cpp/Oversampler.h', 'r') as f:
    text = f.read()

target = '''    inline void up(float x, float* out2) {
        zUp[idxUp] = x;'''

replacement = '''    inline void up(float x, float* out2) {
        if (zUp.size() == 0 || taps == 0 || h.size() == 0) { out2[0] = x; out2[1] = x; return; }
        zUp[idxUp] = x;'''

text = text.replace(target, replacement)

target2 = '''    inline float down(const float* in2) {
        float acc = 0.0f;'''

replacement2 = '''    inline float down(const float* in2) {
        if (zDown.size() == 0 || taps == 0 || h.size() == 0) return in2[0];
        float acc = 0.0f;'''

text = text.replace(target2, replacement2)

with open('../audio-engine-cpp/Oversampler.h', 'w') as f:
    f.write(text)
