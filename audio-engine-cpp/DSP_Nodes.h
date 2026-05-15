#pragma once

#include "miniaudio.h"
#include <atomic>
#include <vector>
#include <cmath>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// ================================================================
// AUXILIARY HIGH-PASS FILTER (For Spatial/Reverb Sends)
// ================================================================
#include "miniaudio.h"
#include <atomic>
#include <vector>
#include <cmath>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// ================================================================
// AUXILIARY HIGH-PASS FILTER (For Spatial/Reverb Sends)
// ================================================================
struct BiquadHPF
{
    float b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
    float x1 = 0, x2 = 0, y1 = 0, y2 = 0;

    void init(float sample_rate, float cutoff_hz)
    {
        float w0 = 2.0f * (float)M_PI * cutoff_hz / sample_rate;
        float alpha = sinf(w0) / (2.0f * 0.707f);
        float a0 = 1.0f + alpha;

        b0 = ((1.0f + cosf(w0)) / 2.0f) / a0;
        b1 = -(1.0f + cosf(w0)) / a0;
        b2 = ((1.0f + cosf(w0)) / 2.0f) / a0;
        a1 = (-2.0f * cosf(w0)) / a0;
        a2 = (1.0f - alpha) / a0;
        x1 = x2 = y1 = y2 = 0.0f;
    }

    float process(float in_sample)
    {
        float out_sample = b0 * in_sample + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = in_sample;
        y2 = y1;
        y1 = out_sample;
        return out_sample;
    }
};

struct StudioExciterNode
{
    ma_node_base baseNode;
    float targetDrive, currentDrive;
    float hpStateL, hpStateR;
};

struct StereoWidenerNode
{
    ma_node_base baseNode;
    float width;
};

#define HAAS_DELAY_SAMPLES 88
#define ITD_DELAY_SAMPLES 26

struct PsychoacousticNode
{
    ma_node_base baseNode;
    float haasBufL[HAAS_DELAY_SAMPLES];
    float itdBufL[ITD_DELAY_SAMPLES];
    float itdBufR[ITD_DELAY_SAMPLES];
    int haasIdx, itdIdx;

    float shadowStateL, shadowStateR;

    // CRITICAL FIX: Proper independent 2-pole notch states
    float notchStateL1, notchStateL2;
    float notchStateR1, notchStateR2;

    // CRITICAL FIX: Independent crossfeed high-pass states to protect bass
    float crossHpL, crossHpR;
    float sideHp;

    float spatialIntensity;
    float env;
};

struct AudiophileEQNode
{
    ma_node_base baseNode;
    std::atomic<float> targetBass, targetMid, targetHigh;
    float currentBass, currentMid, currentHigh;
    float bL, bR, tL, tR;
    float dcBlockL, dcBlockR;
    float env; // CRITICAL FIX: Envelope tracker for Fletcher-Munson curve
};
#define MAX_COMB_BUF 1700
#define MAX_AP_BUF 600

struct CombFilter
{
    float buf[MAX_COMB_BUF];
    int size, idx;
    float feedback, damp, store;
};

struct AllPassFilter
{
    float buf[MAX_AP_BUF];
    int size, idx;
    float feedback;
};

struct ReverbNode
{
    ma_node_base baseNode;
    CombFilter combL[4], combR[4];
    AllPassFilter apL[2], apR[2];
    float roomSize, wetMix, damp;
    BiquadHPF hpfL, hpfR; // <-- ADD THIS
};

struct SubwooferNode
{
    ma_node_base baseNode;
    float lp1L, lp2L, lp1R, lp2R;
    float hp1L, hp1R; // <--- ADD THESE TWO VARIABLES
};
struct ConvolutionNode
{
    ma_node_base baseNode;
    float *irDataL, *irDataR;
    int irLength;
    float *historyL, *historyR;
    int historyIdx;
    float wetMix;
    float hpStateL, hpStateR;
    float lpStateL, lpStateR;
    BiquadHPF hpfL, hpfR; // <-- ADD THIS
};

#define COMP_LOOKAHEAD_SAMPLES 44

struct MultibandCompressorNode
{
    ma_node_base baseNode;
    std::atomic<float> threshold;
    std::atomic<float> makeupGain;
    float envLow, envHigh;
    float attackCoef, releaseCoef;
    float lpStateL, lpStateR;

    // CRITICAL FIX 2: Crossover states for the delayed audio path
    float delayLpStateL, delayLpStateR;

    float dlyL[COMP_LOOKAHEAD_SAMPLES];
    float dlyR[COMP_LOOKAHEAD_SAMPLES];
    int dlyIdx;
};

#define LIMITER_LOOKAHEAD_SAMPLES 88

struct LimiterNode
{
    ma_node_base baseNode;
    float boost, gainEnv;
    // CRITICAL FIX 3: Added missing attack coefficient
    float attackCoef, releaseCoef;

    float dlyL[LIMITER_LOOKAHEAD_SAMPLES];
    float dlyR[LIMITER_LOOKAHEAD_SAMPLES];
    int dlyIdx;
};

void reverb_init_filters(ReverbNode *r);

extern ma_node_vtable g_exciter_vtable;
extern ma_node_vtable g_widener_vtable;
extern ma_node_vtable g_psychoacoustic_vtable;
extern ma_node_vtable g_audiophile_eq_vtable;
extern ma_node_vtable g_reverb_vtable;
extern ma_node_vtable g_subwoofer_vtable;
extern ma_node_vtable g_convolution_vtable;
extern ma_node_vtable g_multiband_compressor_vtable;
extern ma_node_vtable g_limiter_vtable;