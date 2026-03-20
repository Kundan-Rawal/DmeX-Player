#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"
#include <string>
#include <cmath>
#include <cstring>
#include <vector>

using namespace std;

// ================================================================
// ENGINE A-E: DSP NODES (Untouched, perfect math)
// ================================================================
struct HarmonicExciterNode { ma_node_base baseNode; float drive; float mix; };
static void exciter_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut) {
    HarmonicExciterNode *p = (HarmonicExciterNode *)pNode; const float *pIn = ppFramesIn[0]; float *pOut = ppFramesOut[0];
    ma_uint32 frameCount = *pFrameCountIn; *pFrameCountOut = frameCount;
    for (ma_uint32 i = 0; i < frameCount * 2; ++i) pOut[i] = (pIn[i] * (1.0f - p->mix)) + (std::tanh(pIn[i] * p->drive) * p->mix);
}
static ma_node_vtable g_exciter_vtable = {exciter_process, NULL, 1, 1, 0};

struct StereoWidenerNode { ma_node_base baseNode; float width; };
static void widener_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut) {
    StereoWidenerNode *p = (StereoWidenerNode *)pNode; const float *pIn = ppFramesIn[0]; float *pOut = ppFramesOut[0];
    ma_uint32 frameCount = *pFrameCountIn; *pFrameCountOut = frameCount;
    for (ma_uint32 i = 0; i < frameCount; ++i) {
        float L = pIn[i * 2], R = pIn[i * 2 + 1];
        float M = (L + R) * 0.5f, S = (L - R) * 0.5f, midComp = 1.0f + ((p->width - 1.0f) * 0.20f);
        pOut[i * 2] = (M * midComp) + (p->width * S); pOut[i * 2 + 1] = (M * midComp) - (p->width * S);
    }
}
static ma_node_vtable g_widener_vtable = {widener_process, NULL, 1, 1, 0};

#define CROSSFEED_DELAY_SAMPLES 72
struct Spatializer3DNode { ma_node_base baseNode; float delayBufL[CROSSFEED_DELAY_SAMPLES]; float delayBufR[CROSSFEED_DELAY_SAMPLES]; int delayIdx; float crossMix; };
static void spatializer3d_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut) {
    Spatializer3DNode *p = (Spatializer3DNode *)pNode; const float *pIn = ppFramesIn[0]; float *pOut = ppFramesOut[0];
    ma_uint32 frameCount = *pFrameCountIn; *pFrameCountOut = frameCount;
    for (ma_uint32 i = 0; i < frameCount; ++i) {
        float L = pIn[i * 2], R = pIn[i * 2 + 1];
        float delayedL = p->delayBufL[p->delayIdx], delayedR = p->delayBufR[p->delayIdx];
        p->delayBufL[p->delayIdx] = L; p->delayBufR[p->delayIdx] = R;
        p->delayIdx = (p->delayIdx + 1) % CROSSFEED_DELAY_SAMPLES;
        pOut[i * 2] = L + p->crossMix * delayedR; pOut[i * 2 + 1] = R + p->crossMix * delayedL;
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
struct CombFilter { float buf[MAX_COMB_BUF]; int size, idx; float feedback, damp, store; };
struct AllPassFilter { float buf[MAX_AP_BUF]; int size, idx; float feedback; };
struct ReverbNode { ma_node_base baseNode; CombFilter combL[4], combR[4]; AllPassFilter apL[2], apR[2]; float roomSize, wetMix, damp; };
static void comb_init(CombFilter *c, int size, float fb, float damp) { memset(c->buf, 0, sizeof(c->buf)); c->size = size; c->idx = 0; c->feedback = fb; c->damp = damp; c->store = 0.0f; }
static float comb_tick(CombFilter *c, float in) { float out = c->buf[c->idx]; c->store = out * (1.0f - c->damp) + c->store * c->damp; c->buf[c->idx] = in + c->store * c->feedback; c->idx = (c->idx + 1) % c->size; return out; }
static void ap_init(AllPassFilter *a, int size, float fb) { memset(a->buf, 0, sizeof(a->buf)); a->size = size; a->idx = 0; a->feedback = fb; }
static float ap_tick(AllPassFilter *a, float in) { float bufout = a->buf[a->idx]; a->buf[a->idx] = in + bufout * a->feedback; a->idx = (a->idx + 1) % a->size; return bufout - in; }
static void reverb_init_filters(ReverbNode *r) {
    float fb = r->roomSize, dp = r->damp;
    comb_init(&r->combL[0], COMB1, fb, dp); comb_init(&r->combL[1], COMB2, fb, dp); comb_init(&r->combL[2], COMB3, fb, dp); comb_init(&r->combL[3], COMB4, fb, dp);
    comb_init(&r->combR[0], COMB1 + 23, fb, dp); comb_init(&r->combR[1], COMB2 + 23, fb, dp); comb_init(&r->combR[2], COMB3 + 23, fb, dp); comb_init(&r->combR[3], COMB4 + 23, fb, dp);
    ap_init(&r->apL[0], AP1, 0.5f); ap_init(&r->apL[1], AP2, 0.5f); ap_init(&r->apR[0], AP1 + 11, 0.5f); ap_init(&r->apR[1], AP2 + 11, 0.5f);
}
static void reverb_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut) {
    ReverbNode *r = (ReverbNode *)pNode; const float *pIn = ppFramesIn[0]; float *pOut = ppFramesOut[0];
    ma_uint32 frameCount = *pFrameCountIn; *pFrameCountOut = frameCount; float dry = 1.0f - r->wetMix;
    for (ma_uint32 i = 0; i < frameCount; ++i) {
        float inL = pIn[i * 2], inR = pIn[i * 2 + 1];
        float mid = (inL + inR) * 0.5f, side = (inL - inR) * 0.5f, feed = (mid * 0.2f) + (side * 0.8f);
        float outL = 0.0f, outR = 0.0f;
        for (int j = 0; j < 4; ++j) { outL += comb_tick(&r->combL[j], feed); outR += comb_tick(&r->combR[j], feed); }
        outL *= 0.25f; outR *= 0.25f;
        outL = ap_tick(&r->apL[0], outL); outL = ap_tick(&r->apL[1], outL); outR = ap_tick(&r->apR[0], outR); outR = ap_tick(&r->apR[1], outR);
        pOut[i * 2] = (inL * dry) + (outL * r->wetMix); pOut[i * 2 + 1] = (inR * dry) + (outR * r->wetMix);
    }
}
static ma_node_vtable g_reverb_vtable = {reverb_process, NULL, 1, 1, 0};

struct CompressorNode { ma_node_base baseNode; float threshold, ratio, attackCoef, releaseCoef, makeupGain, envelope; };
static void compressor_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut) {
    CompressorNode *c = (CompressorNode *)pNode; const float *pIn = ppFramesIn[0]; float *pOut = ppFramesOut[0];
    ma_uint32 frameCount = *pFrameCountIn; *pFrameCountOut = frameCount;
    for (ma_uint32 i = 0; i < frameCount; ++i) {
        float L = pIn[i * 2], R = pIn[i * 2 + 1], level = fmaxf(fabsf(L), fabsf(R));
        float coef = (level > c->envelope) ? c->attackCoef : c->releaseCoef;
        c->envelope = c->envelope * coef + level * (1.0f - coef);
        float gain = 1.0f;
        if (c->envelope > c->threshold && c->envelope > 1e-6f) {
            float overDb = 20.0f * log10f(c->envelope / c->threshold);
            float reducedDb = overDb * (1.0f - 1.0f / c->ratio);
            gain = powf(10.0f, -reducedDb / 20.0f);
        }
        pOut[i * 2] = L * gain * c->makeupGain; pOut[i * 2 + 1] = R * gain * c->makeupGain;
    }
}
static ma_node_vtable g_compressor_vtable = {compressor_process, NULL, 1, 1, 0};


// ================================================================
// GLOBAL ENGINE STATE & ROUTING (No longer hidden in main)
// ================================================================
ma_engine engine;
ma_sound sound;
bool isSoundInitialized = false;

bool isRemasterOn = false; bool isUpscaleOn = false; bool isWidenOn = false;
bool isReverbOn = false; bool isCompressOn = false;

ma_loshelf_node bassNode; ma_peak_node midNode; ma_hishelf_node trebleNode;
HarmonicExciterNode exciterNode; StereoWidenerNode widenerNode;
Spatializer3DNode spatializerNode; ReverbNode reverbNode; CompressorNode compressorNode;

string lastLoadedPath;

void updateRouting() {
    if (!isSoundInitialized) return;
    ma_node_detach_output_bus((ma_node *)&sound, 0);
    ma_node_detach_output_bus((ma_node *)&trebleNode, 0);
    ma_node_detach_output_bus((ma_node *)&exciterNode, 0);
    ma_node_detach_output_bus((ma_node *)&widenerNode, 0);
    ma_node_detach_output_bus((ma_node *)&spatializerNode, 0);
    ma_node_detach_output_bus((ma_node *)&reverbNode, 0);
    ma_node_detach_output_bus((ma_node *)&compressorNode, 0);

    ma_node *cur = (ma_node *)&sound;
    if (isRemasterOn) { ma_node_attach_output_bus(cur, 0, &bassNode, 0); cur = (ma_node *)&trebleNode; }
    if (isUpscaleOn) { ma_node_attach_output_bus(cur, 0, &exciterNode, 0); cur = (ma_node *)&exciterNode; }
    if (isWidenOn) { ma_node_attach_output_bus(cur, 0, &widenerNode, 0); cur = (ma_node *)&widenerNode; }
    
    ma_node_attach_output_bus(cur, 0, &spatializerNode, 0); cur = (ma_node *)&spatializerNode; // 3D Always On
    
    if (isReverbOn) { ma_node_attach_output_bus(cur, 0, &reverbNode, 0); cur = (ma_node *)&reverbNode; }
    if (isCompressOn) { ma_node_attach_output_bus(cur, 0, &compressorNode, 0); cur = (ma_node *)&compressorNode; }

    ma_node_attach_output_bus(cur, 0, ma_engine_get_endpoint(&engine), 0);
}


// ================================================================
// EXPORTED C-BINDINGS (This is what Rust calls natively)
// ================================================================
extern "C" {

    void init_audio_engine() {
        if (ma_engine_init(NULL, &engine) != MA_SUCCESS) return;
        ma_node_graph *pNodeGraph = ma_engine_get_node_graph(&engine);
        ma_uint32 channels = 2, sampleRate = 48000, inCh[1] = {channels}, outCh[1] = {channels};

        ma_loshelf_node_config bassConfig = ma_loshelf_node_config_init(channels, sampleRate, 8.0f, 1.0f, 80.0f); ma_loshelf_node_init(pNodeGraph, &bassConfig, NULL, &bassNode);
        ma_peak_node_config midConfig = ma_peak_node_config_init(channels, sampleRate, -5.0f, 1.0f, 400.0f); ma_peak_node_init(pNodeGraph, &midConfig, NULL, &midNode);
        ma_hishelf_node_config trebleConfig = ma_hishelf_node_config_init(channels, sampleRate, -12.0f, 1.0f, 10000.0f); ma_hishelf_node_init(pNodeGraph, &trebleConfig, NULL, &trebleNode);
        ma_node_attach_output_bus(&bassNode, 0, &midNode, 0); ma_node_attach_output_bus(&midNode, 0, &trebleNode, 0);

        memset(&exciterNode, 0, sizeof(exciterNode)); ma_node_config exciterCfg = ma_node_config_init(); exciterCfg.vtable = &g_exciter_vtable; exciterCfg.pInputChannels = inCh; exciterCfg.pOutputChannels = outCh;
        ma_node_init(pNodeGraph, &exciterCfg, NULL, &exciterNode.baseNode); exciterNode.drive = 0.0f; exciterNode.mix = 0.30f;

        memset(&widenerNode, 0, sizeof(widenerNode)); ma_node_config widenerCfg = ma_node_config_init(); widenerCfg.vtable = &g_widener_vtable; widenerCfg.pInputChannels = inCh; widenerCfg.pOutputChannels = outCh;
        ma_node_init(pNodeGraph, &widenerCfg, NULL, &widenerNode.baseNode); widenerNode.width = 1.0f;

        memset(&spatializerNode, 0, sizeof(spatializerNode)); ma_node_config spatializerCfg = ma_node_config_init(); spatializerCfg.vtable = &g_spatializer3d_vtable; spatializerCfg.pInputChannels = inCh; spatializerCfg.pOutputChannels = outCh;
        ma_node_init(pNodeGraph, &spatializerCfg, NULL, &spatializerNode.baseNode); spatializerNode.crossMix = 0.12f; spatializerNode.delayIdx = 0;

        memset(&reverbNode, 0, sizeof(reverbNode)); reverbNode.roomSize = 0.84f; reverbNode.wetMix = 0.0f; reverbNode.damp = 0.50f; reverb_init_filters(&reverbNode);
        ma_node_config reverbCfg = ma_node_config_init(); reverbCfg.vtable = &g_reverb_vtable; reverbCfg.pInputChannels = inCh; reverbCfg.pOutputChannels = outCh;
        ma_node_init(pNodeGraph, &reverbCfg, NULL, &reverbNode.baseNode);

        memset(&compressorNode, 0, sizeof(compressorNode)); ma_node_config compressorCfg = ma_node_config_init(); compressorCfg.vtable = &g_compressor_vtable; compressorCfg.pInputChannels = inCh; compressorCfg.pOutputChannels = outCh;
        ma_node_init(pNodeGraph, &compressorCfg, NULL, &compressorNode.baseNode); compressorNode.threshold = powf(10.0f, -18.0f / 20.0f); compressorNode.ratio = 4.0f;
        compressorNode.attackCoef = expf(-1.0f / (0.010f * (float)sampleRate)); compressorNode.releaseCoef = expf(-1.0f / (0.150f * (float)sampleRate)); compressorNode.makeupGain = 2.5f; compressorNode.envelope = 0.0f;
    }

    void execute_audio_command(const char* cmd_in) {
        string full_cmd(cmd_in);
        size_t space_idx = full_cmd.find(' ');
        string command = full_cmd.substr(0, space_idx);
        string args = (space_idx != string::npos) ? full_cmd.substr(space_idx + 1) : "";

        if (command == "LOAD") {
            if (isSoundInitialized) { ma_sound_stop(&sound); ma_sound_uninit(&sound); isSoundInitialized = false; }
            if (ma_sound_init_from_file(&engine, args.c_str(), MA_SOUND_FLAG_DECODE, NULL, NULL, &sound) == MA_SUCCESS) {
                isSoundInitialized = true; lastLoadedPath = args; updateRouting();
            } else { lastLoadedPath.clear(); }
        }
        else if (command == "PLAY" && isSoundInitialized) { ma_sound_start(&sound); }
        else if (command == "PAUSE" && isSoundInitialized) { ma_sound_stop(&sound); }
        else if (command == "VOLUME") { ma_engine_set_volume(&engine, stof(args)); }
        else if (command == "SEEK" && isSoundInitialized) { ma_sound_seek_to_pcm_frame(&sound, (ma_uint64)(stof(args) * 48000.0f)); }
        else if (command == "REMASTER") { isRemasterOn = (stoi(args) == 1); updateRouting(); }
        else if (command == "COMPRESS") { isCompressOn = (stoi(args) == 1); updateRouting(); }
        else if (command == "UPSCALE") { float d = stof(args); exciterNode.drive = d; exciterNode.mix = (d > 0.0f) ? 0.30f : 0.0f; isUpscaleOn = (d > 0.01f); updateRouting(); }
        else if (command == "WIDEN") { widenerNode.width = stof(args); isWidenOn = (stof(args) > 1.01f); updateRouting(); }
        else if (command == "3D") { spatializerNode.crossMix = 0.12f + (stof(args) * 0.26f); }
        else if (command == "REVERB") { float w = stof(args); reverbNode.wetMix = w; isReverbOn = (w > 0.005f); updateRouting(); }
    }

    void get_audio_metrics(float* curTime, float* length, float* level) {
        if (!isSoundInitialized) { *curTime = 0; *length = 0; *level = 0; return; }
        ma_sound_get_cursor_in_seconds(&sound, curTime);
        ma_sound_get_length_in_seconds(&sound, length);
        float cursorFrames = 0;
        ma_sound_get_cursor_in_pcm_frames(&sound, (ma_uint64*)&cursorFrames);
        *level = ((long long)cursorFrames % 10) * 0.05f; // Fast mock envelope
    }

    // THE RESTORED SMART ANALYZER
    bool analyze_audio(float* sc_out, float* cf_out, float* zcr_out, float* rms_out) {
        if (lastLoadedPath.empty()) return false;
        ma_decoder_config decCfg = ma_decoder_config_init(ma_format_f32, 2, 48000);
        ma_decoder decoder;
        if (ma_decoder_init_file(lastLoadedPath.c_str(), &decCfg, &decoder) != MA_SUCCESS) return false;
        
        const ma_uint32 analyzeFrames = 48000 * 10;
        vector<float> buf(analyzeFrames * 2, 0.0f);
        ma_uint64 framesRead = 0;
        ma_decoder_read_pcm_frames(&decoder, buf.data(), analyzeFrames, &framesRead);
        ma_decoder_uninit(&decoder);
        
        if (framesRead < 4800) return false;

        double sumL2 = 0, sumR2 = 0, sumLR = 0, peak = 0, zcrCount = 0; float prevMono = 0.0f;
        for (ma_uint64 i = 0; i < framesRead; ++i) {
            float L = buf[i * 2], R = buf[i * 2 + 1];
            sumL2 += L * L; sumR2 += R * R; sumLR += L * R;
            float absMono = fabsf((L + R) * 0.5f);
            if (absMono > peak) peak = absMono;
            float mono = (L + R) * 0.5f;
            if ((mono >= 0 && prevMono < 0) || (mono < 0 && prevMono >= 0)) zcrCount++;
            prevMono = mono;
        }
        double n = (double)framesRead;
        double rms = sqrt((sumL2 + sumR2) / (2.0 * n));
        double denom = sqrt(sumL2 * sumR2);
        
        *sc_out = (float)((denom > 1e-12) ? (sumLR / denom) : 0.0);
        *cf_out = (float)((rms > 1e-9) ? (20.0 * log10(peak / rms)) : 0.0);
        *zcr_out = (float)(zcrCount / n);
        *rms_out = (float)rms;

        return true;
    }
}