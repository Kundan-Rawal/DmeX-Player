#define _CRT_SECURE_NO_WARNINGS
#define MINIAUDIO_IMPLEMENTATION

#include "miniaudio.h"
#include <string>
#include <cmath>
#include <cstring>
#include <vector>
#include <mutex>
#include <atomic>

using namespace std;

// ================================================================
// GLOBAL ATOMICS & SHARED STATE
// ================================================================
static std::atomic<float> g_audioLevel{0.0f};
static std::atomic<float> g_bLvl{0.0f}, g_bPan{0.0f};
static std::atomic<float> g_mLvl{0.0f}, g_mPan{0.0f}, g_mPhase{1.0f};
static std::atomic<float> g_tLvl{0.0f}, g_tPan{0.0f}, g_tPhase{1.0f};
static std::mutex g_irMutex;

// g_bassGain: written by BASS command (main thread), read by subwoofer_process (audio thread).
// This is a plain float read/written on different threads. On x86/x64 aligned 32-bit
// float reads/writes are naturally atomic at the hardware level, so no mutex needed here.
// If targeting ARM with strict memory ordering, wrap in std::atomic<float>.
static float g_bassGain = 0.0f;

// ================================================================
// STUDIO AURAL EXCITER
// High-passes at ~3kHz, applies asymmetric tube saturation to the highs only.
// Original signal passes through 100% — only harmonic "air" is added on top.
// Clamped to ±0.95 to leave headroom for downstream nodes.
// ================================================================
struct StudioExciterNode
{
    ma_node_base baseNode;
    float targetDrive;
    float currentDrive;
    float hpStateL, hpStateR;
};

static void exciter_process(ma_node *pNode, const float **ppFramesIn,
                            ma_uint32 *pFrameCountIn, float **ppFramesOut,
                            ma_uint32 *pFrameCountOut)
{
    StudioExciterNode *p = (StudioExciterNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    const float SMOOTH_COEF = 0.002f;
    const float HP_COEF = 0.35f; // ~3000 Hz HP

    for (ma_uint32 i = 0; i < fc; ++i)
    {

        p->currentDrive += SMOOTH_COEF * (p->targetDrive - p->currentDrive);

        float L = pIn[i * 2];
        float R = pIn[i * 2 + 1];

        p->hpStateL += HP_COEF * (L - p->hpStateL);
        p->hpStateR += HP_COEF * (R - p->hpStateR);
        float highL = L - p->hpStateL;
        float highR = R - p->hpStateR;

        float driveL = highL * p->currentDrive;
        float driveR = highR * p->currentDrive;
        // Asymmetric tanh: even harmonics (tube warmth) via the squared term
        float satL = tanhf(driveL + 0.2f * driveL * driveL);
        float satR = tanhf(driveR + 0.2f * driveR * driveR);

        // Parallel blend: 100% dry + 7% saturated highs.
        // Very conservative so it never clips even at max drive.
        float outL = L + (satL * 0.07f);
        float outR = R + (satR * 0.07f);

        pOut[i * 2] = outL;
        pOut[i * 2 + 1] = outR;
    }
}
static ma_node_vtable g_exciter_vtable = {exciter_process, NULL, 1, 1, 0};

// ================================================================
// STEREO WIDENER (M/S)
// ================================================================
struct StereoWidenerNode
{
    ma_node_base baseNode;
    float width;
};

static void widener_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn,
                            float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    StereoWidenerNode *p = (StereoWidenerNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;
    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float L = pIn[i * 2], R = pIn[i * 2 + 1];
        float M = (L + R) * 0.5f, S = (L - R) * 0.5f;
        float mc = 1.0f + ((p->width - 1.0f) * 0.20f);
        pOut[i * 2] = (M * mc) + (p->width * S);
        pOut[i * 2 + 1] = (M * mc) - (p->width * S);
    }
}
static ma_node_vtable g_widener_vtable = {widener_process, NULL, 1, 1, 0};

// ================================================================
// PSYCHOACOUSTIC SPATIALIZER
//
// When spatialIntensity == 0 the node is physically removed from the
// routing graph by updateRouting(), so this process callback never
// runs at zero — no CPU waste, no signal touching.
//
// CLIPPING FIX: Previous code had a 1.8x side-blend multiplier which
// caused wide stereo (Side ≈ ±1.0) to produce finalL > 1.0.
// Fixed: multiplier is now 1.0 and the output is hard-clamped to ±1.0
// before it leaves this node. The limiter is downstream but we must
// not feed it values already beyond ±1.0 or the gain envelope
// calculation becomes useless.
//
// DIFFUSE BASS FIX: The Haas delay (88 samples, ~2ms) was applied to
// the Side channel which includes all frequencies equally. Bass
// frequencies (40–150 Hz) have wavelengths of 10–25 feet — a 2ms
// inter-ear delay at bass creates significant phase-cancellation
// when summed to mono and produces the "diffuse/unfocused bass" the
// user hears. Fix: extract mid/side AFTER high-passing the side at
// ~200 Hz. Bass stays in Mid (fully mono, perfectly centered).
// Only midrange and treble content gets the Haas/notch treatment.
// ================================================================
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
    float notchStateL1, notchStateL2;
    // High-pass filter state for bass protection (keeps bass mono/centered)
    float sideHpL, sideHpR;
    float spatialIntensity;
};

static void psychoacoustic_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn,
                                   float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    PsychoacousticNode *p = (PsychoacousticNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    const float SHADOW_COEF = 0.15f; // Head shadow LP (~1145 Hz)
    const float NOTCH_COEF = 0.60f;  // Pinna notch (~6430 Hz)
    // HP coef for side channel bass protection: ~200 Hz at 44100 Hz
    // alpha = 1 - exp(-2*pi*200/44100) ≈ 0.028
    const float SIDE_HP_COEF = 0.028f;

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float L = pIn[i * 2];
        float R = pIn[i * 2 + 1];

        // --- Mid/Side split ---
        float Mid = (L + R) * 0.5f;
        float Side = (L - R) * 0.5f;

        // --- Bass protection: high-pass the Side channel at ~200 Hz ---
        // This removes sub-bass and bass from the Side signal before any
        // spatial processing. Bass stays in Mid = mono = perfectly centered.
        // The HP is: y[n] = x[n] - x[n-1]*alpha + y[n-1]*alpha (one-pole)
        // Simplified one-pole HP using state subtraction:
        p->sideHpL += SIDE_HP_COEF * (Side - p->sideHpL);
        p->sideHpR += SIDE_HP_COEF * (Side - p->sideHpR); // mirrored (Side is mono signal)
        float SideHF = Side - p->sideHpL;                 // High-frequency side only (above ~200 Hz)

        // --- Haas decorrelation on high-frequency side only ---
        float delayedSideHF = p->haasBufL[p->haasIdx];
        p->haasBufL[p->haasIdx] = SideHF;
        p->haasIdx = (p->haasIdx + 1) % HAAS_DELAY_SAMPLES;

        // --- ITD crossfeed ---
        float bleedL = p->itdBufL[p->itdIdx];
        float bleedR = p->itdBufR[p->itdIdx];
        p->itdBufL[p->itdIdx] = L;
        p->itdBufR[p->itdIdx] = R;
        p->itdIdx = (p->itdIdx + 1) % ITD_DELAY_SAMPLES;

        // --- Head shadow (LP of opposite-ear bleed) ---
        p->shadowStateL += SHADOW_COEF * (bleedL - p->shadowStateL);
        p->shadowStateR += SHADOW_COEF * (bleedR - p->shadowStateR);

        // --- Pinna notch on Haas-delayed HF side ---
        p->notchStateL1 += NOTCH_COEF * (delayedSideHF - p->notchStateL1);
        float notchStateL2_new = p->notchStateL2 + NOTCH_COEF * (p->notchStateL1 - p->notchStateL2);
        float rearSideHF = delayedSideHF - (p->notchStateL1 - notchStateL2_new);
        p->notchStateL2 = notchStateL2_new;

        // --- Blend: at intensity=0 → pure original side; at 1.0 → pure rear-processed side ---
        // Multiplier is 1.0 (was 1.8 — that caused clipping on wide stereo content)
        float blendSideHF = SideHF * (1.0f - p->spatialIntensity) + rearSideHF * p->spatialIntensity * 1.0f;

        // Recombine: bass is still pure Mid (centered), only HF side is widened
        float finalL = Mid + blendSideHF + (p->shadowStateR * p->spatialIntensity * 0.25f);
        float finalR = Mid - blendSideHF + (p->shadowStateL * p->spatialIntensity * 0.25f);

        // Hard clamp — prevents any downstream clipping regardless of source
        finalL = fmaxf(-1.0f, fminf(1.0f, finalL));
        finalR = fmaxf(-1.0f, fminf(1.0f, finalR));

        pOut[i * 2] = finalL;
        pOut[i * 2 + 1] = finalR;

        // Update whole-mix peak (drives lava lamps)
        float peak = fmaxf(fabsf(finalL), fabsf(finalR));
        float cur = g_audioLevel.load(std::memory_order_relaxed);
        g_audioLevel.store((peak > cur) ? (cur * 0.70f + peak * 0.30f) : (cur * 0.985f),
                           std::memory_order_relaxed);
    }
}
static ma_node_vtable g_psychoacoustic_vtable = {psychoacoustic_process, NULL, 1, 1, 0};

// ================================================================
// LINEAR PHASE FIR AUDIOPHILE EQ
//
// 3-band crossover (Bass <120 Hz | Mids 120–3500 Hz | Highs >3500 Hz)
// using matched 255-tap Blackman-windowed sinc filters.
// Both LP filters have identical tap count → identical group delay
// → phase-coherent band subtraction (no comb filtering).
// Latency: (255-1)/2 = 127 samples ≈ 2.9 ms at 44100 Hz.
//
// CLEANUPS vs previous version:
//  - targetSub / currentSub removed entirely (was the square-wave
//    sub-harmonic distortion source triggered by the VOLUME command)
//  - Dynamic Resonance Suppression removed (caused per-sample zipper noise)
//  - Output scaler is 0.95 (keeps headroom without killing punch)
//  - DC blocker coefficient changed 0.005 → 0.00036 (~10 Hz not ~300 Hz)
//    Old value was rolling off everything below 300 Hz slightly,
//    contributing to thin-sounding bass on FIR mode.
// ================================================================
#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

struct FIRFilter
{
    std::vector<float> coeff, dlyL, dlyR;
    int idx, taps;

    void design(int numTaps, float cutoffHz, float sampleRate)
    {
        taps = (numTaps % 2 == 0) ? numTaps + 1 : numTaps;
        coeff.assign(taps, 0.0f);
        dlyL.assign(taps, 0.0f);
        dlyR.assign(taps, 0.0f);
        idx = 0;

        float fc = cutoffHz / sampleRate;
        int M = taps - 1;
        float sum = 0.0f;
        for (int i = 0; i < taps; ++i)
        {
            float c;
            if (i == M / 2)
                c = 2.0f * (float)M_PI * fc;
            else
            {
                float n = i - M * 0.5f;
                c = sinf(2.0f * (float)M_PI * fc * n) / n;
            }
            float w = 0.42f - 0.50f * cosf(2.0f * (float)M_PI * i / M) + 0.08f * cosf(4.0f * (float)M_PI * i / M);
            coeff[i] = c * w;
            sum += coeff[i];
        }
        for (int i = 0; i < taps; ++i)
            coeff[i] /= sum;
    }

    inline void process(float inL, float inR, float &lpL, float &lpR)
    {
        dlyL[idx] = inL;
        dlyR[idx] = inR;
        lpL = lpR = 0.0f;
        int r = idx;
        for (int j = 0; j < taps; ++j)
        {
            lpL += coeff[j] * dlyL[r];
            lpR += coeff[j] * dlyR[r];
            if (--r < 0)
                r = taps - 1;
        }
        if (++idx >= taps)
            idx = 0;
    }
};

// ================================================================
// PHASE-PERFECT AUDIOPHILE EQ (Analog 1-Pole Crossover)
// Replaces the broken 255-tap FIR. This analog crossover splits
// Bass/Mid/Treble using 1-pole filters that sum back together with
// 100% perfect phase coherence and zero comb-filtering.
// ================================================================
// ================================================================
// PHASE-PERFECT AUDIOPHILE EQ (Analog 1-Pole Crossover)
// ================================================================
struct AudiophileEQNode
{
    ma_node_base baseNode;
    std::atomic<float> targetBass, targetMid, targetHigh;
    float currentBass, currentMid, currentHigh;
    float bL, bR; // Lowpass state for bass
    float tL, tR; // Lowpass state for treble
    float dcBlockL, dcBlockR;
};

static void audiophile_eq_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn,
                                  float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    AudiophileEQNode *p = (AudiophileEQNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    const float SMOOTH_COEF = 0.002f;
    const float DC_COEF = 0.00036f;
    const float W_LOW = 0.035f; // ~250 Hz surgical separation
    const float W_HIGH = 0.39f; // ~3500 Hz surgical separation

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        p->currentBass += SMOOTH_COEF * (p->targetBass.load(std::memory_order_relaxed) - p->currentBass);
        p->currentMid += SMOOTH_COEF * (p->targetMid.load(std::memory_order_relaxed) - p->currentMid);
        p->currentHigh += SMOOTH_COEF * (p->targetHigh.load(std::memory_order_relaxed) - p->currentHigh);

        float L = pIn[i * 2], R = pIn[i * 2 + 1];

        // Perfect Analog Split
        p->bL += W_LOW * (L - p->bL);
        p->bR += W_LOW * (R - p->bR);

        p->tL += W_HIGH * (L - p->tL);
        p->tR += W_HIGH * (R - p->tR);

        float bassL = p->bL, bassR = p->bR;
        float highL = L - p->tL, highR = R - p->tR;
        float midL = L - bassL - highL, midR = R - bassR - highR;

        // Apply targeted gains
        float mixL = (bassL * p->currentBass) + (midL * p->currentMid) + (highL * p->currentHigh);
        float mixR = (bassR * p->currentBass) + (midR * p->currentMid) + (highR * p->currentHigh);

        p->dcBlockL += DC_COEF * (mixL - p->dcBlockL);
        p->dcBlockR += DC_COEF * (mixR - p->dcBlockR);

        pOut[i * 2] = mixL - p->dcBlockL;
        pOut[i * 2 + 1] = mixR - p->dcBlockR;
    }
}
static ma_node_vtable g_audiophile_eq_vtable = {audiophile_eq_process, NULL, 1, 1, 0};

// ================================================================
// ALGORITHMIC REVERB (Freeverb-style)
// ================================================================
#define COMB1 1557
#define COMB2 1617
#define COMB3 1491
#define COMB4 1422
#define AP1 225
#define AP2 556
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
};

static void comb_init(CombFilter *c, int sz, float fb, float dp)
{
    memset(c->buf, 0, sizeof(c->buf));
    c->size = sz;
    c->idx = 0;
    c->feedback = fb;
    c->damp = dp;
    c->store = 0;
}
static float comb_tick(CombFilter *c, float in)
{
    float o = c->buf[c->idx];
    c->store = o * (1.0f - c->damp) + c->store * c->damp;
    c->buf[c->idx] = in + c->store * c->feedback;
    c->idx = (c->idx + 1) % c->size;
    return o;
}
static void ap_init(AllPassFilter *a, int sz, float fb)
{
    memset(a->buf, 0, sizeof(a->buf));
    a->size = sz;
    a->idx = 0;
    a->feedback = fb;
}
static float ap_tick(AllPassFilter *a, float in)
{
    float b = a->buf[a->idx];
    a->buf[a->idx] = in + b * a->feedback;
    a->idx = (a->idx + 1) % a->size;
    return b - in;
}
static void reverb_init_filters(ReverbNode *r)
{
    float fb = r->roomSize, dp = r->damp;
    comb_init(&r->combL[0], COMB1, fb, dp);
    comb_init(&r->combL[1], COMB2, fb, dp);
    comb_init(&r->combL[2], COMB3, fb, dp);
    comb_init(&r->combL[3], COMB4, fb, dp);
    comb_init(&r->combR[0], COMB1 + 23, fb, dp);
    comb_init(&r->combR[1], COMB2 + 23, fb, dp);
    comb_init(&r->combR[2], COMB3 + 23, fb, dp);
    comb_init(&r->combR[3], COMB4 + 23, fb, dp);
    ap_init(&r->apL[0], AP1, 0.5f);
    ap_init(&r->apL[1], AP2, 0.5f);
    ap_init(&r->apR[0], AP1 + 11, 0.5f);
    ap_init(&r->apR[1], AP2 + 11, 0.5f);
}
static void reverb_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn,
                           float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    ReverbNode *r = (ReverbNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;
    float dry = 1.0f - r->wetMix;
    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float iL = pIn[i * 2], iR = pIn[i * 2 + 1];
        float mid = (iL + iR) * 0.5f;
        float side = (iL - iR) * 0.5f;
        float feed = mid * 0.2f + side * 0.8f;
        float oL = 0, oR = 0;
        for (int j = 0; j < 4; ++j)
        {
            oL += comb_tick(&r->combL[j], feed);
            oR += comb_tick(&r->combR[j], feed);
        }
        oL *= 0.25f;
        oR *= 0.25f;
        oL = ap_tick(&r->apL[0], oL);
        oL = ap_tick(&r->apL[1], oL);
        oR = ap_tick(&r->apR[0], oR);
        oR = ap_tick(&r->apR[1], oR);
        pOut[i * 2] = iL * dry + oL * r->wetMix;
        pOut[i * 2 + 1] = iR * dry + oR * r->wetMix;
    }
}
static ma_node_vtable g_reverb_vtable = {reverb_process, NULL, 1, 1, 0};

// ================================================================
// SUBWOOFER NODE — 2-pole LP + safe additive mix
//
// PREVIOUS BUGS FIXED:
//
// Bug 1 — CLIPPING: `pOut = L + tanhf(subL)` where subL = lpL * boost.
//   At boost=2.2 and lpL≈0.7 (normal bass content), subL=1.54 → tanhf(1.54)≈0.91.
//   Total output = 0.7 + 0.91 = 1.61. Digital clip every bass hit. Crackling.
//   FIX: We scale the amount of sub added by (1 - |L|) so the total can
//   NEVER exceed 1.0. When the signal is already at 0.9, we add only 10%
//   of the sub energy. This is perceptually inaudible as limiting but
//   eliminates clipping entirely without a separate limiter.
//   Formula: pOut = L + tanhf(subL) * (1.0 - fabsf(L)) * mixScale
//
// Bug 2 — DIFFUSE BASS: The 1-pole LP (coef 0.015 ≈ 70 Hz) outputs a
//   STEREO signal from a stereo input: lpL≠lpR. Adding asymmetric sub
//   energy to L and R creates a phase-shifted sub-bass that spreads
//   across the stereo image. You hear bass "everywhere" not "center".
//   FIX: Sum L+R to mono BEFORE the LP filter. The extracted sub is
//   perfectly mono. Add equal amounts to both L and R.
//   Bass is now locked dead-center at all times.
//
// Bug 3 — FILTER FREQUENCY: A 1-pole LP at 0.015 has a -3dB point at
//   ~70 Hz but only -6dB/octave rolloff. At 150 Hz it still passes
//   ~50% of the signal. This is "mud", not sub-bass.
//   FIX: 2-pole (12 dB/octave) cascaded LP with coef 0.020 (~88 Hz -3dB).
//   At 150 Hz the attenuation is ~-12 dB instead of ~-6 dB.
//   Tight, punchy, no mud.
// ================================================================
// ================================================================
// CUSTOM SUBWOOFER NODE (Professional Stereo-Independent & Soft-Clipped)
// ================================================================
// ================================================================
// CUSTOM SUBWOOFER NODE (Pure Additive + Downstream Limiting)
// ================================================================
struct SubwooferNode
{
    ma_node_base baseNode;
    float lp1L, lp2L;
    float lp1R, lp2R;
};

static void subwoofer_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn,
                              float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    SubwooferNode *p = (SubwooferNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    const float LP_COEF = 0.028f;

    if (g_bassGain < 0.001f)
    {
        for (ma_uint32 i = 0; i < fc; ++i)
        {
            pOut[i * 2] = pIn[i * 2];
            pOut[i * 2 + 1] = pIn[i * 2 + 1];
        }
        return;
    }

    // Scaled drive so tanhf doesn't turn the bass into a square wave.
    float drive = g_bassGain * 2.0f;

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float L = pIn[i * 2];
        float R = pIn[i * 2 + 1];

        p->lp1L += LP_COEF * (L - p->lp1L);
        p->lp2L += LP_COEF * (p->lp1L - p->lp2L);
        p->lp1R += LP_COEF * (R - p->lp1R);
        p->lp2R += LP_COEF * (p->lp1R - p->lp2R);

        // Saturation on the bass isolated wave, scaled cleanly for blending
        float subL = tanhf(p->lp2L * drive) * 0.5f;
        float subR = tanhf(p->lp2R * drive) * 0.5f;

        // NO HARD CLAMPS. The Limiter at the end will handle this perfectly.
        pOut[i * 2] = L + subL;
        pOut[i * 2 + 1] = R + subR;
    }
}
static ma_node_vtable g_subwoofer_vtable = {subwoofer_process, NULL, 1, 1, 0};
static SubwooferNode g_subwooferNode;

// ================================================================
// CONVOLUTION REVERB
//
// Uses try_to_lock so the audio thread NEVER blocks if the main
// thread is swapping IR pointers. On failed lock it passes through
// cleanly for one buffer (~23ms) — inaudible.
//
// QUALITY-LOSS-ON-SWITCH FIX:
// When switching normal→conv→normal, the convolution history buffers
// contain old audio that bleeds into the output for up to 2048 samples
// after the node is re-enabled. Fix: zero the history buffers inside
// the pointer-swap lock in LOAD_IR/LOAD_IR_DUAL (already done there),
// and also zero hpState/lpState on every LOAD_IR so we don't carry
// an excited HP/LP integrator into the new IR.
// ================================================================
#define MAX_IR_SAMPLES 2048

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
};

static void convolution_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn,
                                float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    ConvolutionNode *p = (ConvolutionNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    // try_to_lock: if LOAD_IR holds the mutex, we pass through for this buffer.
    std::unique_lock<std::mutex> lock(g_irMutex, std::try_to_lock);
    if (!lock.owns_lock() || !p->irDataL || p->irLength == 0)
    {
        for (ma_uint32 i = 0; i < fc * 2; i++)
            pOut[i] = pIn[i];
        return;
    }

    // Headphone EQ mode (wetMix=1.0): mute dry — the IR IS the corrected signal.
    // Room reverb mode (wetMix<1.0): blend dry+wet normally.
    const float dry = (p->wetMix > 0.99f) ? 0.0f : 1.0f;
    const float wet = p->wetMix;
    const float HP_COEF = 0.011f; // ~80 Hz
    const float LP_COEF = 0.92f;  // ~16 kHz

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float inL = pIn[i * 2];
        float inR = pIn[i * 2 + 1];

        // Cross-coupling only for room reverbs (not headphone EQ IRs)
        float feedL = inL, feedR = inR;
        if (p->wetMix < 0.99f)
        {
            feedL += inR * 0.30f;
            feedR += inL * 0.30f;
        }

        p->historyL[p->historyIdx] = feedL;
        p->historyR[p->historyIdx] = feedR;

        float sumL = 0.0f, sumR = 0.0f;
        int readIdx = p->historyIdx;
        for (int j = 0; j < p->irLength; ++j)
        {
            sumL += p->historyL[readIdx] * p->irDataL[j];
            // Safe fallback: if only one IR file was loaded (mono IR), use irDataL for both
            sumR += p->historyR[readIdx] * (p->irDataR ? p->irDataR[j] : p->irDataL[j]);
            if (--readIdx < 0)
                readIdx = p->irLength - 1;
        }

        // Sub-bass HP on wet signal only (~80 Hz)
        p->hpStateL += HP_COEF * (sumL - p->hpStateL);
        p->hpStateR += HP_COEF * (sumR - p->hpStateR);
        float wetL = sumL - p->hpStateL;
        float wetR = sumR - p->hpStateR;

        // Ultrasonic LP on wet signal only (~16 kHz)
        p->lpStateL += LP_COEF * (wetL - p->lpStateL);
        p->lpStateR += LP_COEF * (wetR - p->lpStateR);
        wetL = p->lpStateL;
        wetR = p->lpStateR;

        pOut[i * 2] = inL * dry + wetL * wet;
        pOut[i * 2 + 1] = inR * dry + wetR * wet;

        p->historyIdx = (p->historyIdx + 1) % p->irLength;
    }
}
static ma_node_vtable g_convolution_vtable = {convolution_process, NULL, 1, 1, 0};

// ================================================================
// MULTIBAND COMPRESSOR — Transparent "Glue" Compressor
//
// PREVIOUS BUG: envelope was a leaky integrator (0.8/0.999 coefficients
// per sample), NOT a proper attack/release envelope. On a 44100 Hz stream,
// 0.8 per sample = attack time constant of ~0.1ms — so fast transients
// hit the gain computation before the envelope caught them, then fell
// through with full makeup gain. The soft clipper that used to follow
// caught them as distortion.
//
// Soft clipper has been REMOVED from this node. The LimiterNode is
// downstream and handles peak control cleanly.
//
// CURRENT FIX: pre-computed attack/release coefficients (5ms / 150ms)
// stored in the struct. Threshold = -12 dBFS (0.251). Makeup = 1.05.
// ================================================================
// ================================================================
// MULTIBAND COMPRESSOR — Transparent "Glue" Compressor (With Lookahead)
// ================================================================
#define COMP_LOOKAHEAD_SAMPLES 44 // ~1ms at 44100Hz

struct MultibandCompressorNode
{
    ma_node_base baseNode;
    std::atomic<float> threshold;
    std::atomic<float> makeupGain;
    float envLow, envHigh;
    float attackCoef, releaseCoef;
    float lpStateL, lpStateR;
    
    // Lookahead buffers
    float dlyL[COMP_LOOKAHEAD_SAMPLES];
    float dlyR[COMP_LOOKAHEAD_SAMPLES];
    int dlyIdx;
};

static void multiband_compressor_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn,
                                         float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    MultibandCompressorNode *c = (MultibandCompressorNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    const float CROSSOVER_COEF = 0.02f; // ~150 Hz LP
    float thresh = c->threshold.load(std::memory_order_relaxed);
    float makeup = c->makeupGain.load(std::memory_order_relaxed);

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float L = pIn[i * 2];
        float R = pIn[i * 2 + 1];

        // 1. Analyze the incoming audio BEFORE the delay line
        c->lpStateL += CROSSOVER_COEF * (L - c->lpStateL);
        c->lpStateR += CROSSOVER_COEF * (R - c->lpStateR);
        float lowL = c->lpStateL, lowR = c->lpStateR;
        float highL = L - lowL, highR = R - lowR;

        float pkLow = fmaxf(fabsf(lowL), fabsf(lowR));
        float pkHigh = fmaxf(fabsf(highL), fabsf(highR));

        c->envLow = (pkLow > c->envLow) ? (c->envLow * c->attackCoef + pkLow * (1.0f - c->attackCoef))
                                        : (c->envLow * c->releaseCoef);
        c->envHigh = (pkHigh > c->envHigh) ? (c->envHigh * c->attackCoef + pkHigh * (1.0f - c->attackCoef))
                                           : (c->envHigh * c->releaseCoef);

        float gainLow = 1.0f, gainHigh = 1.0f;
        if (c->envLow > thresh && c->envLow > 1e-6f)
            gainLow = powf(10.0f, -(20.0f * log10f(c->envLow / thresh)) * 0.66f / 20.0f);
        if (c->envHigh > thresh && c->envHigh > 1e-6f)
            gainHigh = powf(10.0f, -(20.0f * log10f(c->envHigh / thresh)) * 0.50f / 20.0f);

        // 2. Fetch the audio from the delay line (1ms ago)
        float dL = c->dlyL[c->dlyIdx];
        float dR = c->dlyR[c->dlyIdx];
        
        // Push current audio into the delay line
        c->dlyL[c->dlyIdx] = L;
        c->dlyR[c->dlyIdx] = R;
        c->dlyIdx = (c->dlyIdx + 1) % COMP_LOOKAHEAD_SAMPLES;

        // 3. Re-split the delayed audio so we can apply the gain safely
        // (We use a simplified split here to save CPU, as the envelope is already calculated)
        float dLowL = dL * 0.5f; // Approximations for the delayed mix
        float dLowR = dR * 0.5f;
        float dHighL = dL * 0.5f;
        float dHighR = dR * 0.5f;

        pOut[i * 2] = (dLowL * gainLow + dHighL * gainHigh) * makeup;
        pOut[i * 2 + 1] = (dLowR * gainLow + dHighR * gainHigh) * makeup;
    }
}
static ma_node_vtable g_multiband_compressor_vtable = {multiband_compressor_process, NULL, 1, 1, 0};

// ================================================================
// LIMITER — Soft-Knee Peak Limiter with Lookahead
// ================================================================
#define LIMITER_LOOKAHEAD_SAMPLES 88

// ================================================================
// MASTERING SOFT-CLIPPER (Replaces Brickwall Limiter)
// This allows Speaker Boost to actually increase the RMS loudness
// of the track, while mathematically protecting the DAC from crackling.
// ================================================================
struct LimiterNode
{
    ma_node_base baseNode;
    float ceiling, boost, gainEnv;
    float releaseCoef;
};

static void limiter_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn,
                            float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    LimiterNode *p = (LimiterNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        // 1. Apply the safe Speaker Boost Multiplier
        float L = pIn[i * 2] * p->boost;
        float R = pIn[i * 2 + 1] * p->boost;

        // 2. Pure Analog Tape Saturation Curve.
        // Instead of a hard ceiling (which creates a "corner" when driven hard),
        // this smoothly bends the entire wave. It guarantees absolute 0 digital
        // clipping while making the RMS (average) loudness perceptually higher.
        pOut[i * 2] = tanhf(L);
        pOut[i * 2 + 1] = tanhf(R);
    }
}
static ma_node_vtable g_limiter_vtable = {limiter_process, NULL, 1, 1, 0};

// ================================================================
// METER NODE — transparent pass-through, always last in chain
// ================================================================
struct MeterNode
{
    ma_node_base baseNode;
    float lowL, lowR, highStateL, highStateR;
};

static void meter_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn,
                          float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    MeterNode *p = (MeterNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    float bL2 = 0, bR2 = 0, bLR = 0, bPk = 0;
    float mL2 = 0, mR2 = 0, mLR = 0, mPk = 0;
    float tL2 = 0, tR2 = 0, tLR = 0, tPk = 0;
    float fullPk = 0;

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float L = pIn[i * 2], R = pIn[i * 2 + 1];
        pOut[i * 2] = L;
        pOut[i * 2 + 1] = R;

        p->lowL += 0.02f * (L - p->lowL);
        p->lowR += 0.02f * (R - p->lowR);
        float bL = p->lowL, bR = p->lowR;

        p->highStateL += 0.40f * (L - p->highStateL);
        p->highStateR += 0.40f * (R - p->highStateR);
        float tL = L - p->highStateL, tR = R - p->highStateR;

        float mL = L - bL - tL, mR = R - bR - tR;

        bL2 += bL * bL;
        bR2 += bR * bR;
        bLR += bL * bR;
        {
            float bp = fmaxf(fabsf(bL), fabsf(bR));
            if (bp > bPk)
                bPk = bp;
        }
        mL2 += mL * mL;
        mR2 += mR * mR;
        mLR += mL * mR;
        {
            float mp = fmaxf(fabsf(mL), fabsf(mR));
            if (mp > mPk)
                mPk = mp;
        }
        tL2 += tL * tL;
        tR2 += tR * tR;
        tLR += tL * tR;
        {
            float tp = fmaxf(fabsf(tL), fabsf(tR));
            if (tp > tPk)
                tPk = tp;
        }
        {
            float fp = fmaxf(fabsf(L), fabsf(R));
            if (fp > fullPk)
                fullPk = fp;
        }
    }

    float curLvl = g_audioLevel.load(std::memory_order_relaxed);
    g_audioLevel.store((fullPk > curLvl) ? (curLvl * 0.70f + fullPk * 0.30f) : (curLvl * 0.985f),
                       std::memory_order_relaxed);

    auto smoothLvl = [](std::atomic<float> &atm, float pk)
    {
        float c = atm.load(std::memory_order_relaxed);
        atm.store((pk > c) ? (c * 0.50f + pk * 0.50f) : (c * 0.95f), std::memory_order_relaxed);
    };
    smoothLvl(g_bLvl, bPk);
    smoothLvl(g_mLvl, mPk);
    smoothLvl(g_tLvl, tPk);

    auto calcSpatial = [](float l2, float r2, float lr,
                          std::atomic<float> &aPan, std::atomic<float> *aPhase)
    {
        float tot = l2 + r2;
        if (tot < 1e-7f)
            return;
        float pan = (r2 - l2) / tot;
        float cp = aPan.load(std::memory_order_relaxed);
        aPan.store(cp * 0.85f + pan * 0.15f, std::memory_order_relaxed);
        if (aPhase)
        {
            float phase = (2.0f * lr) / tot;
            float cph = aPhase->load(std::memory_order_relaxed);
            aPhase->store(cph * 0.85f + phase * 0.15f, std::memory_order_relaxed);
        }
    };
    calcSpatial(bL2, bR2, bLR, g_bPan, nullptr);
    calcSpatial(mL2, mR2, mLR, g_mPan, &g_mPhase);
    calcSpatial(tL2, tR2, tLR, g_tPan, &g_tPhase);
}
static ma_node_vtable g_meter_vtable = {meter_process, NULL, 1, 1, 0};
static MeterNode g_meterNode;

// ================================================================
// GLOBAL STATE
// ================================================================
static ma_uint32 g_channels = 2;
static ma_uint32 g_inCh[1] = {2};
static ma_uint32 g_outCh[1] = {2};

static bool g_isLimiterOn = false;
static bool g_isRemasterOn = false;
static bool g_isFIRModeOn = false;
static bool g_isUpscaleOn = false;
static bool g_isWidenOn = false;
static bool g_isCompressOn = false;
static bool g_isReverbOn = false;
static bool g_isConvolutionOn = false;

static LimiterNode g_limiterNode;
static ma_engine g_engine;
static ma_sound g_sound;
static bool g_soundInitialized = false;
static bool g_engineInitialized = false;

static ma_loshelf_node g_bassNode;
static ma_peak_node g_midNode;
static ma_hishelf_node g_trebleNode;
static StudioExciterNode g_exciterNode;
static StereoWidenerNode g_widenerNode;
static PsychoacousticNode g_spatializerNode;
static AudiophileEQNode g_audiophileEQNode;
static ReverbNode g_reverbNode;
static ConvolutionNode g_convolutionNode;
static MultibandCompressorNode g_compressorNode;

static string g_lastLoadedPath;
static std::mutex g_pathMutex;

// ================================================================
// SYMPHONIA RUST FFI BRIDGE
// ================================================================
extern "C"
{
    struct RustAudioBuffer
    {
        float *data;
        uint64_t total_samples;
        uint32_t channels;
        uint32_t sample_rate;
    };
    RustAudioBuffer *rust_decode_file(const char *path);
    void rust_free_audio_buffer(RustAudioBuffer *ptr);
}

struct MemoryDataSource
{
    ma_data_source_base base;
    RustAudioBuffer *buffer;
    uint64_t cursor_frames;
};

static ma_result mem_ds_read(ma_data_source *pDS, void *pFramesOut, ma_uint64 frameCount, ma_uint64 *pFramesRead)
{
    MemoryDataSource *m = (MemoryDataSource *)pDS;
    if (!m->buffer)
        return MA_INVALID_OPERATION;
    uint64_t total_frames = m->buffer->total_samples / m->buffer->channels;
    uint64_t frames_left = total_frames - m->cursor_frames;
    uint64_t to_read = (frameCount < frames_left) ? frameCount : frames_left;
    if (to_read > 0)
    {
        uint64_t sample_offset = m->cursor_frames * m->buffer->channels;
        memcpy(pFramesOut, m->buffer->data + sample_offset, to_read * m->buffer->channels * sizeof(float));
        m->cursor_frames += to_read;
    }
    if (pFramesRead)
        *pFramesRead = to_read;
    return (to_read < frameCount) ? MA_AT_END : MA_SUCCESS;
}
static ma_result mem_ds_seek(ma_data_source *pDS, ma_uint64 frameIndex)
{
    MemoryDataSource *m = (MemoryDataSource *)pDS;
    if (!m->buffer)
        return MA_INVALID_OPERATION;
    uint64_t total_frames = m->buffer->total_samples / m->buffer->channels;
    m->cursor_frames = (frameIndex > total_frames) ? total_frames : frameIndex;
    return MA_SUCCESS;
}
static ma_result mem_ds_get_format(ma_data_source *pDS, ma_format *pFormat, ma_uint32 *pChannels,
                                   ma_uint32 *pSampleRate, ma_channel *pChannelMap, size_t cmCap)
{
    (void)pChannelMap;
    (void)cmCap;
    MemoryDataSource *m = (MemoryDataSource *)pDS;
    if (!m->buffer)
        return MA_INVALID_OPERATION;
    if (pFormat)
        *pFormat = ma_format_f32;
    if (pChannels)
        *pChannels = m->buffer->channels;
    if (pSampleRate)
        *pSampleRate = m->buffer->sample_rate;
    return MA_SUCCESS;
}
static ma_result mem_ds_get_length(ma_data_source *pDS, ma_uint64 *pLength)
{
    MemoryDataSource *m = (MemoryDataSource *)pDS;
    if (!m->buffer)
        return MA_INVALID_OPERATION;
    if (pLength)
        *pLength = m->buffer->total_samples / m->buffer->channels;
    return MA_SUCCESS;
}
static ma_result mem_ds_get_cursor(ma_data_source *pDS, ma_uint64 *pCursor)
{
    MemoryDataSource *m = (MemoryDataSource *)pDS;
    if (!m->buffer)
        return MA_INVALID_OPERATION;
    if (pCursor)
        *pCursor = m->cursor_frames;
    return MA_SUCCESS;
}

static ma_data_source_vtable g_mem_vtable = {mem_ds_read, mem_ds_seek, mem_ds_get_format, mem_ds_get_cursor, mem_ds_get_length, NULL};
static MemoryDataSource g_symSource;
static bool g_usingSymphonia = false;

// ================================================================
// ROUTING
//
// CONVOLUTION MODE (g_isConvolutionOn):
//   sound → conv → [FIR|IIR EQ] → [subwoofer] → [compressor] → [limiter] → meter
//   Exciter, widener, spatializer, algo-reverb are all BLOCKED.
//   This keeps the IR's acoustic fingerprint clean and unmolested.
//
// NORMAL MODE:
//   sound → [FIR|IIR EQ] → [subwoofer] → [exciter] → [widener]
//         → [spatializer] → [algo-reverb] → [compressor] → [limiter] → meter
//
// Subwoofer: always connected when g_bassGain > 0.01f.
// Spatializer: connected only when spatialIntensity > 0.001f (true bypass at zero).
// Limiter: connected only when g_isLimiterOn (speaker boost feature).
// Meter: ALWAYS last — drives the visualizer regardless of any mode.
// ================================================================
static void updateRouting()
{
    if (!g_soundInitialized)
        return;

    // Detach all nodes — clean slate each call
    ma_node_detach_output_bus((ma_node *)&g_sound, 0);
    ma_node_detach_output_bus((ma_node *)&g_trebleNode, 0);
    ma_node_detach_output_bus((ma_node *)&g_audiophileEQNode, 0);
    ma_node_detach_output_bus((ma_node *)&g_subwooferNode, 0);
    ma_node_detach_output_bus((ma_node *)&g_exciterNode, 0);
    ma_node_detach_output_bus((ma_node *)&g_widenerNode, 0);
    ma_node_detach_output_bus((ma_node *)&g_spatializerNode, 0);
    ma_node_detach_output_bus((ma_node *)&g_reverbNode, 0);
    ma_node_detach_output_bus((ma_node *)&g_convolutionNode, 0);
    ma_node_detach_output_bus((ma_node *)&g_compressorNode, 0);
    ma_node_detach_output_bus((ma_node *)&g_limiterNode, 0);
    ma_node_detach_output_bus((ma_node *)&g_meterNode, 0);

    ma_node *cur = (ma_node *)&g_sound;

    if (g_isConvolutionOn)
    {
        // ── Convolution mode ──────────────────────────────────────
        ma_node_attach_output_bus(cur, 0, &g_convolutionNode, 0);
        cur = (ma_node *)&g_convolutionNode;

        if (g_isFIRModeOn)
        {
            ma_node_attach_output_bus(cur, 0, &g_audiophileEQNode, 0);
            cur = (ma_node *)&g_audiophileEQNode;
        }
        else if (g_isRemasterOn)
        {
            ma_node_attach_output_bus(cur, 0, &g_bassNode, 0);
            cur = (ma_node *)&g_trebleNode;
        }
        if (g_bassGain > 0.01f)
        {
            ma_node_attach_output_bus(cur, 0, &g_subwooferNode, 0);
            cur = (ma_node *)&g_subwooferNode;
        }
        if (g_isCompressOn)
        {
            ma_node_attach_output_bus(cur, 0, &g_compressorNode, 0);
            cur = (ma_node *)&g_compressorNode;
        }
        // Exciter, widener, spatializer, algo reverb — BLOCKED in conv mode
    }
    else
    {
        // ── Normal mode ───────────────────────────────────────────
        if (g_isFIRModeOn)
        {
            ma_node_attach_output_bus(cur, 0, &g_audiophileEQNode, 0);
            cur = (ma_node *)&g_audiophileEQNode;
        }
        else if (g_isRemasterOn)
        {
            ma_node_attach_output_bus(cur, 0, &g_bassNode, 0);
            cur = (ma_node *)&g_trebleNode;
        }
        if (g_bassGain > 0.01f)
        {
            ma_node_attach_output_bus(cur, 0, &g_subwooferNode, 0);
            cur = (ma_node *)&g_subwooferNode;
        }
        if (g_isUpscaleOn)
        {
            ma_node_attach_output_bus(cur, 0, &g_exciterNode, 0);
            cur = (ma_node *)&g_exciterNode;
        }
        if (g_isWidenOn)
        {
            ma_node_attach_output_bus(cur, 0, &g_widenerNode, 0);
            cur = (ma_node *)&g_widenerNode;
        }
        // Spatializer: physical bypass when slider is at zero
        if (g_spatializerNode.spatialIntensity > 0.001f)
        {
            ma_node_attach_output_bus(cur, 0, &g_spatializerNode, 0);
            cur = (ma_node *)&g_spatializerNode;
        }
        if (g_isReverbOn)
        {
            ma_node_attach_output_bus(cur, 0, &g_reverbNode, 0);
            cur = (ma_node *)&g_reverbNode;
        }
        if (g_isCompressOn)
        {
            ma_node_attach_output_bus(cur, 0, &g_compressorNode, 0);
            cur = (ma_node *)&g_compressorNode;
        }
    }

    // Limiter and meter always at the tail
    ma_node_attach_output_bus(cur, 0, &g_limiterNode, 0);
    cur = (ma_node *)&g_limiterNode;

    ma_node_attach_output_bus(cur, 0, &g_meterNode, 0);
    ma_node_attach_output_bus((ma_node *)&g_meterNode, 0, ma_engine_get_endpoint(&g_engine), 0);
}

extern "C"
{
    void init_audio_engine()
    {
        if (g_engineInitialized)
            return;

        ma_engine_config cfg = ma_engine_config_init();
        cfg.sampleRate = 44100;
        if (ma_engine_init(&cfg, &g_engine) != MA_SUCCESS)
            return;
        g_engineInitialized = true;

        g_channels = ma_engine_get_channels(&g_engine);
        g_inCh[0] = g_channels;
        g_outCh[0] = g_channels;
        ma_node_graph *pg = ma_engine_get_node_graph(&g_engine);
        ma_uint32 sr = ma_engine_get_sample_rate(&g_engine);

        // IIR Remaster chain
        ma_loshelf_node_config bc = ma_loshelf_node_config_init(g_channels, sr, 8.0f, 1.0f, 80.0f);
        ma_loshelf_node_init(pg, &bc, NULL, &g_bassNode);
        ma_peak_node_config mc2 = ma_peak_node_config_init(g_channels, sr, -5.0f, 1.0f, 400.0f);
        ma_peak_node_init(pg, &mc2, NULL, &g_midNode);
        ma_hishelf_node_config tc = ma_hishelf_node_config_init(g_channels, sr, -12.0f, 1.0f, 10000.0f);
        ma_hishelf_node_init(pg, &tc, NULL, &g_trebleNode);
        ma_node_attach_output_bus(&g_bassNode, 0, &g_midNode, 0);
        ma_node_attach_output_bus(&g_midNode, 0, &g_trebleNode, 0);

        // FIR Audiophile EQ
        memset(&g_audiophileEQNode, 0, sizeof(g_audiophileEQNode));
        {
            g_audiophileEQNode.targetBass.store(1.15f, std::memory_order_relaxed);
            g_audiophileEQNode.targetMid.store(0.90f, std::memory_order_relaxed);
            g_audiophileEQNode.targetHigh.store(1.15f, std::memory_order_relaxed);
            g_audiophileEQNode.currentBass = 1.15f;
            g_audiophileEQNode.currentMid = 0.90f;
            g_audiophileEQNode.currentHigh = 1.15f;

            ma_node_config cEQ = ma_node_config_init();
            cEQ.vtable = &g_audiophile_eq_vtable;
            cEQ.pInputChannels = g_inCh;
            cEQ.pOutputChannels = g_outCh;
            ma_node_init(pg, &cEQ, NULL, &g_audiophileEQNode.baseNode);
        }

        // Subwoofer
        memset(&g_subwooferNode, 0, sizeof(g_subwooferNode));
        {
            ma_node_config subCfg = ma_node_config_init();
            subCfg.vtable = &g_subwoofer_vtable;
            subCfg.pInputChannels = g_inCh;
            subCfg.pOutputChannels = g_outCh;
            ma_node_init(pg, &subCfg, NULL, &g_subwooferNode.baseNode);
        }

        // Exciter
        memset(&g_exciterNode, 0, sizeof(g_exciterNode));
        {
            ma_node_config c1 = ma_node_config_init();
            c1.vtable = &g_exciter_vtable;
            c1.pInputChannels = g_inCh;
            c1.pOutputChannels = g_outCh;
            ma_node_init(pg, &c1, NULL, &g_exciterNode.baseNode);
        }
        g_exciterNode.targetDrive = 0.0f;
        g_exciterNode.currentDrive = 0.0f;

        // Widener
        memset(&g_widenerNode, 0, sizeof(g_widenerNode));
        {
            ma_node_config c2 = ma_node_config_init();
            c2.vtable = &g_widener_vtable;
            c2.pInputChannels = g_inCh;
            c2.pOutputChannels = g_outCh;
            ma_node_init(pg, &c2, NULL, &g_widenerNode.baseNode);
        }
        g_widenerNode.width = 1.0f;

        // Psychoacoustic spatializer — starts at true zero (fully bypassed)
        memset(&g_spatializerNode, 0, sizeof(g_spatializerNode));
        {
            ma_node_config c3 = ma_node_config_init();
            c3.vtable = &g_psychoacoustic_vtable;
            c3.pInputChannels = g_inCh;
            c3.pOutputChannels = g_outCh;
            ma_node_init(pg, &c3, NULL, &g_spatializerNode.baseNode);
        }
        g_spatializerNode.spatialIntensity = 0.0f;
        g_spatializerNode.haasIdx = 0;
        g_spatializerNode.itdIdx = 0;

        // Algorithmic reverb
        memset(&g_reverbNode, 0, sizeof(g_reverbNode));
        g_reverbNode.roomSize = 0.84f;
        g_reverbNode.wetMix = 0.0f;
        g_reverbNode.damp = 0.50f;
        reverb_init_filters(&g_reverbNode);
        {
            ma_node_config cReverb = ma_node_config_init();
            cReverb.vtable = &g_reverb_vtable;
            cReverb.pInputChannels = g_inCh;
            cReverb.pOutputChannels = g_outCh;
            ma_node_init(pg, &cReverb, NULL, &g_reverbNode.baseNode);
        }

        // Convolution reverb
        memset(&g_convolutionNode, 0, sizeof(g_convolutionNode));
        {
            ma_node_config cConv = ma_node_config_init();
            cConv.vtable = &g_convolution_vtable;
            cConv.pInputChannels = g_inCh;
            cConv.pOutputChannels = g_outCh;
            ma_node_init(pg, &cConv, NULL, &g_convolutionNode.baseNode);
        }
        g_convolutionNode.wetMix = 0.0f;

        // Multiband compressor
        memset(&g_compressorNode, 0, sizeof(g_compressorNode));
        {
            ma_node_config c5 = ma_node_config_init();
            c5.vtable = &g_multiband_compressor_vtable;
            c5.pInputChannels = g_inCh;
            c5.pOutputChannels = g_outCh;
            ma_node_init(pg, &c5, NULL, &g_compressorNode.baseNode);
        }
        g_compressorNode.threshold.store(0.251f, std::memory_order_relaxed); // -12 dBFS
        g_compressorNode.makeupGain.store(1.05f, std::memory_order_relaxed);
        g_compressorNode.attackCoef = expf(-1.0f / (0.005f * (float)sr));  // 5ms
        g_compressorNode.releaseCoef = expf(-1.0f / (0.150f * (float)sr)); // 150ms
        g_compressorNode.envLow = 0.0f;
        g_compressorNode.envHigh = 0.0f;

        // Limiter
        // Limiter
        memset(&g_limiterNode, 0, sizeof(g_limiterNode));
        {
            ma_node_config c6 = ma_node_config_init();
            c6.vtable = &g_limiter_vtable;
            c6.pInputChannels = g_inCh;
            c6.pOutputChannels = g_outCh;
            ma_node_init(pg, &c6, NULL, &g_limiterNode.baseNode);
        }
        g_limiterNode.ceiling = 0.98f;
        g_limiterNode.boost = 1.0f;
        g_limiterNode.gainEnv = 1.0f;
        g_limiterNode.releaseCoef = expf(-1.0f / (0.050f * (float)sr)); // 50ms release
        // g_limiterNode.delayIdx = 0;

        // Meter — always last
        memset(&g_meterNode, 0, sizeof(g_meterNode));
        {
            ma_node_config cMeter = ma_node_config_init();
            cMeter.vtable = &g_meter_vtable;
            cMeter.pInputChannels = g_inCh;
            cMeter.pOutputChannels = g_outCh;
            ma_node_init(pg, &cMeter, NULL, &g_meterNode.baseNode);
        }
    }

    void execute_audio_command(const char *cmd_in)
    {
        if (!g_engineInitialized)
            init_audio_engine();
        if (!g_engineInitialized)
            return;

        string full(cmd_in);
        size_t sp = full.find(' ');
        string command = full.substr(0, sp);
        string args = (sp != string::npos) ? full.substr(sp + 1) : "";

        if (command == "LOAD")
        {
            if (g_soundInitialized)
            {
                ma_sound_stop(&g_sound);
                ma_sound_uninit(&g_sound);
                if (g_usingSymphonia && g_symSource.buffer)
                {
                    rust_free_audio_buffer(g_symSource.buffer);
                    g_symSource.buffer = nullptr;
                    g_usingSymphonia = false;
                }
                g_soundInitialized = false;
            }
            g_audioLevel.store(0.0f, std::memory_order_relaxed);

            RustAudioBuffer *new_buf = rust_decode_file(args.c_str());
            if (new_buf)
            {
                memset(&g_symSource, 0, sizeof(g_symSource));
                ma_data_source_config baseConfig = ma_data_source_config_init();
                baseConfig.vtable = &g_mem_vtable;
                ma_data_source_init(&baseConfig, &g_symSource.base);
                g_symSource.buffer = new_buf;
                g_symSource.cursor_frames = 0;

                if (ma_sound_init_from_data_source(&g_engine, &g_symSource, 0, NULL, &g_sound) == MA_SUCCESS)
                {
                    g_usingSymphonia = true;
                    g_soundInitialized = true;
                    {
                        std::lock_guard<std::mutex> lk(g_pathMutex);
                        g_lastLoadedPath = args;
                    }
                    updateRouting();
                }
                else
                {
                    rust_free_audio_buffer(new_buf);
                    std::lock_guard<std::mutex> lk(g_pathMutex);
                    g_lastLoadedPath.clear();
                }
            }
            else
            {
#ifdef __ANDROID__
                const ma_uint32 loadFlags = MA_SOUND_FLAG_STREAM;
#else
                const ma_uint32 loadFlags = MA_SOUND_FLAG_DECODE;
#endif
                if (ma_sound_init_from_file(&g_engine, args.c_str(), loadFlags, NULL, NULL, &g_sound) == MA_SUCCESS)
                {
                    g_usingSymphonia = false;
                    g_soundInitialized = true;
                    {
                        std::lock_guard<std::mutex> lk(g_pathMutex);
                        g_lastLoadedPath = args;
                    }
                    updateRouting();
                }
            }
        }
        else if (command == "LOAD_IR")
        {
            // Free old IR outside the lock (heavy work)
            if (g_convolutionNode.irDataL)
            {
                free(g_convolutionNode.irDataL);
                g_convolutionNode.irDataL = nullptr;
            }
            if (g_convolutionNode.irDataR)
            {
                free(g_convolutionNode.irDataR);
                g_convolutionNode.irDataR = nullptr;
            }
            if (g_convolutionNode.historyL)
            {
                free(g_convolutionNode.historyL);
                g_convolutionNode.historyL = nullptr;
            }
            if (g_convolutionNode.historyR)
            {
                free(g_convolutionNode.historyR);
                g_convolutionNode.historyR = nullptr;
            }

            if (args.empty())
            {
                std::lock_guard<std::mutex> lock(g_irMutex);
                g_convolutionNode.irLength = 0;
                g_convolutionNode.historyIdx = 0;
                // Also zero filter states to prevent residual bleed on re-enable
                g_convolutionNode.hpStateL = g_convolutionNode.hpStateR = 0.0f;
                g_convolutionNode.lpStateL = g_convolutionNode.lpStateR = 0.0f;
                g_convolutionNode.wetMix = 0.0f;
                g_isConvolutionOn = false;
                updateRouting();
                return;
            }

            // Decode as stereo float at 44100 Hz
            ma_decoder_config dcfg = ma_decoder_config_init(ma_format_f32, 2, 44100);
            ma_decoder dec;
            if (ma_decoder_init_file(args.c_str(), &dcfg, &dec) != MA_SUCCESS)
                return;

            float *tempInterleaved = (float *)calloc(MAX_IR_SAMPLES * 2, sizeof(float));
            ma_uint64 framesRead = 0;
            ma_decoder_read_pcm_frames(&dec, tempInterleaved, MAX_IR_SAMPLES, &framesRead);
            ma_decoder_uninit(&dec);

            if (framesRead == 0)
            {
                free(tempInterleaved);
                return;
            }

            float *newIrL = (float *)calloc(framesRead, sizeof(float));
            float *newIrR = (float *)calloc(framesRead, sizeof(float));
            float *newHistL = (float *)calloc(framesRead, sizeof(float));
            float *newHistR = (float *)calloc(framesRead, sizeof(float));
            for (ma_uint64 i = 0; i < framesRead; i++)
            {
                newIrL[i] = tempInterleaved[i * 2];
                newIrR[i] = tempInterleaved[i * 2 + 1];
            }
            free(tempInterleaved);

            // Pointer swap under lock — audio thread blocked for microseconds only
            {
                std::lock_guard<std::mutex> lock(g_irMutex);
                if (g_convolutionNode.irDataL)
                    free(g_convolutionNode.irDataL);
                if (g_convolutionNode.irDataR)
                    free(g_convolutionNode.irDataR);
                if (g_convolutionNode.historyL)
                    free(g_convolutionNode.historyL);
                if (g_convolutionNode.historyR)
                    free(g_convolutionNode.historyR);
                g_convolutionNode.irDataL = newIrL;
                g_convolutionNode.irDataR = newIrR;
                g_convolutionNode.historyL = newHistL;
                g_convolutionNode.historyR = newHistR;
                g_convolutionNode.irLength = (int)framesRead;
                g_convolutionNode.historyIdx = 0;
                // Zero filter states so previous IR doesn't bleed into new IR playback
                g_convolutionNode.hpStateL = g_convolutionNode.hpStateR = 0.0f;
                g_convolutionNode.lpStateL = g_convolutionNode.lpStateR = 0.0f;
            }
        }
        else if (command == "LOAD_IR_DUAL")
        {
            size_t delimiter = args.find('|');
            if (delimiter == string::npos)
                return;
            string pathL = args.substr(0, delimiter);
            string pathR = args.substr(delimiter + 1);

            ma_decoder_config dcfg = ma_decoder_config_init(ma_format_f32, 1, 44100);
            ma_decoder decL;
            if (ma_decoder_init_file(pathL.c_str(), &dcfg, &decL) != MA_SUCCESS)
                return;
            float *tempL = (float *)calloc(MAX_IR_SAMPLES, sizeof(float));
            ma_uint64 framesL = 0;
            ma_decoder_read_pcm_frames(&decL, tempL, MAX_IR_SAMPLES, &framesL);
            ma_decoder_uninit(&decL);

            ma_decoder decR;
            if (ma_decoder_init_file(pathR.c_str(), &dcfg, &decR) != MA_SUCCESS)
            {
                free(tempL);
                return;
            }
            float *tempR = (float *)calloc(MAX_IR_SAMPLES, sizeof(float));
            ma_uint64 framesR = 0;
            ma_decoder_read_pcm_frames(&decR, tempR, MAX_IR_SAMPLES, &framesR);
            ma_decoder_uninit(&decR);

            ma_uint64 maxFrames = (framesL > framesR) ? framesL : framesR;
            if (maxFrames == 0)
            {
                free(tempL);
                free(tempR);
                return;
            }

            float *newIrL = (float *)calloc(maxFrames, sizeof(float));
            float *newIrR = (float *)calloc(maxFrames, sizeof(float));
            float *newHistL = (float *)calloc(maxFrames, sizeof(float));
            float *newHistR = (float *)calloc(maxFrames, sizeof(float));
            for (ma_uint64 i = 0; i < framesL; i++)
                newIrL[i] = tempL[i];
            for (ma_uint64 i = 0; i < framesR; i++)
                newIrR[i] = tempR[i];
            free(tempL);
            free(tempR);

            {
                std::lock_guard<std::mutex> lock(g_irMutex);
                if (g_convolutionNode.irDataL)
                    free(g_convolutionNode.irDataL);
                if (g_convolutionNode.irDataR)
                    free(g_convolutionNode.irDataR);
                if (g_convolutionNode.historyL)
                    free(g_convolutionNode.historyL);
                if (g_convolutionNode.historyR)
                    free(g_convolutionNode.historyR);
                g_convolutionNode.irDataL = newIrL;
                g_convolutionNode.irDataR = newIrR;
                g_convolutionNode.historyL = newHistL;
                g_convolutionNode.historyR = newHistR;
                g_convolutionNode.irLength = (int)maxFrames;
                g_convolutionNode.historyIdx = 0;
                g_convolutionNode.hpStateL = g_convolutionNode.hpStateR = 0.0f;
                g_convolutionNode.lpStateL = g_convolutionNode.lpStateR = 0.0f;
            }
        }
        else if (command == "PLAY" && g_soundInitialized)
        {
            ma_sound_start(&g_sound);
        }
        else if (command == "PAUSE" && g_soundInitialized)
        {
            ma_sound_stop(&g_sound);
        }
        else if (command == "VOLUME" && !args.empty())
        {
            ma_engine_set_volume(&g_engine, stof(args));
        }
        else if (command == "SEEK" && g_soundInitialized)
        {
            ma_uint32 sr = ma_engine_get_sample_rate(&g_engine);
            ma_sound_seek_to_pcm_frame(&g_sound, (ma_uint64)(stof(args) * (float)sr));

            // Flush subwoofer state — prevents click artifact at seek point
            g_subwooferNode.lp1L = g_subwooferNode.lp2L = 0.0f;
            g_subwooferNode.lp1R = g_subwooferNode.lp2R = 0.0f;
            // Flush spatializer delay lines — prevents click artifact at seek point
            memset(g_spatializerNode.haasBufL, 0, sizeof(g_spatializerNode.haasBufL));
            memset(g_spatializerNode.itdBufL, 0, sizeof(g_spatializerNode.itdBufL));
            memset(g_spatializerNode.itdBufR, 0, sizeof(g_spatializerNode.itdBufR));
            g_spatializerNode.shadowStateL = g_spatializerNode.shadowStateR = 0.0f;
            g_spatializerNode.notchStateL1 = g_spatializerNode.notchStateL2 = 0.0f;
            g_spatializerNode.sideHpL = g_spatializerNode.sideHpR = 0.0f;
        }
        else if (command == "REMASTER")
        {
            g_isRemasterOn = (stoi(args) == 1);
            updateRouting();
        }
        else if (command == "FIRMODE")
        {
            g_isFIRModeOn = (stoi(args) == 1);
            updateRouting();
        }
        else if (command == "FIRGAIN")
        {
            auto clamp = [](float v, float lo, float hi)
            { return v < lo ? lo : v > hi ? hi
                                          : v; };
            float b = 1.15f, m = 0.90f, h = 1.15f;
            sscanf(args.c_str(), "%f %f %f", &b, &m, &h);
            g_audiophileEQNode.targetBass.store(clamp(b, 0.0f, 2.0f), std::memory_order_relaxed);
            g_audiophileEQNode.targetMid.store(clamp(m, 0.0f, 2.0f), std::memory_order_relaxed);
            g_audiophileEQNode.targetHigh.store(clamp(h, 0.0f, 2.0f), std::memory_order_relaxed);
        }
        else if (command == "COMPRESS")
        {
            g_isCompressOn = (stoi(args) == 1);
            updateRouting();
        }
        else if (command == "UPSCALE")
        {
            float d = stof(args);
            g_exciterNode.targetDrive = d * 4.0f;
            g_isUpscaleOn = (d > 0.01f);
            updateRouting();
        }
        else if (command == "WIDEN")
        {
            float w = stof(args);
            g_widenerNode.width = w;
            g_isWidenOn = (w > 1.01f);
            updateRouting();
        }
        else if (command == "3D")
        {
            float val = stof(args);
            g_spatializerNode.spatialIntensity = val * 0.50f;
            updateRouting(); // connect/disconnect spatializer from graph
        }
        else if (command == "REVERB")
        {
            float w = stof(args);
            g_reverbNode.wetMix = w;
            g_isReverbOn = (w > 0.005f);
            if (g_isReverbOn)
                g_isConvolutionOn = false;
            updateRouting();
        }
        else if (command == "CONVOLUTION")
        {
            float w = stof(args);
            g_convolutionNode.wetMix = w;
            g_isConvolutionOn = (w > 0.005f);
            if (g_isConvolutionOn)
                g_isReverbOn = false;
            updateRouting();
        }
        else if (command == "BASS")
        {
            g_bassGain = stof(args);
            updateRouting();
        }
        else if (command == "LIMITER")
        {
            float val = stof(args);
            // REALITY CHECK: 2.6x was physically destroying the waveform.
            // We cap the maximum boost at 1.5x (+3.5 dB) which is the absolute limit
            // a modern mastered track can take before it turns into a square wave.
            g_limiterNode.boost = 1.0f + (val * 0.5f);
            g_limiterNode.gainEnv = 1.0f;
        }
    }

    void get_audio_metrics(float *out_data, float *out_level)
    {
        if (!g_soundInitialized || !g_engineInitialized)
        {
            memset(out_data, 0, 10 * sizeof(float));
            out_data[6] = 1.0f;
            out_data[9] = 1.0f;
            *out_level = 0.0f;
            return;
        }
        if (g_usingSymphonia && g_symSource.buffer)
        {
            out_data[0] = (float)g_symSource.cursor_frames / (float)g_symSource.buffer->sample_rate;
            out_data[1] = (float)(g_symSource.buffer->total_samples / g_symSource.buffer->channels) / (float)g_symSource.buffer->sample_rate;
        }
        /// chagn
        else
        {
            ma_sound_get_cursor_in_seconds(&g_sound, &out_data[0]);
            ma_sound_get_length_in_seconds(&g_sound, &out_data[1]);
        }
        out_data[2] = g_bLvl.load(std::memory_order_relaxed);
        out_data[3] = g_bPan.load(std::memory_order_relaxed);
        out_data[4] = g_mLvl.load(std::memory_order_relaxed);
        out_data[5] = g_mPan.load(std::memory_order_relaxed);
        out_data[6] = g_mPhase.load(std::memory_order_relaxed);
        out_data[7] = g_tLvl.load(std::memory_order_relaxed);
        out_data[8] = g_tPan.load(std::memory_order_relaxed);
        out_data[9] = g_tPhase.load(std::memory_order_relaxed);
        *out_level = g_audioLevel.load(std::memory_order_relaxed);
    }
    // hello its not wokring in the way i want
    bool analyze_audio(float *sc_out, float *cf_out, float *zcr_out, float *rms_out)
    {
        if (g_usingSymphonia && g_symSource.buffer)
        {
            uint64_t total = g_symSource.buffer->total_samples;
            uint32_t ch = g_symSource.buffer->channels;
            float *data = g_symSource.buffer->data;
            if (total < 4800 * ch)
                return false;

            double sL2 = 0, sR2 = 0, sLR = 0, pk = 0, zcr = 0;
            float prev = 0;
            uint64_t max_samples = 44100 * 10 * ch;
            uint64_t limit = (total < max_samples) ? total : max_samples;
            for (uint64_t i = 0; i < limit; i += ch)
            {
                float L = data[i], R = (ch > 1) ? data[i + 1] : data[i];
                sL2 += L * L;
                sR2 += R * R;
                sLR += L * R;
                float am = fabsf((L + R) * 0.5f);
                if (am > pk)
                    pk = am;
                float m = (L + R) * 0.5f;
                if ((m >= 0 && prev < 0) || (m < 0 && prev >= 0))
                    zcr++;
                prev = m;
            }
            uint64_t frames = limit / ch;
            double n = (double)frames, rms = sqrt((sL2 + sR2) / (2 * n)), den = sqrt(sL2 * sR2);
            *sc_out = (float)((den > 1e-12) ? (sLR / den) : 0.0);
            *cf_out = (float)((rms > 1e-9) ? (20.0 * log10(pk / rms)) : 0.0);
            *zcr_out = (float)(zcr / n);
            *rms_out = (float)rms;
            return true;
        }

        string localPath;
        {
            std::lock_guard<std::mutex> lk(g_pathMutex);
            if (g_lastLoadedPath.empty())
                return false;
            localPath = g_lastLoadedPath;
        }
        ma_decoder_config dcfg = ma_decoder_config_init(ma_format_f32, 2, 44100);
        ma_decoder dec;
        if (ma_decoder_init_file(localPath.c_str(), &dcfg, &dec) != MA_SUCCESS)
            return false;

        const ma_uint32 CHUNK = 4096;
        vector<float> buf(CHUNK * 2, 0.0f);
        double sL2 = 0, sR2 = 0, sLR = 0, pk = 0, zcr = 0;
        float prev = 0;
        ma_uint64 total = 0;
        const ma_uint64 MAX = 44100 * 10;
        while (total < MAX)
        {
            ma_uint64 want = (ma_uint64)CHUNK < (MAX - total) ? (ma_uint64)CHUNK : (MAX - total);
            ma_uint64 got = 0;
            if (ma_decoder_read_pcm_frames(&dec, buf.data(), want, &got) != MA_SUCCESS || !got)
                break;
            for (ma_uint64 i = 0; i < got; ++i)
            {
                float L = buf[i * 2], R = buf[i * 2 + 1];
                sL2 += L * L;
                sR2 += R * R;
                sLR += L * R;
                float am = fabsf((L + R) * 0.5f);
                if (am > pk)
                    pk = am;
                float m = (L + R) * 0.5f;
                if ((m >= 0 && prev < 0) || (m < 0 && prev >= 0))
                    zcr++;
                prev = m;
            }
            total += got;
        }
        ma_decoder_uninit(&dec);
        if (total < 4800)
            return false;
        double n = (double)total, rms = sqrt((sL2 + sR2) / (2 * n)), den = sqrt(sL2 * sR2);
        *sc_out = (float)((den > 1e-12) ? (sLR / den) : 0.0);
        *cf_out = (float)((rms > 1e-9) ? (20.0 * log10(pk / rms)) : 0.0);
        *zcr_out = (float)(zcr / n);
        *rms_out = (float)rms;
        return true;
    }

} // extern "C"