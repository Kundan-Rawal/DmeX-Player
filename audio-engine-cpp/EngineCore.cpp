#define MINIAUDIO_IMPLEMENTATION
#define _CRT_SECURE_NO_WARNINGS

#include "EngineCore.h"
#include <cstring>
#include <atomic> // <--- ADD THIS
#include <cmath>
#include <mutex>

// Define global variables
ma_engine g_engine;
ma_sound g_sound;
bool g_soundInitialized = false;
bool g_engineInitialized = false;

float g_bassGain = 0.0f;
std::mutex g_irMutex;
std::mutex g_pathMutex;
std::mutex g_audioMutex;
std::string g_lastLoadedPath;

bool g_isRemasterOn = false;
bool g_isFIRModeOn = false;
bool g_isUpscaleOn = false;
bool g_isWidenOn = false;
bool g_isCompressOn = false;
bool g_isReverbOn = false;
bool g_isConvolutionOn = false;

ma_uint32 g_channels = 2;
ma_uint32 g_inCh[1] = {2};
ma_uint32 g_outCh[1] = {2};

ma_loshelf_node g_bassNode;
ma_peak_node g_midNode;
ma_hishelf_node g_trebleNode;
StudioExciterNode g_exciterNode;
StereoWidenerNode g_widenerNode;
PsychoacousticNode g_spatializerNode;
AudiophileEQNode g_audiophileEQNode;
ReverbNode g_reverbNode;
ConvolutionNode g_convolutionNode;
MultibandCompressorNode g_compressorNode;
LimiterNode g_limiterNode;
MeterNode g_meterNode;
SubwooferNode g_subwooferNode;

void updateRouting()
{
    if (!g_soundInitialized)
        return;
    // THE STATIC GRAPH FIX:
    // We NEVER tear the graph down. We only plug the newly loaded track into the head of the chain.
    ma_node_attach_output_bus((ma_node *)&g_sound, 0, &g_convolutionNode, 0);
}

extern "C" void init_audio_engine()
{
    if (g_engineInitialized)
        return;
    ma_engine_config cfg = ma_engine_config_init();
#ifdef __ANDROID__
    // ANDROID ONLY: Bypass the OS resampler to save treble and dynamics
    cfg.sampleRate = 0;
#else
    // PC ONLY: Locked in the vault. Do not touch.
    cfg.sampleRate = 48000;
#endif
    if (ma_engine_init(&cfg, &g_engine) != MA_SUCCESS)
        return;
    g_engineInitialized = true;

    g_channels = ma_engine_get_channels(&g_engine);
    g_inCh[0] = g_channels;
    g_outCh[0] = g_channels;
    ma_node_graph *pg = ma_engine_get_node_graph(&g_engine);
    ma_uint32 sr = ma_engine_get_sample_rate(&g_engine);

    ma_loshelf_node_config bc = ma_loshelf_node_config_init(g_channels, sr, 8.0f, 1.0f, 80.0f);
    ma_loshelf_node_init(pg, &bc, NULL, &g_bassNode);
    ma_peak_node_config mc2 = ma_peak_node_config_init(g_channels, sr, -5.0f, 1.0f, 400.0f);
    ma_peak_node_init(pg, &mc2, NULL, &g_midNode);
    ma_hishelf_node_config tc = ma_hishelf_node_config_init(g_channels, sr, -12.0f, 1.0f, 10000.0f);
    ma_hishelf_node_init(pg, &tc, NULL, &g_trebleNode);
    ma_node_attach_output_bus(&g_bassNode, 0, &g_midNode, 0);
    ma_node_attach_output_bus(&g_midNode, 0, &g_trebleNode, 0);

    memset(&g_audiophileEQNode, 0, sizeof(g_audiophileEQNode));
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

    memset(&g_subwooferNode, 0, sizeof(g_subwooferNode));
    // Memory is safely zeroed out by memset, no explicit state setting needed.
    ma_node_config subCfg = ma_node_config_init();
    subCfg.vtable = &g_subwoofer_vtable;
    subCfg.pInputChannels = g_inCh;
    subCfg.pOutputChannels = g_outCh;
    ma_node_init(pg, &subCfg, NULL, &g_subwooferNode.baseNode);

    memset(&g_exciterNode, 0, sizeof(g_exciterNode));
    ma_node_config c1 = ma_node_config_init();
    c1.vtable = &g_exciter_vtable;
    c1.pInputChannels = g_inCh;
    c1.pOutputChannels = g_outCh;
    ma_node_init(pg, &c1, NULL, &g_exciterNode.baseNode);

    memset(&g_widenerNode, 0, sizeof(g_widenerNode));
    g_widenerNode.width = 1.0f;
    ma_node_config c2 = ma_node_config_init();
    c2.vtable = &g_widener_vtable;
    c2.pInputChannels = g_inCh;
    c2.pOutputChannels = g_outCh;
    ma_node_init(pg, &c2, NULL, &g_widenerNode.baseNode);

    memset(&g_spatializerNode, 0, sizeof(g_spatializerNode));
    ma_node_config c3 = ma_node_config_init();
    c3.vtable = &g_psychoacoustic_vtable;
    c3.pInputChannels = g_inCh;
    c3.pOutputChannels = g_outCh;
    ma_node_init(pg, &c3, NULL, &g_spatializerNode.baseNode);

    memset(&g_reverbNode, 0, sizeof(g_reverbNode));
    g_reverbNode.roomSize = 0.84f;
    g_reverbNode.wetMix = 0.0f;
    g_reverbNode.damp = 0.50f;
    reverb_init_filters(&g_reverbNode);
    ma_node_config cRev = ma_node_config_init();
    cRev.vtable = &g_reverb_vtable;
    cRev.pInputChannels = g_inCh;
    cRev.pOutputChannels = g_outCh;
    // CRITICAL FIX: The Reverb node was never plugged in!
    ma_node_init(pg, &cRev, NULL, &g_reverbNode.baseNode);

    memset(&g_convolutionNode, 0, sizeof(g_convolutionNode));
    ma_node_config cConv = ma_node_config_init();
    cConv.vtable = &g_convolution_vtable;
    cConv.pInputChannels = g_inCh;
    cConv.pOutputChannels = g_outCh;
    ma_node_init(pg, &cConv, NULL, &g_convolutionNode.baseNode);

    // memset(&g_compressorNode, 0, sizeof(g_compressorNode));
    // CRITICAL FIX: Lowered threshold (was 0.251) to catch quiet tracks.
    memset(&g_compressorNode, 0, sizeof(g_compressorNode));
    g_compressorNode.threshold.store(0.251f, std::memory_order_relaxed); // Restored
    g_compressorNode.makeupGain.store(1.05f, std::memory_order_relaxed); // Restored

    g_compressorNode.attackCoef = expf(-1.0f / (0.005f * (float)sr));
    g_compressorNode.releaseCoef = expf(-1.0f / (0.150f * (float)sr));
    g_compressorNode.delayLpStateL = 0.0f;
    g_compressorNode.delayLpStateR = 0.0f;
    memset(g_compressorNode.dlyL, 0, sizeof(g_compressorNode.dlyL));
    memset(g_compressorNode.dlyR, 0, sizeof(g_compressorNode.dlyR));
    ma_node_config c5 = ma_node_config_init();
    c5.vtable = &g_multiband_compressor_vtable;
    c5.pInputChannels = g_inCh;
    c5.pOutputChannels = g_outCh;
    ma_node_init(pg, &c5, NULL, &g_compressorNode.baseNode);

    // Limiter (with Soft-Clipper & Lookahead Init)
    memset(&g_limiterNode, 0, sizeof(g_limiterNode));
    g_limiterNode.boost = 1.0f;
    g_limiterNode.gainEnv = 1.0f;
    // CRITICAL FIX: Increased release to 200ms to stop bass wave modulation (rattling)
    g_limiterNode.attackCoef = expf(-1.0f / (0.0015f * (float)sr));
    g_limiterNode.releaseCoef = expf(-1.0f / (0.200f * (float)sr));
    memset(g_limiterNode.dlyL, 0, sizeof(g_limiterNode.dlyL));
    memset(g_limiterNode.dlyR, 0, sizeof(g_limiterNode.dlyR));
    ma_node_config c6 = ma_node_config_init();
    c6.vtable = &g_limiter_vtable;
    c6.pInputChannels = g_inCh;
    c6.pOutputChannels = g_outCh;
    ma_node_init(pg, &c6, NULL, &g_limiterNode.baseNode);

    memset(&g_meterNode, 0, sizeof(g_meterNode));
    ma_node_config cMeter = ma_node_config_init();
    cMeter.vtable = &g_meter_vtable;
    cMeter.pInputChannels = g_inCh;
    cMeter.pOutputChannels = g_outCh;
    ma_node_init(pg, &cMeter, NULL, &g_meterNode.baseNode);

    ma_node_attach_output_bus(&g_convolutionNode, 0, &g_audiophileEQNode, 0);
    ma_node_attach_output_bus(&g_audiophileEQNode, 0, &g_subwooferNode, 0);
    ma_node_attach_output_bus(&g_subwooferNode, 0, &g_compressorNode, 0);
    ma_node_attach_output_bus(&g_compressorNode, 0, &g_exciterNode, 0);
    ma_node_attach_output_bus(&g_exciterNode, 0, &g_widenerNode, 0);
    ma_node_attach_output_bus(&g_widenerNode, 0, &g_spatializerNode, 0);
    ma_node_attach_output_bus(&g_spatializerNode, 0, &g_reverbNode, 0);
    ma_node_attach_output_bus(&g_reverbNode, 0, &g_limiterNode, 0);
    ma_node_attach_output_bus(&g_limiterNode, 0, &g_meterNode, 0);
    ma_node_attach_output_bus(&g_meterNode, 0, ma_engine_get_endpoint(&g_engine), 0);

}