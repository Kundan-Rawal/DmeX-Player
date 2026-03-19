#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"
#include <iostream>
#include <string>
#include <cmath>
#include <cstring>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#endif

using namespace std;

// ================================================================
// ENGINE A: HARMONIC EXCITER
// ================================================================
struct HarmonicExciterNode
{
    ma_node_base baseNode;
    float drive;
    float mix;
};

static void exciter_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn,
                            float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    HarmonicExciterNode *p = (HarmonicExciterNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 frameCount = *pFrameCountIn;
    *pFrameCountOut = frameCount;
    for (ma_uint32 i = 0; i < frameCount * 2; ++i)
    {
        float s = pIn[i];
        pOut[i] = (s * (1.0f - p->mix)) + (std::tanh(s * p->drive) * p->mix);
    }
}
static ma_node_vtable g_exciter_vtable = {exciter_process, NULL, 1, 1, 0};

// ================================================================
// ENGINE B: STEREO WIDENER
// M/S processing. midComp prevents vocal burial when widening.
// Safe ceiling: width = 1.5. Beyond that phase artifacts appear.
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
    ma_uint32 frameCount = *pFrameCountIn;
    *pFrameCountOut = frameCount;
    for (ma_uint32 i = 0; i < frameCount; ++i)
    {
        float L = pIn[i * 2];
        float R = pIn[i * 2 + 1];
        float M = (L + R) * 0.5f;
        float S = (L - R) * 0.5f;
        float midComp = 1.0f + ((p->width - 1.0f) * 0.20f);
        pOut[i * 2] = (M * midComp) + (p->width * S);
        pOut[i * 2 + 1] = (M * midComp) - (p->width * S);
    }
}
static ma_node_vtable g_widener_vtable = {widener_process, NULL, 1, 1, 0};

// ================================================================
// ENGINE C: BINAURAL 3D SPATIALIZER (Cross-Feed + Haas Effect)
//
// ALWAYS in the routing chain. crossMix floor = 0.12 (always-on).
// The 3D command from frontend sets EXTRA depth on top of the floor.
//   crossMix = 0.12 (floor)  → removes in-head tunnel, subtle
//   crossMix = 0.25 (mid)    → clear 3D soundstage
//   crossMix = 0.38 (max)    → Dolby Atmos-like immersion
// ================================================================
#define CROSSFEED_DELAY_SAMPLES 72

struct Spatializer3DNode
{
    ma_node_base baseNode;
    float delayBufL[CROSSFEED_DELAY_SAMPLES];
    float delayBufR[CROSSFEED_DELAY_SAMPLES];
    int delayIdx;
    float crossMix;
};

static void spatializer3d_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn,
                                  float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    Spatializer3DNode *p = (Spatializer3DNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 frameCount = *pFrameCountIn;
    *pFrameCountOut = frameCount;
    for (ma_uint32 i = 0; i < frameCount; ++i)
    {
        float L = pIn[i * 2];
        float R = pIn[i * 2 + 1];
        float delayedL = p->delayBufL[p->delayIdx];
        float delayedR = p->delayBufR[p->delayIdx];
        p->delayBufL[p->delayIdx] = L;
        p->delayBufR[p->delayIdx] = R;
        p->delayIdx = (p->delayIdx + 1) % CROSSFEED_DELAY_SAMPLES;
        pOut[i * 2] = L + p->crossMix * delayedR;
        pOut[i * 2 + 1] = R + p->crossMix * delayedL;
    }
}
static ma_node_vtable g_spatializer3d_vtable = {spatializer3d_process, NULL, 1, 1, 0};

// ================================================================
// ENGINE D: SCHROEDER ALGORITHMIC REVERB
//
// BUG FIXED: 4 comb filters summed without normalization meant
// wetMix=0.25 was ACTUALLY ~full wet (4x energy). Now divided by 4.
// wetMix=0.25 now genuinely sounds like 25% wet blend.
//
// Mid/Side separation: 80% Side into reverb, only 20% Mid.
// → Instruments soaked in the room. Singer stays dry and forward.
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
    float roomSize;
    float wetMix;
    float damp;
};

static void comb_init(CombFilter *c, int size, float fb, float damp)
{
    memset(c->buf, 0, sizeof(c->buf));
    c->size = size;
    c->idx = 0;
    c->feedback = fb;
    c->damp = damp;
    c->store = 0.0f;
}
static float comb_tick(CombFilter *c, float in)
{
    float out = c->buf[c->idx];
    c->store = out * (1.0f - c->damp) + c->store * c->damp;
    c->buf[c->idx] = in + c->store * c->feedback;
    c->idx = (c->idx + 1) % c->size;
    return out;
}
static void ap_init(AllPassFilter *a, int size, float fb)
{
    memset(a->buf, 0, sizeof(a->buf));
    a->size = size;
    a->idx = 0;
    a->feedback = fb;
}
static float ap_tick(AllPassFilter *a, float in)
{
    float bufout = a->buf[a->idx];
    a->buf[a->idx] = in + bufout * a->feedback;
    a->idx = (a->idx + 1) % a->size;
    return bufout - in;
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
    ma_uint32 frameCount = *pFrameCountIn;
    *pFrameCountOut = frameCount;
    float dry = 1.0f - r->wetMix;
    for (ma_uint32 i = 0; i < frameCount; ++i)
    {
        float inL = pIn[i * 2];
        float inR = pIn[i * 2 + 1];
        float mid = (inL + inR) * 0.5f;
        float side = (inL - inR) * 0.5f;
        float feed = (mid * 0.2f) + (side * 0.8f);

        float outL = 0.0f, outR = 0.0f;
        for (int j = 0; j < 4; ++j)
        {
            outL += comb_tick(&r->combL[j], feed);
            outR += comb_tick(&r->combR[j], feed);
        }
        // NORMALIZATION: divide by number of comb filters so wetMix is accurate
        outL *= 0.25f;
        outR *= 0.25f;

        outL = ap_tick(&r->apL[0], outL);
        outL = ap_tick(&r->apL[1], outL);
        outR = ap_tick(&r->apR[0], outR);
        outR = ap_tick(&r->apR[1], outR);

        pOut[i * 2] = (inL * dry) + (outL * r->wetMix);
        pOut[i * 2 + 1] = (inR * dry) + (outR * r->wetMix);
    }
}
static ma_node_vtable g_reverb_vtable = {reverb_process, NULL, 1, 1, 0};

// ================================================================
// ENGINE E: DYNAMIC RANGE COMPRESSOR
// ================================================================
struct CompressorNode
{
    ma_node_base baseNode;
    float threshold, ratio, attackCoef, releaseCoef, makeupGain, envelope;
};

static void compressor_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn,
                               float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    CompressorNode *c = (CompressorNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 frameCount = *pFrameCountIn;
    *pFrameCountOut = frameCount;
    for (ma_uint32 i = 0; i < frameCount; ++i)
    {
        float L = pIn[i * 2];
        float R = pIn[i * 2 + 1];
        float level = fmaxf(fabsf(L), fabsf(R));
        float coef = (level > c->envelope) ? c->attackCoef : c->releaseCoef;
        c->envelope = c->envelope * coef + level * (1.0f - coef);
        float gain = 1.0f;
        if (c->envelope > c->threshold && c->envelope > 1e-6f)
        {
            float overDb = 20.0f * log10f(c->envelope / c->threshold);
            float reducedDb = overDb * (1.0f - 1.0f / c->ratio);
            gain = powf(10.0f, -reducedDb / 20.0f);
        }
        pOut[i * 2] = L * gain * c->makeupGain;
        pOut[i * 2 + 1] = R * gain * c->makeupGain;
    }
}
static ma_node_vtable g_compressor_vtable = {compressor_process, NULL, 1, 1, 0};

// ================================================================
// DYNAMIC ROUTING ENGINE
// NOTE: spatializer is ALWAYS attached — no is3DOn gate.
// ================================================================
void updateRouting(
    ma_sound *pSound,
    bool isRemasterOn, bool isUpscaleOn, bool isWidenOn,
    bool isReverbOn, bool isCompressOn,
    ma_node *pBass, ma_node *pTreble,
    ma_node *pExciter, ma_node *pWidener,
    ma_node *pSpatializer, ma_node *pReverb, ma_node *pCompressor,
    ma_engine *pEngine)
{
    ma_node_detach_output_bus((ma_node *)pSound, 0);
    ma_node_detach_output_bus(pTreble, 0);
    ma_node_detach_output_bus(pExciter, 0);
    ma_node_detach_output_bus(pWidener, 0);
    ma_node_detach_output_bus(pSpatializer, 0);
    ma_node_detach_output_bus(pReverb, 0);
    ma_node_detach_output_bus(pCompressor, 0);

    ma_node *cur = (ma_node *)pSound;

    if (isRemasterOn)
    {
        ma_node_attach_output_bus(cur, 0, pBass, 0);
        cur = pTreble;
    }
    if (isUpscaleOn)
    {
        ma_node_attach_output_bus(cur, 0, pExciter, 0);
        cur = pExciter;
    }
    if (isWidenOn)
    {
        ma_node_attach_output_bus(cur, 0, pWidener, 0);
        cur = pWidener;
    }

    // 3D spatializer: unconditionally wired in every configuration
    ma_node_attach_output_bus(cur, 0, pSpatializer, 0);
    cur = pSpatializer;

    if (isReverbOn)
    {
        ma_node_attach_output_bus(cur, 0, pReverb, 0);
        cur = pReverb;
    }
    if (isCompressOn)
    {
        ma_node_attach_output_bus(cur, 0, pCompressor, 0);
        cur = pCompressor;
    }

    ma_node_attach_output_bus(cur, 0, ma_engine_get_endpoint(pEngine), 0);
}

// ================================================================
// MAIN
// ================================================================
int main()
{
#ifdef _WIN32
    SetConsoleOutputCP(CP_UTF8);
    SetConsoleCP(CP_UTF8);
#endif

    ma_engine engine;
    ma_sound sound;
    bool isSoundInitialized = false;

    bool isRemasterOn = false;
    bool isUpscaleOn = false;
    bool isWidenOn = false;
    bool isReverbOn = false;
    bool isCompressOn = false;

    string lastLoadedPath;

    if (ma_engine_init(NULL, &engine) != MA_SUCCESS)
        return -1;

    ma_node_graph *pNodeGraph = ma_engine_get_node_graph(&engine);
    ma_uint32 channels = 2;
    ma_uint32 sampleRate = 48000;
    ma_uint32 inCh[1] = {channels};
    ma_uint32 outCh[1] = {channels};

    ma_loshelf_node_config bassConfig = ma_loshelf_node_config_init(channels, sampleRate, 8.0f, 1.0f, 80.0f);
    ma_loshelf_node bassNode;
    ma_loshelf_node_init(pNodeGraph, &bassConfig, NULL, &bassNode);
    ma_peak_node_config midConfig = ma_peak_node_config_init(channels, sampleRate, -5.0f, 1.0f, 400.0f);
    ma_peak_node midNode;
    ma_peak_node_init(pNodeGraph, &midConfig, NULL, &midNode);
    ma_hishelf_node_config trebleConfig = ma_hishelf_node_config_init(channels, sampleRate, -12.0f, 1.0f, 10000.0f);
    ma_hishelf_node trebleNode;
    ma_hishelf_node_init(pNodeGraph, &trebleConfig, NULL, &trebleNode);
    ma_node_attach_output_bus(&bassNode, 0, &midNode, 0);
    ma_node_attach_output_bus(&midNode, 0, &trebleNode, 0);

    HarmonicExciterNode exciterNode;
    memset(&exciterNode, 0, sizeof(exciterNode));
    ma_node_config exciterCfg = ma_node_config_init();
    exciterCfg.vtable = &g_exciter_vtable;
    exciterCfg.pInputChannels = inCh;
    exciterCfg.pOutputChannels = outCh;
    ma_node_init(pNodeGraph, &exciterCfg, NULL, &exciterNode.baseNode);
    exciterNode.drive = 0.0f;
    exciterNode.mix = 0.30f;

    StereoWidenerNode widenerNode;
    memset(&widenerNode, 0, sizeof(widenerNode));
    ma_node_config widenerCfg = ma_node_config_init();
    widenerCfg.vtable = &g_widener_vtable;
    widenerCfg.pInputChannels = inCh;
    widenerCfg.pOutputChannels = outCh;
    ma_node_init(pNodeGraph, &widenerCfg, NULL, &widenerNode.baseNode);
    widenerNode.width = 1.0f;

    Spatializer3DNode spatializerNode;
    memset(&spatializerNode, 0, sizeof(spatializerNode));
    ma_node_config spatializerCfg = ma_node_config_init();
    spatializerCfg.vtable = &g_spatializer3d_vtable;
    spatializerCfg.pInputChannels = inCh;
    spatializerCfg.pOutputChannels = outCh;
    ma_node_init(pNodeGraph, &spatializerCfg, NULL, &spatializerNode.baseNode);
    spatializerNode.crossMix = 0.12f; // Always-on floor
    spatializerNode.delayIdx = 0;

    ReverbNode reverbNode;
    memset(&reverbNode, 0, sizeof(reverbNode));
    reverbNode.roomSize = 0.84f;
    reverbNode.wetMix = 0.0f;
    reverbNode.damp = 0.50f;
    reverb_init_filters(&reverbNode);
    ma_node_config reverbCfg = ma_node_config_init();
    reverbCfg.vtable = &g_reverb_vtable;
    reverbCfg.pInputChannels = inCh;
    reverbCfg.pOutputChannels = outCh;
    ma_node_init(pNodeGraph, &reverbCfg, NULL, &reverbNode.baseNode);

    CompressorNode compressorNode;
    memset(&compressorNode, 0, sizeof(compressorNode));
    ma_node_config compressorCfg = ma_node_config_init();
    compressorCfg.vtable = &g_compressor_vtable;
    compressorCfg.pInputChannels = inCh;
    compressorCfg.pOutputChannels = outCh;
    ma_node_init(pNodeGraph, &compressorCfg, NULL, &compressorNode.baseNode);
    compressorNode.threshold = powf(10.0f, -18.0f / 20.0f);
    compressorNode.ratio = 4.0f;
    compressorNode.attackCoef = expf(-1.0f / (0.010f * (float)sampleRate));
    compressorNode.releaseCoef = expf(-1.0f / (0.150f * (float)sampleRate));
    compressorNode.makeupGain = 2.5f;
    compressorNode.envelope = 0.0f;

    cout << "READY" << endl;

    string command;
    while (cin >> command || !cin.eof())
    {
        if (cin.fail())
        {
            cin.clear();
            cin.ignore(10000, '\n');
            continue;
        }

#define REROUTE()                                                               \
    if (isSoundInitialized)                                                     \
    updateRouting(                                                              \
        &sound, isRemasterOn, isUpscaleOn, isWidenOn, isReverbOn, isCompressOn, \
        (ma_node *)&bassNode, (ma_node *)&trebleNode,                           \
        (ma_node *)&exciterNode, (ma_node *)&widenerNode,                       \
        (ma_node *)&spatializerNode, (ma_node *)&reverbNode, (ma_node *)&compressorNode, &engine)

        if (command == "LOAD")
        {
            string filepath;
            ws(cin);
            getline(cin, filepath);
            filepath.erase(filepath.find_last_not_of(" \n\r\t") + 1);
            if (filepath.empty())
                continue;
            if (isSoundInitialized)
            {
                ma_sound_stop(&sound);
                ma_sound_uninit(&sound);
                isSoundInitialized = false;
            }
            if (ma_sound_init_from_file(&engine, filepath.c_str(), MA_SOUND_FLAG_DECODE, NULL, NULL, &sound) == MA_SUCCESS)
            {
                isSoundInitialized = true;
                lastLoadedPath = filepath;
                REROUTE();
                cout << "LOADED_SUCCESSFULLY" << endl;
            }
            else
            {
                lastLoadedPath.clear();
            }
        }
        else if (command == "ANALYZE")
        {
            if (lastLoadedPath.empty())
            {
                cout << "FINGERPRINT_ERROR" << endl;
                continue;
            }
            ma_decoder_config decCfg = ma_decoder_config_init(ma_format_f32, 2, 48000);
            ma_decoder decoder;
            if (ma_decoder_init_file(lastLoadedPath.c_str(), &decCfg, &decoder) != MA_SUCCESS)
            {
                cout << "FINGERPRINT_ERROR" << endl;
                continue;
            }
            const ma_uint32 analyzeFrames = 48000 * 10;
            vector<float> buf(analyzeFrames * 2, 0.0f);
            ma_uint64 framesRead = 0;
            ma_decoder_read_pcm_frames(&decoder, buf.data(), analyzeFrames, &framesRead);
            ma_decoder_uninit(&decoder);
            if (framesRead < 4800)
            {
                cout << "FINGERPRINT_ERROR" << endl;
                continue;
            }
            double sumL2 = 0, sumR2 = 0, sumLR = 0, peak = 0, zcrCount = 0;
            float prevMono = 0.0f;
            for (ma_uint64 i = 0; i < framesRead; ++i)
            {
                float L = buf[i * 2], R = buf[i * 2 + 1];
                sumL2 += L * L;
                sumR2 += R * R;
                sumLR += L * R;
                float absMono = fabsf((L + R) * 0.5f);
                if (absMono > peak)
                    peak = absMono;
                float mono = (L + R) * 0.5f;
                if ((mono >= 0 && prevMono < 0) || (mono < 0 && prevMono >= 0))
                    zcrCount++;
                prevMono = mono;
            }
            double n = (double)framesRead;
            double rms = sqrt((sumL2 + sumR2) / (2.0 * n));
            double denom = sqrt(sumL2 * sumR2);
            double sc = (denom > 1e-12) ? (sumLR / denom) : 0.0;
            double cf = (rms > 1e-9) ? (20.0 * log10(peak / rms)) : 0.0;
            double zcr = zcrCount / n;
            cout << "FINGERPRINT " << sc << " " << cf << " " << zcr << " " << rms << endl;
        }
        else if (command == "REMASTER")
        {
            int t;
            cin >> t;
            isRemasterOn = (t == 1);
            REROUTE();
        }
        else if (command == "UPSCALE")
        {
            float d;
            cin >> d;
            exciterNode.drive = d;
            exciterNode.mix = (d > 0.0f) ? 0.30f : 0.0f;
            isUpscaleOn = (d > 0.01f);
            REROUTE();
        }
        else if (command == "WIDEN")
        {
            float w;
            cin >> w;
            widenerNode.width = w;
            isWidenOn = (w > 1.01f);
            REROUTE();
        }
        else if (command == "3D")
        {
            // extraVal 0.0-1.0 → real crossMix = 0.12 (floor) + extra * 0.26 (max 0.38)
            float e;
            cin >> e;
            spatializerNode.crossMix = 0.12f + (e * 0.26f);
        }
        else if (command == "REVERB")
        {
            float w;
            cin >> w;
            reverbNode.wetMix = w;
            isReverbOn = (w > 0.005f);
            REROUTE();
        }
        else if (command == "COMPRESS")
        {
            int t;
            cin >> t;
            isCompressOn = (t == 1);
            REROUTE();
        }
        else if (command == "VOLUME")
        {
            float v;
            cin >> v;
            ma_engine_set_volume(&engine, v);
        }
        else if (command == "GET_TIME" && isSoundInitialized)
        {
            float cur = 0, len = 0;
            ma_sound_get_cursor_in_seconds(&sound, &cur);
            ma_sound_get_length_in_seconds(&sound, &len);
            cout << "TIME " << cur << " " << len << endl;
        }
        else if (command == "PLAY" && isSoundInitialized)
        {
            ma_sound_start(&sound);
        }
        else if (command == "PAUSE" && isSoundInitialized)
        {
            ma_sound_stop(&sound);
        }
        else if (command == "SEEK" && isSoundInitialized)
        {
            float s;
            cin >> s;
            ma_sound_seek_to_pcm_frame(&sound, (ma_uint64)(s * (float)sampleRate));
        }
        else if (command == "QUIT")
        {
            break;
        }
#undef REROUTE
    }

    if (isSoundInitialized)
        ma_sound_uninit(&sound);
    ma_hishelf_node_uninit(&trebleNode, NULL);
    ma_peak_node_uninit(&midNode, NULL);
    ma_loshelf_node_uninit(&bassNode, NULL);
    ma_node_uninit(&exciterNode.baseNode, NULL);
    ma_node_uninit(&widenerNode.baseNode, NULL);
    ma_node_uninit(&spatializerNode.baseNode, NULL);
    ma_node_uninit(&reverbNode.baseNode, NULL);
    ma_node_uninit(&compressorNode.baseNode, NULL);
    ma_engine_uninit(&engine);
    return 0;
}