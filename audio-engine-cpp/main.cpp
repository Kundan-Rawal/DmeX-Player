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
// FORWARD DECLARATION — g_audioLevel used in spatializer callback
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
static void exciter_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn,
                            float **ppFramesOut, ma_uint32 *pFrameCountOut)
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
static void spatializer3d_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn,
                                  float **ppFramesOut, ma_uint32 *pFrameCountOut)
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

        // Level meter with peak-hold: fast attack (0.3), slow release (0.015 per frame)
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
static void compressor_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn,
                               float **ppFramesOut, ma_uint32 *pFrameCountOut)
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

// ================================================================
// GLOBAL STATE
//
// FIX A: inCh/outCh are GLOBAL, not stack-local.
// The old code declared these as local variables inside init_audio_engine()
// then stored their addresses (pInputChannels / pOutputChannels) in node
// configs. After the function returned, the stack was reclaimed and those
// pointers became dangling — classic UB that manifests as SIGSEGV.
// ================================================================
static ma_uint32 g_channels = 2;
static ma_uint32 g_inCh[1] = {2};
static ma_uint32 g_outCh[1] = {2};

static ma_engine g_engine;
static ma_sound g_sound;
static bool g_soundInitialized = false;
static bool g_engineInitialized = false;

static bool g_isRemasterOn = false;
static bool g_isUpscaleOn = false;
static bool g_isWidenOn = false;
static bool g_isReverbOn = false;
static bool g_isCompressOn = false;

static ma_loshelf_node g_bassNode;
static ma_peak_node g_midNode;
static ma_hishelf_node g_trebleNode;
static HarmonicExciterNode g_exciterNode;
static StereoWidenerNode g_widenerNode;
static Spatializer3DNode g_spatializerNode;
static ReverbNode g_reverbNode;
static CompressorNode g_compressorNode;

static string g_lastLoadedPath;
static std::mutex g_pathMutex;

// ================================================================
// ROUTING (internal)
// ================================================================
static void updateRouting()
{
    if (!g_soundInitialized)
        return;
    ma_node_detach_output_bus((ma_node *)&g_sound, 0);
    ma_node_detach_output_bus((ma_node *)&g_trebleNode, 0);
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
    // Spatializer: always in chain (level meter lives here)
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
    ma_node_attach_output_bus(cur, 0, ma_engine_get_endpoint(&g_engine), 0);
}

// ================================================================
// EXPORTED C BINDINGS
// ================================================================
extern "C"
{

    // FIX B: init_audio_engine is idempotent (safe to call multiple times)
    // and is called LAZILY on first audio_command — NOT from Tauri setup().
    //
    // On Android, ma_engine_init() must be called AFTER the Activity starts
    // and the audio subsystem (AAudio / OpenSL ES) is ready. Calling it from
    // setup() — which runs during JNI initialization before Activity.onCreate()
    // completes — causes the JavaBridge thread to fault at 0x7c00000000
    // because AAudio's binder connection hasn't been established yet.
    void init_audio_engine()
    {
        if (g_engineInitialized)
            return;

        ma_engine_config cfg = ma_engine_config_init();
        // 44100 Hz matches Android's native mixing rate → avoids SRC overhead
        cfg.sampleRate = 44100;
        // Let miniaudio choose: AAudio on Android ≥ 8.0, OpenSL ES as fallback
        // (MA_BACKEND_AAUDIO / MA_BACKEND_OPENSL are the Android backends)

        if (ma_engine_init(&cfg, &g_engine) != MA_SUCCESS)
            return;
        g_engineInitialized = true;

        // Sync global channel arrays with what the engine actually opened
        g_channels = ma_engine_get_channels(&g_engine);
        g_inCh[0] = g_channels;
        g_outCh[0] = g_channels;

        ma_node_graph *pg = ma_engine_get_node_graph(&g_engine);
        ma_uint32 sr = ma_engine_get_sample_rate(&g_engine);

        // EQ chain
        ma_loshelf_node_config bc = ma_loshelf_node_config_init(g_channels, sr, 8.0f, 1.0f, 80.0f);
        ma_loshelf_node_init(pg, &bc, NULL, &g_bassNode);
        ma_peak_node_config mc2 = ma_peak_node_config_init(g_channels, sr, -5.0f, 1.0f, 400.0f);
        ma_peak_node_init(pg, &mc2, NULL, &g_midNode);
        ma_hishelf_node_config tc = ma_hishelf_node_config_init(g_channels, sr, -12.0f, 1.0f, 10000.0f);
        ma_hishelf_node_init(pg, &tc, NULL, &g_trebleNode);
        ma_node_attach_output_bus(&g_bassNode, 0, &g_midNode, 0);
        ma_node_attach_output_bus(&g_midNode, 0, &g_trebleNode, 0);

        // Exciter
        memset(&g_exciterNode, 0, sizeof(g_exciterNode));
        {
            ma_node_config c = ma_node_config_init();
            c.vtable = &g_exciter_vtable;
            c.pInputChannels = g_inCh;
            c.pOutputChannels = g_outCh;
            ma_node_init(pg, &c, NULL, &g_exciterNode.baseNode);
            g_exciterNode.drive = 0;
            g_exciterNode.mix = 0.30f;
        }

        // Widener
        memset(&g_widenerNode, 0, sizeof(g_widenerNode));
        {
            ma_node_config c = ma_node_config_init();
            c.vtable = &g_widener_vtable;
            c.pInputChannels = g_inCh;
            c.pOutputChannels = g_outCh;
            ma_node_init(pg, &c, NULL, &g_widenerNode.baseNode);
            g_widenerNode.width = 1.0f;
        }

        // Spatializer (always in chain — level meter runs here)
        memset(&g_spatializerNode, 0, sizeof(g_spatializerNode));
        {
            ma_node_config c = ma_node_config_init();
            c.vtable = &g_spatializer3d_vtable;
            c.pInputChannels = g_inCh;
            c.pOutputChannels = g_outCh;
            ma_node_init(pg, &c, NULL, &g_spatializerNode.baseNode);
            g_spatializerNode.crossMix = 0.12f;
            g_spatializerNode.delayIdx = 0;
        }

        // Reverb
        memset(&g_reverbNode, 0, sizeof(g_reverbNode));
        g_reverbNode.roomSize = 0.84f;
        g_reverbNode.wetMix = 0;
        g_reverbNode.damp = 0.50f;
        reverb_init_filters(&g_reverbNode);
        {
            ma_node_config c = ma_node_config_init();
            c.vtable = &g_reverb_vtable;
            c.pInputChannels = g_inCh;
            c.pOutputChannels = g_outCh;
            ma_node_init(pg, &c, NULL, &g_reverbNode.baseNode);
        }

        // Compressor
        memset(&g_compressorNode, 0, sizeof(g_compressorNode));
        {
            ma_node_config c = ma_node_config_init();
            c.vtable = &g_compressor_vtable;
            c.pInputChannels = g_inCh;
            c.pOutputChannels = g_outCh;
            ma_node_init(pg, &c, NULL, &g_compressorNode.baseNode);
            g_compressorNode.threshold = powf(10.0f, -18.0f / 20.0f);
            g_compressorNode.ratio = 4.0f;
            g_compressorNode.attackCoef = expf(-1.0f / (0.010f * (float)sr));
            g_compressorNode.releaseCoef = expf(-1.0f / (0.150f * (float)sr));
            g_compressorNode.makeupGain = 2.5f;
        }
    }

    void execute_audio_command(const char *cmd_in)
    {
        // Lazy init — safe to call from any thread, idempotent
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
                g_soundInitialized = false;
            }
            g_audioLevel.store(0.0f, std::memory_order_relaxed);

// Platform-adaptive loading strategy:
//
// Android → MA_SOUND_FLAG_STREAM
//   Mobile ARM CPUs are ~10x slower at MP3 decoding than desktop.
//   DECODE blocked the IPC thread 10-14s decoding a full MP3 to PCM.
//   STREAM decodes incrementally in the audio I/O thread → <100ms load.
//   Trade-off: ma_sound_get_length_in_seconds() returns 0 for ~100ms
//   after LOAD; JS polling guards this with "if (m[1] > 0)".
//
// Desktop → MA_SOUND_FLAG_DECODE
//   Desktop CPUs decode a full MP3 in <500ms — acceptable latency.
//   The fully-decoded PCM buffer in RAM gives instant seeking with no
//   gap or stutter, and eliminates per-buffer disk reads during playback.
//
// __ANDROID__ is defined automatically by the Android NDK (clang).
// On Windows / Linux / macOS it is never defined.
#ifdef __ANDROID__
            const ma_uint32 loadFlags = MA_SOUND_FLAG_STREAM;
#else
            const ma_uint32 loadFlags = MA_SOUND_FLAG_DECODE;
#endif

            if (ma_sound_init_from_file(&g_engine, args.c_str(), loadFlags, NULL, NULL, &g_sound) == MA_SUCCESS)
            {
                g_soundInitialized = true;
                {
                    std::lock_guard<std::mutex> lk(g_pathMutex);
                    g_lastLoadedPath = args;
                }
                updateRouting();
            }
            else
            {
                std::lock_guard<std::mutex> lk(g_pathMutex);
                g_lastLoadedPath.clear();
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
        ma_sound_get_cursor_in_seconds(&g_sound, curTime);
        // With MA_SOUND_FLAG_STREAM the length starts at 0 and becomes available
        // once the decoder has read the file header (~50-200ms after LOAD).
        // We return whatever value is available — JS ignores 0-values for duration.
        ma_sound_get_length_in_seconds(&g_sound, len);
        *level = g_audioLevel.load(std::memory_order_relaxed);
    }

    bool analyze_audio(float *sc_out, float *cf_out, float *zcr_out, float *rms_out)
    {
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
            ma_result r = ma_decoder_read_pcm_frames(&dec, buf.data(), want, &got);
            if (!got)
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
            if (r != MA_SUCCESS)
                break;
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