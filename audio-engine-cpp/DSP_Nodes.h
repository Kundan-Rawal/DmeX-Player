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

// --- ADD THESE NEW STRUCTS ---

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

struct BiquadPeak
{
    float b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
    float x1 = 0, x2 = 0, y1 = 0, y2 = 0;

    void init(float sample_rate, float cutoff_hz, float q, float gain_db)
    {
        float A = powf(10.0f, gain_db / 40.0f);
        float w0 = 2.0f * (float)M_PI * cutoff_hz / sample_rate;
        float alpha = sinf(w0) / (2.0f * q);
        float a0 = 1.0f + alpha / A;

        b0 = (1.0f + alpha * A) / a0;
        b1 = (-2.0f * cosf(w0)) / a0;
        b2 = (1.0f - alpha * A) / a0;
        a1 = (-2.0f * cosf(w0)) / a0;
        a2 = (1.0f - alpha / A) / a0;
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

struct BiquadLPF
{
    float b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
    float x1 = 0, x2 = 0, y1 = 0, y2 = 0;

    void init(float sample_rate, float cutoff_hz)
    {
        float w0 = 2.0f * (float)M_PI * cutoff_hz / sample_rate;
        float alpha = sinf(w0) / (2.0f * 0.70710678f);
        float cosw0 = cosf(w0);
        float a0 = 1.0f + alpha;
        b0 = (1.0f - cosw0) / 2.0f / a0;
        b1 = (1.0f - cosw0) / a0;
        b2 = (1.0f - cosw0) / 2.0f / a0;
        a1 = -2.0f * cosw0 / a0;
        a2 = (1.0f - alpha) / a0;
        x1 = x2 = y1 = y2 = 0;
    }

    float process(float in)
    {
        float out = b0 * in + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = in;
        y2 = y1;
        y1 = out;
        return out;
    }
};

struct LinkwitzRiley4
{
    BiquadLPF lpf1, lpf2;
    BiquadHPF hpf1, hpf2;

    void init(float sample_rate, float cutoff_hz)
    {
        lpf1.init(sample_rate, cutoff_hz);
        lpf2.init(sample_rate, cutoff_hz);
        hpf1.init(sample_rate, cutoff_hz);
        hpf2.init(sample_rate, cutoff_hz);
    }

    // Splits a single signal into Low and High with perfect flat-sum phase alignment
    void process(float input, float &outLow, float &outHigh)
    {
        outLow = lpf2.process(lpf1.process(input));
        outHigh = hpf2.process(hpf1.process(input));
    }
};

#define HAAS_BUFFER_SIZE 4096

struct DynamicSpatializerNode
{
    ma_node_base baseNode;

    // Dual Crossover Network (Splits into Low, Mid, High)
    LinkwitzRiley4 crossLowL, crossLowR;   // 250Hz Crossover
    LinkwitzRiley4 crossHighL, crossHighR; // 4000Hz Crossover

    // LFO State
    float lfoPhase;

    // Haas Delay Lines
    float delayL[HAAS_BUFFER_SIZE];
    float delayR[HAAS_BUFFER_SIZE];
    int writeIdx;
};

extern ma_node_vtable g_dynamic_spatializer_vtable;

struct StudioExciterNode
{
    ma_node_base baseNode;
    float targetDrive, currentDrive;
    float hpStateL, hpStateR;
};

#define CROSSFEED_DELAY_SAMPLES 22

struct StereoWidenerNode
{
    ma_node_base baseNode;
    float width;
    
    // Crossfeed states
    float delayL[CROSSFEED_DELAY_SAMPLES];
    float delayR[CROSSFEED_DELAY_SAMPLES];
    int delayIdx;
    float lpStateL, lpStateR;
    float sideLp;
};

#define SURROUND_HAAS_DELAY 882
#define CENTER_ITD_DELAY 22

struct PsychoacousticNode
{
    ma_node_base baseNode;
    
    // Subwoofer Bypass (180Hz) to keep bass completely dry
    LinkwitzRiley4 crossSubwooferL, crossSubwooferR;

    // Center ITD Delay
    float centerDelayBuf[CENTER_ITD_DELAY];
    int centerIdx;

    // Rear Haas Delay
    float rearDelayBufL[SURROUND_HAAS_DELAY];
    float rearDelayBufR[SURROUND_HAAS_DELAY];
    int rearIdx;

    // Low-Pass states for Rear
    float rearLpL, rearLpR;

    // Top Elevation Notch States (12kHz pinna notch)
    float notchTopL1, notchTopL2;
    float notchTopR1, notchTopR2;

    float spatialIntensity;
};

struct AudiophileEQNode
{
    ma_node_base baseNode;
    std::atomic<float> targetBass, targetMid, targetHigh;
    float currentBass, currentMid, currentHigh;
    
    LinkwitzRiley4 crossBassL, crossBassR;       // 80Hz
    LinkwitzRiley4 crossMidBassL, crossMidBassR; // 180Hz
    LinkwitzRiley4 crossTrebleL, crossTrebleR;   // 8000Hz
    
    BiquadPeak presenceL, presenceR; // 2.5kHz Fletcher-Munson presence eq
    float envUpwardL, envUpwardR;    // Envelope trackers for Upward Compression
    
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
    LinkwitzRiley4 crossBassL, crossBassR;       // 80Hz
    LinkwitzRiley4 crossMidBassL, crossMidBassR; // 180Hz
    
    // Legacy 1-pole filter states for Android/Laptop Speaker protection
    float hp1L, hp1R;
    float lp1L, lp1R;
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