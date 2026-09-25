#pragma once


// Blauert directional-band shaper.
//   depth: 0 = off, 1 = full effect
//   Positive `frontness pushes the image forward, negative pushes it back.
struct DirectionalBands {
    BiquadPeak front1, front2;     // 450 Hz, 3.5 kHz
    BiquadPeak back1,  back2;      // 1.2 kHz, 11 kHz
    BiquadPeak up1;                // 8.5 kHz
    float sr = 48000.0f;

    void init(float sampleRate) {
        sr = sampleRate;
        setPosition(0.0f, 0.0f, 1.0f);
    }

    void reset() {
        front1.reset(); front2.reset();
        back1.reset();  back2.reset();
        up1.reset();
    }

    void setPosition(float frontness, float elevation, float depth) {
        float f_gain = 0.0f;
        float b_gain = 0.0f;
        
        if (frontness > 0.0f) {
            f_gain = 2.5f * frontness * depth;
            b_gain = -1.5f * frontness * depth;
        } else {
            b_gain = 2.5f * (-frontness) * depth;
            f_gain = -1.5f * (-frontness) * depth;
        }

        float u_gain = 2.0f * elevation * depth;

        front1.init(sr, 450.0f, 1.0f, f_gain);
        front2.init(sr, 3500.0f, 1.4f, f_gain);
        
        back1.init(sr, 1200.0f, 0.9f, b_gain);
        back2.init(sr, 11000.0f, 1.5f, b_gain);

        up1.init(sr, 8500.0f, 1.2f, u_gain);
    }

    inline float process(float x) {
        return up1.process(back2.process(back1.process(front2.process(front1.process(x)))));
    }
};

