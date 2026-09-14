import os

with open('../audio-engine-cpp/DSP_Nodes.h', 'r') as f:
    text = f.read()

target1 = '''        a1 = -2.0f * cosw0 / a0;
        a2 = (1.0f - alpha) / a0;
    }

    float process(float in)'''

replacement1 = '''        a1 = -2.0f * cosw0 / a0;
        a2 = (1.0f - alpha) / a0;
    }

    void reset() { x1 = 0; x2 = 0; y1 = 0; y2 = 0; }

    float process(float in)'''

text = text.replace(target1, replacement1)

target2 = '''        a1 = -2.0f * cosw0 / a0;
        a2 = (1.0f - alpha) / a0;
    }

    float process(float input)'''

replacement2 = '''        a1 = -2.0f * cosw0 / a0;
        a2 = (1.0f - alpha) / a0;
    }

    void reset() { x1 = 0; x2 = 0; y1 = 0; y2 = 0; }

    float process(float input)'''

text = text.replace(target2, replacement2)

target3 = '''        hpf1.init(sample_rate, cutoff_hz);
        hpf2.init(sample_rate, cutoff_hz);
    }

    // Splits a single signal into Low and High with perfect flat-sum phase alignment'''

replacement3 = '''        hpf1.init(sample_rate, cutoff_hz);
        hpf2.init(sample_rate, cutoff_hz);
    }

    void reset() { lpf1.reset(); lpf2.reset(); hpf1.reset(); hpf2.reset(); }

    // Splits a single signal into Low and High with perfect flat-sum phase alignment'''

text = text.replace(target3, replacement3)

with open('../audio-engine-cpp/DSP_Nodes.h', 'w') as f:
    f.write(text)
print("Updated DSP_Nodes.h with reset()")
