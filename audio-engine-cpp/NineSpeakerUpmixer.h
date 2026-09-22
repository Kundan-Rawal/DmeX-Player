#pragma once
#include <cmath>
#include <cstring>
#include <algorithm>
#include "DSP_Nodes.h"
#include "SmoothedParam.h"

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define ITD_BUF_SIZE 512

// High-fidelity binaural virtual speaker with crisp localization (Zero 450Hz Mud)
struct VirtualSpeakerChannel {
    BiquadPeak presenceEQ; // Vocal & instrument clarity & definition
    BiquadPeak airEQ;      // Sparkling high-frequency crispness
    BiquadLPF shadowLP;    // Acoustic head shadow low-pass for the far ear
    float delayBuf[ITD_BUF_SIZE];
    int writeIdx = 0;
    int itdSamples = 0;
    float gainNear = 1.0f;
    float gainFar = 0.2f;
    float azimuthDeg = 0.0f;
    float elevationDeg = 0.0f;

    void init(float sr, float azDeg, float elDeg) {
        azimuthDeg = azDeg;
        elevationDeg = elDeg;

        float azRad = azDeg * (float)M_PI / 180.0f;
        float absAz = fabsf(azRad);

        // 1. Crystal-Clear Presence & Air Tuning (Completely eliminates boxiness/mud)
        // Center & Front: boost vocal presence at 3.4kHz (+2.5dB) and upper air at 12kHz (+2.0dB) so voices POP OUT!
        // Height & Rear: subtle pinna contour with elevated air reflections
        if (fabsf(azDeg) < 1.0f) {
            // Front Center (Vocal & Lead Anchor)
            presenceEQ.init(sr, 3400.0f, 1.1f, +2.5f); // Vocal articulation & diction
            airEQ.init(sr, 12000.0f, 0.9f, +2.0f);      // Crisp, sparkling air
        } else if (fabsf(azDeg) <= 45.0f && elDeg <= 5.0f) {
            // Front Left / Front Right (±30°)
            presenceEQ.init(sr, 3600.0f, 1.0f, +1.8f); // Clean instrument presence
            airEQ.init(sr, 12500.0f, 0.9f, +1.5f);      // Crisp stereo extension
        } else if (elDeg > 20.0f) {
            // Height Left / Height Right (±45°, +35°)
            presenceEQ.init(sr, 6000.0f, 1.2f, -1.5f); // Subtle pinna elevation dip
            airEQ.init(sr, 9500.0f, 1.1f, +2.5f);       // Overhead room sheen
        } else if (fabsf(azDeg) >= 120.0f) {
            // Rear Left / Rear Right (±135°)
            presenceEQ.init(sr, 7000.0f, 1.3f, -2.5f); // Rear pinna notch
            airEQ.init(sr, 11000.0f, 1.1f, +1.5f);      // Rear diffuse air
        } else {
            // Side Left / Side Right (±90°)
            presenceEQ.init(sr, 3800.0f, 1.0f, +1.0f);
            airEQ.init(sr, 10500.0f, 1.0f, +1.2f);
        }

        // 2. Physical Interaural Time Difference (ITD)
        // Woodworth spherical model: ITD = (r/c) * (sin|az| + |az|)
        float itdSec = 0.000255f * (sinf(absAz) + absAz);
        itdSamples = (int)(itdSec * sr + 0.5f);
        if (itdSamples < 0) itdSamples = 0;
        if (itdSamples >= ITD_BUF_SIZE - 2) itdSamples = ITD_BUF_SIZE - 2;

        // 3. True Acoustic Head Shadow (ILD) & Dramatic Channel Separation
        if (fabsf(azDeg) < 1.0f) {
            gainNear = 0.707f;
            gainFar  = 0.707f;
            shadowLP.init(sr, 18000.0f);
        } else {
            // Near ear receives direct, punchy, unattenuated sound
            gainNear = 1.0f;
            // Far ear is strongly shadowed and attenuated (down to 0.14 at 90°)
            // This prevents comb filtering between ears, making each speaker position distinct and pop out!
            gainFar = 0.40f * (1.0f - 0.65f * sinf(absAz));
            if (gainFar < 0.14f) gainFar = 0.14f;

            float shadowFc = 1600.0f + (1.0f - sinf(absAz)) * 3400.0f;
            if (shadowFc < 1100.0f) shadowFc = 1100.0f;
            shadowLP.init(sr, shadowFc);
        }

        reset();
    }

    void reset() {
        presenceEQ.reset();
        airEQ.reset();
        shadowLP.reset();
        memset(delayBuf, 0, sizeof(delayBuf));
        writeIdx = 0;
    }

    inline void process(float inSample, float& outL, float& outR) {
        // Apply pristine presence and air shaping
        float shaped = airEQ.process(presenceEQ.process(inSample));

        if (fabsf(azimuthDeg) < 1.0f) {
            outL += shaped * gainNear;
            outR += shaped * gainFar;
            return;
        }

        delayBuf[writeIdx] = shaped;
        int readIdx = writeIdx - itdSamples;
        if (readIdx < 0) readIdx += ITD_BUF_SIZE;
        float delayed = delayBuf[readIdx];
        if (++writeIdx >= ITD_BUF_SIZE) writeIdx = 0;

        float farSignal  = shadowLP.process(delayed) * gainFar;
        float nearSignal = shaped * gainNear;

        if (azimuthDeg < 0.0f) {
            // Left speaker: Near is Left ear, Far is Right ear
            outL += nearSignal;
            outR += farSignal;
        } else {
            // Right speaker: Near is Right ear, Far is Left ear
            outR += nearSignal;
            outL += farSignal;
        }
    }
};

class NineSpeakerUpmixer {
public:
    VirtualSpeakerChannel speakers[9];
    LinkwitzRiley4 crossBassL, crossBassR;
    SmoothedParam bass3DAmount;
    float corrEnv = 0.5f;
    float corrCoef = 0.002f;
    float sr = 48000.0f;

    void init(float sampleRate) {
        sr = sampleRate > 0.0f ? sampleRate : 48000.0f;

        // Crossover to preserve punchy stereo bass (< 180 Hz)
        crossBassL.init(sr, 180.0f);
        crossBassR.init(sr, 180.0f);

        // Smooth crossfade between Direct Stereo Bass (0.0f) and Full 3D Room Bass (1.0f)
        bass3DAmount.init(0.0f, sr, 25.0f);

        corrCoef = tauCoef(35.0f, sr); // 35ms correlation tracking
        corrEnv = 0.5f;

        // 9 Speaker Positions according to T19 spec:
        // 0: FrontLeft   (-30°,   0°)
        // 1: FrontCenter (  0°,   0°)
        // 2: FrontRight  (+30°,   0°)
        // 3: SideLeft    (-90°,   0°)
        // 4: SideRight   (+90°,   0°)
        // 5: BackLeft    (-135°,  0°)
        // 6: BackRight   (+135°,  0°)
        // 7: HeightLeft  (-45°, +35°)
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

    void setBass3D(bool roomBass) {
        bass3DAmount.set(roomBass ? 1.0f : 0.0f);
    }

    void reset() {
        crossBassL.reset();
        crossBassR.reset();
        corrEnv = 0.5f;
        for (int i = 0; i < 9; ++i) {
            speakers[i].reset();
        }
    }

    // Processes one stereo frame. Real-time safe: zero allocations, zero locks.
    inline void process(float inL, float inR, float& outL, float& outR) {
        // 0. Low/High Band Split (< 180Hz)
        float bassL = 0.0f, nonBassL = 0.0f;
        float bassR = 0.0f, nonBassR = 0.0f;
        crossBassL.process(inL, bassL, nonBassL);
        crossBassR.process(inR, bassR, nonBassR);

        // Smoothly blend how much bass enters the 9-speaker matrix
        // b3D = 0.0 -> Direct Stereo Bass (Punch Mode)
        // b3D = 1.0 -> Full 3D Room Bass (Spatial Immersion Mode)
        float b3D = bass3DAmount.next();
        float L = nonBassL + (bassL * b3D);
        float R = nonBassR + (bassR * b3D);

        // 1. Mid / Side Separation
        float mid  = (L + R) * 0.5f;
        float side = (L - R) * 0.5f;

        // 2. Real-time correlation tracking
        float instCorr = (L * R) / (0.5f * (L * L + R * R) + 1e-9f);
        instCorr = fmaxf(0.0f, fminf(1.0f, instCorr));
        corrEnv += (instCorr - corrEnv) * corrCoef;
        float c = fmaxf(0.20f, fminf(0.85f, corrEnv));

        // 3. Clear Vocal & Spatial Extraction (Distinct, popping soundstage)
        float centre = mid * c;
        float restL  = L - centre * 0.60f;
        float restR  = R - centre * 0.60f;

        float ambL = side * (1.0f - c * 0.50f);
        float ambR = -side * (1.0f - c * 0.50f);

        float mono9[9];
        mono9[0] = restL * 0.95f;                 // FrontLeft
        mono9[1] = centre * 1.15f;                // FrontCenter (Vocals pop forward!)
        mono9[2] = restR * 0.95f;                 // FrontRight
        mono9[3] = restL * 0.35f + ambL * 0.55f;  // SideLeft
        mono9[4] = restR * 0.35f + ambR * 0.55f;  // SideRight
        mono9[5] = ambL * 0.55f;                  // BackLeft
        mono9[6] = ambR * 0.55f;                  // BackRight
        mono9[7] = ambL * 0.30f;                  // HeightLeft
        mono9[8] = ambR * 0.30f;                  // HeightRight

        // 4. Render through the 9 Virtual Speakers
        float binL = 0.0f;
        float binR = 0.0f;
        for (int k = 0; k < 9; ++k) {
            speakers[k].process(mono9[k], binL, binR);
        }

        // Energy balance scalar
        const float NORM_GAIN = 0.62f;
        binL *= NORM_GAIN;
        binR *= NORM_GAIN;

        // 5. Recombine: direct punchy bass (when b3D < 1) + 3D binaural room output
        outL = (bassL * (1.0f - b3D)) + binL;
        outR = (bassR * (1.0f - b3D)) + binR;
    }
};
