#define MINIAUDIO_IMPLEMENTATION
#define _CRT_SECURE_NO_WARNINGS

#include "EngineCore.h"
#include <cstring>
#include <atomic>
#include <cmath>
#include <mutex>

// Define global variables
ma_engine g_engine;
ma_device g_device; // The Locked Physical DAC (Context handled internally now)
ma_sound g_sound;
bool g_isInitialized = false;
bool g_engineInitialized = false;
bool g_soundInitialized = false;
bool g_usingCustomDevice = false; // True when we own a manual ma_device (AAudio/WASAPI)

float g_bassGain = 0.0f;
float g_trebleGain = 0.0f;
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
bool g_isAndroidSpeaker = false;
bool g_isLaptopSpeaker = false;
bool g_is8DModeOn = false;

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
DynamicSpatializerNode g_8DNode;

void updateRouting()
{
    if (!g_soundInitialized)
        return;
    // THE STATIC GRAPH FIX:
    // We NEVER tear the graph down. We only plug the newly loaded track into the head of the chain.
    ma_node_attach_output_bus((ma_node *)&g_sound, 0, &g_convolutionNode, 0);
}
static void manual_data_callback(ma_device *pDevice, void *pOutput, const void *pInput, ma_uint32 frameCount)
{
    (void)pInput; // We are playing, not recording.
    ma_engine *pEngine = (ma_engine *)pDevice->pUserData;

    // Only pull from the engine if the C++ graph is fully wired and ready
    if (pEngine != NULL && g_engineInitialized)
    {
        ma_engine_read_pcm_frames(pEngine, pOutput, frameCount, NULL);
    }
    else
    {
        // Output mathematical silence to prevent popping during boot
        memset(pOutput, 0, frameCount * 2 * sizeof(float));
    }
}
extern "C" void init_audio_engine()
{
    if (g_engineInitialized)
        return;

#ifdef __ANDROID__
    // --- ANDROID AAUDIO EXCLUSIVE INITIALIZATION ---
    // Mirror the Windows WASAPI architecture: custom device -> headless engine -> manual callback
    // This bypasses AudioFlinger's resampler and hidden limiters for bit-perfect output.
    {
        ma_device_config deviceConfig = ma_device_config_init(ma_device_type_playback);
        deviceConfig.playback.format   = ma_format_f32;
        deviceConfig.playback.channels = 2;
        deviceConfig.sampleRate        = 0; // Hardware native rate (bypass OS resampler)
        deviceConfig.performanceProfile = ma_performance_profile_low_latency; // Request MMAP exclusive path
        deviceConfig.dataCallback      = manual_data_callback;
        deviceConfig.pUserData         = &g_engine;

        // miniaudio auto-prefers AAudio over OpenSL on Android 8+
        bool deviceReady = (ma_device_init(NULL, &deviceConfig, &g_device) == MA_SUCCESS);

        if (!deviceReady)
        {
            // Low-latency failed — retry with conservative profile (shared mode)
            deviceConfig.performanceProfile = ma_performance_profile_conservative;
            deviceReady = (ma_device_init(NULL, &deviceConfig, &g_device) == MA_SUCCESS);
        }

        if (!deviceReady)
        {
            // All custom device attempts failed — fall back to the old simple engine init
            ma_engine_config cfg = ma_engine_config_init();
            cfg.sampleRate = 0;
            if (ma_engine_init(&cfg, &g_engine) != MA_SUCCESS)
                return;
            g_usingCustomDevice = false;
            goto engine_ready;
        }

        // --- THE HEADLESS ENGINE (identical to Windows) ---
        ma_engine_config engineConfig = ma_engine_config_init();
        engineConfig.noDevice    = MA_TRUE;
        engineConfig.channels    = 2;
        engineConfig.sampleRate  = g_device.sampleRate; // Match engine to DAC

        if (ma_engine_init(&engineConfig, &g_engine) != MA_SUCCESS)
        {
            ma_device_uninit(&g_device);
            return;
        }

        if (ma_device_start(&g_device) != MA_SUCCESS)
        {
            ma_engine_uninit(&g_engine);
            ma_device_uninit(&g_device);
            return;
        }

        g_usingCustomDevice = true;
    }

#else
    // --- WINDOWS WASAPI EXCLUSIVE INITIALIZATION ---
    ma_device_config deviceConfig = ma_device_config_init(ma_device_type_playback);
    deviceConfig.playback.format = ma_format_f32;
    deviceConfig.playback.channels = 2;

    // Audiophile Flags
    deviceConfig.wasapi.noAutoConvertSRC = MA_TRUE;
    deviceConfig.wasapi.noDefaultQualitySRC = MA_TRUE;
    deviceConfig.wasapi.noHardwareOffloading = MA_TRUE;
    deviceConfig.sampleRate = 0; // Hardware Native Rate

    // THE FIX: Explicitly bind the manual callback we just wrote
    deviceConfig.dataCallback = manual_data_callback;
    deviceConfig.pUserData = &g_engine;

    if (ma_device_init(NULL, &deviceConfig, &g_device) != MA_SUCCESS)
    {
        printf("WARNING: Exclusive mode failed. Stripping locks.\n");
        deviceConfig.wasapi.noAutoConvertSRC = MA_FALSE;
        deviceConfig.wasapi.noDefaultQualitySRC = MA_FALSE;
        deviceConfig.wasapi.noHardwareOffloading = MA_FALSE;
        deviceConfig.sampleRate = 48000;

        if (ma_device_init(NULL, &deviceConfig, &g_device) != MA_SUCCESS)
        {
            printf("CRITICAL: Shared mode also failed.\n");
            return;
        }
    }

    // --- THE HEADLESS ENGINE ---
    ma_engine_config engineConfig = ma_engine_config_init();
    engineConfig.noDevice = MA_TRUE; // Disconnect engine from automatic OS routing
    engineConfig.channels = 2;
    engineConfig.sampleRate = g_device.sampleRate; // Match engine to DAC

    if (ma_engine_init(&engineConfig, &g_engine) != MA_SUCCESS)
    {
        printf("CRITICAL: Failed to initialize headless engine.\n");
        ma_device_uninit(&g_device);
        return;
    }

    // Turn the ignition key
    if (ma_device_start(&g_device) != MA_SUCCESS)
    {
        printf("CRITICAL: Failed to start the DAC.\n");
        ma_engine_uninit(&g_engine);
        ma_device_uninit(&g_device);
        return;
    }
    
    g_usingCustomDevice = true;
#endif
engine_ready:
    g_engineInitialized = true;

    g_channels = ma_engine_get_channels(&g_engine);
    g_inCh[0] = g_channels;
    g_outCh[0] = g_channels;
    ma_node_graph *pg = ma_engine_get_node_graph(&g_engine);
    ma_uint32 sr = ma_engine_get_sample_rate(&g_engine);

    ma_loshelf_node_config bc = ma_loshelf_node_config_init(g_channels, sr, 8.0f, 1.0f, 130.0f);
    ma_loshelf_node_init(pg, &bc, NULL, &g_bassNode);
    ma_peak_node_config mc2 = ma_peak_node_config_init(g_channels, sr, -5.0f, 1.0f, 400.0f);
    ma_peak_node_init(pg, &mc2, NULL, &g_midNode);
    ma_hishelf_node_config tc = ma_hishelf_node_config_init(g_channels, sr, -12.0f, 1.0f, 6000.0f);
    ma_hishelf_node_init(pg, &tc, NULL, &g_trebleNode);
    ma_node_attach_output_bus(&g_bassNode, 0, &g_midNode, 0);
    ma_node_attach_output_bus(&g_midNode, 0, &g_trebleNode, 0);

    memset(&g_audiophileEQNode, 0, sizeof(g_audiophileEQNode));
    g_audiophileEQNode.targetBass.store(1.0f, std::memory_order_relaxed);
    g_audiophileEQNode.targetMid.store(1.0f, std::memory_order_relaxed);
    g_audiophileEQNode.targetHigh.store(1.0f, std::memory_order_relaxed);
    g_audiophileEQNode.currentBass = 1.0f;
    g_audiophileEQNode.currentMid = 1.0f;
    g_audiophileEQNode.currentHigh = 1.0f;
    g_audiophileEQNode.crossBassL.init((float)sr, 80.0f);
    g_audiophileEQNode.crossBassR.init((float)sr, 80.0f);
    g_audiophileEQNode.crossMidBassL.init((float)sr, 180.0f);
    g_audiophileEQNode.crossMidBassR.init((float)sr, 180.0f);
    g_audiophileEQNode.crossTrebleL.init((float)sr, 8000.0f);
    g_audiophileEQNode.crossTrebleR.init((float)sr, 8000.0f);
    g_audiophileEQNode.presenceL.init((float)sr, 2500.0f, 0.707f, 2.0f);
    g_audiophileEQNode.presenceR.init((float)sr, 2500.0f, 0.707f, 2.0f);
    ma_node_config cEQ = ma_node_config_init();
    cEQ.vtable = &g_audiophile_eq_vtable;
    cEQ.pInputChannels = g_inCh;
    cEQ.pOutputChannels = g_outCh;
    ma_node_init(pg, &cEQ, NULL, &g_audiophileEQNode.baseNode);

    memset(&g_subwooferNode, 0, sizeof(g_subwooferNode));
    g_subwooferNode.crossBassL.init((float)sr, 80.0f);
    g_subwooferNode.crossBassR.init((float)sr, 80.0f);
    g_subwooferNode.crossMidBassL.init((float)sr, 180.0f);
    g_subwooferNode.crossMidBassR.init((float)sr, 180.0f);
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
    g_spatializerNode.crossSubwooferL.init((float)sr, 180.0f);
    g_spatializerNode.crossSubwooferR.init((float)sr, 180.0f);
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
    g_reverbNode.hpfL.init((float)sr, 150.0f);
    g_reverbNode.hpfR.init((float)sr, 150.0f);

    ma_node_config cRev = ma_node_config_init();
    cRev.vtable = &g_reverb_vtable;
    cRev.pInputChannels = g_inCh;
    cRev.pOutputChannels = g_outCh;
    ma_node_init(pg, &cRev, NULL, &g_reverbNode.baseNode);

    memset(&g_convolutionNode, 0, sizeof(g_convolutionNode));
    g_convolutionNode.hpfL.init((float)sr, 150.0f);
    g_convolutionNode.hpfR.init((float)sr, 150.0f);

    ma_node_config cConv = ma_node_config_init();
    cConv.vtable = &g_convolution_vtable;
    cConv.pInputChannels = g_inCh;
    cConv.pOutputChannels = g_outCh;
    ma_node_init(pg, &cConv, NULL, &g_convolutionNode.baseNode);

    memset(&g_compressorNode, 0, sizeof(g_compressorNode));
    g_compressorNode.threshold.store(0.251f, std::memory_order_relaxed);
    g_compressorNode.makeupGain.store(1.0f, std::memory_order_relaxed); // Safe headroom for AAudio
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

    memset(&g_limiterNode, 0, sizeof(g_limiterNode));
    g_limiterNode.boost = 1.0f;
    g_limiterNode.gainEnv = 1.0f;
    g_limiterNode.attackCoef = expf(-1.0f / (0.0005f * (float)sr)); // Ultra-fast attack to prevent DAC hard-clipping
    g_limiterNode.releaseCoef = expf(-1.0f / (0.150f * (float)sr));
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

    // Init the 8D Spatializer (Dormant but memory allocated)
    memset(&g_8DNode, 0, sizeof(g_8DNode));
    g_8DNode.crossLowL.init(sr, 250.0f);
    g_8DNode.crossLowR.init(sr, 250.0f);
    g_8DNode.crossHighL.init(sr, 4000.0f);
    g_8DNode.crossHighR.init(sr, 4000.0f);

    ma_node_config c8D = ma_node_config_init();
    c8D.vtable = &g_dynamic_spatializer_vtable;
    c8D.pInputChannels = g_inCh;
    c8D.pOutputChannels = g_outCh;
    ma_node_init(pg, &c8D, NULL, &g_8DNode.baseNode);

    // THE ONLY WIRING THAT SHOULD EXIST FOR THIS SECTION:
    ma_node_attach_output_bus(&g_convolutionNode, 0, &g_audiophileEQNode, 0);
    ma_node_attach_output_bus(&g_audiophileEQNode, 0, &g_subwooferNode, 0);
    ma_node_attach_output_bus(&g_subwooferNode, 0, &g_compressorNode, 0);
    ma_node_attach_output_bus(&g_compressorNode, 0, &g_exciterNode, 0);
    ma_node_attach_output_bus(&g_exciterNode, 0, &g_widenerNode, 0);

    // --- 8D Amputated. Direct connection to Haas Spatializer ---
    ma_node_attach_output_bus(&g_widenerNode, 0, &g_spatializerNode, 0);
    // -----------------------------------------------------------

    ma_node_attach_output_bus(&g_spatializerNode, 0, &g_reverbNode, 0);
    ma_node_attach_output_bus(&g_reverbNode, 0, &g_meterNode, 0);
    ma_node_attach_output_bus(&g_meterNode, 0, &g_limiterNode, 0);
    ma_node_attach_output_bus(&g_limiterNode, 0, ma_engine_get_endpoint(&g_engine), 0);
}

// --- I ADDED THIS FOR YOU. CALL THIS FROM RUST WHEN THE APP CLOSES. ---
// --- I ADDED THIS FOR YOU. CALL THIS FROM RUST WHEN THE APP CLOSES. ---
extern "C" void uninit_audio_engine()
{
    if (!g_engineInitialized)
        return;

    // 1. Stop the DAC from pulling data first (only if we created a custom device)
    if (g_usingCustomDevice)
    {
        ma_device_stop(&g_device);
        ma_device_uninit(&g_device);
    }

    // 2. Safely destroy the engine now that the DAC is quiet
    ma_engine_uninit(&g_engine);

    g_engineInitialized = false;
}