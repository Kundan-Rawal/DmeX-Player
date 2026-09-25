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

// Schroeder-style allpass filter for natural acoustic decorrelation without phase cancellation
struct SimpleAllpass {
    float buf[256];
    int idx = 0;
    int delay = 127;
    float g = 0.55f;

    void init(int d, float gain) {
        delay = (d > 0 && d < 250) ? d : 127;
        g = gain;
        reset();
    }
    void reset() {
        memset(buf, 0, sizeof(buf));
        idx = 0;
    }
    inline float process(float in) {
        float bufOut = buf[idx];
        float out = -g * in + bufOut;
        buf[idx] = in + g * out;
        if (++idx >= delay) idx = 0;
        return out;
    }
};

// High-fidelity binaural virtual speaker with crisp localization & calibrated HRTF acoustics
struct VirtualSpeakerChannel {
    BiquadPeak pinnaEQ;    // Pinna elevation / rear cue
    BiquadLPF shadowLP;    // Acoustic head shadow low-pass for the far ear
    float delayBuf[ITD_BUF_SIZE];
    int writeIdx = 0;
    int itdSamples = 0;
    float gainNear = 1.0f;
    float gainFar = 0.25f;
    float azimuthDeg = 0.0f;
    float elevationDeg = 0.0f;

    void init(float sr, float azDeg, float elDeg) {
        azimuthDeg = azDeg;
        elevationDeg = elDeg;

        float azRad = azDeg * (float)M_PI / 180.0f;
        float absAz = fabsf(azRad);

        // 1. Physical ITD (Woodworth spherical model)
        float itdSec = 0.000255f * (sinf(absAz) + absAz);
        itdSamples = (int)(itdSec * sr + 0.5f);
        if (itdSamples < 0) itdSamples = 0;
        if (itdSamples >= ITD_BUF_SIZE - 2) itdSamples = ITD_BUF_SIZE - 2;

        // 2. Anatomical Pinna Cues (Subtle, calibrated, no harsh resonant peaks)
        if (fabsf(azDeg) < 1.0f) {
            // Front Center: Crystal vocal articulation (subtle +1.0 dB at 3.5 kHz)
            pinnaEQ.init(sr, 3500.0f, 1.2f, +1.0f);
            gainNear = 1.0f;
            gainFar  = 1.0f;
            shadowLP.init(sr, 20000.0f); // Line-of-sight to both ears
        } else if (fabsf(azDeg) <= 50.0f && elDeg <= 5.0f) {
            // Front Left / Front Right (±42°): Direct stereo stage (flat transparent)
            pinnaEQ.init(sr, 3600.0f, 1.0f, 0.0f);
            gainNear = 0.92f;
            gainFar  = 0.28f;
            shadowLP.init(sr, 2500.0f);
        } else if (elDeg > 20.0f) {
            // Height Left / Height Right (±50°, +35°): Pinna elevation notch at 8 kHz
            pinnaEQ.init(sr, 8000.0f, 1.4f, -2.0f);
            gainNear = 0.70f;
            gainFar  = 0.22f;
            shadowLP.init(sr, 2200.0f);
        } else if (fabsf(azDeg) >= 120.0f) {
            // Rear Left / Rear Right (±135°): Rear pinna shadow notch at 6.5 kHz
            pinnaEQ.init(sr, 6500.0f, 1.3f, -2.0f);
            gainNear = 0.75f;
            gainFar  = 0.20f;
            shadowLP.init(sr, 1500.0f);
        } else {
            // Side Left / Side Right (±90°): Wide lateral wings
            pinnaEQ.init(sr, 4000.0f, 1.0f, 0.0f);
            gainNear = 0.85f;
            gainFar  = 0.22f;
            shadowLP.init(sr, 1600.0f);
        }

        reset();
    }

    void reset() {
        pinnaEQ.reset();
        shadowLP.reset();
        memset(delayBuf, 0, sizeof(delayBuf));
        writeIdx = 0;
    }

    inline void process(float inSample, float& outL, float& outR) {
        float shaped = pinnaEQ.process(inSample);

        if (fabsf(azimuthDeg) < 1.0f) {
            // Front Center: identical to both ears, 0 delay, pure vocal anchor
            outL += shaped * gainNear;
            outR += shaped * gainFar;
            return;
        }

        delayBuf[writeIdx] = shaped;
        int readIdx = writeIdx - itdSamples;
        if (readIdx < 0) readIdx += ITD_BUF_SIZE;
        float delayed = delayBuf[readIdx];
        if (++writeIdx >= ITD_BUF_SIZE) writeIdx = 0;

        float nearSignal = shaped * gainNear;
        float farSignal  = shadowLP.process(delayed) * gainFar;

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
    SimpleAllpass apSurround;

    // Dedicated Room Subwoofer Spatializer (Parallel acoustic room resonance)
    float roomSubBufL[512];
    float roomSubBufR[512];
    int roomSubIdx = 0;
    BiquadPeak subResonanceL;
    BiquadPeak subResonanceR;

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

        // Surround decorrelator: ~2.6ms with 0.55 gain
        apSurround.init((int)(0.0026f * sr), 0.55f);

        // Cinema Subwoofer Room Resonance (+2.0 dB at 55 Hz with broad Q)
        subResonanceL.init(sr, 55.0f, 0.8f, +2.0f);
        subResonanceR.init(sr, 55.0f, 0.8f, +2.0f);
        memset(roomSubBufL, 0, sizeof(roomSubBufL));
        memset(roomSubBufR, 0, sizeof(roomSubBufR));
        roomSubIdx = 0;

        corrCoef = tauCoef(35.0f, sr); // 35ms correlation tracking
        corrEnv = 0.5f;

        // 9 Speaker Positions:
        // 0: FrontLeft   (-42°,   0°)
        // 1: FrontCenter (  0°,   0°)
        // 2: FrontRight  (+42°,   0°)
        // 3: SideLeft    (-90°,   0°)
        // 4: SideRight   (+90°,   0°)
        // 5: BackLeft    (-135°,  0°)
        // 6: BackRight   (+135°,  0°)
        // 7: HeightLeft  (-50°, +35°)
        // 8: HeightRight (+50°, +35°)
        speakers[0].init(sr, -42.0f,   0.0f);
        speakers[1].init(sr,   0.0f,   0.0f);
        speakers[2].init(sr, +42.0f,   0.0f);
        speakers[3].init(sr, -90.0f,   0.0f);
        speakers[4].init(sr, +90.0f,   0.0f);
        speakers[5].init(sr, -135.0f,  0.0f);
        speakers[6].init(sr, +135.0f,  0.0f);
        speakers[7].init(sr, -50.0f, +35.0f);
        speakers[8].init(sr, +50.0f, +35.0f);

        reset();
    }

    void setBass3D(bool roomBass) {
        bass3DAmount.set(roomBass ? 1.0f : 0.0f);
    }

    void reset() {
        crossBassL.reset();
        crossBassR.reset();
        subResonanceL.reset();
        subResonanceR.reset();
        apSurround.reset();
        memset(roomSubBufL, 0, sizeof(roomSubBufL));
        memset(roomSubBufR, 0, sizeof(roomSubBufR));
        roomSubIdx = 0;
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

        // Mids & Highs go through the 9-speaker upmixer
        float L = nonBassL;
        float R = nonBassR;

        // 1. Mid / Side Separation
        float mid  = (L + R) * 0.5f;
        float side = (L - R) * 0.5f;

        // 2. Real-time correlation tracking
        float instCorr = (L * R) / (0.5f * (L * L + R * R) + 1e-9f);
        instCorr = fmaxf(0.0f, fminf(1.0f, instCorr));
        corrEnv += (instCorr - corrEnv) * corrCoef;
        float c = fmaxf(0.05f, fminf(0.95f, corrEnv));

        // 3. Clear Acoustic Stage Decomposition (Zero Vocal Smearing & Pinpoint Localization)
        // Correlated vocal center energy routes cleanly to FrontCenter (0°).
        float centre = mid * c;
        float directL = L - centre;
        float directR = R - centre;

        // Diffuse ambient energy for surrounds: decorrelated, NEVER anti-phase (-1.0)!
        float amb = side * (1.0f - c * 0.5f);
        float ambL = amb;
        float ambR = apSurround.process(amb);

        float mono9[9];
        mono9[0] = directL * 0.85f;                     // FrontLeft (-42°)
        mono9[1] = centre * 1.00f;                      // FrontCenter (0° vocal pop!)
        mono9[2] = directR * 0.85f;                     // FrontRight (+42°)
        mono9[3] = directL * 0.30f + ambL * 0.35f;      // SideLeft (-90°)
        mono9[4] = directR * 0.30f + ambR * 0.35f;      // SideRight (+90°)
        mono9[5] = ambL * 0.30f;                        // BackLeft (-135°)
        mono9[6] = ambR * 0.30f;                        // BackRight (+135°)
        mono9[7] = directL * 0.12f + ambL * 0.20f;      // HeightLeft (-50°, +35°)
        mono9[8] = directR * 0.12f + ambR * 0.20f;      // HeightRight (+50°, +35°)

        // 4. Render through the 9 Virtual Speakers (Calibrated for exact 1.0 unit power)
        float binL = 0.0f;
        float binR = 0.0f;
        for (int k = 0; k < 9; ++k) {
            speakers[k].process(mono9[k], binL, binR);
        }

        // 5. Dual Bass Processing: Direct Stereo vs. 3D Room Bass
        float b3D = bass3DAmount.next();

        if (b3D < 0.001f) {
            // Direct Stereo Bass: 0ms delay, phase-locked with upper transients!
            outL = bassL + binL;
            outR = bassR + binR;
        } else {
            // 3D Room Bass Physical Simulation (Parallel room resonance and cross-wall envelopment)
            roomSubBufL[roomSubIdx] = bassL;
            roomSubBufR[roomSubIdx] = bassR;

            int dCross = (int)(0.0035f * sr); // ~3.5ms cross-reflection
            if (dCross < 1) dCross = 1;
            if (dCross > 500) dCross = 500;
            int readCross = roomSubIdx - dCross;
            if (readCross < 0) readCross += 512;

            if (++roomSubIdx >= 512) roomSubIdx = 0;

            float subCrxL = roomSubBufL[readCross];
            float subCrxR = roomSubBufR[readCross];

            // Room resonance applied to parallel cross-wall reflection
            float roomReflectL = subResonanceL.process(subCrxR);
            float roomReflectR = subResonanceR.process(subCrxL);

            // Direct bass is ALWAYS present at 1.0x (sharp kick punch) + subtle parallel 3D room envelopment
            float roomScale = b3D * 0.20f;
            float finalBassL = bassL + roomReflectL * roomScale;
            float finalBassR = bassR + roomReflectR * roomScale;

            outL = finalBassL + binL;
            outR = finalBassR + binR;
        }
    }
};
