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

// High-fidelity binaural virtual speaker with crisp localization & open 3D soundstage
struct VirtualSpeakerChannel {
    BiquadPeak presenceEQ; // Vocal & instrument clarity & definition
    BiquadPeak airEQ;      // Sparkling high-frequency crispness
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

        // 1. Crisp Vocal Articulation & Open Air Tuning
        if (fabsf(azDeg) < 1.0f) {
            // Front Center (Vocal & Lead Anchor)
            presenceEQ.init(sr, 3400.0f, 1.1f, +2.5f); // Vocal articulation & diction
            airEQ.init(sr, 12000.0f, 0.9f, +2.0f);      // Crisp, sparkling air
        } else if (fabsf(azDeg) <= 50.0f && elDeg <= 5.0f) {
            // Front Left / Front Right (±42°)
            presenceEQ.init(sr, 3600.0f, 1.0f, +1.8f); // Clean instrument presence
            airEQ.init(sr, 12500.0f, 0.9f, +1.5f);      // Crisp stereo extension
        } else if (elDeg > 20.0f) {
            // Height Left / Height Right (±50°, +35°)
            presenceEQ.init(sr, 6000.0f, 1.2f, -1.5f); // Subtle pinna elevation dip
            airEQ.init(sr, 9500.0f, 1.1f, +2.5f);       // Overhead room sheen
        } else if (fabsf(azDeg) >= 120.0f) {
            // Rear Left / Rear Right (±135°)
            presenceEQ.init(sr, 7000.0f, 1.3f, -2.5f); // Rear pinna notch
            airEQ.init(sr, 11000.0f, 1.1f, +1.5f);      // Rear diffuse air
        } else {
            // Side Left / Side Right (±90°)
            presenceEQ.init(sr, 3800.0f, 1.0f, +1.2f);
            airEQ.init(sr, 10500.0f, 1.0f, +1.5f);
        }

        // 2. Physical Interaural Time Difference (ITD)
        // Woodworth spherical model: ITD = (r/c) * (sin|az| + |az|)
        float itdSec = 0.000255f * (sinf(absAz) + absAz);
        itdSamples = (int)(itdSec * sr + 0.5f);
        if (itdSamples < 0) itdSamples = 0;
        if (itdSamples >= ITD_BUF_SIZE - 2) itdSamples = ITD_BUF_SIZE - 2;

        // 3. True Acoustic Head Shadow (ILD) with Natural Binaural Crosstalk
        if (fabsf(azDeg) < 1.0f) {
            gainNear = 0.707f;
            gainFar  = 0.707f;
            shadowLP.init(sr, 18000.0f);
        } else {
            gainNear = 1.0f;
            // Contralateral gain tuned for expansive room externalization without comb filtering
            gainFar = 0.36f * (1.0f - 0.35f * sinf(absAz));
            if (gainFar < 0.20f) gainFar = 0.20f;

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

    // Dedicated Room Subwoofer Spatializer (Delivers real, physical 3D room bass)
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

        // Cinema Subwoofer Room Resonance (+2.5dB at 60Hz with broad Q for deep room weight)
        subResonanceL.init(sr, 60.0f, 0.8f, +2.5f);
        subResonanceR.init(sr, 60.0f, 0.8f, +2.5f);
        memset(roomSubBufL, 0, sizeof(roomSubBufL));
        memset(roomSubBufR, 0, sizeof(roomSubBufR));
        roomSubIdx = 0;

        corrCoef = tauCoef(35.0f, sr); // 35ms correlation tracking
        corrEnv = 0.5f;

        // 9 Speaker Positions according to T19 spec with widened soundstage:
        // 0: FrontLeft   (-42°,   0°)  [Wider front soundstage than ±30°]
        // 1: FrontCenter (  0°,   0°)  [Crystal vocal anchor]
        // 2: FrontRight  (+42°,   0°)
        // 3: SideLeft    (-90°,   0°)  [Expansive lateral wings]
        // 4: SideRight   (+90°,   0°)
        // 5: BackLeft    (-135°,  0°)  [Surround depth]
        // 6: BackRight   (+135°,  0°)
        // 7: HeightLeft  (-50°, +35°)  [Elevated 3D dome]
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
        float c = fmaxf(0.15f, fminf(0.85f, corrEnv));

        // 3. Wide 3D Spatial Decomposition (Sweet Spot between wide separation and vocal clarity)
        float centre = mid * (c * 0.88f);
        float restL  = L - centre * 0.82f;
        float restR  = R - centre * 0.82f;

        // Open up the lateral & ambient wings for clear distinction from standard stereo
        float ambL = side * (1.15f - c * 0.30f);
        float ambR = -side * (1.15f - c * 0.30f);

        float mono9[9];
        mono9[0] = restL * 0.90f;                 // FrontLeft (-42°)
        mono9[1] = centre * 1.05f;                // FrontCenter (0° vocal pop!)
        mono9[2] = restR * 0.90f;                 // FrontRight (+42°)
        mono9[3] = restL * 0.40f + ambL * 0.70f;  // SideLeft (-90° - distinct 3D width)
        mono9[4] = restR * 0.40f + ambR * 0.70f;  // SideRight (+90°)
        mono9[5] = ambL * 0.55f;                  // BackLeft (-135°)
        mono9[6] = ambR * 0.55f;                  // BackRight (+135°)
        mono9[7] = ambL * 0.35f;                  // HeightLeft (-50°, +35°)
        mono9[8] = ambR * 0.35f;                  // HeightRight (+50°, +35°)

        // 4. Render through the 9 Virtual Speakers
        float binL = 0.0f;
        float binR = 0.0f;
        for (int k = 0; k < 9; ++k) {
            speakers[k].process(mono9[k], binL, binR);
        }

        // Energy balance scalar
        const float NORM_GAIN = 0.65f;
        binL *= NORM_GAIN;
        binR *= NORM_GAIN;

        // 5. Dual Bass Processing: Direct Stereo vs. 3D Room Bass
        float b3D = bass3DAmount.next();

        // 3D Room Bass Physical Simulation
        roomSubBufL[roomSubIdx] = bassL;
        roomSubBufR[roomSubIdx] = bassR;

        // Direct room distance delay (~2.2ms, 106 samples at 48kHz)
        int dDirect = (int)(0.0022f * sr);
        if (dDirect < 1) dDirect = 1;
        if (dDirect > 500) dDirect = 500;
        int readDirect = roomSubIdx - dDirect;
        if (readDirect < 0) readDirect += 512;

        // Cross-room wall reflection delay (~3.8ms, 182 samples at 48kHz)
        int dCross = (int)(0.0038f * sr);
        if (dCross < 1) dCross = 1;
        if (dCross > 500) dCross = 500;
        int readCross = roomSubIdx - dCross;
        if (readCross < 0) readCross += 512;

        if (++roomSubIdx >= 512) roomSubIdx = 0;

        float subDirL = roomSubBufL[readDirect];
        float subDirR = roomSubBufR[readDirect];
        float subCrxL = roomSubBufL[readCross];
        float subCrxR = roomSubBufR[readCross];

        // Combine direct room wave + cross-wall envelopment
        float roomBassL = subResonanceL.process(subDirL * 0.82f + subCrxR * 0.28f);
        float roomBassR = subResonanceR.process(subDirR * 0.82f + subCrxL * 0.28f);

        // Smooth glide between Direct Stereo Bass (0.0f) and 3D Room Bass (1.0f)
        float finalBassL = (1.0f - b3D) * bassL + b3D * roomBassL;
        float finalBassR = (1.0f - b3D) * bassR + b3D * roomBassR;

        outL = finalBassL + binL;
        outR = finalBassR + binR;
    }
};
