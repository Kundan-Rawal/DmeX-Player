#include <atomic>
extern std::atomic<float> g_presenceBoost;
extern std::atomic<float> g_upscaleTarget;
#include "FFTConvolver.h"
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
    void reset() { x1 = x2 = y1 = y2 = 0.0f; }


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

    
    void reset() { x1 = x2 = y1 = y2 = 0.0f; }
    void init(float sample_rate, float cutoff_hz, float q, float gain_db)
    {
        update_coeffs(sample_rate, cutoff_hz, q, gain_db);
        reset();
    }

    void update_coeffs(float sample_rate, float cutoff_hz, float q, float gain_db)
    {
        if (fabsf(gain_db) < 1.0e-6f) {
            b0 = 1.0f;
            b1 = b2 = a1 = a2 = 0.0f;
            return;
        }
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

    // RBJ slope-1 shelves, matching miniaudio's shelf design.
    void update_shelf(float sampleRate, float frequency, float gainDb, bool high) {
        if (fabsf(gainDb) < 1.0e-6f) {
            b0 = 1.0f; b1 = b2 = a1 = a2 = 0.0f;
            return;
        }
        const double A = pow(10.0, gainDb / 40.0);
        const double w = 2.0 * M_PI * frequency / sampleRate;
        const double c = cos(w), v = sqrt(2.0 * A) * sin(w);
        const double sign = high ? 1.0 : -1.0;
        const double a0 = A + 1.0 - sign * (A - 1.0) * c + v;
        b0 = (float)(A * (A + 1.0 + sign * (A - 1.0) * c + v) / a0);
        b1 = (float)(-sign * 2.0 * A * (A - 1.0 + sign * (A + 1.0) * c) / a0);
        b2 = (float)(A * (A + 1.0 + sign * (A - 1.0) * c - v) / a0);
        a1 = (float)(sign * 2.0 * (A - 1.0 - sign * (A + 1.0) * c) / a0);
        a2 = (float)((A + 1.0 - sign * (A - 1.0) * c - v) / a0);
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
#include "DirectionalBands.h"

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

    void reset() { x1 = x2 = y1 = y2 = 0.0f; }

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

    void reset() {
        lpf1.reset();
        lpf2.reset();
        hpf1.reset();
        hpf2.reset();
    }

    // Splits a single signal into Low and High with perfect flat-sum phase alignment
    void process(float input, float &outLow, float &outHigh)
    {
        outLow = lpf2.process(lpf1.process(input));
        outHigh = hpf2.process(hpf1.process(input));
    }
};

#include "NineSpeakerUpmixer.h"

struct DynamicSpatializerNode
{
    ma_node_base baseNode;

    NineSpeakerUpmixer upmixer;
    SmoothedGate gate;
    float sampleRate = 48000.0f;
    bool rendererSleeping = true;

    void init(float sr, const char* sofaFile = nullptr) {
        sampleRate = sr;
        upmixer.init(sr, sofaFile);
        gate.init(false, sr, 25.0f); // 25ms smooth click-free crossfade
        rendererSleeping = true;
    }

    void setSeparation(float value) {
        upmixer.setSeparation(value);
    }

    float separationTarget() const {
        return upmixer.separationTarget();
    }

    void setDepth(float value) {
        upmixer.setDepth(value);
    }

    bool hrtfAvailable() const {
        return upmixer.hrtfAvailable();
    }

    int hrtfSampleRate() const {
        return upmixer.hrtfSampleRate();
    }

    int hrtfInitStatus() const {
        return upmixer.hrtfInitStatus();
    }

    void reset() {
        upmixer.reset();
    }
};

extern ma_node_vtable g_dynamic_spatializer_vtable;

#include "Oversampler.h"

struct StudioExciterNode
{
    ma_node_base baseNode;
    SmoothedParam drive;
    float hpStateL, hpStateR;
    float hpCoef; // Dynamically calculated HPF coefficient

    Oversampler4x os, cleanOs;
    float dryDelayL[64], dryDelayR[64];
    int dryIdx = 0, dryDelay = 0;

    void init(float sampleRate) {
        os.init();
        cleanOs.init();
        drive.init(0.0f, sampleRate);
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
    float sampleRate = 48000.0f;
    SmoothedParam width;
    
    // Crossfeed states
    float delayL[CROSSFEED_DELAY_SAMPLES];
    float delayR[CROSSFEED_DELAY_SAMPLES];
    int delayIdx;
    float lpStateL, lpStateR;
    float sideLp, sideLp2;
};

#define MAX_AP_BUF 1500

struct AllPassFilter
{
    float buf[MAX_AP_BUF];
    int size, idx;
    float feedback;
};

void ap_init(AllPassFilter *a, int sz, float fb);
float ap_tick(AllPassFilter *a, float in);

#define SURROUND_HAAS_DELAY 882
#define CENTER_ITD_DELAY 22

struct PsychoacousticNode
{
    ma_node_base baseNode;
    float sampleRate = 48000.0f;
    
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
    SmoothedParam depthAmount;
    DirectionalBands bandsMid, bandsSide;
    float lastDepth = -1.0f;
};

struct EqualLoudness {
    BiquadPeak lowShelfL, lowShelfR;
    BiquadPeak highShelfL, highShelfR;
    float sr = 48000.0f;
    float envDb = -20.0f;
    float lastVolume = -1.0f;
    SmoothedParam volume;
    SmoothedGate enabled;
    unsigned updateCounter = 0;

    void init(float sampleRate) {
        sr = sampleRate;
        lastVolume = -1.0f;
        updateCounter = 0;
        volume.init(1.0f, sr, 50.0f);
        enabled.init(true, sr, 25.0f);
        lowShelfL.init(sr, 80.0f, 0.7f, 0.0f);
        lowShelfR.init(sr, 80.0f, 0.7f, 0.0f);
        highShelfL.init(sr, 10000.0f, 0.7f, 0.0f);
        highShelfR.init(sr, 10000.0f, 0.7f, 0.0f);
    }

    void update(float currentVolume) {
        float delta = 0.0f;
        // Start boosting ONLY when volume slider is below 50%
        if (currentVolume < 0.5f) {
            // Delta scales from 0 (at 0.5 vol) to 50 (at 0.0 vol)
            delta = (0.5f - currentVolume) * 100.0f;
        }

        // Extremely gentle boost for DmeX's naturally bass-heavy signature
        float bassBoost   = delta * 0.05f; 
        float trebleBoost = delta * 0.03f;

        // Hard cap to prevent any distortion
        bassBoost   = fminf(bassBoost,   2.5f); // Max +2.5dB
        trebleBoost = fminf(trebleBoost, 1.5f); // Max +1.5dB

        // Coefficients can change with the volume control, but each channel
        // keeps its own history so loudness compensation cannot crossfeed L/R.
        lowShelfL.update_shelf(sr, 80.0f, bassBoost, false);
        lowShelfR.update_shelf(sr, 80.0f, bassBoost, false);
        highShelfL.update_shelf(sr, 10000.0f, trebleBoost, true);
        highShelfR.update_shelf(sr, 10000.0f, trebleBoost, true);
        lastVolume = currentVolume;
    }

    inline void process(float& l, float& r) {
        const float v = volume.next();
        if ((updateCounter++ & 31u) == 0 && fabsf(lastVolume - v) > 0.0001f)
            update(v);
        const float wet = enabled.next();
        const float fl = highShelfL.process(lowShelfL.process(l));
        const float fr = highShelfR.process(lowShelfR.process(r));
        l += (fl - l) * wet;
        r += (fr - r) * wet;
    }
};

struct AudiophileEQNode
{
    ma_node_base baseNode;
    SmoothedParam targetBass, targetMid, targetHigh;
    float sampleRate = 48000.0f;
    float lastPresence = -1.0f;
    float lastBassDb = 100.0f, lastTrebleDb = 100.0f;
    BiquadPeak bassShelfL, bassShelfR, trebleShelfL, trebleShelfR;
    unsigned coefficientCounter = 0;
    
    LinkwitzRiley4 crossBassL, crossBassR;       // 80Hz
    LinkwitzRiley4 crossMidBassL, crossMidBassR; // 180Hz
    LinkwitzRiley4 crossTrebleL, crossTrebleR;   // 8000Hz
    
    BiquadPeak presenceL, presenceR; // 2.5kHz Fletcher-Munson presence eq
    float envUpwardL, envUpwardR;    // Envelope trackers for Upward Compression
    
    float dcBlockL, dcBlockR;
    float env; // CRITICAL FIX: Envelope tracker for Fletcher-Munson curve
    EqualLoudness iso226;
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
    float sampleRate = 48000.0f;
    CombFilter combL[4], combR[4];
    AllPassFilter apL[2], apR[2];
    SmoothedParam roomSize, wetMix, damp;
    SmoothedGate enabled;
    BiquadHPF hpfL, hpfR;
    std::atomic<bool> automatic{false};
    SmoothedGate automaticBlend;
    float autoFast = 0.0f, autoSlow = 0.0f;
};

struct SubwooferNode
{
    ma_node_base baseNode;
    LinkwitzRiley4 crossBassL, crossBassR;       // 80Hz
    LinkwitzRiley4 crossMidBassL, crossMidBassR; // 180Hz
    LinkwitzRiley4 analysis60L, analysis60R;
    LinkwitzRiley4 analysis100L, analysis100R;
    
    SmoothedParam drive, field, room;
    BiquadHPF speakerProtectionL, speakerProtectionR;
    BiquadHPF virtualBassL, virtualBassR;
    float fieldDelayL[2048]{}, fieldDelayR[2048]{};
    int fieldIndex = 0;
    unsigned tuneCounter = 0;
    float energyAttack = 0.0f, energyRelease = 0.0f;
    float transientFastCoef = 0.0f, transientSlowCoef = 0.0f;
    float transientFast = 0.0f, transientSlow = 0.0f;
    float fullBandEnv = 0.0f;
    float bassScarcity = 0.0f;
    float lastDensity = -1.0f;
    float lastScarcity = -1.0f;

    // Three-band fundamental tracking and broad dual-anchor shaping.
    float env30_60 = 0.0f, env60_90 = 0.0f, env90_130 = 0.0f;
    float currentFreq = 105.0f, targetFreq = 105.0f;
    float lastTunedFreq = -1.0f;
    float lastSubHz = -1.0f;
    BiquadPeak subPeakL, subPeakR; // User-selected broad weight anchor
    BiquadPeak midPeakL, midPeakR; // Dynamic 78-118Hz punch anchor
    BiquadHPF subsonicL, subsonicR; // Removes non-musical content below roughly 26Hz
    bool isHighlightInit = false;
    float lastBassGain = -1.0f;
    float sampleRate = 44100.0f;
};
struct ConvolutionNode
{
    ma_node_base baseNode;
    
    // We use pointers and atomic swap to safely hot-swap IRs from the loading thread
    std::atomic<FFTConvolver*> convL{nullptr};
    std::atomic<FFTConvolver*> convR{nullptr};
    
    // IR ownership changes are permitted only while the engine is stopped.

    BlockAdapter blockAdapterL;
    BlockAdapter blockAdapterR;
    int blockSize = 512;

    SmoothedParam wetMix;
    float feedL[512]{}, feedR[512]{}, wetL[512]{}, wetR[512]{}, mix[512]{};
    BiquadHPF hpfL, hpfR;
    float hpStateL = 0.0f;
    float hpStateR = 0.0f;
    float lpStateL = 0.0f;
    float lpStateR = 0.0f;
    float bassStateL = 0.0f;
    float bassStateR = 0.0f;
};

// ================================================================
// TASK T22: INVERSE HEADPHONE COMPENSATION (HARMAN TARGET CALIBRATION)
// ================================================================
struct HeadphoneCompNode
{
    ma_node_base baseNode;
    float sampleRate = 48000.0f;

    std::atomic<FFTConvolver*> convL{nullptr};
    std::atomic<FFTConvolver*> convR{nullptr};

    // IR ownership changes are permitted only while the engine is stopped.

    BlockAdapter blockAdapterL;
    BlockAdapter blockAdapterR;
    int blockSize = 512;

    SmoothedGate enabled;
    SmoothedParam strength; // 0.0 to 1.0 (100% Harman calibration)

    void init(float sr = 48000.0f) {
        sampleRate = sr;
        blockSize = 512;
        blockAdapterL.init(512, 2);
        blockAdapterR.init(512, 2);
        enabled.init(false, sr, 25.0f);
        strength.init(1.0f, sr, 25.0f);
    }

    void reset() {
        if (auto* c = convL.load(std::memory_order_relaxed)) c->reset();
        if (auto* c = convR.load(std::memory_order_relaxed)) c->reset();
        blockAdapterL.reset();
        blockAdapterR.reset();
    }
};

#define COMP_LOOKAHEAD_SAMPLES 192

struct MultibandCompressorNode
{
    ma_node_base baseNode;
    float sampleRate = 48000.0f;
    SmoothedParam threshold;
    SmoothedParam makeupGain;
    float envLow, envHigh;
    float attackCoef, releaseCoef;
    float detectorCoef = 0.02f;
    SmoothedGate enabled;
    float lpStateL, lpStateR;

    // CRITICAL FIX 2: Crossover states for the delayed audio path
    float delayLpStateL, delayLpStateR;

    float dlyL[COMP_LOOKAHEAD_SAMPLES];
    float dlyR[COMP_LOOKAHEAD_SAMPLES];
    int dlyIdx, delaySamples;
    LinkwitzRiley4 crossL, crossR; // Phase-coherent 150Hz crossover
};

#define LIMITER_LOOKAHEAD_SAMPLES 384

struct LimiterNode
{
    ma_node_base baseNode;
    SmoothedParam boost, master;
    int holdSamples = 0;
    float gainEnv;
    float gainSmooth; // T11.3 smoothed envelope
    float attackCoef, releaseCoef;
    float peakEnv; // Anti-motorboating envelope peak follower
    float loudnessEnv = 0.0f;
    float loudnessGain = 1.0f;
    float loudnessAttackCoef = 0.0f;
    float loudnessReleaseCoef = 0.0f;
    float loudnessGainAttackCoef = 0.0f;
    float loudnessGainReleaseCoef = 0.0f;
    float loudnessSidechainCoef = 0.0f;
    float loudnessThreshold = 1.0f;
    float loudnessRatio = 1.0f;
    float loudnessMakeup = 1.0f;
    unsigned loudnessControlCounter = 0;

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
extern ma_node_vtable g_headphone_comp_vtable;
struct AudioRestorationNode
{
    ma_node_base baseNode;
    LinkwitzRiley4 crossoverL, crossoverR;
    BiquadHPF harmonicFilterL, harmonicFilterR;
    Oversampler4x os;
    SmoothedParam amount;
    float dryL[64]{}, dryR[64]{};
    int delayIndex = 0, delaySamples = 20;

    void init(float sampleRate) {
        crossoverL.init(sampleRate, 8000.0f);
        crossoverR.init(sampleRate, 8000.0f);
        harmonicFilterL.init(sampleRate, 10000.0f);
        harmonicFilterR.init(sampleRate, 10000.0f);
        os.init();
        amount.init(0.0f, sampleRate, 25.0f);
        delaySamples = (int)os.latencySamples();
        delayIndex = 0;
        std::fill(std::begin(dryL), std::end(dryL), 0.0f);
        std::fill(std::begin(dryR), std::end(dryR), 0.0f);
    }
};

extern ma_node_vtable g_restoration_vtable;

void dsp_flush_all_state(void);
