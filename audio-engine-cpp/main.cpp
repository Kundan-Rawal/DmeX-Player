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
static std::atomic<float> g_audioLevel{0.0f};

// ================================================================
// DSP NODE PROCESS CALLBACKS
// ================================================================
struct HarmonicExciterNode
{
    ma_node_base baseNode;
    float drive;
    float mix;
};
static void exciter_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    HarmonicExciterNode *p = (HarmonicExciterNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;
    for (ma_uint32 i = 0; i < fc * 2; ++i)
        pOut[i] = (pIn[i] * (1.0f - p->mix)) + (std::tanh(pIn[i] * p->drive) * p->mix);
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
struct Spatializer3DNode
{
    ma_node_base baseNode;
    float delayBufL[CROSSFEED_DELAY_SAMPLES];
    float delayBufR[CROSSFEED_DELAY_SAMPLES];
    int delayIdx;
    float crossMix;
};
static void spatializer3d_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    Spatializer3DNode *p = (Spatializer3DNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;
    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float L = pIn[i * 2], R = pIn[i * 2 + 1];
        float dL = p->delayBufL[p->delayIdx], dR = p->delayBufR[p->delayIdx];
        p->delayBufL[p->delayIdx] = L;
        p->delayBufR[p->delayIdx] = R;
        p->delayIdx = (p->delayIdx + 1) % CROSSFEED_DELAY_SAMPLES;
        pOut[i * 2] = L + p->crossMix * dR;
        pOut[i * 2 + 1] = R + p->crossMix * dL;

        float peak = fmaxf(fabsf(pOut[i * 2]), fabsf(pOut[i * 2 + 1]));
        float cur = g_audioLevel.load(std::memory_order_relaxed);
        float next = (peak > cur) ? (cur * 0.70f + peak * 0.30f) : (cur * 0.985f);
        g_audioLevel.store(next, std::memory_order_relaxed);
    }
}
static ma_node_vtable g_spatializer3d_vtable = {spatializer3d_process, NULL, 1, 1, 0};

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

struct LimiterNode
{
    ma_node_base baseNode;
    float ceiling;     // absolute digital ceiling (0.98f)
    float userBoost;   // base multiplier set by UI intensity slider
    float gainEnv;     // current smoothed gain reduction envelope (starts at 1.0)
    float attackCoef;  // fast attack — catches peaks before they clip
    float releaseCoef; // slow release — smooth recovery, no pumping artifacts
    float rmsAccum;    // squared sample accumulator for RMS window
    int rmsSamples;    // sample counter for RMS measurement window
    float autoGain;    // auto-leveling gain derived from short-term RMS analysis
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
        float iL = pIn[i * 2], iR = pIn[i * 2 + 1], mid = (iL + iR) * 0.5f, side = (iL - iR) * 0.5f, feed = (mid * 0.2f) + (side * 0.8f);
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

struct CompressorNode
{
    ma_node_base baseNode;
    float threshold, ratio, attackCoef, releaseCoef, makeupGain, envelope;
};
static void compressor_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    CompressorNode *c = (CompressorNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;
    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float L = pIn[i * 2], R = pIn[i * 2 + 1], lv = fmaxf(fabsf(L), fabsf(R));
        float coef = (lv > c->envelope) ? c->attackCoef : c->releaseCoef;
        c->envelope = c->envelope * coef + lv * (1 - coef);
        float gain = 1.0f;
        if (c->envelope > c->threshold && c->envelope > 1e-6f)
        {
            float odb = 20 * log10f(c->envelope / c->threshold);
            gain = powf(10, -odb * (1 - 1 / c->ratio) / 20);
        }
        pOut[i * 2] = L * gain * c->makeupGain;
        pOut[i * 2 + 1] = R * gain * c->makeupGain;
    }
}
static ma_node_vtable g_compressor_vtable = {compressor_process, NULL, 1, 1, 0};

static void limiter_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    LimiterNode *p = (LimiterNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    // Soft-knee zone: limiting begins 0.15 below the ceiling (~0.83)
    // This gives a smooth curve into the limit instead of a hard wall
    const float ceil = p->ceiling;
    const float kneeWidth = 0.15f;
    const float kneeStart = ceil - kneeWidth;

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        // Step 1: Apply user boost multiplied by auto-gain riding
        // autoGain is continuously re-learned from the song's own RMS —
        // quiet songs get more boost, already-loud songs get less.
        float L = pIn[i * 2] * p->userBoost * p->autoGain;
        float R = pIn[i * 2 + 1] * p->userBoost * p->autoGain;

        // Step 2: True peak detection on the boosted signal
        float peak = fmaxf(fabsf(L), fabsf(R));

        // Step 3: Soft-knee gain target
        // Below kneeStart  → pass through untouched (targetGain = 1.0)
        // In the knee zone → smooth hyperbolic curve, no hard edge
        // Above ceiling    → hard safety catch (inter-sample peaks)
        float targetGain = 1.0f;
        if (peak > kneeStart && peak > 1e-6f)
        {
            // x goes 0→1 across the knee zone
            float x = (peak - kneeStart) / kneeWidth;
            // Smooth asymptotic curve: approaches but never reaches ceiling
            float softCeil = kneeStart + kneeWidth * x / (1.0f + x);
            targetGain = softCeil / peak;
        }
        // Hard safety clamp — catches any inter-sample overshoot
        if (peak * targetGain > ceil && peak > 1e-6f)
            targetGain = ceil / peak;

        // Step 4: Asymmetric envelope smoothing
        // Fast attack (1.5ms) catches peaks before they distort.
        // Slow release (200ms) recovers smoothly — no "breathing" pumping.
        float coef = (targetGain < p->gainEnv) ? p->attackCoef : p->releaseCoef;
        p->gainEnv = p->gainEnv * coef + targetGain * (1.0f - coef);

        pOut[i * 2] = L * p->gainEnv;
        pOut[i * 2 + 1] = R * p->gainEnv;

        // Step 5: RMS accumulation — measure loudness over a ~50ms window
        p->rmsAccum += L * L + R * R;
        p->rmsSamples += 2;

        if (p->rmsSamples >= 4410) // 50ms window at 44100Hz
        {
            float rms = sqrtf(p->rmsAccum / (float)p->rmsSamples);
            if (rms > 0.002f) // skip silence — don't boost noise floor
            {
                // Target loudness: -13dBFS (0.224f RMS)
                // This is loud and present without straining the speaker coil
                float ideal = 0.224f / rms;
                // Clamp: never less than 0.6x (prevents volume collapse on loud songs)
                //        never more than 3.0x (prevents nuclear boost on silent passages)
                ideal = fmaxf(0.6f, fminf(3.0f, ideal));
                // Slow 5% blend per window — gain rides the track smoothly
                // without lurching or reacting to individual transients
                p->autoGain = p->autoGain * 0.95f + ideal * 0.05f;
            }
            p->rmsAccum = 0.0f;
            p->rmsSamples = 0;
        }
    }
}
static ma_node_vtable g_limiter_vtable = {limiter_process, NULL, 1, 1, 0};

// ================================================================
// GLOBAL STATE
// ================================================================
static ma_uint32 g_channels = 2;
static ma_uint32 g_inCh[1] = {2};
static ma_uint32 g_outCh[1] = {2};

static bool g_isLimiterOn = false;
static LimiterNode g_limiterNode;

static ma_engine g_engine;
static ma_sound g_sound;
static bool g_soundInitialized = false;
static bool g_engineInitialized = false;

static float g_bassGain = 0.0f;
static bool g_isRemasterOn = false;
static bool g_isUpscaleOn = false;
static bool g_isWidenOn = false;
static bool g_isReverbOn = false;
static bool g_isCompressOn = false;

// static ma_loshelf_node g_bassNode;
static ma_loshelf_node g_bassNode; // Remaster chain bass shelf
static ma_peak_node g_midNode;
static ma_hishelf_node g_trebleNode;
static ma_peak_node g_subwooferNode; // Dedicated, isolated subwoofer
static HarmonicExciterNode g_exciterNode;
static StereoWidenerNode g_widenerNode;
static Spatializer3DNode g_spatializerNode;
static ReverbNode g_reverbNode;
static CompressorNode g_compressorNode;

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
    (void)pChannelMap; // Silence unused parameter warning
    (void)cmCap;       // Silence unused parameter warning

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

// 2. UPDATE THE VTABLE TO INCLUDE IT (Replace the old g_mem_vtable line with this)
static ma_data_source_vtable g_mem_vtable = {mem_ds_read, mem_ds_seek, mem_ds_get_format, mem_ds_get_cursor, mem_ds_get_length, NULL};
static MemoryDataSource g_symSource;
static bool g_usingSymphonia = false;
// ================================================================
// ROUTING & INIT
// ================================================================
static void updateRouting()
{
    if (!g_soundInitialized)
        return;
    ma_node_detach_output_bus((ma_node *)&g_sound, 0);
    ma_node_detach_output_bus((ma_node *)&g_trebleNode, 0);
    ma_node_detach_output_bus((ma_node *)&g_subwooferNode, 0);
    ma_node_detach_output_bus((ma_node *)&g_exciterNode, 0);
    ma_node_detach_output_bus((ma_node *)&g_widenerNode, 0);
    ma_node_detach_output_bus((ma_node *)&g_spatializerNode, 0);
    ma_node_detach_output_bus((ma_node *)&g_reverbNode, 0);
    ma_node_detach_output_bus((ma_node *)&g_compressorNode, 0);

    ma_node *cur = (ma_node *)&g_sound;
    if (g_isRemasterOn)
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

    ma_node_attach_output_bus(cur, 0, &g_spatializerNode, 0);
    cur = (ma_node *)&g_spatializerNode;

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
    if (g_isLimiterOn)
    {
        ma_node_attach_output_bus(cur, 0, &g_limiterNode, 0);
        cur = (ma_node *)&g_limiterNode;
    }

    ma_node_attach_output_bus(cur, 0, ma_engine_get_endpoint(&g_engine), 0);
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

        // Remaster chain — loshelf is correct here, warm analog character
        ma_loshelf_node_config bc = ma_loshelf_node_config_init(g_channels, sr, 8.0f, 1.0f, 80.0f);
        ma_loshelf_node_init(pg, &bc, NULL, &g_bassNode);
        ma_peak_node_config mc2 = ma_peak_node_config_init(g_channels, sr, -5.0f, 1.0f, 400.0f);
        ma_peak_node_init(pg, &mc2, NULL, &g_midNode);
        ma_hishelf_node_config tc = ma_hishelf_node_config_init(g_channels, sr, -12.0f, 1.0f, 10000.0f);
        ma_hishelf_node_init(pg, &tc, NULL, &g_trebleNode);
        ma_node_attach_output_bus(&g_bassNode, 0, &g_midNode, 0);
        ma_node_attach_output_bus(&g_midNode, 0, &g_trebleNode, 0);

        // Dedicated subwoofer — completely separate node, zero gain until slider moves
        ma_peak_node_config subCfg = ma_peak_node_config_init(g_channels, sr, 0.0f, 1.2f, 65.0f);
        ma_peak_node_init(pg, &subCfg, NULL, &g_subwooferNode);

        memset(&g_exciterNode, 0, sizeof(g_exciterNode));
        ma_node_config c1 = ma_node_config_init();
        c1.vtable = &g_exciter_vtable;
        c1.pInputChannels = g_inCh;
        c1.pOutputChannels = g_outCh;
        ma_node_init(pg, &c1, NULL, &g_exciterNode.baseNode);
        g_exciterNode.drive = 0;
        g_exciterNode.mix = 0.30f;

        memset(&g_widenerNode, 0, sizeof(g_widenerNode));
        ma_node_config c2 = ma_node_config_init();
        c2.vtable = &g_widener_vtable;
        c2.pInputChannels = g_inCh;
        c2.pOutputChannels = g_outCh;
        ma_node_init(pg, &c2, NULL, &g_widenerNode.baseNode);
        g_widenerNode.width = 1.0f;

        memset(&g_spatializerNode, 0, sizeof(g_spatializerNode));
        ma_node_config c3 = ma_node_config_init();
        c3.vtable = &g_spatializer3d_vtable;
        c3.pInputChannels = g_inCh;
        c3.pOutputChannels = g_outCh;
        ma_node_init(pg, &c3, NULL, &g_spatializerNode.baseNode);
        g_spatializerNode.crossMix = 0.12f;
        g_spatializerNode.delayIdx = 0;

        memset(&g_reverbNode, 0, sizeof(g_reverbNode));
        g_reverbNode.roomSize = 0.84f;
        g_reverbNode.wetMix = 0;
        g_reverbNode.damp = 0.50f;
        reverb_init_filters(&g_reverbNode);
        ma_node_config c4 = ma_node_config_init();
        c4.vtable = &g_reverb_vtable;
        c4.pInputChannels = g_inCh;
        c4.pOutputChannels = g_outCh;
        ma_node_init(pg, &c4, NULL, &g_reverbNode.baseNode);

        memset(&g_compressorNode, 0, sizeof(g_compressorNode));
        ma_node_config c5 = ma_node_config_init();
        c5.vtable = &g_compressor_vtable;
        c5.pInputChannels = g_inCh;
        c5.pOutputChannels = g_outCh;
        ma_node_init(pg, &c5, NULL, &g_compressorNode.baseNode);
        g_compressorNode.threshold = powf(10.0f, -18.0f / 20.0f);
        g_compressorNode.ratio = 4.0f;
        g_compressorNode.attackCoef = expf(-1.0f / (0.010f * (float)sr));
        g_compressorNode.releaseCoef = expf(-1.0f / (0.150f * (float)sr));
        g_compressorNode.makeupGain = 2.5f;

        // Initialize the Adaptive Loudness Maximizer
        memset(&g_limiterNode, 0, sizeof(g_limiterNode));
        ma_node_config c6 = ma_node_config_init();
        c6.vtable = &g_limiter_vtable;
        c6.pInputChannels = g_inCh;
        c6.pOutputChannels = g_outCh;
        ma_node_init(pg, &c6, NULL, &g_limiterNode.baseNode);
        g_limiterNode.ceiling = 0.98f;                                  // absolute digital ceiling
        g_limiterNode.userBoost = 1.6f;                                 // conservative base — autoGain does the heavy lifting
        g_limiterNode.gainEnv = 1.0f;                                   // start with full gain, let envelope settle
        g_limiterNode.autoGain = 1.0f;                                  // start neutral, RMS riding kicks in after 50ms
        g_limiterNode.attackCoef = expf(-1.0f / (0.0015f * (float)sr)); // 1.5ms attack
        g_limiterNode.releaseCoef = expf(-1.0f / (0.200f * (float)sr)); // 200ms release
        g_limiterNode.rmsAccum = 0.0f;
        g_limiterNode.rmsSamples = 0;
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

            // STEP 1: Always try Rust Symphonia first (Fixes .m4a and .mp3 perfectly)
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
        }
        else if (command == "REMASTER")
        {
            g_isRemasterOn = (stoi(args) == 1);
            updateRouting();
        }
        else if (command == "COMPRESS")
        {
            g_isCompressOn = (stoi(args) == 1);
            updateRouting();
        }
        else if (command == "UPSCALE")
        {
            float d = stof(args);
            g_exciterNode.drive = d;
            g_exciterNode.mix = (d > 0) ? 0.30f : 0;
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
            g_spatializerNode.crossMix = 0.12f + (stof(args) * 0.26f);
        }
        else if (command == "REVERB")
        {
            float w = stof(args);
            g_reverbNode.wetMix = w;
            g_isReverbOn = (w > 0.005f);
            updateRouting();
        }
        else if (command == "BASS")
        {
            g_bassGain = stof(args);
            ma_uint32 sr = ma_engine_get_sample_rate(&g_engine);

            // 1. We now use a PEAK config for a tight, punchy bell curve
            ma_peak_config cfg;
            memset(&cfg, 0, sizeof(cfg));
            cfg.format = ma_format_f32;
            cfg.channels = g_channels;
            cfg.sampleRate = sr;
            cfg.gainDB = g_bassGain * 14.0f; // Max 14dB peak boost
            cfg.q = 1.2f;                    // Tight bell curve (prevents mid-bass mud)
            cfg.frequency = 65.0f;           // Exact "chest punch" / kick drum frequency

            // 2. Re-initialize the Peak node
            ma_peak_node_reinit(&cfg, &g_subwooferNode);

            updateRouting();
        }
        else if (command == "LIMITER")
        {
            float val = stof(args);
            if (val < 0.01f)
            {
                g_isLimiterOn = false;
            }
            else
            {
                g_isLimiterOn = true;
                // Map UI value 0.0–1.0 → userBoost range 1.2x–2.6x
                // autoGain handles the per-song leveling on top of this.
                // Lower end (1.2x) = warm, gentle loudness for earphones.
                // Upper end (2.6x) = maximum push for phone speakers.
                g_limiterNode.userBoost = 1.2f + (val * 1.4f);
                // Reset autoGain so it re-learns the new song/intensity quickly
                g_limiterNode.autoGain = 1.0f;
                g_limiterNode.gainEnv = 1.0f;
            }
            updateRouting();
        }
    }

    void get_audio_metrics(float *curTime, float *len, float *level)
    {
        if (!g_soundInitialized || !g_engineInitialized)
        {
            *curTime = 0;
            *len = 0;
            *level = 0;
            return;
        }

        // 3. BYPASS MINIAUDIO AND READ DIRECTLY FROM OUR RAM BUFFER
        if (g_usingSymphonia && g_symSource.buffer)
        {
            *curTime = (float)g_symSource.cursor_frames / (float)g_symSource.buffer->sample_rate;
            *len = (float)(g_symSource.buffer->total_samples / g_symSource.buffer->channels) / (float)g_symSource.buffer->sample_rate;
        }
        else
        {
            ma_sound_get_cursor_in_seconds(&g_sound, curTime);
            ma_sound_get_length_in_seconds(&g_sound, len);
        }

        *level = g_audioLevel.load(std::memory_order_relaxed);
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