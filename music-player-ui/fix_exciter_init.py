import re

with open('../audio-engine-cpp/DSP_Nodes.h', 'r') as f:
    text = f.read()

target = '''    void init(float sampleRate) {
        // Equivalent to HP_COEF = 0.40f at 44100 Hz
        // alpha = 1.0 - exp(-2 * pi * Fc / Fs) -> Fc ~ 3600 Hz
        float fc = 3600.0f;
        float sr = (sampleRate > 0) ? sampleRate : 44100.0f;
        hpCoef = 1.0f - expf(-2.0f * (float)M_PI * fc / sr);
    }'''

replacement = '''    void init(float sampleRate) {
        os.init();
        dryDelay = (int)(os.latencySamples() + 0.5f);
        memset(dryDelayL, 0, sizeof(dryDelayL));
        memset(dryDelayR, 0, sizeof(dryDelayR));
        dryIdx = 0;
    }'''

text = text.replace(target, replacement)

with open('../audio-engine-cpp/DSP_Nodes.h', 'w') as f:
    f.write(text)
