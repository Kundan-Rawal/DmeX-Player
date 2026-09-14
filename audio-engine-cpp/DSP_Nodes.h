#pragma once

#include "miniaudio.h"
#include <atomic>
#include <vector>
#include <cmath>
#include "SmoothedParam.h"

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

    void reset() { x1 = 0; x2 = 0; y1 = 0; y2 = 0; }

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

    void update_coeffs(float sample_rate, float cutoff_hz, float q, float gain_db)
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

    void reset() { x1 = 0; x2 = 0; y1 = 0; y2 = 0; }

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

    void reset() { lpf1.reset(); lpf2.reset(); hpf1.reset(); hpf2.reset(); }

    // Splits a single signal into Low and High with perfect flat-sum phase alignment
    void process(float input, float &outLow, float &outHigh)
    {
        outLow = lpf2.process(lpf1.process(input));
        outHigh = hpf2.process(hpf1.process(input));
    }
};

#define HAAS_BUFFER_SIZE 4096

// Phase-coherent 3-way Linkwitz-Riley crossover.
// Bands sum to unity magnitude and unity phase.
struct Crossover3 {
    LinkwitzRiley4 split1;  // low / rest split
    LinkwitzRiley4 split2;  // mid / high split
    LinkwitzRiley4 apLo;    // allpass compensation for the LOW band

    void init(float sr, float fLo = 200.0f, float fHi = 4000.0f) {
        split1.init(sr, fLo);
        split2.init(sr, fHi);
        apLo.init(sr, fHi);
    }
    
    void reset() {
        split1.reset();
        split2.reset();
        apLo.reset();
    }

    inline void process(float x, float& lo, float& mid, float& hi) {
        float rest;
        split1.process(x, lo, rest);
        split2.process(rest, mid, hi);
        
        // Phase-match low band: AP4 = LP4 + HP4
        float loLP, loHP;
        apLo.process(lo, loLP, loHP);
        lo = loLP + loHP;
    }
};

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
    float sampleRate;
};

extern ma_node_vtable g_dynamic_spatializer_vtable;

#include "Oversampler.h"

struct StudioExciterNode
{
    ma_node_base baseNode;
    SmoothedParam drive;
    float hpStateL, hpStateR;
    float hpCoef; // Dynamically calculated HPF coefficient

    Oversampler4x os;
    float dryDelayL[32], dryDelayR[32];
    int dryIdx = 0, dryDelay = 0;

    void init(float sampleRate) {
        os.init();
        dryDelay = (int)(os.latencySamples() + 0.5f);
        memset(dryDelayL, 0, sizeof(dryDelayL));
        memset(dryDelayR, 0, sizeof(dryDelayR));
        dryIdx = 0;
        float sr = (sampleRate > 0) ? sampleRate : 44100.0f;
        hpCoef = 1.0f - std::exp(-2.0f * 3.14159265f * 3600.0f / sr);
    }
};

#define CROSSFEED_DELAY_SAMPLES 22

struct StereoWidenerNode
{
    ma_node_base baseNode;
    SmoothedParam width;
    Crossover3 xoverL, xoverR;
    float corrEnv = 1.0f;
};

#define MAX_AP_BUF 1500

struct AllPassFilter
{
    float buf[MAX_AP_BUF];
    int size, idx;
    float feedback;
};

void ap_init(AllPassFilter *a, int sz, float fb);

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

    // Rear Decorrelation (Allpass Filter Bank)
    AllPassFilter rearApL[3];
    AllPassFilter rearApR[3];

    // Low-Pass states for Rear
    float rearLpL, rearLpR;

    // Top Elevation Notch States (12kHz pinna notch)
    float notchTopL1, notchTopL2;
    float notchTopR1, notchTopR2;

    SmoothedParam spatialIntensity;
};


struct AudiophileEQNode
{
    ma_node_base baseNode;
    SmoothedParam targetBass, targetMid, targetHigh;
    
    Crossover3 xoverL, xoverR;
    LinkwitzRiley4 crossTrebleL, crossTrebleR;   // 8000Hz
    
    BiquadPeak presenceL, presenceR; // 2.5kHz Fletcher-Munson presence eq
    float envUpwardL, envUpwardR;    // Envelope trackers for Upward Compression
    
    float dcBlockL, dcBlockR;
    float env; // CRITICAL FIX: Envelope tracker for Fletcher-Munson curve
};
#define MAX_COMB_BUF 4000

struct CombFilter
{
    float buf[MAX_COMB_BUF];
    int size, idx;
    float feedback, damp, store;
};



struct ReverbNode
{
    ma_node_base baseNode;
    CombFilter combL[4], combR[4];
    AllPassFilter apL[2], apR[2];
    SmoothedParam roomSize, wetMix, damp;
    BiquadHPF hpfL, hpfR; // <-- ADD THIS
};

#pragma once



struct SubwooferNode
{
    ma_node_base baseNode;
    Crossover3 xoverL, xoverR;
    
    // Legacy 1-pole filter states for Android/Laptop Speaker protection
    float hp1L, hp1R;
    float lp1L, lp1R;

    // Adaptive Fundamental Tracking & Dual-Peak Bi-Modal Highlighting
    float env30_60 = 0.0f, env60_90 = 0.0f, env90_130 = 0.0f;
    float currentFreq = 95.0f, targetFreq = 95.0f;
    BiquadPeak subPeakL, subPeakR; // Peak 1: Permanent 45Hz tactile anchor
    BiquadPeak midPeakL, midPeakR; // Peak 2: Dynamic 85-115Hz acoustic fundamental anchor
    bool isHighlightInit = false;
    float sampleRate = 44100.0f;
};
struct ConvolutionNode
{
    ma_node_base baseNode;
    float *irDataL, *irDataR;
    int irLength;
    float *historyL, *historyR;
    int historyIdx;
    SmoothedParam wetMix;
    float hpStateL, hpStateR;
    float lpStateL, lpStateR;
    BiquadHPF hpfL, hpfR; // <-- ADD THIS
};

#define COMP_LOOKAHEAD_SAMPLES 96

struct MultibandCompressorNode
{
    ma_node_base baseNode;
    SmoothedParam threshold;
    SmoothedParam makeupGain;
    struct CompBand {
        float env = 0.0f;
        float attackCoef = 0.0f;
        float releaseCoef = 0.0f;
        float ratio = 1.0f;
        float thresholdDb = 0.0f;
        float makeupGain = 1.0f;
        void init(float sr, float attMs, float relMs, float r, float thDb, float mu) {
            attackCoef = tauCoef(attMs, sr);
            releaseCoef = tauCoef(relMs, sr);
            ratio = r;
            thresholdDb = thDb;
            makeupGain = mu;
            env = 0.0f;
        }
    };
    CompBand bandLo, bandMid, bandHi;
    
    float dlyL[COMP_LOOKAHEAD_SAMPLES];
    float dlyR[COMP_LOOKAHEAD_SAMPLES];
    int dlyIdx = 0;
    
    Crossover3 xoverL, xoverR;
};

#define LIMITER_LOOKAHEAD_SAMPLES 192

struct LimiterNode
{
    ma_node_base baseNode;
    SmoothedParam boost;
    float gainEnv;
    float gainSmooth; // T11.3 smoothed envelope
    float attackCoef, releaseCoef;
    float peakEnv; // Anti-motorboating envelope peak follower

    float dlyL[LIMITER_LOOKAHEAD_SAMPLES];
    float dlyR[LIMITER_LOOKAHEAD_SAMPLES];
    int dlyIdx, delaySamples;
    
    // High-Pass Sidechain state to prevent Bass from ducking Vocals/Treble
    float scLpL, scLpR;

    Oversampler4x osDetect;
    float sr;
};

void reverb_init_filters(ReverbNode *r, float sampleRate);

extern ma_node_vtable g_exciter_vtable;
extern ma_node_vtable g_widener_vtable;
extern ma_node_vtable g_psychoacoustic_vtable;
extern ma_node_vtable g_audiophile_eq_vtable;
extern ma_node_vtable g_reverb_vtable;
extern ma_node_vtable g_subwoofer_vtable;
extern ma_node_vtable g_convolution_vtable;
extern ma_node_vtable g_multiband_compressor_vtable;
extern ma_node_vtable g_limiter_vtable;
struct AudioRestorationNode
{
    ma_node_base baseNode;
    
    // Parameters
    float denoiseIntensity; // 0.0 to 1.0
    float upscaleTarget; // 1.0 = 320k, 2.0 = 640k extreme
    float presenceBoost; // 0.0 to 1.0
    
    // Wave shaper states
    float x1L = 0, x1R = 0;
    float prevTrebleL = 0, prevTrebleR = 0;
    
    // Filter states for perfect separation
    LinkwitzRiley4 crossoverL, crossoverR;
    BiquadHPF harmonicFilterL, harmonicFilterR;
    BiquadLPF lowPassSincL, lowPassSincR;
    
    void init(float sample_rate) {
        // 8000Hz crossover completely isolates the air/cymbals from the vocals
        crossoverL.init(sample_rate, 8000.0f);
        crossoverR.init(sample_rate, 8000.0f);
        harmonicFilterL.init(sample_rate, 10000.0f);
        harmonicFilterR.init(sample_rate, 10000.0f);
        lowPassSincL.init(sample_rate, 18000.0f);
        lowPassSincR.init(sample_rate, 18000.0f);
        denoiseIntensity = 0.0f;
        upscaleTarget = 0.0f;
        presenceBoost = 0.0f;
    }
};

extern ma_node_vtable g_restoration_vtable;

void dsp_flush_all_state(void);

