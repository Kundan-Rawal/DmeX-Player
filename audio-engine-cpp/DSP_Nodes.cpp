#include "DSP_Nodes.h"
#include <cmath>
#include <cstring>
#include <mutex>

extern std::atomic<float> g_audioLevel;
extern float g_bassGain;
extern float g_trebleGain;
extern float g_trebleGain;
extern std::mutex g_irMutex;
extern bool g_isConvolutionOn;
extern bool g_isFIRModeOn;
extern bool g_isRemasterOn;
extern bool g_isUpscaleOn;
extern bool g_isWidenOn;
extern bool g_isCompressOn;
extern bool g_isReverbOn;
extern bool g_isAndroidSpeaker;
extern bool g_isLaptopSpeaker;
extern bool g_is8DModeOn;

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

        // 1. Binaural Crossfeed (HRTF-lite) to anchor the stereo image
        // We delay the opposite channel and low-pass it to simulate head-shadowing
        float crossfeedL = p->delayR[p->delayIdx];
        float crossfeedR = p->delayL[p->delayIdx];

        p->delayL[p->delayIdx] = L;
        p->delayR[p->delayIdx] = R;
        p->delayIdx = (p->delayIdx + 1) % CROSSFEED_DELAY_SAMPLES;

        // Head-shadow low-pass (approx 700Hz)
        const float HEAD_SHADOW_COEF = 0.1f;
        p->lpStateL += HEAD_SHADOW_COEF * (crossfeedL - p->lpStateL);
        p->lpStateR += HEAD_SHADOW_COEF * (crossfeedR - p->lpStateR);

        // Blend the shadowed opposite channel slightly (e.g. 15% mix)
        float mixL = L + (p->lpStateR * 0.15f);
        float mixR = R + (p->lpStateL * 0.15f);

        // 2. Blumlein Shuffler (Bass-Safe Widening)
        float M = (mixL + mixR) * 0.5f;
        float S = (mixL - mixR) * 0.5f;
        
        // Isolate the bass from the Side channel so we don't widen the sub-bass
        // (This keeps the bass exactly at its original stereo width, preventing diffusion)
        const float SIDE_HP_COEF = 0.05f; // ~300Hz
        p->sideLp += SIDE_HP_COEF * (S - p->sideLp);
        float sideHighs = S - p->sideLp; // The treble/mids of the Side channel
        float sideLows = p->sideLp;      // The bass of the Side channel

        float effectiveWidth = p->width;
        if (g_isLaptopSpeaker) {
            effectiveWidth = 1.0f + ((p->width - 1.0f) * 0.4f);
        }

        float midGain = 1.0f + ((effectiveWidth - 1.0f) * 0.1f);
        
        // We multiply ONLY the upper frequencies of the Side channel by the width,
        // and we pass the sideLows through exactly at 1.0x width.
        // This guarantees pristine original stereo bass while massively widening the highs.
        float finalS = sideLows + (sideHighs * effectiveWidth);

        pOut[i * 2] = (M * midGain) + finalS;
        pOut[i * 2 + 1] = (M * midGain) - finalS;
    }
}
ma_node_vtable g_widener_vtable = {widener_process, NULL, 1, 1, 0};

// ================================================================
// TRUE MID/SIDE SPATIALIZER (Vocals stay 100% pure)
// ================================================================
static void psychoacoustic_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    PsychoacousticNode *p = (PsychoacousticNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    float intensity = p->spatialIntensity;

    if (intensity < 0.001f)
    {
        memcpy(ppFramesOut[0], ppFramesIn[0], fc * 2 * sizeof(float));
        return;
    }

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float L = pIn[i * 2];
        float R = pIn[i * 2 + 1];

        // 0. Extract Bass (Subwoofer Bypass at 180Hz)
        // We completely bypass the 180Hz bass from the 3D delays to keep it perfectly punchy and clear.
        float bassL, nonBassL, bassR, nonBassR;
        p->crossSubwooferL.process(L, bassL, nonBassL);
        p->crossSubwooferR.process(R, bassR, nonBassR);

        float inL = nonBassL;
        float inR = nonBassR;

        // 1. The 5.1 Extraction Matrix
        float center = (inL + inR) * 0.5f;
        float sideL  = (inL - inR) * 0.5f;
        float sideR  = (inR - inL) * 0.5f; 
        
        // 2. Virtual Center (Front Speaker) 
        // 0.5ms ITD crossfeed to pull the center channel out of the head.
        float delayedCenter = p->centerDelayBuf[p->centerIdx];
        p->centerDelayBuf[p->centerIdx] = center;
        p->centerIdx = (p->centerIdx + 1) % CENTER_ITD_DELAY;
        float virtualCenterL = center + (delayedCenter * 0.25f * intensity);
        float virtualCenterR = center + (delayedCenter * 0.25f * intensity);

        // 3. Virtual Rear (Surround L/R)
        // 20ms Haas Delay, Low-Passed (Head Shadow), and phase inverted.
#ifndef __ANDROID__
        float rearL = p->rearDelayBufL[p->rearIdx];
        float rearR = p->rearDelayBufR[p->rearIdx];
        p->rearDelayBufL[p->rearIdx] = sideL;
        p->rearDelayBufR[p->rearIdx] = sideR;
        p->rearIdx = (p->rearIdx + 1) % SURROUND_HAAS_DELAY;
#else
        // Android Lite 5.1: Bypass the heavy 20ms Haas delay which causes phase cancellation mud on cheap DACs.
        // We feed the sides directly into the Head Shadow filter to create directionality without driver stress.
        float rearL = sideL;
        float rearR = sideR;
#endif

        // Head shadow low-pass on the rear speakers
        const float REAR_LP_COEF = 0.15f;
        p->rearLpL += REAR_LP_COEF * (rearL - p->rearLpL);
        p->rearLpR += REAR_LP_COEF * (rearR - p->rearLpR);
        
        // Invert phase to trick the brain into rear localization
#ifndef __ANDROID__
        // TUNING FIX: Reduced from 0.7f to 0.35f to prevent the rear from overpowering the front
        float virtualRearL = -p->rearLpL * 0.35f * intensity;
        float virtualRearR = -p->rearLpR * 0.35f * intensity;
#else
        // Android Lite 5.1: Keep phase normal to prevent destructive interference, but rely on the low-pass
        // and 8kHz pinna notch to trick the brain into hearing 5.1 width without phase-mud.
        float virtualRearL = p->rearLpL * 0.35f * intensity;
        float virtualRearR = p->rearLpR * 0.35f * intensity;
#endif

        // 4. Downmix to Binaural Stereo
        // Center + Boosted Front Sides + Virtual Rear Sides
        // TUNING FIX: Boost the front sides slightly to balance the rear depth
        float frontSideL = sideL * (1.0f + 0.25f * intensity);
        float frontSideR = sideR * (1.0f + 0.25f * intensity);
        
        float outL = virtualCenterL + frontSideL + virtualRearL;
        float outR = virtualCenterR + frontSideR + virtualRearR;

        // 5. Top Elevation Notch (8kHz pinna cue)
        // TUNING FIX: Moved from 12kHz (0.65f) down to 8kHz (0.45f). 
        // Cutting 12kHz makes things sound "muffled" or "down". Cutting 8kHz triggers the "Up/Top" brain cue.
        const float TOP_NOTCH_COEF = 0.45f; 
        p->notchTopL1 += TOP_NOTCH_COEF * (outL - p->notchTopL1);
        p->notchTopL2 += TOP_NOTCH_COEF * (p->notchTopL1 - p->notchTopL2);
        outL -= (outL - p->notchTopL2) * 0.08f * intensity; // Reduced depth from 0.15 to 0.08

        p->notchTopR1 += TOP_NOTCH_COEF * (outR - p->notchTopR1);
        p->notchTopR2 += TOP_NOTCH_COEF * (p->notchTopR1 - p->notchTopR2);
        outR -= (outR - p->notchTopR2) * 0.08f * intensity;

        // 6. Sum Bypassed Subwoofer
        pOut[i * 2] = outL + bassL;
        pOut[i * 2 + 1] = outR + bassR;
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
    if (!g_isFIRModeOn && !g_isRemasterOn && g_trebleGain < 0.001f)
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
    for (ma_uint32 i = 0; i < fc; ++i)
    {
        p->currentBass += SMOOTH_COEF * (p->targetBass.load(std::memory_order_relaxed) - p->currentBass);
        p->currentMid += SMOOTH_COEF * (p->targetMid.load(std::memory_order_relaxed) - p->currentMid);
        p->currentHigh += SMOOTH_COEF * (p->targetHigh.load(std::memory_order_relaxed) - p->currentHigh);

        float L = pIn[i * 2], R = pIn[i * 2 + 1];

        // 1. Isolate the full Bass band up to 180Hz (Sub-bass + Kick Punch + Bass Guitar)
        float bassBandL, nonBassL, bassBandR, nonBassR;
        p->crossMidBassL.process(L, bassBandL, nonBassL);
        p->crossMidBassR.process(R, bassBandR, nonBassR);

        // 2. Isolate the Mids from the Treble (8000Hz LR4 Crossover)
        float midL, trebleL, midR, trebleR;
        p->crossTrebleL.process(nonBassL, midL, trebleL);
        p->crossTrebleR.process(nonBassR, midR, trebleR);

        // 3. VOCAL PROCESSING (180Hz - 8kHz)
#ifndef __ANDROID__
        // A. Psychoacoustic Vocal Exciter (Harmonic Bite)
        // Disabled on Android: Mobile DACs struggle with synthetic harmonics, causing intermodulation noise/distortion.
        float satMidL = midL / (1.0f + fabsf(midL));
        float satMidR = midR / (1.0f + fabsf(midR));
        midL = midL + (satMidL * 0.05f);
        midR = midR + (satMidR * 0.05f);
#endif

        // B. Mid/Side Stereo Widening (3% Side Boost)
        float midM = (midL + midR) * 0.5f;
        float midS = (midL - midR) * 0.5f;
        midS *= 1.03f; // Boost the stereo width (panned vocals) by 3% while leaving the center completely untouched
        midL = midM + midS;
        midR = midM - midS;

        // C. Upward Vocal Compression (The Intimacy Algorithm)
        // Kept ON for Android: This cleanly boosts quiet vocals so they aren't overshadowed by the bass!
        float midMonoEnv = fabsf(midM);
        p->envUpwardL += 0.001f * (midMonoEnv - p->envUpwardL);
        // If the vocal is quiet (env is near 0), upwardGain approaches 1.15x. If loud (>0.5), it approaches 1.0x.
        float upwardGain = 1.0f + 0.15f * (1.0f - fminf(p->envUpwardL * 2.0f, 1.0f));
        midL *= upwardGain;
        midR *= upwardGain;

        // D. Fletcher-Munson Presence EQ (2.5kHz)
#ifndef __ANDROID__
        // Disabled on Android: Bypassing the 2.5kHz boost prevents the treble from sounding "cheap" or "tinny".
        midL = p->presenceL.process(midL);
        midR = p->presenceR.process(midR);
#endif

        // 4. Absolute Gains
        float gBass = p->currentBass;
        float gMid = p->currentMid;
        float gTreble = p->currentHigh + g_trebleGain;

        // 5. Parallel Summation
        // Because LR4 crossovers sum perfectly flat, re-combining these bands 
        // with their respective gains yields a completely zero-phase, distortion-free output.
#ifdef __ANDROID__
        // Android DACs hard-clip at 0 dBFS. Lower the master volume by ~3dB (-30%) to give
        // the saturated bass and the excited trebles room to breathe without distorting.
        // If playing on the internal phone speaker, keep it at 1.0f so it stays loud.
        float MASTER_GAIN = g_isAndroidSpeaker ? 1.0f : 0.707f;
#else
        const float MASTER_GAIN = 1.0f;
#endif

        pOut[i * 2] = ((bassBandL * gBass) + (midL * gMid) + (trebleL * gTreble)) * MASTER_GAIN;
        pOut[i * 2 + 1] = ((bassBandR * gBass) + (midR * gMid) + (trebleR * gTreble)) * MASTER_GAIN;
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
// ================================================================
// SUBWOOFER NODE (Dynamic Thump Expander & Speaker Protection)
// ================================================================
static void subwoofer_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    SubwooferNode *p = (SubwooferNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float L = pIn[i * 2], R = pIn[i * 2 + 1];

#ifdef __ANDROID__
        if (g_isAndroidSpeaker)
        {
            // 1. ALWAYS protect the Android speaker, even if bass boost is 0
            const float HP_COEF = 0.018f; // ~120Hz
            p->hp1L += HP_COEF * (L - p->hp1L);
            p->hp1R += HP_COEF * (R - p->hp1R);
            float safeL = L - p->hp1L;
            float safeR = R - p->hp1R;

            float harmL = 0.0f, harmR = 0.0f;

            // 2. Only generate psychoacoustic harmonics if the user requested bass
            if (g_bassGain >= 0.001f)
            {
                const float LP_COEF = 0.012f; // ~80Hz
                p->lp1L += LP_COEF * (L - p->lp1L);
                p->lp1R += LP_COEF * (R - p->lp1R);

                float drive = g_bassGain * 4.0f;
                auto waveshape = [](float x)
                {
                    float ax = fabsf(x);
                    if (ax > 1.0f)
                        ax = 1.0f;
                    return (x > 0 ? 1.0f : -1.0f) * (ax - (ax * ax * ax) / 3.0f);
                };
                harmL = waveshape(p->lp1L * drive);
                harmR = waveshape(p->lp1R * drive);
            }

            // Mix the hallucinated bass back into the safe mids
            pOut[i * 2] = safeL + harmL;
            pOut[i * 2 + 1] = safeR + harmR;
            continue; // Skip the earphone logic
        }
#endif

        // ==========================================
        // NORMAL EARPHONE / WINDOWS MODE
        // ==========================================
        if (g_isLaptopSpeaker)
        {
            // LAPTOP SPEAKER BASS PROTECTION
            // High-pass real sub-bass to prevent physical distortion, replace with psychoacoustic harmonics
            const float HP_COEF = 0.015f; // ~100Hz
            p->hp1L += HP_COEF * (L - p->hp1L);
            p->hp1R += HP_COEF * (R - p->hp1R);
            float safeL = L - p->hp1L;
            float safeR = R - p->hp1R;

            float harmL = 0.0f, harmR = 0.0f;
            if (g_bassGain >= 0.001f)
            {
                const float LP_COEF = 0.012f; // ~80Hz
                p->lp1L += LP_COEF * (L - p->lp1L);
                p->lp1R += LP_COEF * (R - p->lp1R);
                float drive = g_bassGain * 3.5f; // Slightly tamed for laptop
                auto waveshape = [](float x)
                {
                    float ax = fabsf(x);
                    if (ax > 1.0f) ax = 1.0f;
                    return (x > 0 ? 1.0f : -1.0f) * (ax - (ax * ax * ax) / 3.0f);
                };
                harmL = waveshape(p->lp1L * drive);
                harmR = waveshape(p->lp1R * drive);
            }
            pOut[i * 2] = safeL + harmL;
            pOut[i * 2 + 1] = safeR + harmR;
            continue;
        }

        if (g_bassGain < 0.001f)
        {
            // Safe to bypass only if we are in earphone mode and bass is 0
            pOut[i * 2] = L;
            pOut[i * 2 + 1] = R;
            continue;
        }

        // 1. Isolate everything below 180Hz (The entire bass range)
        float totalBassL, nonBassL, totalBassR, nonBassR;
        p->crossMidBassL.process(L, totalBassL, nonBassL);
        p->crossMidBassR.process(R, totalBassR, nonBassR);

        // 2. Split the Bass into Sub-Bass (0-80Hz) and Mid-Bass (80-180Hz)
        float subL, midBassL, subR, midBassR;
        p->crossBassL.process(totalBassL, subL, midBassL);
        p->crossBassR.process(totalBassR, subR, midBassR);

        float drive = g_bassGain * 1.2f;
        
        // Soft saturation wave-shaper for Sub-Bass only
        auto saturate = [](float x) {
            float ax = fabsf(x);
            if (ax > 1.0f) ax = 1.0f;
            return (x > 0 ? 1.0f : -1.0f) * (ax - (ax * ax * ax) / 3.0f);
        };

        // Deep Sub-Bass (0-80Hz) gets the heavy 3.0x saturated multiplier for massive thump
#ifdef __ANDROID__
        float subMult = 1.6f; // Prevent 0 dBFS hard clipping on low-headroom Android DACs
        float midMult = 0.8f; // Reduce 80-180Hz so it doesn't overshadow the weakened sub-bass
#else
        float subMult = 3.0f;
        float midMult = 1.5f;
#endif

        float processedSubL = saturate(subL * drive * subMult);
        float processedSubR = saturate(subR * drive * subMult);

        // Mid-Bass (80-180Hz) gets a clean, linear multiplier to restore kick body & bass guitar
        // without adding muddy harmonic distortion to the low-mids.
        float processedMidBassL = midBassL * drive * midMult;
        float processedMidBassR = midBassR * drive * midMult;

        // Sum the Sub, Mid-Bass, and the completely untouched non-bass signal (>180Hz)
        // This guarantees absolute zero phase smearing in the midrange while providing huge, wide bass.
        pOut[i * 2] = nonBassL + processedSubL + processedMidBassL;
        pOut[i * 2 + 1] = nonBassR + processedSubR + processedMidBassR;
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

        float sumL = 1e-18f, sumR = 1e-18f; // Anti-Denormal DC Offset
        int readIdx = p->historyIdx;

#ifdef __ANDROID__
        // 50% Decimation + Anti-Denormal for ARM Mobile Processors
        for (int j = 0; j < p->irLength; j += 2)
        {
            sumL += p->historyL[readIdx] * p->irDataL[j];
            sumR += p->historyR[readIdx] * (p->irDataR ? p->irDataR[j] : p->irDataL[j]);
            readIdx -= 2;
            if (readIdx < 0) readIdx += p->irLength;
        }
        sumL *= 2.0f; // Compensate for 50% decimation volume loss
        sumR *= 2.0f;
#else
        // Full resolution for Desktop
        for (int j = 0; j < p->irLength; ++j)
        {
            sumL += p->historyL[readIdx] * p->irDataL[j];
            sumR += p->historyR[readIdx] * (p->irDataR ? p->irDataR[j] : p->irDataL[j]);
            if (--readIdx < 0) readIdx = p->irLength - 1;
        }
#endif

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

    // Hard ceiling for the safety clipper
    float thresh = (p->boost > 1.01f) ? 0.92f : 0.98f;

#ifdef __ANDROID__
    if (g_isAndroidSpeaker)
    {
        // THE LOUDNESS WAR CLIPPER (Android Speakers Only)
        // Bypasses the clean envelope to aggressively maximize RMS volume.
        for (ma_uint32 i = 0; i < fc; ++i)
        {
            float L = pIn[i * 2] * p->boost;
            float R = pIn[i * 2 + 1] * p->boost;

            auto clip = [](float x)
            {
                float ax = fabsf(x);
                // Clean up to 70% volume.
                if (ax < 0.70f)
                    return x;
                // Hyperbolic tangent saturation for the top 30% to prevent hard clipping crackle.
                float over = ax - 0.70f;
                float lim = 0.70f + 0.30f * tanhf(over / 0.30f);
                return (x > 0) ? lim : -lim;
            };

            pOut[i * 2] = clip(L);
            pOut[i * 2 + 1] = clip(R);
        }
        return; // Exit early, skipping the clean Lookahead limiter below
    }
#endif

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        // 1. Read raw input and apply the user's boost
        float multiplier = g_isLaptopSpeaker ? 2.5f : 1.0f; // Aggressively boost laptop speakers into the lookahead limiter for major RMS gains
        float L = pIn[i * 2] * p->boost * multiplier;
        float R = pIn[i * 2 + 1] * p->boost * multiplier;

        // 2. Peak Detection (Find the loudest channel)
        float peak = fmaxf(fabsf(L), fabsf(R));

        // 3. Calculate Target Gain (How much do we need to duck to prevent clipping?)
        float targetGain = 1.0f;
        if (peak > thresh)
        {
            targetGain = thresh / peak;
        }

        // 4. Smooth the Envelope (Fast Attack, Slow Release)
        if (targetGain < p->gainEnv)
        {
            // Volume is too high -> Duck quickly (Attack)
            p->gainEnv = p->gainEnv * p->attackCoef + targetGain * (1.0f - p->attackCoef);
        }
        else
        {
            // Volume is safe -> Recover slowly (Release)
            p->gainEnv = p->gainEnv * p->releaseCoef + targetGain * (1.0f - p->releaseCoef);
        }

        // 5. Read the DELAYED Signal (The signal from ~2ms ago)
        float delayedL = p->dlyL[p->dlyIdx];
        float delayedR = p->dlyR[p->dlyIdx];

        // 6. Push the CURRENT signal into the delay buffer for the future
        p->dlyL[p->dlyIdx] = L;
        p->dlyR[p->dlyIdx] = R;
        p->dlyIdx = (p->dlyIdx + 1) % LIMITER_LOOKAHEAD_SAMPLES;

        // 7. Apply the smoothed gain envelope to the delayed signal
        float outL = delayedL * p->gainEnv;
        float outR = delayedR * p->gainEnv;

        // 8. Safety Soft-Clip (Catches any micro-transients that slipped past the attack phase)
        auto clip = [thresh](float x)
        {
            float ax = fabsf(x);
            if (ax < thresh)
                return x;
            float over = ax - thresh;
            float lim = thresh + 0.08f * tanhf(over / 0.08f);
            return (x > 0) ? lim : -lim;
        };

        pOut[i * 2] = clip(outL);
        pOut[i * 2 + 1] = clip(outR);
    }
}
ma_node_vtable g_limiter_vtable = {limiter_process, NULL, 1, 1, 0};

// ================================================================
// TRUE 8D OBJECT-BASED SPATIALIZER (LR4 + HAAS)
// ================================================================
static void dynamic_spatializer_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    // 1. THE ACOUSTIC SHIELD: Absolute zero footprint when disabled.
    if (!g_is8DModeOn)
    {
        memcpy(ppFramesOut[0], ppFramesIn[0], (*pFrameCountIn) * 2 * sizeof(float));
        *pFrameCountOut = *pFrameCountIn;
        return;
    }

    DynamicSpatializerNode *p = (DynamicSpatializerNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    // LFO Speed: 0.15 Hz (One full circle around the head every 6.6 seconds)
    float lfoStep = (2.0f * (float)M_PI * 0.15f) / 44100.0f;

    for (ma_uint32 i = 0; i < fc; i++)
    {
        float inL = pIn[i * 2];
        float inR = pIn[i * 2 + 1];

        // 2. THE CASCADING CROSSOVER (Shatter the signal into Low, Mid, High)
        float lowL, midHighL, lowR, midHighR;
        p->crossLowL.process(inL, lowL, midHighL);
        p->crossLowR.process(inR, lowR, midHighR);

        float midL, highL, midR, highR;
        p->crossHighL.process(midHighL, midL, highL);
        p->crossHighR.process(midHighR, midR, highR);

        // 3. THE SUB-BASS ANCHOR (Locked dead center)
        float outLowL = lowL;
        float outLowR = lowR;

        // 4. THE ATMOSPHERIC ROOF (Static extreme Mid/Side widening for Highs)
        float midSide_M = (highL + highR) * 0.5f;
        float midSide_S = (highL - highR) * 0.5f;
        float outHighL = midSide_M + (midSide_S * 1.5f);
        float outHighR = midSide_M - (midSide_S * 1.5f);

        // 5. THE 3D DRIFTER (Modulate only the Mids)
        p->lfoPhase += lfoStep;
        if (p->lfoPhase > 2.0f * (float)M_PI)
            p->lfoPhase -= 2.0f * (float)M_PI;

        float lfoVal = sinf(p->lfoPhase); // Ranges -1.0 (Left) to +1.0 (Right)

        // Constant Power Panning Law
        float angle = (lfoVal + 1.0f) * 0.25f * (float)M_PI;
        float panGainL = cosf(angle);
        float panGainR = sinf(angle);

        // Mono-sum the mid band before panning it so it acts like a single solid object
        float monoMid = (midL + midR) * 0.5f;
        float pannedMidL = monoMid * panGainL;
        float pannedMidR = monoMid * panGainR;

        // 6. DYNAMIC HAAS DELAY (Psychoacoustic time-shifting)
        // Delay the opposite ear by up to 12ms to trick the brain's localization
        p->delayL[p->writeIdx] = pannedMidL;
        p->delayR[p->writeIdx] = pannedMidR;

        float maxDelaySamples = 12.0f * (44100.0f / 1000.0f); // 12ms

        // If sound is left (lfoVal < 0), delay the Right ear. Vice versa.
        int delayOffsetL = (lfoVal > 0.0f) ? (int)(lfoVal * maxDelaySamples) : 0;
        int delayOffsetR = (lfoVal < 0.0f) ? (int)(-lfoVal * maxDelaySamples) : 0;

        int readIdxL = (p->writeIdx - delayOffsetL + HAAS_BUFFER_SIZE) % HAAS_BUFFER_SIZE;
        int readIdxR = (p->writeIdx - delayOffsetR + HAAS_BUFFER_SIZE) % HAAS_BUFFER_SIZE;

        float haasMidL = p->delayL[readIdxL];
        float haasMidR = p->delayR[readIdxR];

        p->writeIdx = (p->writeIdx + 1) % HAAS_BUFFER_SIZE;

        // 7. SUMMING MIXER (Reassemble the shattered pieces)
        pOut[i * 2] = outLowL + haasMidL + outHighL;
        pOut[i * 2 + 1] = outLowR + haasMidR + outHighR;
    }
}

ma_node_vtable g_dynamic_spatializer_vtable = {
    dynamic_spatializer_process,
    NULL,
    1, // 1 input bus
    1, // 1 output bus
    0};
