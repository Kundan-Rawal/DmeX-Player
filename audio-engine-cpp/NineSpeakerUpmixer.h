#pragma once
#include <cmath>
#include <cstring>
#include <algorithm>
#include "DirectionalBands.h"
#include "SmoothedParam.h"

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// Delay buffer for contralateral (far) ear ITD
#define ITD_BUF_SIZE 512

struct VirtualSpeakerChannel {
    DirectionalBands pinna;
    BiquadLPF shadowLP;
    float delayBuf[ITD_BUF_SIZE];
    int writeIdx = 0;
    int itdSamples = 0;
    float gainNear = 1.0f;
    float gainFar = 0.5f;
    float azimuthDeg = 0.0f;
    float elevationDeg = 0.0f;

    void init(float sr, float azDeg, float elDeg) {
        azimuthDeg = azDeg;
        elevationDeg = elDeg;
        pinna.init(sr);

        float azRad = azDeg * (float)M_PI / 180.0f;
        float elRad = elDeg * (float)M_PI / 180.0f;

        // Directional pinna cues
        float frontness = cosf(azRad) * cosf(elRad);
        float elevation = sinf(elRad);
        pinna.setPosition(frontness, elevation, 0.85f);

        // Calculate Woodworth ITD for contralateral ear
        float absAz = fabsf(azRad);
        // r/c ~= 0.0875m / 343m/s = 0.000255s
        float itdSec = 0.000255f * (sinf(absAz) + absAz);
        itdSamples = (int)(itdSec * sr + 0.5f);
        if (itdSamples < 0) itdSamples = 0;
        if (itdSamples >= ITD_BUF_SIZE - 2) itdSamples = ITD_BUF_SIZE - 2;

        // Head shadow low-pass cutoff for far ear (drops from 5kHz down to 1.2kHz as azimuth reaches 90 deg)
        float shadowFc = 1200.0f + (1.0f - sinf(absAz)) * 3800.0f;
        if (shadowFc < 800.0f) shadowFc = 800.0f;
        shadowLP.init(sr, shadowFc);

        // ILD Far Ear gain (drops to ~0.50 (-6dB) at 90 deg)
        gainNear = 1.0f;
        gainFar = 1.0f - (0.45f * sinf(absAz));

        reset();
    }

    void reset() {
        pinna.reset();
        shadowLP.reset();
        memset(delayBuf, 0, sizeof(delayBuf));
        writeIdx = 0;
    }

    inline void process(float inSample, float& outL, float& outR) {
        // 1. Directional Pinna Filtering
        float shaped = pinna.process(inSample);

        // 2. Center speaker case (Azimuth == 0)
        if (fabsf(azimuthDeg) < 1.0f) {
            outL += shaped * 0.707f;
            outR += shaped * 0.707f;
            return;
        }

        // Store in delay line for far ear ITD
        delayBuf[writeIdx] = shaped;
        int readIdx = writeIdx - itdSamples;
        if (readIdx < 0) readIdx += ITD_BUF_SIZE;
        float delayed = delayBuf[readIdx];
        if (++writeIdx >= ITD_BUF_SIZE) writeIdx = 0;

        // Far ear receives delayed + head-shadowed low-passed signal
        float farSignal = shadowLP.process(delayed) * gainFar;
        float nearSignal = shaped * gainNear;

        // Speaker on Left (Azimuth < 0): Left ear is Near, Right ear is Far
        if (azimuthDeg < 0.0f) {
            outL += nearSignal;
            outR += farSignal;
        } else {
            // Speaker on Right (Azimuth > 0): Right ear is Near, Left ear is Far
            outR += nearSignal;
            outL += farSignal;
        }
    }
};

class NineSpeakerUpmixer {
public:
    VirtualSpeakerChannel speakers[9];
    LinkwitzRiley4 crossBassL, crossBassR;
    float corrEnv = 0.5f;
    float corrCoef = 0.002f;
    float sr = 48000.0f;

    void init(float sampleRate) {
        sr = sampleRate > 0.0f ? sampleRate : 48000.0f;

        // Crossover to preserve punchy stereo bass (< 180 Hz)
        crossBassL.init(sr, 180.0f);
        crossBassR.init(sr, 180.0f);

        corrCoef = tauCoef(40.0f, sr); // 40ms correlation tracking
        corrEnv = 0.5f;

        // 9 Speaker Positions according to T19 spec:
        // 0: FrontLeft (-30°, 0°)
        // 1: FrontCenter (0°, 0°)
        // 2: FrontRight (+30°, 0°)
        // 3: SideLeft (-90°, 0°)
        // 4: SideRight (+90°, 0°)
        // 5: BackLeft (-135°, 0°)
        // 6: BackRight (+135°, 0°)
        // 7: HeightLeft (-45°, +35°)
        // 8: HeightRight (+45°, +35°)
        speakers[0].init(sr, -30.0f,   0.0f);
        speakers[1].init(sr,   0.0f,   0.0f);
        speakers[2].init(sr, +30.0f,   0.0f);
        speakers[3].init(sr, -90.0f,   0.0f);
        speakers[4].init(sr, +90.0f,   0.0f);
        speakers[5].init(sr, -135.0f,  0.0f);
        speakers[6].init(sr, +135.0f,  0.0f);
        speakers[7].init(sr, -45.0f, +35.0f);
        speakers[8].init(sr, +45.0f, +35.0f);

        reset();
    }

    void reset() {
        crossBassL.reset();
        crossBassR.reset();
        corrEnv = 0.5f;
        for (int i = 0; i < 9; ++i) {
            speakers[i].reset();
        }
    }

    // Processes one stereo frame. Real-time safe: no allocations, no locks.
    inline void process(float inL, float inR, float& outL, float& outR) {
        // 0. Extract Bass (<180Hz) to keep it 100% dry, punchy & in stereo
        float bassL = 0.0f, nonBassL = 0.0f;
        float bassR = 0.0f, nonBassR = 0.0f;
        crossBassL.process(inL, bassL, nonBassL);
        crossBassR.process(inR, bassR, nonBassR);

        float L = nonBassL;
        float R = nonBassR;

        // 1. Mid / Side Separation
        float mid  = (L + R) * 0.5f;
        float side = (L - R) * 0.5f;

        // 2. Real-time correlation tracking
        float instCorr = (L * R) / (0.5f * (L * L + R * R) + 1e-9f);
        instCorr = fmaxf(0.0f, fminf(1.0f, instCorr));
        corrEnv += (instCorr - corrEnv) * corrCoef;
        float c = corrEnv;

        // 3. Intelligent Upmix Decomposition
        float centre = mid * c;
        float restL  = L - centre;
        float restR  = R - centre;

        float ambL = side * (1.0f - c);
        float ambR = -side * (1.0f - c);

        float mono9[9];
        mono9[0] = restL * 0.80f;                 // FrontLeft
        mono9[1] = centre * 0.95f;                // FrontCenter
        mono9[2] = restR * 0.80f;                 // FrontRight
        mono9[3] = restL * 0.25f + ambL * 0.35f;  // SideLeft
        mono9[4] = restR * 0.25f + ambR * 0.35f;  // SideRight
        mono9[5] = ambL * 0.40f;                  // BackLeft
        mono9[6] = ambR * 0.40f;                  // BackRight
        mono9[7] = ambL * 0.20f;                  // HeightLeft
        mono9[8] = ambR * 0.20f;                  // HeightRight

        // 4. Render the 9 Virtual Speakers through the Binaural Spatial Matrix
        float binL = 0.0f;
        float binR = 0.0f;
        for (int k = 0; k < 9; ++k) {
            speakers[k].process(mono9[k], binL, binR);
        }

        // Energy balance scalar to match bypass gain
        const float NORM_GAIN = 0.68f;
        binL *= NORM_GAIN;
        binR *= NORM_GAIN;

        // 5. Recombine with pristine original stereo bass
        outL = bassL + binL;
        outR = bassR + binR;
    }
};
