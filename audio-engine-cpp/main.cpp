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
// FORWARD DECLARATION
// ================================================================
static std::atomic<float> g_audioLevel{0.0f}; // Whole-mix peak — drives lava lamps & VU meter

// Multi-band spatial atomics — written by MeterNode, read by get_audio_metrics
// Bass  (< ~150Hz):  only pan tracked; bass is inherently mono in most mixes
// Mids  (150–4kHz):  pan + phase — vocals, guitars, keys live here
// Treble (> ~4kHz):  pan + phase — cymbals, air, sibilance, synth highs
static std::atomic<float> g_bLvl{0.0f}, g_bPan{0.0f};
static std::atomic<float> g_mLvl{0.0f}, g_mPan{0.0f}, g_mPhase{1.0f};
static std::atomic<float> g_tLvl{0.0f}, g_tPan{0.0f}, g_tPhase{1.0f};

// ================================================================
// DSP NODE PROCESS CALLBACKS
// ================================================================
// ================================================================
// STUDIO AURAL EXCITER (Tube Harmonics)
// High-passes the audio at ~3kHz before applying asymmetric clipping.
// Generates warm even/odd harmonics (Air) without distorting the bass.
// ================================================================
struct StudioExciterNode
{
    ma_node_base baseNode;
    float targetDrive;
    float currentDrive;
    float hpStateL, hpStateR;
};

static void exciter_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    StudioExciterNode *p = (StudioExciterNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    const float SMOOTH_COEF = 0.002f; // ~50ms zero-click glide
    const float HP_COEF = 0.35f;      // ~3000Hz Crossover

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        // 1. Parameter Smoothing
        p->currentDrive += SMOOTH_COEF * (p->targetDrive - p->currentDrive);

        float L = pIn[i * 2];
        float R = pIn[i * 2 + 1];

        // 2. High-Pass Filter (Isolate the treble)
        p->hpStateL += HP_COEF * (L - p->hpStateL);
        p->hpStateR += HP_COEF * (R - p->hpStateR);
        float highL = L - p->hpStateL;
        float highR = R - p->hpStateR;

        // 3. Asymmetric Tube Distortion
        // std::tanh gives punchy odd harmonics. The squared term (high * high) adds warm even harmonics.
        float driveL = highL * p->currentDrive;
        float driveR = highR * p->currentDrive;
        float satL = std::tanh(driveL + 0.2f * driveL * driveL);
        float satR = std::tanh(driveR + 0.2f * driveR * driveR);

        // 4. Parallel Mix
        // The original L and R pass through 100% untouched. We just sprinkle the "Air" on top.
        pOut[i * 2] = L + (satL * 0.15f);
        pOut[i * 2 + 1] = R + (satR * 0.15f);
    }
}
static ma_node_vtable g_exciter_vtable = {exciter_process, NULL, 1, 1, 0};

struct StereoWidenerNode
{
    ma_node_base baseNode;
    float width;
};
static void widener_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    StereoWidenerNode *p = (StereoWidenerNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;
    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float L = pIn[i * 2], R = pIn[i * 2 + 1], M = (L + R) * 0.5f, S = (L - R) * 0.5f;
        float mc = 1.0f + ((p->width - 1.0f) * 0.20f);
        pOut[i * 2] = (M * mc) + (p->width * S);
        pOut[i * 2 + 1] = (M * mc) - (p->width * S);
    }
}
static ma_node_vtable g_widener_vtable = {widener_process, NULL, 1, 1, 0};

#define CROSSFEED_DELAY_SAMPLES 72
// ================================================================
// TRUE 360° PSYCHOACOUSTIC UPMIXER
// Replaces the basic crossfeed delay with a Head-Related model.
// ================================================================
#define HAAS_DELAY_SAMPLES 88 // ~2ms for extreme decorrelation width
#define ITD_DELAY_SAMPLES 26  // ~0.6ms representing the distance between human ears

struct PsychoacousticNode
{
    ma_node_base baseNode;

    // Delay lines for Interaural Time Difference (ITD) and Haas Effect
    float haasBufL[HAAS_DELAY_SAMPLES];
    float haasBufR[HAAS_DELAY_SAMPLES];
    float itdBufL[ITD_DELAY_SAMPLES];
    float itdBufR[ITD_DELAY_SAMPLES];
    int haasIdx;
    int itdIdx;

    // Head Shadow Low-Pass Filters (Simulates the skull blocking high frequencies)
    float shadowStateL, shadowStateR;

    // Pinna Notch Filters (Simulates sound wrapping around the outer ear)
    // A notch around 8kHz pushes the sound "behind" the listener.
    float notchStateL1, notchStateL2;
    float notchStateR1, notchStateR2;

    float spatialIntensity; // 0.0 to 1.0 (mapped from UI)
};

static void psychoacoustic_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    PsychoacousticNode *p = (PsychoacousticNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    const float SHADOW_COEF = 0.15f;
    const float NOTCH_COEF = 0.6f;

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float L = pIn[i * 2];
        float R = pIn[i * 2 + 1];

        // 1. EXACT MID/SIDE EXTRACTION
        // Mid is the phantom center (Vocals, Kick). Side is the hard-panned edges.
        float Mid = (L + R) * 0.5f;
        float Side = (L - R) * 0.5f;

        // 2. HAAS DECORRELATION ON THE SIDES ONLY
        // We delay the side channel to stretch the stereo field outside the physical headphones.
        float delayedSide = p->haasBufL[p->haasIdx];
        p->haasBufL[p->haasIdx] = Side;
        p->haasIdx = (p->haasIdx + 1) % HAAS_DELAY_SAMPLES;

        // 3. HEAD SHADOW (Crossfeed)
        // Left ear hears a muffled, delayed version of Right ear, and vice versa.
        float bleedL = p->itdBufL[p->itdIdx];
        float bleedR = p->itdBufR[p->itdIdx];
        p->itdBufL[p->itdIdx] = L;
        p->itdBufR[p->itdIdx] = R;
        p->itdIdx = (p->itdIdx + 1) % ITD_DELAY_SAMPLES;

        p->shadowStateL += SHADOW_COEF * (bleedL - p->shadowStateL);
        p->shadowStateR += SHADOW_COEF * (bleedR - p->shadowStateR);

        // 4. PINNA NOTCH FILTERING
        // Apply the notch filter to the HAAS delayed sides to push them "behind" the head
        p->notchStateL1 += NOTCH_COEF * (delayedSide - p->notchStateL1);
        p->notchStateL2 += NOTCH_COEF * (p->notchStateL1 - p->notchStateL2);
        float rearSide = delayedSide - (p->notchStateL1 - p->notchStateL2);

        // 5. TRUE STEREO RECOMBINATION (The Fix)
        // Mathematically, L = Mid + Side, and R = Mid - Side.
        // If intensity is 0, blendSide equals original Side, leaving the song 100% perfectly untouched.
        // As intensity increases, we blend the original Side with our 3D rearSide.
        float blendSide = (Side * (1.0f - p->spatialIntensity)) + (rearSide * p->spatialIntensity * 1.8f);

        // We inject the head shadow crossfeed (muffled opposite channel) strictly scaled by intensity.
        float finalL = Mid + blendSide + (p->shadowStateR * p->spatialIntensity * 0.35f);
        float finalR = Mid - blendSide + (p->shadowStateL * p->spatialIntensity * 0.35f);

        pOut[i * 2] = finalL;
        pOut[i * 2 + 1] = finalR;

        // Update the peak meter for the lava lamps
        float peak = fmaxf(fabsf(finalL), fabsf(finalR));
        float cur = g_audioLevel.load(std::memory_order_relaxed);
        float next = (peak > cur) ? (cur * 0.70f + peak * 0.30f) : (cur * 0.985f);
        g_audioLevel.store(next, std::memory_order_relaxed);
    }
}
static ma_node_vtable g_psychoacoustic_vtable = {psychoacoustic_process, NULL, 1, 1, 0};

// ================================================================
// LINEAR PHASE FIR AUDIOPHILE EQ NODE
//
// WHY THIS EXISTS:
//   The standard "Remaster" chain uses miniaudio biquad IIR filters
//   (ma_loshelf_node, ma_peak_node, ma_hishelf_node). IIR filters are
//   very fast but they shift the phase of high frequencies — causing
//   microscopic "smearing" on cymbals, hi-hats, and transients that
//   trained ears can detect as a slight haziness.
//
//   This node implements Blackman-windowed sinc FIR filters. FIR filters
//   achieve strictly linear phase — they delay ALL frequencies by the
//   same number of samples, so no frequency is smeared relative to any
//   other. The result is surgical, mastering-grade clarity.
//
// ARCHITECTURE:
//   A 3-band crossover splits the signal into Bass / Mids / Highs using
//   two LP filters. Each band has an independent gain control. The bands
//   are summed and output. All three bands are phase-aligned by delaying
//   the dry signal to compensate for the FIR filter's inherent latency.
//
//   Crossover points: ~120Hz (bass/mid) and ~3500Hz (mid/high)
//   FIR taps: 255 for BOTH filters — identical tap count is mandatory so
//             both LP filters have the same group delay (127 samples).
//             Mismatched tap counts cause comb filtering at the crossover.
//   Latency: (255-1)/2 = 127 samples ≈ 2.9ms at 44100Hz
//   CPU: ~45M multiply-accumulates/sec — negligible on any PC.
//
//   Gain targets (conservative, musical — no clipping, no distortion):
//   Bass  +2dB  (×1.26) — warmth without boom
//   Mid   −1dB  (×0.89) — gentle presence dip, not a harsh scoop
//   High  +1.5dB(×1.19) — subtle air lift, stays clean on all material
//   Output ×0.88 scaler baked into process() — absolute headroom guarantee
//
// USAGE:
//   Optional. Activated by the FIRMODE 1 command.
//   When inactive the node is detached from the graph entirely —
//   no CPU cost whatsoever when the user hasn't enabled it.
//   Command: FIRMODE 1        (enable)
//            FIRMODE 0        (disable)
//            FIRGAIN b m h    (set bass/mid/high gains, e.g. "1.2 0.9 1.15")
// ================================================================
#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// One stereo instance of a single-band FIR LP filter using a circular
// delay line for O(N) per-sample convolution.
struct FIRFilter
{
    std::vector<float> coeff; // filter coefficients (symmetric, numTaps long)
    std::vector<float> dlyL;  // delay line Left
    std::vector<float> dlyR;  // delay line Right
    int idx;                  // write head in circular buffer
    int taps;                 // number of taps (always odd)

    void design(int numTaps, float cutoffHz, float sampleRate)
    {
        taps = (numTaps % 2 == 0) ? numTaps + 1 : numTaps; // force odd
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
            // Blackman window — best stop-band attenuation for audiophile use
            float w = 0.42f - 0.50f * cosf(2.0f * (float)M_PI * i / M) + 0.08f * cosf(4.0f * (float)M_PI * i / M);
            coeff[i] = c * w;
            sum += coeff[i];
        }
        // Normalize: unity gain at DC
        for (int i = 0; i < taps; ++i)
            coeff[i] /= sum;
    }

    // Process one stereo frame. Writes lpL/lpR (low-passed output).
    inline void process(float inL, float inR, float &lpL, float &lpR)
    {
        dlyL[idx] = inL;
        dlyR[idx] = inR;

        lpL = 0.0f;
        lpR = 0.0f;
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

// The full 3-band EQ node that wraps two FIRFilters into a miniaudio node.
struct AudiophileEQNode
{
    ma_node_base baseNode;
    FIRFilter lpBass, lpMid;
    std::vector<float> latDlyL, latDlyR;
    int latIdx, latSamples;

    // Lock-Free UI Targets
    std::atomic<float> targetBass;
    std::atomic<float> targetMid;
    std::atomic<float> targetHigh;
    std::atomic<float> targetSub;

    float currentBass, currentMid, currentHigh, currentSub;

    // Sub-Harmonic Synth State
    float prevBassL, prevBassR;
    float subPhaseL, subPhaseR;
    float subEnvL, subEnvR;

    // DC Blocker State
    float dcBlockL, dcBlockR;
};
static void audiophile_eq_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    AudiophileEQNode *p = (AudiophileEQNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    // One-pole smoothing coefficient (approx 50ms glide at 44100Hz)
    const float SMOOTH_COEF = 0.002f;

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        // 1. Smooth the parameters (Zero-Click gliding)
        p->currentBass += SMOOTH_COEF * (p->targetBass.load(std::memory_order_relaxed) - p->currentBass);
        p->currentMid += SMOOTH_COEF * (p->targetMid.load(std::memory_order_relaxed) - p->currentMid);
        p->currentHigh += SMOOTH_COEF * (p->targetHigh.load(std::memory_order_relaxed) - p->currentHigh);
        p->currentSub += SMOOTH_COEF * (p->targetSub.load(std::memory_order_relaxed) - p->currentSub);

        float inL = pIn[i * 2], inR = pIn[i * 2 + 1];

        // 2. Run both FIR LP filters
        float bassL, bassR, bassAndMidL, bassAndMidR;
        p->lpBass.process(inL, inR, bassL, bassR);
        p->lpMid.process(inL, inR, bassAndMidL, bassAndMidR);

        // 3. Write dry input to latency compensation line
        p->latDlyL[p->latIdx] = inL;
        p->latDlyR[p->latIdx] = inR;

        // 4. Read phase-aligned dry signal
        int readIdx = p->latIdx - p->latSamples;
        if (readIdx < 0)
            readIdx += (int)p->latDlyL.size();
        float dryL = p->latDlyL[readIdx];
        float dryR = p->latDlyR[readIdx];
        p->latIdx = (p->latIdx + 1) % (int)p->latDlyL.size();

        // 5. Derive the three isolated bands
        float midL = bassAndMidL - bassL;
        float midR = bassAndMidR - bassR;
        float highL = dryL - bassAndMidL;
        float highR = dryR - bassAndMidR;

        // 6. DYNAMIC RESONANCE SUPPRESSION (3kHz)
        // If the mids get too loud (e.g. screaming vocals), dynamically dip them by 2dB
        float midPeak = fmaxf(fabsf(midL), fabsf(midR));
        float dynMidGain = p->currentMid;
        if (midPeak > 0.6f)
            dynMidGain *= 0.8f; // Duck the harshness

        // 7. DBX-120 SUB-HARMONIC SYNTHESIZER
        // Track zero-crossings of the bass band to generate a wave at half the frequency
        if (bassL >= 0.0f && p->prevBassL < 0.0f)
            p->subPhaseL = (p->subPhaseL > 0.0f) ? -1.0f : 1.0f;
        if (bassR >= 0.0f && p->prevBassR < 0.0f)
            p->subPhaseR = (p->subPhaseR > 0.0f) ? -1.0f : 1.0f;

        p->prevBassL = bassL;
        p->prevBassR = bassR;

        // Envelope follower to shape the synthesized sub-bass
        p->subEnvL = p->subEnvL * 0.99f + fabsf(bassL) * 0.01f;
        p->subEnvR = p->subEnvR * 0.99f + fabsf(bassR) * 0.01f;

        float synthSubL = p->subPhaseL * p->subEnvL;
        float synthSubR = p->subPhaseR * p->subEnvR;

        float totalBassGain = p->currentBass + p->currentSub;

        // 8. RECOMBINE MIX
        float mixL = (bassL * totalBassGain) + (synthSubL * p->currentSub * 0.5f) + (midL * dynMidGain) + (highL * p->currentHigh);
        float mixR = (bassR * totalBassGain) + (synthSubR * p->currentSub * 0.5f) + (midR * dynMidGain) + (highR * p->currentHigh);

        // 9. 10Hz DC OFFSET BLOCKER
        // Strips out inaudible direct-current offsets to save speaker headroom
        p->dcBlockL += 0.005f * (mixL - p->dcBlockL);
        p->dcBlockR += 0.005f * (mixR - p->dcBlockR);

        pOut[i * 2] = mixL - p->dcBlockL;
        pOut[i * 2 + 1] = mixR - p->dcBlockR;
    }
}
static ma_node_vtable g_audiophile_eq_vtable = {audiophile_eq_process, NULL, 1, 1, 0};
//========================
// ALGORITHMIC REVERB NODE
// Freeverb-style: 4 parallel comb filters + 2 allpass filters per channel.
// CPU cost: negligible (~0.1% on any modern device).
// Best for: synthetic spaces, mobile/low-power scenarios, instant-on
// (requires no IR file).
// Command: REVERB <0.0-1.0>
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
    c->store = o * (1 - c->damp) + c->store * c->damp;
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
static void reverb_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
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
        float mid = (iL + iR) * 0.5f, side = (iL - iR) * 0.5f;
        float feed = (mid * 0.2f) + (side * 0.8f);
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
        pOut[i * 2] = (iL * dry) + (oL * r->wetMix);
        pOut[i * 2 + 1] = (iR * dry) + (oR * r->wetMix);
    }
}
static ma_node_vtable g_reverb_vtable = {reverb_process, NULL, 1, 1, 0};

// ================================================================
// CONVOLUTION REVERB NODE
// Time-domain direct convolution against a real room Impulse Response.
//
// FILTER DESIGN — "Transparent Plate" approach:
//
//   HP at ~80Hz  (coef 0.011f): Removes only sub-bass rumble (< 80Hz).
//   This prevents 808s and kick sub frequencies from creating a low-end
//   build-up in the reverb tail. Everything above 80Hz — including the
//   entire 100-350Hz warmth range that makes the EMT-140 sound analog —
//   passes through completely untouched.
//
//   LP at ~16kHz (coef 0.92f): Removes only ultrasonic aliasing artifacts
//   that can accumulate in time-domain convolution. The filter sits well
//   above the audible air band (12-16kHz) so the EMT-140's famous shimmer
//   and sparkle are preserved. For forest/outdoor IRs with long tails this
//   also prevents harsh flutter echo build-up in the extreme highs.
//
//   dry = 1.0f: The original track always plays at full volume.
//   The reverb is layered additively on top — never subtractive.
//   This means the bass and punch of the dry track is never weakened.
//   No makeup gain needed because no frequencies were carved out.
// ================================================================
#define MAX_IR_SAMPLES 2048

struct ConvolutionNode
{
    ma_node_base baseNode;
    float *irData;   // Impulse Response samples (mono, 44100Hz)
    int irLength;    // Number of IR samples (0 = no IR, passthrough)
    float *historyL; // Circular buffer — past Left-channel input
    float *historyR; // Circular buffer — past Right-channel input
    int historyIdx;  // Write-head position in circular buffers
    float wetMix;    // 0.0 = dry only, 1.0 = full wet layer added
    // One-pole IIR filter states for the wet reverb signal only
    float hpStateL, hpStateR; // High-pass: removes sub-bass rumble
    float lpStateL, lpStateR; // Low-pass:  removes ultrasonic aliasing
};

static void convolution_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    ConvolutionNode *p = (ConvolutionNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    // No IR loaded — pass audio straight through unchanged
    if (!p->irData || p->irLength == 0)
    {
        for (ma_uint32 i = 0; i < fc * 2; i++)
            pOut[i] = pIn[i];
        return;
    }

    // dry = 1.0f: Original track is NEVER attenuated. The reverb is
    // purely additive — layered on top at wetMix volume. This preserves
    // 100% of the bass, punch, and dynamics of the source track.
    const float dry = 1.0f;
    const float wet = p->wetMix;

    // HP coefficient for ~80Hz one-pole high-pass at 44100Hz sample rate.
    // Formula: coef = 2*pi*fc/sr = 2*3.14159*80/44100 ≈ 0.011f
    // Only values BELOW this cutoff are removed from the wet signal.
    const float HP_COEF = 0.011f;

    // LP coefficient for ~16kHz one-pole low-pass at 44100Hz.
    // Formula: coef = 2*pi*fc/sr = 2*3.14159*16000/44100 ≈ 0.92f
    // Only ultrasonic aliasing artifacts above 16kHz are softened.
    const float LP_COEF = 0.92f;

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float inL = pIn[i * 2];
        float inR = pIn[i * 2 + 1];

        // 1. Write the current input frame into the circular history buffers
        p->historyL[p->historyIdx] = inL;
        p->historyR[p->historyIdx] = inR;

        // 2. Direct convolution: multiply history against the entire IR
        float sumL = 0.0f, sumR = 0.0f;
        int readIdx = p->historyIdx;
        for (int j = 0; j < p->irLength; ++j)
        {
            sumL += p->historyL[readIdx] * p->irData[j];
            sumR += p->historyR[readIdx] * p->irData[j];
            if (--readIdx < 0)
                readIdx = p->irLength - 1;
        }

        // 3. Sub-bass high-pass on the wet signal only (~80Hz).
        //    Removes the build-up of kick drum and 808 sub frequencies
        //    in the reverb tail without touching the dry track's bass.
        p->hpStateL += HP_COEF * (sumL - p->hpStateL);
        p->hpStateR += HP_COEF * (sumR - p->hpStateR);
        float wetL = sumL - p->hpStateL; // sub-bass removed, all warmth kept
        float wetR = sumR - p->hpStateR;

        // 4. Ultrasonic low-pass on the wet signal only (~16kHz).
        //    Removes convolution aliasing artifacts while keeping the
        //    EMT-140's shimmer and sparkle fully intact.
        p->lpStateL += LP_COEF * (wetL - p->lpStateL);
        p->lpStateR += LP_COEF * (wetR - p->lpStateR);
        wetL = p->lpStateL;
        wetR = p->lpStateR;

        // 5. Blend: dry at full volume + filtered reverb tail layered on top.
        //    No makeup gain because we barely touched any audible frequencies.
        pOut[i * 2] = (inL * dry) + (wetL * wet);
        pOut[i * 2 + 1] = (inR * dry) + (wetR * wet);

        // 6. Advance the write head
        p->historyIdx = (p->historyIdx + 1) % p->irLength;
    }
}
static ma_node_vtable g_convolution_vtable = {convolution_process, NULL, 1, 1, 0};

// ================================================================
// COMPRESSOR NODE
// ================================================================
// ================================================================
// MASTERING MULTI-BAND COMPRESSOR & SOFT CLIPPER
// Splits audio at 150Hz. Bass and Treble are compressed independently.
// Prevents loud kick drums from sucking the volume out of the vocals.
// Ends with an analog-style soft-clipper to catch rogue peaks.
// ================================================================
struct MultibandCompressorNode
{
    ma_node_base baseNode;

    // Lock-free atomic parameters for thread-safe UI updates
    std::atomic<float> threshold;
    std::atomic<float> makeupGain;

    float envLow, envHigh;
    float lpStateL, lpStateR; // 150Hz Crossover filters
};

static void multiband_compressor_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    MultibandCompressorNode *c = (MultibandCompressorNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    const float CROSSOVER_COEF = 0.02f; // ~150Hz LP filter
    float thresh = c->threshold.load(std::memory_order_relaxed);
    float makeup = c->makeupGain.load(std::memory_order_relaxed);

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float L = pIn[i * 2], R = pIn[i * 2 + 1];

        // 1. Crossover Split (150Hz)
        c->lpStateL += CROSSOVER_COEF * (L - c->lpStateL);
        c->lpStateR += CROSSOVER_COEF * (R - c->lpStateR);
        float lowL = c->lpStateL, lowR = c->lpStateR;
        float highL = L - lowL, highR = R - lowR;

        // 2. Dual Peak Detection
        float pkLow = fmaxf(fabsf(lowL), fabsf(lowR));
        float pkHigh = fmaxf(fabsf(highL), fabsf(highR));

        // 3. Dual Envelopes (Fast attack, medium release)
        c->envLow = c->envLow * 0.999f + pkLow * 0.001f;
        c->envHigh = c->envHigh * 0.998f + pkHigh * 0.002f;

        // 4. Calculate Gain Reduction (Bass ratio 4:1, High ratio 2:1)
        float gainLow = 1.0f, gainHigh = 1.0f;
        if (c->envLow > thresh && c->envLow > 1e-6f)
            gainLow = powf(10.0f, -(20.0f * log10f(c->envLow / thresh)) * 0.75f / 20.0f);
        if (c->envHigh > thresh && c->envHigh > 1e-6f)
            gainHigh = powf(10.0f, -(20.0f * log10f(c->envHigh / thresh)) * 0.5f / 20.0f);

        // 5. Recombine
        float finalL = (lowL * gainLow) + (highL * gainHigh);
        float finalR = (lowR * gainLow) + (highR * gainHigh);
        finalL *= makeup;
        finalR *= makeup;

        // 6. ANALOG SOFT-CLIPPER (Smoothly rounds off anything above 0.90f)
        auto softClip = [](float x)
        {
            float absX = fabsf(x);
            if (absX < 0.90f)
                return x;
            if (absX > 0.98f)
                return (x > 0 ? 0.98f : -0.98f);
            float over = absX - 0.90f;
            float clipped = 0.90f + over / (1.0f + powf(over / 0.08f, 2.0f));
            return (x > 0 ? clipped : -clipped);
        };

        pOut[i * 2] = softClip(finalL);
        pOut[i * 2 + 1] = softClip(finalR);
    }
}
static ma_node_vtable g_multiband_compressor_vtable = {multiband_compressor_process, NULL, 1, 1, 0};
// ================================================================
// LIMITER NODE
// ================================================================
#define LIMITER_LOOKAHEAD_SAMPLES 88 // ~2.0ms at 44100Hz

struct LimiterNode
{
    ma_node_base baseNode;
    float ceiling;
    float boost;
    float gainEnv;
    float attackCoef;
    float releaseCoef;

    // The Lookahead Buffer
    float delayL[LIMITER_LOOKAHEAD_SAMPLES];
    float delayR[LIMITER_LOOKAHEAD_SAMPLES];
    int delayIdx;
};

static void limiter_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    LimiterNode *p = (LimiterNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    const float ceil = p->ceiling;
    const float kneeWidth = 0.15f;
    const float kneeStart = ceil - kneeWidth;

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        // 1. Read the CURRENT audio frame and apply the user's boost
        float L = pIn[i * 2] * p->boost;
        float R = pIn[i * 2 + 1] * p->boost;
        float peak = fmaxf(fabsf(L), fabsf(R));

        // 2. Calculate the target gain based on the CURRENT frame
        float targetGain = 1.0f;
        if (peak > kneeStart && peak > 1e-6f)
        {
            float x = (peak - kneeStart) / kneeWidth;
            float softCeil = kneeStart + kneeWidth * x / (1.0f + x);
            targetGain = softCeil / peak;
        }
        if (peak * targetGain > ceil && peak > 1e-6f)
            targetGain = ceil / peak;

        // 3. Smooth the gain envelope (Attack/Release ballistics)
        float coef = (targetGain < p->gainEnv) ? p->attackCoef : p->releaseCoef;
        p->gainEnv = p->gainEnv * coef + targetGain * (1.0f - coef);

        // 4. THE TIME MACHINE (Lookahead)
        // Read the audio from 2 milliseconds ago...
        float delayedL = p->delayL[p->delayIdx];
        float delayedR = p->delayR[p->delayIdx];

        // ...and store the current audio for the future
        p->delayL[p->delayIdx] = L;
        p->delayR[p->delayIdx] = R;
        p->delayIdx = (p->delayIdx + 1) % LIMITER_LOOKAHEAD_SAMPLES;

        // 5. Apply the futuristic gain envelope to the PAST audio signal.
        // The limiter acts before the transient actually occurs!
        pOut[i * 2] = delayedL * p->gainEnv;
        pOut[i * 2 + 1] = delayedR * p->gainEnv;
    }
}
static ma_node_vtable g_limiter_vtable = {limiter_process, NULL, 1, 1, 0};

// ================================================================
// MULTI-BAND METER NODE — Bass / Mids / Treble Spatial Imager
//
// A transparent pass-through that sits at the end of the audio chain
// and splits every buffer into three frequency bands using one-pole
// IIR filters, then calculates the Level, Pan, and Phase Correlation
// for each band independently.
//
// Crossover points (approximate at 44100Hz sample rate):
//   Bass   LP coef 0.02f  → fc ≈ 140Hz
//   Treble HP coef 0.40f  → fc ≈ 3600Hz
//   Mids                  → everything between the two (by subtraction)
//
// Output atomics layout — matches get_audio_metrics array exactly:
//   g_audioLevel  whole-mix peak (drives lava lamps + mini VU)
//   g_bLvl/bPan   bass level + pan
//   g_mLvl/mPan/mPhase  mid level + pan + phase
//   g_tLvl/tPan/tPhase  treble level + pan + phase
// ================================================================
struct MeterNode
{
    ma_node_base baseNode;
    // One-pole filter states — zero-initialized by memset in init
    float lowL, lowR;             // LP integrator for bass extraction
    float highStateL, highStateR; // LP integrator whose output is subtracted for HP
};

static void meter_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
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
        pOut[i * 2] = L; // Pass-through — meter never alters the signal
        pOut[i * 2 + 1] = R;

        // ── Bass LP (~140Hz) ─────────────────────────────────────
        p->lowL += 0.02f * (L - p->lowL);
        p->lowR += 0.02f * (R - p->lowR);
        float bL = p->lowL, bR = p->lowR;

        // ── Treble HP (~3600Hz) — subtract LP from original ──────
        p->highStateL += 0.40f * (L - p->highStateL);
        p->highStateR += 0.40f * (R - p->highStateR);
        float tL = L - p->highStateL, tR = R - p->highStateR;

        // ── Mids = what's left ────────────────────────────────────
        float mL = L - bL - tL, mR = R - bR - tR;

        // ── Accumulate per-band energy ────────────────────────────
        bL2 += bL * bL;
        bR2 += bR * bR;
        bLR += bL * bR;
        float bp = fmaxf(fabsf(bL), fabsf(bR));
        if (bp > bPk)
            bPk = bp;

        mL2 += mL * mL;
        mR2 += mR * mR;
        mLR += mL * mR;
        float mp = fmaxf(fabsf(mL), fabsf(mR));
        if (mp > mPk)
            mPk = mp;

        tL2 += tL * tL;
        tR2 += tR * tR;
        tLR += tL * tR;
        float tp = fmaxf(fabsf(tL), fabsf(tR));
        if (tp > tPk)
            tPk = tp;

        float fp = fmaxf(fabsf(L), fabsf(R));
        if (fp > fullPk)
            fullPk = fp;
    }

    // ── Whole-mix level (drives lava lamps & mini VU meter) ──────
    float curLvl = g_audioLevel.load(std::memory_order_relaxed);
    g_audioLevel.store((fullPk > curLvl) ? (curLvl * 0.70f + fullPk * 0.30f) : (curLvl * 0.985f),
                       std::memory_order_relaxed);

    // ── Helper: smooth a level atomic with fast attack / slow release ──
    auto smoothLvl = [](std::atomic<float> &atm, float pk)
    {
        float c = atm.load(std::memory_order_relaxed);
        atm.store((pk > c) ? (c * 0.50f + pk * 0.50f) : (c * 0.95f), std::memory_order_relaxed);
    };
    smoothLvl(g_bLvl, bPk);
    smoothLvl(g_mLvl, mPk);
    smoothLvl(g_tLvl, tPk);

    // ── Helper: calculate pan and optional phase from energy sums ──
    auto calcSpatial = [](float l2, float r2, float lr,
                          std::atomic<float> &aPan,
                          std::atomic<float> *aPhase)
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
    calcSpatial(bL2, bR2, bLR, g_bPan, nullptr);   // Bass: pan only (bass is almost always center)
    calcSpatial(mL2, mR2, mLR, g_mPan, &g_mPhase); // Mids: pan + phase
    calcSpatial(tL2, tR2, tLR, g_tPan, &g_tPhase); // Treble: pan + phase
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
static bool g_isFIRModeOn = false; // Optional audiophile FIR EQ (replaces IIR remaster when active)
static bool g_isUpscaleOn = false;
static bool g_isWidenOn = false;
static bool g_isCompressOn = false;
static float g_bassGain = 0.0f;

// Reverb mode flags — MUTUALLY EXCLUSIVE.
// Only one can be true at a time. The REVERB and CONVOLUTION command
// handlers enforce this: enabling one automatically clears the other.
static bool g_isReverbOn = false;      // Algorithmic (Freeverb) reverb
static bool g_isConvolutionOn = false; // Convolution (IR-based) reverb

static LimiterNode g_limiterNode;
static ma_engine g_engine;
static ma_sound g_sound;
static bool g_soundInitialized = false;
static bool g_engineInitialized = false;

static ma_loshelf_node g_bassNode; // Remaster chain bass shelf
static ma_peak_node g_midNode;
static ma_hishelf_node g_trebleNode;
static ma_peak_node g_subwooferNode; // Dedicated, isolated subwoofer
static StudioExciterNode g_exciterNode;
static StereoWidenerNode g_widenerNode;
static PsychoacousticNode g_spatializerNode;
static AudiophileEQNode g_audiophileEQNode; // Optional linear-phase FIR EQ
static ReverbNode g_reverbNode;             // Algorithmic reverb
static ConvolutionNode g_convolutionNode;   // Convolution reverb
static MultibandCompressorNode g_compressorNode;
static string g_lastLoadedPath;
static std::mutex g_pathMutex;

// ================================================================
// SYMPHONIA RUST FFI BRIDGE (IN-MEMORY DECODE)
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

static ma_result mem_ds_get_format(ma_data_source *pDS, ma_format *pFormat, ma_uint32 *pChannels, ma_uint32 *pSampleRate, ma_channel *pChannelMap, size_t cmCap)
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

// 2. UPDATE THE VTABLE TO INCLUDE IT
static ma_data_source_vtable g_mem_vtable = {mem_ds_read, mem_ds_seek, mem_ds_get_format, mem_ds_get_cursor, mem_ds_get_length, NULL};
static MemoryDataSource g_symSource;
static bool g_usingSymphonia = false;

// ================================================================
// ROUTING
// Audio graph order (left to right):
//   sound -> [remaster chain] -> [subwoofer] -> [exciter] -> [widener]
//         -> spatializer -> [algoReverb OR convReverb] -> [compressor]
//         -> [limiter] -> engine endpoint
//
// The two reverb nodes occupy the same slot in the chain and are
// mutually exclusive — only one is ever connected at a time.
// Both are always initialized in memory; switching is zero-cost.
// ================================================================
static void updateRouting()
{
    if (!g_soundInitialized)
        return;

    // Detach everything first for a clean graph every call
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
    ma_node_detach_output_bus((ma_node *)&g_meterNode, 0); // always last in chain

    ma_node *cur = (ma_node *)&g_sound;

    // Remaster/FIR slot — mutually exclusive: FIR takes priority when both are on.
    // The IIR biquad chain (g_bassNode → g_midNode → g_trebleNode) and the FIR
    // AudiophileEQ node occupy the same position in the graph. Only one connects.
    if (g_isFIRModeOn)
    {
        ma_node_attach_output_bus(cur, 0, &g_audiophileEQNode, 0);
        cur = (ma_node *)&g_audiophileEQNode;
    }
    else if (g_isRemasterOn)
    {
        ma_node_attach_output_bus(cur, 0, &g_bassNode, 0);
        cur = (ma_node *)&g_trebleNode; // trebleNode is the tail of the bass->mid->treble chain
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

    // Spatializer is always in the chain (crossMix=0.12 at rest = near-transparent)
    ma_node_attach_output_bus(cur, 0, &g_spatializerNode, 0);
    cur = (ma_node *)&g_spatializerNode;

    // Reverb slot — only ONE of these two ever connects at a time.
    // The else-if here is the routing-level guard that enforces mutual exclusion
    // even if both flags somehow end up true (defensive programming).
    if (g_isReverbOn)
    {
        ma_node_attach_output_bus(cur, 0, &g_reverbNode, 0);
        cur = (ma_node *)&g_reverbNode;
    }
    else if (g_isConvolutionOn)
    {
        ma_node_attach_output_bus(cur, 0, &g_convolutionNode, 0);
        cur = (ma_node *)&g_convolutionNode;
    }

    if (g_isCompressOn)
    {
        ma_node_attach_output_bus(cur, 0, &g_compressorNode, 0);
        cur = (ma_node *)&g_compressorNode;
    }
    if (g_isLimiterOn)
    {
        ma_node_attach_output_bus(cur, 0, &g_limiterNode, 0);
        cur = (ma_node *)&g_limiterNode;
    }

    // Meter is always the absolute last node — it reads the final mix
    // and passes it through to the hardware output unchanged.
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

        // Remaster chain — loshelf -> peak mid -> hishelf treble (chained internally)
        ma_loshelf_node_config bc = ma_loshelf_node_config_init(g_channels, sr, 8.0f, 1.0f, 80.0f);
        ma_loshelf_node_init(pg, &bc, NULL, &g_bassNode);
        ma_peak_node_config mc2 = ma_peak_node_config_init(g_channels, sr, -5.0f, 1.0f, 400.0f);
        ma_peak_node_init(pg, &mc2, NULL, &g_midNode);
        ma_hishelf_node_config tc = ma_hishelf_node_config_init(g_channels, sr, -12.0f, 1.0f, 10000.0f);
        ma_hishelf_node_init(pg, &tc, NULL, &g_trebleNode);
        ma_node_attach_output_bus(&g_bassNode, 0, &g_midNode, 0);
        ma_node_attach_output_bus(&g_midNode, 0, &g_trebleNode, 0);

        // Audiophile FIR EQ — optional, user-activated via FIRMODE command.
        // Uses C++ vectors for delay lines; the node itself is trivially small.
        // Designed here so filters are ready the moment the user enables the feature.
        {
            // Both filters MUST use the same tap count so their group delays
            // are identical. If lpBass has 511 taps and lpMid has 255 taps,
            // bassL is delayed 255 samples but bassAndMidL is delayed 127 —
            // the band-subtraction (midL = bassAndMidL - bassL) combines
            // signals from two different moments in time, producing comb
            // filtering across the entire crossover zone. Sounds shaggy and
            // unclear. Fix: 255 taps for both → both delayed 127 samples.
            const int FIR_TAPS = 255;      // odd, linear phase, same for both filters
            const float BASS_CUT = 120.0f; // Hz — 255 taps gives a clean knee here
            const float MID_CUT = 3500.0f; // Hz — preserves upper-mid body
            const float SAMPLE_RATE = (float)sr;

            // Default gains — used when FIR is on but no smart profile has been
            // applied yet (e.g. user enables FIR before auto-classification fires).
            // Per-profile gains are sent via FIRGAIN from App.tsx on every profile
            // apply, so these defaults only matter for the first few seconds.
            //   Bass  +3.5dB → ×1.50  warm punch, clearly audible
            //   Mid   −2dB   → ×0.79  presence dip: cuts nasal honk, opens mids
            //   High  +2.5dB → ×1.33  air lift: cymbals and sibilance come forward
            // These three band signals sum to ≤ 1.0 on a 0dBFS source because
            // bass energy and treble energy are complementary — they don't peak
            // simultaneously. No blanket output scaler needed.
            g_audiophileEQNode.targetBass = 1.50f;
            g_audiophileEQNode.targetMid = 0.79f;
            g_audiophileEQNode.targetHigh = 1.33f;
            g_audiophileEQNode.targetSub = 0.0f; // Sub starts at 0

            // Snap the current values to target instantly on boot
            g_audiophileEQNode.currentBass = 1.50f;
            g_audiophileEQNode.currentMid = 0.79f;
            g_audiophileEQNode.currentHigh = 1.33f;
            g_audiophileEQNode.currentSub = 0.0f;

            g_audiophileEQNode.lpBass.design(FIR_TAPS, BASS_CUT, SAMPLE_RATE);
            g_audiophileEQNode.lpMid.design(FIR_TAPS, MID_CUT, SAMPLE_RATE);

            // Latency = (255-1)/2 = 127 samples ≈ 2.9ms — same for both filters
            int latency = (FIR_TAPS - 1) / 2;
            g_audiophileEQNode.latSamples = latency;
            g_audiophileEQNode.latDlyL.assign(latency + 1, 0.0f);
            g_audiophileEQNode.latDlyR.assign(latency + 1, 0.0f);
            g_audiophileEQNode.latIdx = 0;

            ma_node_config cFIR = ma_node_config_init();
            cFIR.vtable = &g_audiophile_eq_vtable;
            cFIR.pInputChannels = g_inCh;
            cFIR.pOutputChannels = g_outCh;
            ma_node_init(pg, &cFIR, NULL, &g_audiophileEQNode.baseNode);
        }

        // Dedicated subwoofer — completely separate node, zero gain until slider moves
        ma_peak_node_config subCfg = ma_peak_node_config_init(g_channels, sr, 0.0f, 1.2f, 65.0f);
        ma_peak_node_init(pg, &subCfg, NULL, &g_subwooferNode);

        memset(&g_exciterNode, 0, sizeof(g_exciterNode));
        ma_node_config c1 = ma_node_config_init();
        c1.vtable = &g_exciter_vtable;
        c1.pInputChannels = g_inCh;
        c1.pOutputChannels = g_outCh;
        ma_node_init(pg, &c1, NULL, &g_exciterNode.baseNode);
        g_exciterNode.targetDrive = 0.0f;
        g_exciterNode.currentDrive = 0.0f;

        memset(&g_widenerNode, 0, sizeof(g_widenerNode));
        ma_node_config c2 = ma_node_config_init();
        c2.vtable = &g_widener_vtable;
        c2.pInputChannels = g_inCh;
        c2.pOutputChannels = g_outCh;
        ma_node_init(pg, &c2, NULL, &g_widenerNode.baseNode);
        g_widenerNode.width = 1.0f;

        memset(&g_spatializerNode, 0, sizeof(g_spatializerNode));
        ma_node_config c3 = ma_node_config_init();
        c3.vtable = &g_psychoacoustic_vtable; // Use the new vtable
        c3.pInputChannels = g_inCh;
        c3.pOutputChannels = g_outCh;
        ma_node_init(pg, &c3, NULL, &g_spatializerNode.baseNode);
        g_spatializerNode.spatialIntensity = 0.12f; // Default resting state
        g_spatializerNode.haasIdx = 0;
        g_spatializerNode.itdIdx = 0;

        // Algorithmic reverb — starts silent (wetMix=0), instant-on, no IR needed
        memset(&g_reverbNode, 0, sizeof(g_reverbNode));
        g_reverbNode.roomSize = 0.84f;
        g_reverbNode.wetMix = 0.0f;
        g_reverbNode.damp = 0.50f;
        reverb_init_filters(&g_reverbNode);
        ma_node_config cReverb = ma_node_config_init();
        cReverb.vtable = &g_reverb_vtable;
        cReverb.pInputChannels = g_inCh;
        cReverb.pOutputChannels = g_outCh;
        ma_node_init(pg, &cReverb, NULL, &g_reverbNode.baseNode);

        // Convolution reverb — starts with no IR loaded (passthrough until LOAD_IR)
        memset(&g_convolutionNode, 0, sizeof(g_convolutionNode));
        ma_node_config cConv = ma_node_config_init();
        cConv.vtable = &g_convolution_vtable;
        cConv.pInputChannels = g_inCh;
        cConv.pOutputChannels = g_outCh;
        ma_node_init(pg, &cConv, NULL, &g_convolutionNode.baseNode);
        g_convolutionNode.wetMix = 0.0f;

        memset(&g_compressorNode, 0, sizeof(g_compressorNode));
        ma_node_config c5 = ma_node_config_init();
        c5.vtable = &g_multiband_compressor_vtable; // Use the new multi-band vtable
        c5.pInputChannels = g_inCh;
        c5.pOutputChannels = g_outCh;
        ma_node_init(pg, &c5, NULL, &g_compressorNode.baseNode);

        g_compressorNode.threshold.store(powf(10.0f, -18.0f / 20.0f), std::memory_order_relaxed);
        g_compressorNode.makeupGain.store(2.5f, std::memory_order_relaxed);

        // Initialize the Speaker Boost Limiter (clean soft-knee, no AGC)
        memset(&g_limiterNode, 0, sizeof(g_limiterNode)); // This clears the new delay buffers to silence
        ma_node_config c6 = ma_node_config_init();
        c6.vtable = &g_limiter_vtable;
        c6.pInputChannels = g_inCh;
        c6.pOutputChannels = g_outCh;
        ma_node_init(pg, &c6, NULL, &g_limiterNode.baseNode);

        g_limiterNode.ceiling = 0.98f;
        g_limiterNode.boost = 1.0f;
        g_limiterNode.gainEnv = 1.0f;
        g_limiterNode.attackCoef = expf(-1.0f / (0.0015f * (float)sr)); // 1.5ms attack

        // Because of lookahead, we can make the release much faster without causing distortion
        g_limiterNode.releaseCoef = expf(-1.0f / (0.120f * (float)sr)); // 120ms release
        g_limiterNode.delayIdx = 0;

        // Meter node — transparent pass-through, always last in the chain.
        // Initialized here; wired into routing via updateRouting().
        memset(&g_meterNode, 0, sizeof(g_meterNode));
        ma_node_config cMeter = ma_node_config_init();
        cMeter.vtable = &g_meter_vtable;
        cMeter.pInputChannels = g_inCh;
        cMeter.pOutputChannels = g_outCh;
        ma_node_init(pg, &cMeter, NULL, &g_meterNode.baseNode);
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

            // STEP 1: Always try Rust Symphonia first (fixes .m4a and .mp3 perfectly)
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
                // STEP 2: Fallback natively if Rust decoder fails (edge case)
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
            // Free any previously loaded IR and its history buffers
            if (g_convolutionNode.irData)
            {
                free(g_convolutionNode.irData);
                g_convolutionNode.irData = nullptr;
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
            g_convolutionNode.irLength = 0;
            g_convolutionNode.historyIdx = 0;

            // Empty path = unload IR. Also disable convolution so the node is
            // cleanly removed from the graph, not left as a silent passthrough.
            if (args.empty())
            {
                g_convolutionNode.wetMix = 0.0f;
                g_isConvolutionOn = false;
                updateRouting();
                return;
            }

            // Decode the IR file as mono f32 at 44100Hz.
            // Forced mono: a stereo IR needs a 4-path matrix multiply (LL, LR, RL, RR)
            // which is 4x the CPU. Mono IR applied to both channels still colours
            // the space correctly without the extra cost.
            ma_decoder_config dcfg = ma_decoder_config_init(ma_format_f32, 1, 44100);
            ma_decoder dec;
            if (ma_decoder_init_file(args.c_str(), &dcfg, &dec) != MA_SUCCESS)
                return;

            // Allocate and read, capped at MAX_IR_SAMPLES to protect CPU in time-domain
            g_convolutionNode.irData = (float *)calloc(MAX_IR_SAMPLES, sizeof(float));
            ma_uint64 framesRead = 0;
            ma_decoder_read_pcm_frames(&dec, g_convolutionNode.irData, MAX_IR_SAMPLES, &framesRead);
            ma_decoder_uninit(&dec);

            if (framesRead == 0)
            {
                free(g_convolutionNode.irData);
                g_convolutionNode.irData = nullptr;
                return;
            }

            g_convolutionNode.irLength = (int)framesRead;
            g_convolutionNode.historyL = (float *)calloc(framesRead, sizeof(float));
            g_convolutionNode.historyR = (float *)calloc(framesRead, sizeof(float));
            g_convolutionNode.historyIdx = 0;
            // IR is now ready. Send CONVOLUTION <wet> to activate it in the graph.
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
            float vol = stof(args);
            ma_engine_set_volume(&g_engine, vol);

            // DYNAMIC FLETCHER-MUNSON LOUDNESS CONTOUR
            // The human ear physically loses bass sensitivity at low volumes.
            // As volume drops from 1.0 (100%) down to 0.0, we calculate a compensation boost.
            // At 100% volume, compensation is 0.
            // At 10% volume, compensation gives a warm, rich sub-bass lift.
            float loudnessComp = (1.0f - vol) * 0.40f;

            // We inject this directly into the perfectly phase-aligned FIR engine!
            // It sums with whatever the user's manual BASS slider is currently set to.
            g_audiophileEQNode.targetSub = (g_bassGain * 1.2f) + loudnessComp;
        }
        else if (command == "SEEK" && g_soundInitialized)
        {
            ma_uint32 sr = ma_engine_get_sample_rate(&g_engine);
            ma_sound_seek_to_pcm_frame(&g_sound, (ma_uint64)(stof(args) * (float)sr));
        }
        else if (command == "REMASTER")
        {
            g_isRemasterOn = (stoi(args) == 1);
            // FIR mode takes priority — turning on IIR remaster while FIR is active
            // has no effect on routing (FIR stays in graph) but the flag is stored
            // so that if the user later disables FIR, IIR remaster resumes.
            updateRouting();
        }
        else if (command == "FIRMODE")
        {
            // Enable/disable the audiophile linear-phase FIR EQ.
            // When enabled it replaces the IIR biquad remaster chain in the graph.
            // When disabled the IIR remaster chain resumes if g_isRemasterOn is set.
            g_isFIRModeOn = (stoi(args) == 1);
            updateRouting();
        }
        else if (command == "FIRGAIN")
        {
            auto clamp = [](float v, float lo, float hi)
            { return v < lo ? lo : v > hi ? hi
                                          : v; };
            float b = 1.50f, m = 0.79f, h = 1.33f;
            sscanf(args.c_str(), "%f %f %f", &b, &m, &h);

            // Lock-free atomic stores (Thread Safe)
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
            // Multiply by a healthy gain factor since we are only distorting the highs now
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
            // Maps the 0.0 - 1.0 UI slider to a healthy spatial mix
            g_spatializerNode.spatialIntensity = 0.12f + (stof(args) * 0.40f);
        }
        else if (command == "REVERB")
        {
            // Freeverb algorithmic reverb — low CPU, no IR file required.
            // Enabling this automatically disables convolution reverb (mutual exclusion).
            float w = stof(args);
            g_reverbNode.wetMix = w;
            g_isReverbOn = (w > 0.005f);
            if (g_isReverbOn)
            {
                g_isConvolutionOn = false;
                g_convolutionNode.wetMix = 0.0f;
            }
            updateRouting();
        }
        else if (command == "CONVOLUTION")
        {
            // IR-based convolution reverb — realistic spaces, requires LOAD_IR first.
            // Enabling this automatically disables algorithmic reverb (mutual exclusion).
            float w = stof(args);
            g_convolutionNode.wetMix = w;
            g_isConvolutionOn = (w > 0.005f);
            if (g_isConvolutionOn)
            {
                g_isReverbOn = false;
                g_reverbNode.wetMix = 0.0f;
            }
            updateRouting();
        }
        else if (command == "BASS")
        {
            g_bassGain = stof(args);
            g_audiophileEQNode.targetSub.store(g_bassGain * 1.2f, std::memory_order_relaxed);
        }
        else if (command == "LIMITER")
        {
            float val = stof(args);
            if (val < 0.01f)
            {
                // NONE preset — bypass entirely
                g_isLimiterOn = false;
            }
            else
            {
                g_isLimiterOn = true;
                // Preset boost levels (fixed, clean, no noise floor riding):
                // Low  (val=0.30) -> boost=1.48x — warm, gentle presence on speakers
                // Med  (val=0.60) -> boost=1.96x — noticeable uplift, still natural
                // High (val=1.00) -> boost=2.60x — maximum safe push for phone speakers
                g_limiterNode.boost = 1.0f + (val * 1.6f);
                g_limiterNode.gainEnv = 1.0f; // reset envelope so new level snaps in cleanly
            }
            updateRouting();
        }
    }

    // Output layout — 10 floats in order:
    //   [0] curTime   [1] len
    //   [2] bLvl      [3] bPan
    //   [4] mLvl      [5] mPan      [6] mPhase
    //   [7] tLvl      [8] tPan      [9] tPhase
    // The "finished" flag is computed in Rust from [0] and [1], never injected here.
    // g_audioLevel (whole mix) is returned separately to Rust for the lava lamps.
    void get_audio_metrics(float *out_data, float *out_level)
    {
        if (!g_soundInitialized || !g_engineInitialized)
        {
            memset(out_data, 0, 10 * sizeof(float));
            out_data[6] = 1.0f; // mPhase default: in-phase
            out_data[9] = 1.0f; // tPhase default: in-phase
            *out_level = 0.0f;
            return;
        }

        if (g_usingSymphonia && g_symSource.buffer)
        {
            out_data[0] = (float)g_symSource.cursor_frames / (float)g_symSource.buffer->sample_rate;
            out_data[1] = (float)(g_symSource.buffer->total_samples / g_symSource.buffer->channels) / (float)g_symSource.buffer->sample_rate;
        }
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

    // FIX: Instant zero-latency fingerprinting using the RAM buffer directly
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

        // Fallback for non-Symphonia tracks
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