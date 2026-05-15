#include "DSP_Nodes.h"
#include <cmath>
#include <cstring>
#include <mutex>

extern std::atomic<float> g_audioLevel;
extern float g_bassGain;
extern std::mutex g_irMutex;
extern bool g_isConvolutionOn;
extern bool g_isFIRModeOn;
extern bool g_isRemasterOn;
extern bool g_isUpscaleOn;
extern bool g_isWidenOn;
extern bool g_isCompressOn;
extern bool g_isReverbOn;

// ================================================================
// STUDIO AURAL EXCITER
// ================================================================
static void exciter_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    if (!g_isUpscaleOn)
    {
        memcpy(ppFramesOut[0], ppFramesIn[0], (*pFrameCountIn) * 2 * sizeof(float));
        *pFrameCountOut = *pFrameCountIn;
        return;
    }
    StudioExciterNode *p = (StudioExciterNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    const float SMOOTH_COEF = 0.002f;
    const float HP_COEF = 0.40f;

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        p->currentDrive += SMOOTH_COEF * (p->targetDrive - p->currentDrive);
        float L = pIn[i * 2], R = pIn[i * 2 + 1];

        p->hpStateL += HP_COEF * (L - p->hpStateL);
        p->hpStateR += HP_COEF * (R - p->hpStateR);
        float highL = L - p->hpStateL, highR = R - p->hpStateR;

        float satL = highL * p->currentDrive;
        float satR = highR * p->currentDrive;
        satL = satL / (1.0f + fabsf(satL));
        satR = satR / (1.0f + fabsf(satR));

        pOut[i * 2] = L + (satL * 0.05f);
        pOut[i * 2 + 1] = R + (satR * 0.05f);
    }
}
ma_node_vtable g_exciter_vtable = {exciter_process, NULL, 1, 1, 0};

// ================================================================
// STEREO WIDENER
// ================================================================
static void widener_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    if (!g_isWidenOn)
    {
        memcpy(ppFramesOut[0], ppFramesIn[0], (*pFrameCountIn) * 2 * sizeof(float));
        *pFrameCountOut = *pFrameCountIn;
        return;
    }
    StereoWidenerNode *p = (StereoWidenerNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float L = pIn[i * 2], R = pIn[i * 2 + 1];
        float M = (L + R) * 0.5f, S = (L - R) * 0.5f;
        pOut[i * 2] = M + (S * p->width);
        pOut[i * 2 + 1] = M - (S * p->width);
    }
}
ma_node_vtable g_widener_vtable = {widener_process, NULL, 1, 1, 0};

// ================================================================
// TRUE MID/SIDE SPATIALIZER (Vocals stay 100% pure)
// ================================================================
static void psychoacoustic_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    PsychoacousticNode *p = (PsychoacousticNode *)pNode;
    if (p->spatialIntensity < 0.001f)
    {
        memcpy(ppFramesOut[0], ppFramesIn[0], (*pFrameCountIn) * 2 * sizeof(float));
        *pFrameCountOut = *pFrameCountIn;
        return;
    }

    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    const float HEAD_SHADOW_COEF = 0.18f;
    const float PINNA_NOTCH_COEF = 0.45f;
    const float SIDE_HP_COEF = 0.05f;

    float intensity = p->spatialIntensity;

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float inL = pIn[i * 2];
        float inR = pIn[i * 2 + 1];

        float mid = (inL + inR) * 0.5f;
        float side = (inL - inR) * 0.5f;

        // 1. Bass-Protection (Side Channel)
        p->sideHp += SIDE_HP_COEF * (side - p->sideHp);
        float safeSide = side - p->sideHp;

        // 2. Haas Delay
        float delayedSide = p->haasBufL[p->haasIdx];
        p->haasBufL[p->haasIdx] = safeSide;
        p->haasIdx = (p->haasIdx + 1) % HAAS_DELAY_SAMPLES;

        // 3. Head Shadow Filter
        p->shadowStateL += HEAD_SHADOW_COEF * (inL - p->shadowStateL);
        p->shadowStateR += HEAD_SHADOW_COEF * (inR - p->shadowStateR);

        // 4. Bass-Protected ITD Crossfeed
        // High-pass the shadowed signal before crossing it over so we NEVER phase-cancel the low end.
        p->crossHpL += SIDE_HP_COEF * (p->shadowStateL - p->crossHpL);
        p->crossHpR += SIDE_HP_COEF * (p->shadowStateR - p->crossHpR);

        float crossfeedInL = p->shadowStateL - p->crossHpL;
        float crossfeedInR = p->shadowStateR - p->crossHpR;

        float crossL = p->itdBufL[p->itdIdx];
        float crossR = p->itdBufR[p->itdIdx];
        p->itdBufL[p->itdIdx] = crossfeedInR; // Right feeds to Left
        p->itdBufR[p->itdIdx] = crossfeedInL; // Left feeds to Right
        p->itdIdx = (p->itdIdx + 1) % ITD_DELAY_SAMPLES;

        // 5. 3D Reconstruction (With Absolute Zero-Intensity Transparency)
        // If intensity is 0, finalSide equals side, and crossfeed drops to 0.
        float finalSide = side + (delayedSide - side) * intensity;

        float outL = mid + finalSide * (1.0f + intensity) - (crossL * 0.35f * intensity);
        float outR = mid - finalSide * (1.0f + intensity) - (crossR * 0.35f * intensity);

        // 6. Pinna Notch (Proper Independent 2-Pole Filters)
        p->notchStateL1 += PINNA_NOTCH_COEF * (outL - p->notchStateL1);
        p->notchStateL2 += PINNA_NOTCH_COEF * (p->notchStateL1 - p->notchStateL2);
        outL -= (outL - p->notchStateL2) * 0.15f * intensity;

        p->notchStateR1 += PINNA_NOTCH_COEF * (outR - p->notchStateR1);
        p->notchStateR2 += PINNA_NOTCH_COEF * (p->notchStateR1 - p->notchStateR2);
        outR -= (outR - p->notchStateR2) * 0.15f * intensity;

        pOut[i * 2] = outL;
        pOut[i * 2 + 1] = outR;
    }
}
ma_node_vtable g_psychoacoustic_vtable = {psychoacoustic_process, NULL, 1, 1, 0};

// ================================================================
// AUDIOPHILE EQ (Zero Distortion)
// ================================================================
// ================================================================
// AUDIOPHILE EQ (Zero Phase-Distortion Parallel Architecture)
// ================================================================
// ================================================================
// AUDIOPHILE EQ (True Parallel Full-Spectrum Architecture)
// ================================================================
static void audiophile_eq_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    AudiophileEQNode *p = (AudiophileEQNode *)pNode;
    if (!g_isFIRModeOn && !g_isRemasterOn)
    {
        memcpy(ppFramesOut[0], ppFramesIn[0], (*pFrameCountIn) * 2 * sizeof(float));
        *pFrameCountOut = *pFrameCountIn;
        return;
    }

    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    const float SMOOTH_COEF = 0.002f;
    // CRITICAL FIX: Dropped crossover from 0.032f (245Hz) down to 0.012f (~90Hz)
    // This stops the bass boost from touching the guitars and lower vocals.
    const float F_BASS = 0.012f;
    const float F_TREBLE = 0.65f;

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        p->currentBass += SMOOTH_COEF * (p->targetBass.load(std::memory_order_relaxed) - p->currentBass);
        p->currentMid += SMOOTH_COEF * (p->targetMid.load(std::memory_order_relaxed) - p->currentMid);
        p->currentHigh += SMOOTH_COEF * (p->targetHigh.load(std::memory_order_relaxed) - p->currentHigh);

        float L = pIn[i * 2], R = pIn[i * 2 + 1];

        // 1. Isolate the Bass perfectly
        p->bL += F_BASS * (L - p->bL);
        p->bR += F_BASS * (R - p->bR);
        float bassL = p->bL;
        float bassR = p->bR;

        // 2. Isolate the Mids and Treble
        float restL = L - bassL;
        float restR = R - bassR;

        p->dcBlockL += F_TREBLE * (restL - p->dcBlockL);
        p->dcBlockR += F_TREBLE * (restR - p->dcBlockR);
        float midL = p->dcBlockL;
        float midR = p->dcBlockR;

        float trebleL = restL - midL;
        float trebleR = restR - midR;

        // 3. The True Parallel Mix
        // 1.0f is our center point. If currentBass is 1.50, gBass = +0.50 (a 50% layered boost).
        // If currentMid is 0.80, gMid = -0.20 (a 20% phase-aligned cut).
        float gBass = p->currentBass - 1.0f;
        float gMid = p->currentMid - 1.0f;
        float gTreble = p->currentHigh - 1.0f;

        // CRITICAL FIX: The dry signal (L and R) passes through 100% untouched.
        // We now safely layer the isolated Bass, Mids, and Treble back on top.
        pOut[i * 2] = L + (bassL * gBass) + (midL * gMid) + (trebleL * gTreble);
        pOut[i * 2 + 1] = R + (bassR * gBass) + (midR * gMid) + (trebleR * gTreble);
    }
}
ma_node_vtable g_audiophile_eq_vtable = {audiophile_eq_process, NULL, 1, 1, 0};
// ================================================================
// ALGORITHMIC REVERB
// ================================================================
#define COMB1 1557
#define COMB2 1617
#define COMB3 1491
#define COMB4 1422
#define AP1 225
#define AP2 556

void comb_init(CombFilter *c, int sz, float fb, float dp)
{
    memset(c->buf, 0, sizeof(c->buf));
    c->size = sz;
    c->idx = 0;
    c->feedback = fb;
    c->damp = dp;
    c->store = 0;
}
void ap_init(AllPassFilter *a, int sz, float fb)
{
    memset(a->buf, 0, sizeof(a->buf));
    a->size = sz;
    a->idx = 0;
    a->feedback = fb;
}
void reverb_init_filters(ReverbNode *r)
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
static float comb_tick(CombFilter *c, float in)
{
    float o = c->buf[c->idx];
    c->store = o * (1.0f - c->damp) + c->store * c->damp;
    c->buf[c->idx] = in + c->store * c->feedback;
    c->idx = (c->idx + 1) % c->size;
    return o;
}
static float ap_tick(AllPassFilter *a, float in)
{
    float b = a->buf[a->idx];
    a->buf[a->idx] = in + b * a->feedback;
    a->idx = (a->idx + 1) % a->size;
    return b - in;
}
static void reverb_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    ReverbNode *r = (ReverbNode *)pNode;
    if (!g_isReverbOn)
    {
        memcpy(ppFramesOut[0], ppFramesIn[0], (*pFrameCountIn) * 2 * sizeof(float));
        *pFrameCountOut = *pFrameCountIn;
        return;
    }
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;
    float dry = 1.0f - r->wetMix;
    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float iL = pIn[i * 2], iR = pIn[i * 2 + 1];

        // 1. Calculate the High-Passed Signal
        float hpL = r->hpfL.process(iL);
        float hpR = r->hpfR.process(iR);

        // 2. The 20% Bass Bleed Algorithm (80% HPF + 20% RAW)
        float bleedL = (hpL * 0.80f) + (iL * 0.20f);
        float bleedR = (hpR * 0.80f) + (iR * 0.20f);

        // 3. Feed the calculated bleed into the reverb combs
        float feed = ((bleedL + bleedR) * 0.5f) * 0.2f + ((bleedL - bleedR) * 0.5f) * 0.8f;

        float oL = 0, oR = 0;
        for (int j = 0; j < 4; ++j)
        {
            oL += comb_tick(&r->combL[j], feed);
            oR += comb_tick(&r->combR[j], feed);
        }
        oL *= 0.25f;
        oR *= 0.25f;
        oL = ap_tick(&r->apL[1], ap_tick(&r->apL[0], oL));
        oR = ap_tick(&r->apR[1], ap_tick(&r->apR[0], oR));

        // 4. Output: The dry signal (iL/iR) is STILL 100% UNTOUCHED
        pOut[i * 2] = iL * dry + oL * r->wetMix;
        pOut[i * 2 + 1] = iR * dry + oR * r->wetMix;
    }
}
ma_node_vtable g_reverb_vtable = {reverb_process, NULL, 1, 1, 0};

// ================================================================
// SUBWOOFER NODE (Dynamic Thump Expander)
// ================================================================
// ================================================================
// SUBWOOFER NODE (Dynamic Thump Expander)
// ================================================================
static void subwoofer_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    SubwooferNode *p = (SubwooferNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    if (g_bassGain < 0.001f)
    {
        for (ma_uint32 i = 0; i < fc; ++i)
        {
            pOut[i * 2] = pIn[i * 2];
            pOut[i * 2 + 1] = pIn[i * 2 + 1];
        }
        return;
    }

    // CRITICAL FIX: Dropped to ~75Hz.
    // This strictly isolates the kick drum punch and sub-rumble, completely protecting the mids/vocals from mud.
    const float LP_COEF = 0.010f;
    float drive = g_bassGain * 1.5f;

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float L = pIn[i * 2], R = pIn[i * 2 + 1];

        p->lp1L += LP_COEF * (L - p->lp1L);
        p->lp2L += LP_COEF * (p->lp1L - p->lp2L);
        p->lp1R += LP_COEF * (R - p->lp1R);
        p->lp2R += LP_COEF * (p->lp1R - p->lp2R);

        // CRITICAL FIX: Ripped out the tanhf() castration.
        // Massive, clean linear gain (up to 6x boost). The transient punch is preserved,
        // and your Master Limiter at the end of the chain will catch and glue any clipping.
        float subL = p->lp2L * drive * 4.0f;
        float subR = p->lp2R * drive * 4.0f;

        pOut[i * 2] = L + subL;
        pOut[i * 2 + 1] = R + subR;
    }
}

ma_node_vtable g_subwoofer_vtable = {subwoofer_process, NULL, 1, 1, 0};

// ================================================================
// CONVOLUTION NODE
// ================================================================
static void convolution_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    ConvolutionNode *p = (ConvolutionNode *)pNode;
    if (!g_isConvolutionOn)
    {
        memcpy(ppFramesOut[0], ppFramesIn[0], (*pFrameCountIn) * 2 * sizeof(float));
        *pFrameCountOut = *pFrameCountIn;
        return;
    }
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    std::unique_lock<std::mutex> lock(g_irMutex, std::try_to_lock);
    if (!lock.owns_lock() || !p->irDataL || p->irLength == 0)
    {
        for (ma_uint32 i = 0; i < fc * 2; i++)
            pOut[i] = pIn[i];
        return;
    }

    const float dry = (p->wetMix > 0.99f) ? 0.0f : 1.0f;
    const float wet = p->wetMix;
    const float HP_COEF = 0.011f;
    const float LP_COEF = 0.92f;

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float inL = pIn[i * 2], inR = pIn[i * 2 + 1];
        
        // 1. Calculate the High-Passed Signal
        float hpL = p->hpfL.process(inL);
        float hpR = p->hpfR.process(inR);

        // 2. The 20% Bass Bleed Algorithm
        float feedL = (hpL * 0.80f) + (inL * 0.20f);
        float feedR = (hpR * 0.80f) + (inR * 0.20f);

        if (p->wetMix < 0.99f)
        {
            float tempL = feedL;
            feedL += feedR * 0.30f;
            feedR += tempL * 0.30f;
        }

        p->historyL[p->historyIdx] = feedL;
        p->historyR[p->historyIdx] = feedR;

        float sumL = 0.0f, sumR = 0.0f;
        int readIdx = p->historyIdx;
        for (int j = 0; j < p->irLength; ++j)
        {
            sumL += p->historyL[readIdx] * p->irDataL[j];
            sumR += p->historyR[readIdx] * (p->irDataR ? p->irDataR[j] : p->irDataL[j]);
            if (--readIdx < 0)
                readIdx = p->irLength - 1;
        }

        p->hpStateL += HP_COEF * (sumL - p->hpStateL);
        p->hpStateR += HP_COEF * (sumR - p->hpStateR);
        float wetL = sumL - p->hpStateL, wetR = sumR - p->hpStateR;

        p->lpStateL += LP_COEF * (wetL - p->lpStateL);
        p->lpStateR += LP_COEF * (wetR - p->lpStateR);
        wetL = p->lpStateL;
        wetR = p->lpStateR;

        // 3. Output: The dry signal (inL/inR) is STILL 100% UNTOUCHED
        pOut[i * 2] = inL * dry + wetL * wet;
        pOut[i * 2 + 1] = inR * dry + wetR * wet;
        p->historyIdx = (p->historyIdx + 1) % p->irLength;
    }
}
ma_node_vtable g_convolution_vtable = {convolution_process, NULL, 1, 1, 0};

// ================================================================
// TRANSPARENT RMS GLUE COMPRESSOR
// ================================================================
static void multiband_compressor_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    MultibandCompressorNode *c = (MultibandCompressorNode *)pNode;
    if (!g_isCompressOn)
    {
        memcpy(ppFramesOut[0], ppFramesIn[0], (*pFrameCountIn) * 2 * sizeof(float));
        *pFrameCountOut = *pFrameCountIn;
        return;
    }
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    float thresh = c->threshold.load(std::memory_order_relaxed);
    float makeup = c->makeupGain.load(std::memory_order_relaxed);

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float L = pIn[i * 2], R = pIn[i * 2 + 1];

        // 1. ISOLATE BASS FOR DETECTION (So treble spikes don't trigger the compressor)
        c->lpStateL += 0.015f * (L - c->lpStateL);
        c->lpStateR += 0.015f * (R - c->lpStateR);
        float maxLowPeak = fmaxf(fabsf(c->lpStateL), fabsf(c->lpStateR));

        if (maxLowPeak > c->envLow)
        {
            c->envLow = c->envLow * c->attackCoef + maxLowPeak * (1.0f - c->attackCoef);
        }
        else
        {
            c->envLow = c->envLow * c->releaseCoef + maxLowPeak * (1.0f - c->releaseCoef);
        }

        // Calculate gain reduction ONLY for the low band
        float lowGain = 1.0f;
        if (c->envLow > thresh && thresh > 0.001f)
        {
            float over = c->envLow - thresh;
            lowGain = thresh / (thresh + over * 0.6f); // Clamp the bass tight
        }

        // 2. DELAY LINE
        float dL = c->dlyL[c->dlyIdx];
        float dR = c->dlyR[c->dlyIdx];
        c->dlyL[c->dlyIdx] = L;
        c->dlyR[c->dlyIdx] = R;
        c->dlyIdx = (c->dlyIdx + 1) % COMP_LOOKAHEAD_SAMPLES;

        // 3. SPLIT DELAYED SIGNAL INTO LOW AND HIGH
        c->delayLpStateL += 0.015f * (dL - c->delayLpStateL);
        c->delayLpStateR += 0.015f * (dR - c->delayLpStateR);

        float bassL = c->delayLpStateL;
        float bassR = c->delayLpStateR;
        float highL = dL - bassL;
        float highR = dR - bassR;

        // 4. THE FIX: Apply gain ONLY to bass. Highs/Vocals bypass compression entirely.
        pOut[i * 2] = ((bassL * lowGain) + highL) * makeup;
        pOut[i * 2 + 1] = ((bassR * lowGain) + highR) * makeup;
    }
}
ma_node_vtable g_multiband_compressor_vtable = {multiband_compressor_process, NULL, 1, 1, 0};

// ================================================================
// MASTERING SOFT-CLIPPER WITH LOOKAHEAD
// ================================================================
static void limiter_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    LimiterNode *p = (LimiterNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    // Hard ceiling
    float thresh = (p->boost > 1.01f) ? 0.92f : 0.98f;

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float L = pIn[i * 2] * p->boost;
        float R = pIn[i * 2 + 1] * p->boost;

        // Instantaneous Soft Clipper (Zero release time = zero pumping)
        auto clip = [thresh](float x)
        {
            float ax = fabsf(x);
            if (ax < thresh)
                return x;
            float over = ax - thresh;
            float lim = thresh + 0.08f * tanhf(over / 0.08f);
            return (x > 0) ? lim : -lim;
        };

        pOut[i * 2] = clip(L);
        pOut[i * 2 + 1] = clip(R);
    }
}
ma_node_vtable g_limiter_vtable = {limiter_process, NULL, 1, 1, 0};