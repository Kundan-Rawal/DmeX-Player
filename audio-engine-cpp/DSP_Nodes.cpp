#include "DSP_Nodes.h"
#include <cmath>
#include <complex>
#include <vector>
#include <cstring>
#include <mutex>

extern std::atomic<float> g_audioLevel;
extern std::atomic<float> g_bassGain;
extern std::atomic<float> g_subBassHz;
extern std::atomic<float> g_trebleGain;
extern std::atomic<float> g_outputGain;
extern std::atomic<bool> g_isAdaptiveLoudnessOn;
extern std::atomic<float> g_bassField;
extern std::atomic<bool> g_roomBass;
extern std::atomic<float> g_bassMotionHz;
extern std::mutex g_irMutex;
extern std::atomic<bool> g_isConvolutionOn;
extern std::atomic<bool> g_isFIRModeOn;
extern std::atomic<bool> g_isRemasterOn;
extern std::atomic<bool> g_isUpscaleOn;
extern std::atomic<bool> g_isWidenOn;
extern std::atomic<bool> g_isCompressOn;
extern std::atomic<bool> g_isReverbOn;
extern std::atomic<bool> g_isAndroidSpeaker;
extern std::atomic<bool> g_isLaptopSpeaker;
extern std::atomic<bool> g_is8DModeOn;
extern std::atomic<bool> g_ecoMode;

// ================================================================
// ALLPASS FUNCTIONS
// ================================================================

void ap_init(AllPassFilter *a, int sz, float fb)
{
    memset(a->buf, 0, sizeof(a->buf));
    a->size = (std::max)(1, (std::min)(sz, MAX_AP_BUF));
    a->idx = 0;
    a->feedback = fb;
}

float ap_tick(AllPassFilter *a, float in)
{
    float b = a->buf[a->idx];
    const float state = in + b * a->feedback;
    a->buf[a->idx] = state;
    a->idx = (a->idx + 1) % a->size;
    return b - a->feedback * state;
}

// ================================================================
// STUDIO AURAL EXCITER
// ================================================================
static void exciter_process(ma_node* node, const float** input, ma_uint32* countIn, float** output, ma_uint32* countOut)
{
    auto* p = (StudioExciterNode*)node;
    *countOut = *countIn;
    const bool sleeping = g_ecoMode.load() && p->drive.target.load() == 0.0f && p->drive.peek() < 1.0e-6f;
    for (ma_uint32 i = 0; i < *countIn; ++i) {
        const float L = input[0][2*i], R = input[0][2*i+1], drive = p->drive.next();
        p->hpStateL += (L - p->hpStateL) * p->hpCoef;
        p->hpStateR += (R - p->hpStateR) * p->hpCoef;
        if (sleeping) {
            p->dryDelayL[p->dryIdx] = L; p->dryDelayR[p->dryIdx] = R;
            const int rd = (p->dryIdx + 64 - p->dryDelay) % 64;
            output[0][2*i] = p->dryDelayL[rd]; output[0][2*i+1] = p->dryDelayR[rd];
            p->dryIdx = (p->dryIdx + 1) % 64;
            continue;
        }
        float wet[8], dry[8];
        p->os.upsample(L - p->hpStateL, R - p->hpStateR, wet);
        p->cleanOs.upsample(L - p->hpStateL, R - p->hpStateR, dry);
        for (float& x : wet) x = tanhf(x * (1.0f + drive * 3.0f));
        float wetL, wetR, cleanL, cleanR;
        p->os.downsample(wet, &wetL, &wetR);
        p->cleanOs.downsample(dry, &cleanL, &cleanR);
        p->dryDelayL[p->dryIdx] = L;
        p->dryDelayR[p->dryIdx] = R;
        const int rd = (p->dryIdx + 64 - p->dryDelay) % 64;
        output[0][2*i] = p->dryDelayL[rd] + drive * 0.10f * (wetL - cleanL);
        output[0][2*i+1] = p->dryDelayR[rd] + drive * 0.10f * (wetR - cleanR);
        p->dryIdx = (p->dryIdx + 1) % 64;
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

        const float mixL = L, mixR = R;

        // 2. Blumlein Shuffler (Bass-Safe Widening)
        float M = (mixL + mixR) * 0.5f;
        float S = (mixL - mixR) * 0.5f;
        
        // Isolate the bass from the Side channel so we don't widen the sub-bass or kick body
        // 2-Pole steeper slope (12 dB/oct) prevents 0-120Hz from leaking into widening and causing phase hollowing!
        const float SIDE_HP_COEF = 1.0f - std::exp(-2.0f * static_cast<float>(M_PI) * 150.0f / p->sampleRate);
        p->sideLp += SIDE_HP_COEF * (S - p->sideLp);
        p->sideLp2 += SIDE_HP_COEF * (p->sideLp - p->sideLp2);
        float sideLows = p->sideLp2;     // The bass of the Side channel
        float sideHighs = S - sideLows;  // The treble/mids of the Side channel

        float effectiveWidth = p->width.next();
        if (g_isLaptopSpeaker) {
            effectiveWidth = 1.0f + ((effectiveWidth - 1.0f) * 0.4f);
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

    const bool nineD = g_is8DModeOn.load();

    // 9D already performs the complete binaural render. A second center/side
    // matrix here would spatialize the same signal twice and blur localization.
    if (nineD) {
        memcpy(pOut, pIn, fc * 2 * sizeof(float));
        return;
    }

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float L = pIn[i * 2];
        float R = pIn[i * 2 + 1];
        const float intensity = p->spatialIntensity.next();
        const bool skipHaas = intensity < 0.001f;

        // 0. Extract Bass (Subwoofer Crossover at 180Hz)
        // Keep 100% of bass out of the Haas delay lines so zero 18ms comb filtering or phase cancellation occurs!
        float bassL, nonBassL, bassR, nonBassR;
        p->crossSubwooferL.process(L, bassL, nonBassL);
        p->crossSubwooferR.process(R, bassR, nonBassR);

        float inL = nonBassL;
        float inR = nonBassR;

        // 1. The 5.1 Extraction Matrix
        float center = (inL + inR) * 0.5f;
        float sideL  = (inL - inR) * 0.5f;
        
        // T15: Apply Blauert Directional Bands
        float depth = p->depthAmount.next();
        if (fabs(depth - p->lastDepth) > 0.005f) {
            p->bandsMid.setPosition(0.7f, 0.0f, depth);
            p->bandsSide.setPosition(-0.5f, 0.0f, depth);
            p->lastDepth = depth;
        }
        center = p->bandsMid.process(center);
        sideL = p->bandsSide.process(sideL);
        float sideR  = -sideL; 
        
        // 2. Virtual Center (Front Speaker) 
        float vocalBoost = 1.0f + (0.18f * intensity);
        float virtualCenterL = center;
        float virtualCenterR = center;
        
        float virtualRearL = 0.0f;
        float virtualRearR = 0.0f;
        
        float frontSideL = sideL;
        float frontSideR = sideR;

        if (!skipHaas) {
            p->centerDelayBuf[p->centerIdx] = center;
            p->centerIdx = (p->centerIdx + 1) % CENTER_ITD_DELAY;
            virtualCenterL = center * vocalBoost;
            virtualCenterR = center * vocalBoost;

            // 3. Virtual Rear Decorrelation (Allpass Bank)
            float rearL = ap_tick(&p->rearApL[2], ap_tick(&p->rearApL[1], ap_tick(&p->rearApL[0], sideL)));
            float rearR = ap_tick(&p->rearApR[2], ap_tick(&p->rearApR[1], ap_tick(&p->rearApR[0], sideR)));

            const float REAR_LP_COEF = 0.45f;
            p->rearLpL += REAR_LP_COEF * (rearL - p->rearLpL);
            p->rearLpR += REAR_LP_COEF * (rearR - p->rearLpR);

            const float TOP_NOTCH_COEF = 0.45f;
            p->notchTopL1 += TOP_NOTCH_COEF * (p->rearLpL - p->notchTopL1);
            p->notchTopL2 += TOP_NOTCH_COEF * (p->notchTopL1 - p->notchTopL2);
            float upCueL = p->rearLpL - (p->rearLpL - p->notchTopL2) * 0.65f;

            p->notchTopR1 += TOP_NOTCH_COEF * (p->rearLpR - p->notchTopR1);
            p->notchTopR2 += TOP_NOTCH_COEF * (p->notchTopR1 - p->notchTopR2);
            float upCueR = p->rearLpR - (p->rearLpR - p->notchTopR2) * 0.65f;

            float downCueL = p->notchTopL2;
            float downCueR = p->notchTopR2;

            // Apply 3D depth to the rear channels so it physically pushes sound deeper backwards
            float depthExpand = 1.0f + (depth * 0.5f);
            virtualRearL = (upCueL * 0.65f + downCueL * 0.35f) * intensity * depthExpand;
            virtualRearR = (upCueR * 0.65f + downCueR * 0.35f) * intensity * depthExpand;

            // 5. Downmix to Binaural Stereo
            frontSideL = sideL * (1.0f + 0.12f * intensity);
            frontSideR = sideR * (1.0f + 0.12f * intensity);
        }
        
        float outL = virtualCenterL + frontSideL + virtualRearL;
        float outR = virtualCenterR + frontSideR + virtualRearR;

        pOut[i * 2] = L + (outL - nonBassL);
        pOut[i * 2 + 1] = R + (outR - nonBassR);
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
static void audiophile_eq_process(ma_node *node, const float **input, ma_uint32 *countIn, float **output, ma_uint32 *countOut)
{
    auto* p = (AudiophileEQNode*)node;
    *countOut = *countIn;
    const float bassDb = (std::min)(0.0f, g_bassGain.load());
    p->targetBass.set(bassDb);
    p->targetHigh.set(g_trebleGain.load());
    p->targetMid.set(g_presenceBoost.load());
    p->iso226.enabled.set(g_isAdaptiveLoudnessOn.load());
    p->iso226.volume.set((std::clamp)(g_outputGain.load(), 0.0f, 1.0f));
    for (ma_uint32 i = 0; i < *countIn; ++i) {
        const float L = input[0][2*i], R = input[0][2*i+1];

        const float bass = p->targetBass.next(), high = p->targetHigh.next();
        const float presence = p->targetMid.next();
        if ((p->coefficientCounter++ & 31u) == 0) {
            if (fabsf(presence - p->lastPresence) > 0.0001f) {
                p->presenceL.update_coeffs(p->sampleRate, 2500.0f, 0.8f, 6.0f * presence);
                p->presenceR.update_coeffs(p->sampleRate, 2500.0f, 0.8f, 6.0f * presence);
                p->lastPresence = presence;
            }
            if (fabsf(bass - p->lastBassDb) > 0.0001f) {
                p->bassShelfL.update_shelf(p->sampleRate, 180.0f, bass, false);
                p->bassShelfR.update_shelf(p->sampleRate, 180.0f, bass, false);
                p->lastBassDb = bass;
            }
            if (fabsf(high - p->lastTrebleDb) > 0.0001f) {
                p->trebleShelfL.update_shelf(p->sampleRate, 8000.0f, high, true);
                p->trebleShelfR.update_shelf(p->sampleRate, 8000.0f, high, true);
                p->lastTrebleDb = high;
            }
        }
        float outL = p->trebleShelfL.process(p->bassShelfL.process(L));
        float outR = p->trebleShelfR.process(p->bassShelfR.process(R));
        outL = p->presenceL.process(outL);
        outR = p->presenceR.process(outR);
        p->iso226.process(outL, outR);
        output[0][2*i] = outL;
        output[0][2*i+1] = outR;
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
    c->size = (std::max)(1, (std::min)(sz, MAX_COMB_BUF));
    c->idx = 0;
    c->feedback = fb;
    c->damp = dp;
    c->store = 0;
}
void reverb_init_filters(ReverbNode *r, float sampleRate)
{
    r->autoFast = r->autoSlow = 0;
    r->automaticBlend.init(r->automatic.load(), sampleRate, 60.0f);
    float fb = r->roomSize.peek(), dp = r->damp.peek();
    
    // Scale indices by sample rate (they were hardcoded for 44.1kHz)
    float sr_ratio = sampleRate > 0.0f ? (sampleRate / 44100.0f) : 1.0f;
    auto scale_size = [sr_ratio](int baseSize) -> int {
        return (int)(baseSize * sr_ratio);
    };

    comb_init(&r->combL[0], scale_size(COMB1), fb, dp);
    comb_init(&r->combL[1], scale_size(COMB2), fb, dp);
    comb_init(&r->combL[2], scale_size(COMB3), fb, dp);
    comb_init(&r->combL[3], scale_size(COMB4), fb, dp);
    comb_init(&r->combR[0], scale_size(COMB1 + 23), fb, dp);
    comb_init(&r->combR[1], scale_size(COMB2 + 23), fb, dp);
    comb_init(&r->combR[2], scale_size(COMB3 + 23), fb, dp);
    comb_init(&r->combR[3], scale_size(COMB4 + 23), fb, dp);
    ap_init(&r->apL[0], scale_size(AP1), 0.5f);
    ap_init(&r->apL[1], scale_size(AP2), 0.5f);
    ap_init(&r->apR[0], scale_size(AP1 + 11), 0.5f);
    ap_init(&r->apR[1], scale_size(AP2 + 11), 0.5f);
}
static float comb_tick(CombFilter *c, float in)
{
    float o = c->buf[c->idx];
    c->store = o * (1.0f - c->damp) + c->store * c->damp;
    c->buf[c->idx] = in + c->store * c->feedback;
    c->idx = (c->idx + 1) % c->size;
    return o;
}
static void reverb_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    ReverbNode *r = (ReverbNode *)pNode;
    r->enabled.set(g_isReverbOn.load());
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;
    const bool automatic = r->automatic.load(std::memory_order_relaxed);
    r->automaticBlend.set(automatic);
    const float fastCoef = tauCoef(4.0f, r->sampleRate), slowCoef = tauCoef(120.0f, r->sampleRate);
    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float iL = pIn[i * 2], iR = pIn[i * 2 + 1];

        // Keep low bass out of the room so kick weight remains direct and localizable.
        float hpL = r->hpfL.process(iL);
        float hpR = r->hpfR.process(iR);
        const float manualRoom = r->roomSize.next(), manualDamping = r->damp.next();
        const float amount = r->wetMix.next() * r->enabled.next();
        const float activity = (std::max)(fabsf(hpL), fabsf(hpR));
        r->autoFast += fastCoef * (activity - r->autoFast);
        r->autoSlow += slowCoef * (activity - r->autoSlow);
        const float onset = (std::max)(0.0f, r->autoFast - r->autoSlow) / (r->autoSlow + 0.03f);
        const float autoBlend = r->automaticBlend.next();
        const float room = manualRoom + (0.42f + 0.40f * amount - manualRoom) * autoBlend;
        const float damping = manualDamping + (0.68f - 0.24f * amount - manualDamping) * autoBlend;

        // Feed both channels independently, including centered sources, while
        // crossfeeding enough energy to create a room around the stereo image.
        const float feedL = 0.70f * hpL + 0.30f * hpR;
        const float feedR = 0.70f * hpR + 0.30f * hpL;

        float oL = 0, oR = 0;
        for (int j = 0; j < 4; ++j)
        {
            r->combL[j].feedback = r->combR[j].feedback = room;
            r->combL[j].damp = r->combR[j].damp = damping;
            oL += comb_tick(&r->combL[j], feedL);
            oR += comb_tick(&r->combR[j], feedR);
        }
        oL = ap_tick(&r->apL[1], ap_tick(&r->apL[0], oL * 0.25f));
        oR = ap_tick(&r->apR[1], ap_tick(&r->apR[0], oR * 0.25f));
        oL = tanhf(oL);
        oR = tanhf(oR);
        
        // The room is additive: never turn down the dry kick attack, vocal or stereo image
        // as the user raises Reverb. The wet scale leaves headroom for the final limiter.
        const float curWet = amount * (1.0f - autoBlend) + amount / (1.0f + 0.8f * onset) * autoBlend;
        const float wetGain = curWet * (0.45f + 0.40f * curWet);
        pOut[i * 2] = iL + oL * wetGain;
        pOut[i * 2 + 1] = iR + oR * wetGain;
    }
}
ma_node_vtable g_reverb_vtable = {reverb_process, NULL, 1, 1, 0};

// ================================================================
// SUBWOOFER NODE (Dynamic Thump Expander & Speaker Protection)
// ================================================================
static void subwoofer_process(ma_node *node, const float **input, ma_uint32 *countIn, float **output, ma_uint32 *countOut)
{
    auto* p = (SubwooferNode*)node;
    *countOut = *countIn;
    p->drive.set((std::clamp)(g_bassGain.load(), 0.0f, 2.1f));
    p->field.set((std::clamp)(g_bassField.load(), 0.0f, 1.0f));
    p->room.set(g_roomBass.load() ? 1.0f : 0.0f);
    const float subHz = g_subBassHz.load(std::memory_order_relaxed);
    const float sr = p->sampleRate;
    const bool smallSpeaker = g_isLaptopSpeaker.load() || g_isAndroidSpeaker.load();
    const int delayL = (std::min)(2047, (int)(0.0035f * sr));
    const int delayR = (std::min)(2047, (int)(0.0057f * sr));
    for (ma_uint32 i = 0; i < *countIn; ++i) {
        const float L = input[0][2*i], R = input[0][2*i+1];
        const float drive = p->drive.next(), field = p->field.next(), room = p->room.next();
        float bassL, nonBassL, bassR, nonBassR;
        p->crossMidBassL.process(L, bassL, nonBassL);
        p->crossMidBassR.process(R, bassR, nonBassR);
        const float cleanL = p->subsonicL.process(bassL);
        const float cleanR = p->subsonicR.process(bassR);
        float subL, midL, subR, midR;
        p->crossBassL.process(cleanL, subL, midL);
        p->crossBassR.process(cleanR, subR, midR);
        float low60L, above60L, low60R, above60R;
        p->analysis60L.process(cleanL, low60L, above60L);
        p->analysis60R.process(cleanR, low60R, above60R);
        float bodyL, upperL, bodyR, upperR;
        p->analysis100L.process(above60L, bodyL, upperL);
        p->analysis100R.process(above60R, bodyR, upperR);
        const float lowEnergy = (fabsf(low60L) + fabsf(low60R)) * 0.5f;
        const float bodyEnergy = (fabsf(bodyL) + fabsf(bodyR)) * 0.5f;
        const float upperEnergy = (fabsf(upperL) + fabsf(upperR)) * 0.5f;
        const float subEnergy = lowEnergy + bodyEnergy;
        const float midEnergy = upperEnergy;
        const float fullEnergy = (fabsf(L) + fabsf(R)) * 0.5f;
        const float oldEnergy = p->env30_60 + p->env60_90 + p->env90_130;
        p->env30_60 += (lowEnergy > p->env30_60 ? p->energyAttack : p->energyRelease) * (lowEnergy - p->env30_60);
        p->env60_90 += (bodyEnergy > p->env60_90 ? p->energyAttack : p->energyRelease) * (bodyEnergy - p->env60_90);
        p->env90_130 += (upperEnergy > p->env90_130 ? p->energyAttack : p->energyRelease) * (upperEnergy - p->env90_130);
        p->fullBandEnv += (fullEnergy > p->fullBandEnv ? p->energyAttack : p->energyRelease) * (fullEnergy - p->fullBandEnv);
        if ((p->tuneCounter++ & 31u) == 0) {
            const float total = p->env30_60 + p->env60_90 + p->env90_130;
            const float tracked = total > 0.0001f
                ? (50.0f * p->env30_60 + 80.0f * p->env60_90 + 112.0f * p->env90_130) / total
                : 96.0f;
            p->targetFreq = (std::clamp)(tracked, 78.0f, 118.0f);
            p->currentFreq += tauCoef(25.0f, sr / 32.0f) * (p->targetFreq - p->currentFreq);
            const float density = p->env30_60 + p->env60_90 + p->env90_130 * 0.85f;
            const float bassRatio = total / (p->fullBandEnv + 0.002f);
            const float scarcityTarget = (std::clamp)((0.26f - bassRatio) / 0.20f, 0.0f, 1.0f);
            const float bassActivity = (std::clamp)((total - 0.0005f) / 0.006f, 0.0f, 1.0f);
            const float scarcityCoef = tauCoef(180.0f, sr / 32.0f);
            p->bassScarcity += scarcityCoef * (scarcityTarget * bassActivity - p->bassScarcity);
            if (!p->isHighlightInit || fabsf(p->currentFreq - p->lastTunedFreq) > 0.25f ||
                subHz != p->lastSubHz ||
                fabsf(drive - p->lastBassGain) > 0.002f || fabsf(density - p->lastDensity) > 0.01f ||
                fabsf(p->bassScarcity - p->lastScarcity) > 0.01f) {
                const float headroom = 0.82f + 0.18f / (1.0f + density * 0.35f);
                // Use broad anchors with bounded scarcity compensation. This keeps
                // 50-90 Hz and 100-130 Hz masters emotionally consistent without the
                // former 10 dB song-to-song jump at one narrow moving frequency.
                // Very low anchors overlap the subsonic protection slope, so
                // recover a little weight there without touching the punch band.
                const float deepAnchorScale = subHz <= 40.0f ? 1.20f : 1.0f;
                const float subDb = drive * (2.2f + 1.6f * p->bassScarcity) * headroom * deepAnchorScale;
                const float midDb = drive * (3.0f + 2.4f * p->bassScarcity) * headroom;
                p->subPeakL.update_coeffs(sr, subHz, 0.70f, subDb);
                p->subPeakR.update_coeffs(sr, subHz, 0.70f, subDb);
                p->midPeakL.update_coeffs(sr, p->currentFreq, 0.80f, midDb);
                p->midPeakR.update_coeffs(sr, p->currentFreq, 0.80f, midDb);
                p->lastBassGain = drive;
                p->lastTunedFreq = p->currentFreq;
                p->lastSubHz = subHz;
                p->lastDensity = density;
                p->lastScarcity = p->bassScarcity;
                p->isHighlightInit = true;
            }
        }
        // Run both anchors as ordinary full-signal peaking EQ and mix back only
        // their difference. Feeding a crossover branch into the peaks rotates the
        // delta against the dry signal near 100-130 Hz, which can make high Drive
        // cancel the exact upper-bass fundamentals it is meant to recover.
        const float shapedBassL = p->midPeakL.process(p->subPeakL.process(L));
        const float shapedBassR = p->midPeakR.process(p->subPeakR.process(R));

        // A linked fast/slow envelope distinguishes a kick onset from sustained bass.
        // Linking both channels preserves the source's stereo position.
        const float detector = (std::max)(fabsf(cleanL), fabsf(cleanR));
        p->transientFast += p->transientFastCoef * (detector - p->transientFast);
        p->transientSlow += p->transientSlowCoef * (detector - p->transientSlow);
        const float onset = (std::max)(0.0f, p->transientFast - p->transientSlow);
        const float onsetRatio = (std::min)(1.0f, onset / (p->transientSlow + 0.015f));
        const float punchGain = 0.42f * drive * onsetRatio;
        const float tonalBlend = (std::min)(0.90f, 0.42f + 0.16f * drive + 0.12f * p->bassScarcity);
        const float tonalDeltaL = (shapedBassL - L) * tonalBlend;
        const float tonalDeltaR = (shapedBassR - R) * tonalBlend;

        // Remove subsonic content as a difference signal, then add tonal weight and
        // the short upper-bass attack separately. There is no internal bass clipper;
        // the downstream lookahead limiter remains the single peak-control stage.
        const float active = (std::min)(1.0f, drive / 0.02f);
        const float punchDeltaL = (shapedBassL - L) * punchGain * 0.5f;
        const float punchDeltaR = (shapedBassR - R) * punchGain * 0.5f;
        float outL = L + active * (cleanL - bassL) + tonalDeltaL + punchDeltaL;
        float outR = R + active * (cleanR - bassR) + tonalDeltaR + punchDeltaR;

        // Field receives only upper bass and remains independent from Drive.
        const float sendL = midL;
        const float sendR = midR;
        p->fieldDelayL[p->fieldIndex] = sendL;
        p->fieldDelayR[p->fieldIndex] = sendR;
        const float reflectL = p->fieldDelayR[(p->fieldIndex + 2048 - delayL) % 2048];
        const float reflectR = p->fieldDelayL[(p->fieldIndex + 2048 - delayR) % 2048];
        p->fieldIndex = (p->fieldIndex + 1) % 2048;
        const float spatialOnset = (std::max)(0.0f, subEnergy + midEnergy - oldEnergy);
        const float transientSpace = 1.0f / (1.0f + 6.0f * spatialOnset / (oldEnergy + 0.01f));
        // Compact Bass is an exact no-reflection mode. Bass Field becomes audible
        // only when 3D Room is explicitly selected.
        const float space = field * room * 0.24f * transientSpace * (1.0f - onsetRatio);
        outL += space * reflectL;
        outR += space * reflectR;

        if (smallSpeaker) {
            // Protect tiny drivers below 48 Hz without deleting musical sub-bass or
            // the 80-120 Hz chest-hit band. A transient-weighted second harmonic
            // makes deep kicks audible without adding a constant fuzzy bass layer.
            const float protectedL = p->speakerProtectionL.process(outL);
            const float protectedR = p->speakerProtectionR.process(outR);
            const float virtualL = p->virtualBassL.process(fabsf(subL));
            const float virtualR = p->virtualBassR.process(fabsf(subR));
            const float virtualGain = drive * (0.05f + 0.30f * onsetRatio);
            outL = protectedL + virtualGain * virtualL;
            outR = protectedR + virtualGain * virtualR;
        }
        output[0][2*i] = outL;
        output[0][2*i+1] = outR;
    }
    g_bassMotionHz.store(p->currentFreq, std::memory_order_relaxed);
}

ma_node_vtable g_subwoofer_vtable = {subwoofer_process, NULL, 1, 1, 0};

// ================================================================
// CORE ENGINE DSP NODES
// ================================================================



// ================================================================
// CONVOLUTION NODE
// ================================================================

static void convolution_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    ConvolutionNode *p = (ConvolutionNode *)pNode;
    
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    FFTConvolver* cL = p->convL.load(std::memory_order_acquire);
    FFTConvolver* cR = p->convR.load(std::memory_order_acquire);
    

    if (p->blockSize != 512) {
        memmove(pOut, pIn, fc * 2 * sizeof(float));
        return;
    }
    p->blockAdapterL.process(pIn, pOut, fc, [&](const float* inBuf, float* outBuf) {
        if (!cL || !cR || (p->wetMix.target.load() == 0.0f && p->wetMix.peek() < 1.0e-6f)) {
            std::memcpy(outBuf, inBuf, 512 * 2 * sizeof(float));
            return;
        }
        for (int i = 0; i < 512; ++i) {
            p->feedL[i] = inBuf[2*i];
            p->feedR[i] = inBuf[2*i+1];
            p->mix[i] = p->wetMix.next();
        }
        cL->process(p->feedL, p->wetL);
        cR->process(p->feedR, p->wetR);
        for (int i = 0; i < 512; ++i) {
            outBuf[2*i] = p->feedL[i] + p->mix[i] * (p->wetL[i] - p->feedL[i]);
            outBuf[2*i+1] = p->feedR[i] + p->mix[i] * (p->wetR[i] - p->feedR[i]);
        }
    });
}
ma_node_vtable g_convolution_vtable = {convolution_process, NULL, 1, 1, 0};

// ================================================================
// TASK T22: INVERSE HEADPHONE COMPENSATION (HARMAN TARGET CALIBRATION)
// ================================================================
static void headphone_comp_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    HeadphoneCompNode *p = (HeadphoneCompNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    FFTConvolver *cL = p->convL.load(std::memory_order_relaxed);
    FFTConvolver *cR = p->convR.load(std::memory_order_relaxed);
    p->blockAdapterL.process(pIn, pOut, fc, [&](const float *inBuf, float *outBuf) {
        if (!cL || !cR || p->enabled.fullyOff()) {
            std::memcpy(outBuf, inBuf, 512 * 2 * sizeof(float));
            return;
        }
        float feedL[512];
        float feedR[512];
        int bs = p->blockSize;
        if (bs > 512) bs = 512;

        for (int i = 0; i < bs; ++i)
        {
            feedL[i] = inBuf[i * 2];
            feedR[i] = inBuf[i * 2 + 1];
        }

        float compL[512];
        float compR[512];

        cL->process(feedL, compL);
        cR->process(feedR, compR);

        for (int i = 0; i < bs; ++i)
        {
            float dryL = feedL[i];
            float dryR = feedR[i];
            float wetL = compL[i];
            float wetR = compR[i];

            float gate = p->enabled.next();
            float st   = p->strength.next();
            float blend = gate * st;

            outBuf[i * 2]     = dryL + (wetL - dryL) * blend;
            outBuf[i * 2 + 1] = dryR + (wetR - dryR) * blend;
        }
    });


}
ma_node_vtable g_headphone_comp_vtable = {headphone_comp_process, NULL, 1, 1, 0};


// ================================================================
// TRANSPARENT RMS GLUE COMPRESSOR
// ================================================================
static void multiband_compressor_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    MultibandCompressorNode *c = (MultibandCompressorNode *)pNode;
    c->enabled.set(g_isCompressOn.load());
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;


    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float L = pIn[i * 2], R = pIn[i * 2 + 1];

        const float thresh = c->threshold.next(), makeup = c->makeupGain.next();
        const float enabled = c->enabled.next();
        // Detector and processing both address the non-bass band.
        c->lpStateL += c->detectorCoef * (L - c->lpStateL);
        c->lpStateR += c->detectorCoef * (R - c->lpStateR);
        float highDetL = L - c->lpStateL;
        float highDetR = R - c->lpStateR;
        float maxHighPeak = fmaxf(fabsf(highDetL), fabsf(highDetR));

        if (maxHighPeak > c->envHigh)
        {
            c->envHigh = c->envHigh * c->attackCoef + maxHighPeak * (1.0f - c->attackCoef);
        }
        else
        {
            c->envHigh = c->envHigh * c->releaseCoef + maxHighPeak * (1.0f - c->releaseCoef);
        }

        // Calculate gain reduction ONLY for the high band
        float highGain = 1.0f;
        if (c->envHigh > thresh && thresh > 0.001f)
        {
            float over = c->envHigh - thresh;
            highGain = thresh / (thresh + over * 0.35f); 
        }

        // 2. DELAY LINE
        highGain = 1.0f + enabled * (highGain - 1.0f);
        float dL = c->dlyL[c->dlyIdx];
        float dR = c->dlyR[c->dlyIdx];
        c->dlyL[c->dlyIdx] = L;
        c->dlyR[c->dlyIdx] = R;
        c->dlyIdx = (c->dlyIdx + 1) % ((c->delaySamples > 0 && c->delaySamples <= COMP_LOOKAHEAD_SAMPLES) ? c->delaySamples : COMP_LOOKAHEAD_SAMPLES);

        // Complementary residual band: changing high gain must not invert a crossover lobe.
        c->delayLpStateL += c->detectorCoef * (dL - c->delayLpStateL);
        c->delayLpStateR += c->detectorCoef * (dR - c->delayLpStateR);
        const float highL_d = dL - c->delayLpStateL;
        const float highR_d = dR - c->delayLpStateR;
        pOut[i * 2] = (dL + highL_d * (highGain - 1.0f)) * makeup;
        pOut[i * 2 + 1] = (dR + highR_d * (highGain - 1.0f)) * makeup;
    }
}
ma_node_vtable g_multiband_compressor_vtable = {multiband_compressor_process, NULL, 1, 1, 0};

// ================================================================
// MASTERING SOFT-CLIPPER WITH LOOKAHEAD
// ================================================================
// ================================================================
// MASTERING SOFT-CLIPPER WITH LOOKAHEAD
// ================================================================
static void limiter_process(ma_node *node, const float **input, ma_uint32 *countIn, float **output, ma_uint32 *countOut)
{
    auto* p = (LimiterNode*)node;
    *countOut = *countIn;
    p->master.set((std::clamp)(g_outputGain.load(), 0.0f, 2.0f));
    constexpr float ceiling = 0.891251f;
    for (ma_uint32 i = 0; i < *countIn; ++i) {
        const float control = p->master.next();
        const float amount = (std::clamp)(control - 1.0f, 0.0f, 1.0f);
        const float baseVolume = (std::min)(control, 1.0f);
        const float inL = input[0][2*i], inR = input[0][2*i+1];

        // Stereo-linked loudness maximizer. A bass-relaxed RMS sidechain keeps
        // sustained sub energy from pulling vocals and detail down, while the
        // downstream true-peak limiter remains the absolute safety stage.
        p->scLpL += p->loudnessSidechainCoef * (inL - p->scLpL);
        p->scLpR += p->loudnessSidechainCoef * (inR - p->scLpR);
        const float detectL = (inL - p->scLpL) + 0.35f * p->scLpL;
        const float detectR = (inR - p->scLpR) + 0.35f * p->scLpR;
        const float detector = sqrtf(0.5f * (detectL * detectL + detectR * detectR) + 1.0e-12f);
        const float envCoef = detector > p->loudnessEnv ? p->loudnessAttackCoef : p->loudnessReleaseCoef;
        p->loudnessEnv = envCoef * p->loudnessEnv + (1.0f - envCoef) * detector;

        if ((p->loudnessControlCounter++ & 31u) == 0) {
            p->loudnessThreshold = powf(10.0f, (-12.0f - 4.0f * amount) / 20.0f);
            p->loudnessRatio = 1.0f + 1.5f * amount;
            p->loudnessMakeup = powf(10.0f, 8.0f * amount / 20.0f);
        }
        float compression = 1.0f;
        if (amount > 0.0001f && p->loudnessEnv > p->loudnessThreshold) {
            const float compressedLevel = p->loudnessThreshold
                + (p->loudnessEnv - p->loudnessThreshold) / p->loudnessRatio;
            compression = compressedLevel / p->loudnessEnv;
        }
        const float targetLoudnessGain = baseVolume * p->loudnessMakeup * compression;
        const float gainCoef = targetLoudnessGain < p->loudnessGain
            ? p->loudnessGainAttackCoef : p->loudnessGainReleaseCoef;
        p->loudnessGain = gainCoef * p->loudnessGain + (1.0f - gainCoef) * targetLoudnessGain;

        const float gain = p->loudnessGain * p->boost.next();
        float L = inL * gain, R = inR * gain;
        if (!std::isfinite(L)) L = 0.0f;
        if (!std::isfinite(R)) R = 0.0f;
        float up[8];
        p->osDetect.upsample(L, R, up);
        float peak = (std::max)(fabsf(L), fabsf(R));
        for (float x : up) peak = (std::max)(peak, fabsf(x));
        const float target = peak > ceiling ? ceiling / peak : 1.0f;
        if (target <= p->gainEnv) {
            p->gainEnv = target;
            p->holdSamples = p->delaySamples + 32;
        } else if (p->holdSamples > 0) {
            --p->holdSamples;
        } else {
            p->gainEnv += (target - p->gainEnv) * (1.0f - p->releaseCoef);
        }
        p->gainSmooth = p->gainEnv;
        const int w = p->dlyIdx;
        p->dlyL[w] = L;
        p->dlyR[w] = R;
        const int r = (w + LIMITER_LOOKAHEAD_SAMPLES - p->delaySamples) % LIMITER_LOOKAHEAD_SAMPLES;
        output[0][2*i] = (std::clamp)(p->dlyL[r] * p->gainEnv, -ceiling, ceiling);
        output[0][2*i+1] = (std::clamp)(p->dlyR[r] * p->gainEnv, -ceiling, ceiling);
        p->dlyIdx = (w + 1) % LIMITER_LOOKAHEAD_SAMPLES;
    }
    extern std::atomic<float> g_limiterGR;
    g_limiterGR.store(p->gainEnv * (std::min)(1.0f, p->loudnessGain), std::memory_order_relaxed);
}
ma_node_vtable g_limiter_vtable = {limiter_process, NULL, 1, 1, 0};

// ================================================================
// TRUE 8D OBJECT-BASED SPATIALIZER (LR4 + HAAS)
// ================================================================
static void dynamic_spatializer_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    DynamicSpatializerNode *p = (DynamicSpatializerNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    // Real-time thread-safe toggle
    const bool requested = g_is8DModeOn.load() && p->separationTarget() > 0.0001f;
    p->gate.set(requested);

    // 1. THE ACOUSTIC SHIELD: Absolute bit-identical zero footprint when disabled.
    if (p->gate.fullyOff())
    {
        p->rendererSleeping = true;
        memcpy(pOut, pIn, fc * 2 * sizeof(float));
        return;
    }

    if (requested && p->rendererSleeping) {
        p->upmixer.reset();
        p->rendererSleeping = false;
    }

    for (ma_uint32 i = 0; i < fc; i++)
    {
        float inL = pIn[i * 2];
        float inR = pIn[i * 2 + 1];

        // 2. Render through the 9-Speaker Upmix & Binaural Matrix
        float spatL = 0.0f, spatR = 0.0f;
        p->upmixer.process(inL, inR, spatL, spatR);

        // 3. Smooth lock-free 25ms crossfade between bypass and 9-speaker field
        float gate = p->gate.next();
        pOut[i * 2]     = inL + (spatL - inL) * gate;
        pOut[i * 2 + 1] = inR + (spatR - inR) * gate;
    }
}

ma_node_vtable g_dynamic_spatializer_vtable = {
    dynamic_spatializer_process,
    NULL,
    1, // 1 input bus
    1, // 1 output bus
    0};

// ================================================================
// HARMONIC AIR (oversampled synthesis, not recovery of lost information)
// ================================================================
static void audio_restoration_process(ma_node *node, const float **input, ma_uint32 *countIn, float **output, ma_uint32 *countOut)
{
    auto* p = (AudioRestorationNode*)node;
    *countOut = *countIn;
    p->amount.set(g_isUpscaleOn.load() ? (std::clamp)(g_upscaleTarget.load(), 0.0f, 2.0f) : 0.0f);
    const bool sleeping = g_ecoMode.load() && p->amount.target.load() == 0.0f && p->amount.peek() < 1.0e-6f;
    for (ma_uint32 i = 0; i < *countIn; ++i) {
        const float L = input[0][2*i], R = input[0][2*i+1];
        if (sleeping) {
            const int w = p->delayIndex, r = (w + 64 - p->delaySamples) % 64;
            p->dryL[w] = L; p->dryR[w] = R;
            output[0][2*i] = p->dryL[r]; output[0][2*i+1] = p->dryR[r];
            p->delayIndex = (w + 1) % 64;
            continue;
        }
        float lowL, highL, lowR, highR;
        p->crossoverL.process(L, lowL, highL);
        p->crossoverR.process(R, lowR, highR);
        float up[8];
        p->os.upsample(highL, highR, up);
        for (float& x : up) {
            const float bounded = tanhf(3.0f * x);
            x = bounded * bounded;
        }
        float wetL, wetR;
        p->os.downsample(up, &wetL, &wetR);
        wetL = p->harmonicFilterL.process(wetL);
        wetR = p->harmonicFilterR.process(wetR);
        const int w = p->delayIndex, r = (w + 64 - p->delaySamples) % 64;
        p->dryL[w] = L;
        p->dryR[w] = R;
        const float amount = 0.15f * p->amount.next();
        output[0][2*i] = p->dryL[r] + amount * wetL;
        output[0][2*i+1] = p->dryR[r] + amount * wetR;
        p->delayIndex = (w + 1) % 64;
    }
}
ma_node_vtable g_restoration_vtable = {audio_restoration_process, NULL, 1, 1, 0};
extern ConvolutionNode g_convolutionNode;
extern ReverbNode g_reverbNode;
extern MultibandCompressorNode g_compressorNode;
extern LimiterNode g_limiterNode;
extern StudioExciterNode g_exciterNode;
extern AudiophileEQNode g_audiophileEQNode;
extern SubwooferNode g_subwooferNode;
extern PsychoacousticNode g_spatializerNode;
extern AudioRestorationNode g_restorationNode;
extern DynamicSpatializerNode g_8DNode;
extern StereoWidenerNode g_widenerNode;
extern HeadphoneCompNode g_headphoneCompNode;
extern std::mutex g_irMutex;
extern std::atomic<float> g_audioLevel;

void dsp_flush_all_state(void)
{
    g_headphoneCompNode.reset();
    g_8DNode.reset();
    g_8DNode.rendererSleeping = true;
    g_exciterNode.os.reset();
    g_exciterNode.cleanOs.reset();
    std::fill(std::begin(g_exciterNode.dryDelayL), std::end(g_exciterNode.dryDelayL), 0.0f);
    std::fill(std::begin(g_exciterNode.dryDelayR), std::end(g_exciterNode.dryDelayR), 0.0f);
    g_exciterNode.dryIdx = 0;
    g_audiophileEQNode.bassShelfL.reset(); g_audiophileEQNode.bassShelfR.reset();
    g_audiophileEQNode.trebleShelfL.reset(); g_audiophileEQNode.trebleShelfR.reset();
    g_audiophileEQNode.presenceL.reset(); g_audiophileEQNode.presenceR.reset();
    g_audiophileEQNode.iso226.lowShelfL.reset(); g_audiophileEQNode.iso226.lowShelfR.reset();
    g_audiophileEQNode.iso226.highShelfL.reset(); g_audiophileEQNode.iso226.highShelfR.reset();
    g_subwooferNode.crossBassL.reset(); g_subwooferNode.crossBassR.reset();
    g_subwooferNode.crossMidBassL.reset(); g_subwooferNode.crossMidBassR.reset();
    g_subwooferNode.fieldIndex = 0;
    std::fill(std::begin(g_subwooferNode.fieldDelayL), std::end(g_subwooferNode.fieldDelayL), 0.0f);
    std::fill(std::begin(g_subwooferNode.fieldDelayR), std::end(g_subwooferNode.fieldDelayR), 0.0f);
    g_reverbNode.hpfL.reset(); g_reverbNode.hpfR.reset();
    g_reverbNode.autoFast = g_reverbNode.autoSlow = 0;
    g_spatializerNode.crossSubwooferL.reset(); g_spatializerNode.crossSubwooferR.reset();
    g_spatializerNode.bandsMid.reset(); g_spatializerNode.bandsSide.reset();
    {
        std::lock_guard<std::mutex> lk(g_irMutex);
        
        if (auto* c = g_convolutionNode.convL.load(std::memory_order_relaxed)) c->reset();
        if (auto* c = g_convolutionNode.convR.load(std::memory_order_relaxed)) c->reset();
        g_convolutionNode.bassStateL = 0.0f;
        g_convolutionNode.bassStateR = 0.0f;
        g_convolutionNode.hpStateL = 0.0f;
        g_convolutionNode.hpStateR = 0.0f;
        g_convolutionNode.lpStateL = 0.0f;
        g_convolutionNode.lpStateR = 0.0f;
        g_convolutionNode.hpfL.reset();
        g_convolutionNode.hpfR.reset();
        g_convolutionNode.blockAdapterL.reset();
        g_convolutionNode.blockAdapterR.reset();

    }

    for (int i = 0; i < 4; ++i) {
        memset(g_reverbNode.combL[i].buf, 0, sizeof(g_reverbNode.combL[i].buf));
        g_reverbNode.combL[i].idx = 0;
        g_reverbNode.combL[i].store = 0;
        memset(g_reverbNode.combR[i].buf, 0, sizeof(g_reverbNode.combR[i].buf));
        g_reverbNode.combR[i].idx = 0;
        g_reverbNode.combR[i].store = 0;
    }
    for (int i = 0; i < 2; ++i) {
        memset(g_reverbNode.apL[i].buf, 0, sizeof(g_reverbNode.apL[i].buf));
        g_reverbNode.apL[i].idx = 0;
        memset(g_reverbNode.apR[i].buf, 0, sizeof(g_reverbNode.apR[i].buf));
        g_reverbNode.apR[i].idx = 0;
    }

    memset(g_compressorNode.dlyL, 0, sizeof(g_compressorNode.dlyL));
    memset(g_compressorNode.dlyR, 0, sizeof(g_compressorNode.dlyR));
    g_compressorNode.dlyIdx = 0;
    g_compressorNode.envLow  = 0.0f;
    g_compressorNode.envHigh = 0.0f;
    g_compressorNode.lpStateL = 0.0f;
    g_compressorNode.lpStateR = 0.0f;
    g_compressorNode.delayLpStateL = 0.0f;
    g_compressorNode.delayLpStateR = 0.0f;

    memset(g_limiterNode.dlyL, 0, sizeof(g_limiterNode.dlyL));
    memset(g_limiterNode.dlyR, 0, sizeof(g_limiterNode.dlyR));
    g_limiterNode.dlyIdx = 0;
    g_limiterNode.gainEnv = 1.0f;
    g_limiterNode.gainSmooth = 1.0f;
    g_limiterNode.holdSamples = 0;
    g_limiterNode.osDetect.reset();
    g_limiterNode.peakEnv = 0.0f;
    g_limiterNode.scLpL = 0.0f;
    g_limiterNode.scLpR = 0.0f;
    g_limiterNode.loudnessEnv = 0.0f;
    g_limiterNode.loudnessGain = 1.0f;
    g_limiterNode.loudnessThreshold = 1.0f;
    g_limiterNode.loudnessRatio = 1.0f;
    g_limiterNode.loudnessMakeup = 1.0f;
    g_limiterNode.loudnessControlCounter = 0;

    g_exciterNode.hpStateL = 0.0f;
    g_exciterNode.hpStateR = 0.0f;

    
    
    
    g_audiophileEQNode.envUpwardL = 0.0f;
    g_audiophileEQNode.envUpwardR = 0.0f;
    g_audiophileEQNode.dcBlockL = 0.0f;
    g_audiophileEQNode.dcBlockR = 0.0f;
    g_audiophileEQNode.env = 0.0f;

    g_subwooferNode.speakerProtectionL.reset();
    g_subwooferNode.speakerProtectionR.reset();
    g_subwooferNode.virtualBassL.reset();
    g_subwooferNode.virtualBassR.reset();
    g_subwooferNode.env30_60 = 0.0f;
    g_subwooferNode.env60_90 = 0.0f;
    g_subwooferNode.env90_130 = 0.0f;
    g_subwooferNode.transientFast = 0.0f;
    g_subwooferNode.transientSlow = 0.0f;
    g_subwooferNode.fullBandEnv = 0.0f;
    g_subwooferNode.bassScarcity = 0.0f;
    g_subwooferNode.currentFreq = 105.0f;
    g_subwooferNode.targetFreq = 105.0f;
    g_subwooferNode.lastTunedFreq = -1.0f;
    g_subwooferNode.lastSubHz = -1.0f;
    g_subwooferNode.subsonicL.reset();
    g_subwooferNode.subsonicR.reset();
    g_subwooferNode.analysis60L.reset();
    g_subwooferNode.analysis60R.reset();
    g_subwooferNode.analysis100L.reset();
    g_subwooferNode.analysis100R.reset();
    g_subwooferNode.subPeakL.reset();
    g_subwooferNode.subPeakR.reset();
    g_subwooferNode.midPeakL.reset();
    g_subwooferNode.midPeakR.reset();
    g_subwooferNode.lastBassGain = -1.0f;
    g_subwooferNode.lastScarcity = -1.0f;
    g_subwooferNode.isHighlightInit = false;

    memset(g_spatializerNode.centerDelayBuf, 0, sizeof(g_spatializerNode.centerDelayBuf));
    g_spatializerNode.centerIdx = 0;
    for(int i = 0; i < 3; ++i) {
        memset(g_spatializerNode.rearApL[i].buf, 0, sizeof(g_spatializerNode.rearApL[i].buf));
        memset(g_spatializerNode.rearApR[i].buf, 0, sizeof(g_spatializerNode.rearApR[i].buf));
        g_spatializerNode.rearApL[i].idx = g_spatializerNode.rearApR[i].idx = 0;
    }
    g_spatializerNode.rearLpL = g_spatializerNode.rearLpR = 0.0f;
    g_spatializerNode.notchTopL1 = g_spatializerNode.notchTopL2 = 0.0f;
    g_spatializerNode.notchTopR1 = g_spatializerNode.notchTopR2 = 0.0f;

    memset(g_widenerNode.delayL, 0, sizeof(g_widenerNode.delayL));
    memset(g_widenerNode.delayR, 0, sizeof(g_widenerNode.delayR));
    g_widenerNode.delayIdx = 0;
    g_widenerNode.lpStateL = 0.0f;
    g_widenerNode.lpStateR = 0.0f;
    g_widenerNode.sideLp = 0.0f;
    g_widenerNode.sideLp2 = 0.0f;

    g_restorationNode.init(g_subwooferNode.sampleRate);

    g_audioLevel.store(0.0f, std::memory_order_relaxed);
}
