#define MINIAUDIO_IMPLEMENTATION
#define _CRT_SECURE_NO_WARNINGS
#include "EngineCore.h"
#include "StreamingDecoder.h"
#include "DenormalGuard.h"
#include <algorithm>
#include <array>
#include <cstdio>
#include <cstring>
#include <chrono>
#include <stdexcept>

ma_engine g_engine{};
ma_device g_device{};
ma_sound g_sound{};
std::atomic<bool> g_engineInitialized{false};
bool g_soundInitialized = false;
std::recursive_mutex g_audioMutex;
std::mutex g_irMutex, g_pathMutex;
std::string g_lastLoadedPath;
std::atomic<float> g_bassGain{0}, g_subBassHz{52}, g_bassField{0}, g_bassMotionHz{105};
std::atomic<float> g_trebleGain{0}, g_denoiseIntensity{0}, g_upscaleTarget{0}, g_presenceBoost{0};
std::atomic<float> g_outputGain{1}, g_masterVolume{1}, g_outputPeak{0};
std::atomic<bool> g_roomBass{false}, g_bypassAll{false};
std::atomic<bool> g_pauseRequested{false};
std::atomic<bool> g_irRestoreFailed{false};
#ifdef __ANDROID__
std::atomic<bool> g_ecoMode{true};
#else
std::atomic<bool> g_ecoMode{false};
#endif
std::atomic<bool> g_isRemasterOn{false}, g_isFIRModeOn{false}, g_isUpscaleOn{false}, g_isWidenOn{false};
std::atomic<bool> g_isCompressOn{false}, g_isReverbOn{false}, g_isConvolutionOn{false};
std::atomic<bool> g_isAndroidSpeaker{false}, g_isLaptopSpeaker{false}, g_is8DModeOn{false};
std::atomic<bool> g_isAdaptiveLoudnessOn{false}, g_trackFinished{false};
std::atomic<int> g_requestedSampleRate{48000};
std::atomic<unsigned long long> g_audioGeneration{0};
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
AudioRestorationNode g_restorationNode;
HeadphoneCompNode g_headphoneCompNode;
ma_uint32 g_channels = 2, g_inCh[1] = {2}, g_outCh[1] = {2};

namespace {
std::array<ma_node*, 16> nodes{};
size_t nodeCount = 0;
bool deviceReady = false, engineReady = false;
ma_resource_manager streamResources{};
bool streamResourcesReady = false;
ma_decoding_backend_vtable* decodingBackends[]{ &g_streamingDecoder };
#ifdef DMEX_DSP_TESTS
bool offline = false;
#endif
std::atomic<bool> renderReady{false}, recoveryRequested{false};
std::atomic<float> callbackLoad{0}, maximumCallbackLoad{0};
std::atomic<unsigned> overBudgetCallbacks{0};
std::string hrtfPath;
bool sourceEnded = false;
ma_uint64 drainFrames = 0;

void initNode(ma_node_graph* graph, const ma_node_config* config, ma_node* node) {
    const ma_result result = ma_node_init(graph, config, nullptr, node);
    if (result != MA_SUCCESS) throw std::runtime_error(ma_result_description(result));
    nodes[nodeCount++] = node;
}
int scaled_delay(int samples, ma_uint32 rate) {
    return static_cast<int>(std::lround(samples * static_cast<double>(rate) / 48000.0));
}
void attach(ma_node* from, ma_node* to) {
    const ma_result result = ma_node_attach_output_bus(from, 0, to, 0);
    if (result != MA_SUCCESS) throw std::runtime_error(ma_result_description(result));
}
void notification(const ma_device_notification* event) {
    if (event->type == ma_device_notification_type_rerouted ||
        (event->type == ma_device_notification_type_stopped && renderReady.load()))
        recoveryRequested.store(true);
}
void callback(ma_device*, void* output, const void*, ma_uint32 frames) {
    DenormalGuard denormals;
    if (!output || !frames) return;
    if (!renderReady.load(std::memory_order_acquire) || g_pauseRequested.load(std::memory_order_acquire)) {
        std::memset(output, 0, frames * 2 * sizeof(float));
        g_audioLevel.store(0); g_outputPeak.store(0);
        return;
    }
    const auto started = std::chrono::steady_clock::now();
    audio_apply_pending_parameters();
    ma_engine_read_pcm_frames(&g_engine, output, frames, nullptr);
    const float* samples = static_cast<const float*>(output);
    float peak = 0;
    for (ma_uint32 i = 0; i < frames * 2; ++i)
        peak = (std::max)(peak, std::abs(samples[i]));
    g_outputPeak.store(peak, std::memory_order_relaxed);
    if (g_bypassAll.load()) {
        meter_analyze(&g_meterNode, samples, frames);
        g_limiterGR.store(1.0f, std::memory_order_relaxed);
    }
    if (g_soundInitialized && ma_sound_at_end(&g_sound)) {
        if (!sourceEnded) {
            sourceEnded = true;
            drainFrames = g_bypassAll.load() ? 0 : 2 * 512 + 128 + 384;
        }
        if (drainFrames <= frames) g_trackFinished.store(true);
        else drainFrames -= frames;
    }
    const float load = static_cast<float>(std::chrono::duration<double>(std::chrono::steady_clock::now()-started).count()) *
        ma_engine_get_sample_rate(&g_engine) / frames * 100.0f;
    callbackLoad.store(load, std::memory_order_relaxed);
    if (load > maximumCallbackLoad.load(std::memory_order_relaxed)) maximumCallbackLoad.store(load, std::memory_order_relaxed);
    if (load > 100) overBudgetCallbacks.fetch_add(1, std::memory_order_relaxed);
}
}

void engine_reset_transport() {
    meter_reset(&g_meterNode);
    sourceEnded = false;
    drainFrames = 0;
    g_trackFinished.store(false);
}
void engine_suspend() {
    renderReady.store(false, std::memory_order_release);
    if (deviceReady) ma_device_stop(&g_device);
}
bool engine_is_rendering() { return renderReady.load(std::memory_order_acquire); }
extern "C" void audio_request_device_pause() { g_pauseRequested.store(true, std::memory_order_release); }
void engine_resume() {
    if (!g_engineInitialized.load()) return;
    renderReady.store(true, std::memory_order_release);
    if (!deviceReady) return;
    if (ma_device_start(&g_device) != MA_SUCCESS) {
        renderReady.store(false);
        recoveryRequested.store(true);
        throw std::runtime_error("Audio output could not start");
    }
}
void updateRouting() {
    if (!g_soundInitialized) return;
    meter_reset(&g_meterNode);
    ma_node_detach_output_bus(reinterpret_cast<ma_node*>(&g_sound), 0);
    if (g_bypassAll.load()) {
        ma_node_detach_output_bus(&g_meterNode.baseNode, 0);
        attach(reinterpret_cast<ma_node*>(&g_sound), ma_engine_get_endpoint(&g_engine));
        ma_engine_set_volume(&g_engine, 1.0f);
    } else {
        attach(reinterpret_cast<ma_node*>(&g_sound), &g_restorationNode.baseNode);
        attach(&g_meterNode.baseNode, ma_engine_get_endpoint(&g_engine));
        ma_engine_set_volume(&g_engine, 1.0f);
    }
}
extern "C" int engine_get_sample_rate() {
    return g_engineInitialized.load() ? static_cast<int>(ma_engine_get_sample_rate(&g_engine)) : g_requestedSampleRate.load();
}
extern "C" void init_audio_engine() {
    std::lock_guard<std::recursive_mutex> owner(g_audioMutex);
    if (g_engineInitialized.load()) return;
    try {
        ma_device_config device = ma_device_config_init(ma_device_type_playback);
        device.playback.format = ma_format_f32;
        device.playback.channels = 2;
        device.playback.shareMode = ma_share_mode_shared;
        device.sampleRate = g_requestedSampleRate.load();
        device.periodSizeInMilliseconds = g_ecoMode.load() ? 20 : 10;
        device.periods = 3;
        device.performanceProfile = ma_performance_profile_conservative;
        device.dataCallback = callback;
        device.notificationCallback = notification;
#ifdef DMEX_DSP_TESTS
        if (!offline) {
#endif
        if (ma_device_init(nullptr, &device, &g_device) != MA_SUCCESS)
            throw std::runtime_error("Requested output format is unavailable");
        deviceReady = true;
#ifdef DMEX_DSP_TESTS
        }
#endif
        ma_engine_config config = ma_engine_config_init();
        auto resources = ma_resource_manager_config_init();
        resources.pVFS = stream_vfs();
        resources.decodedFormat = ma_format_f32;
        resources.ppCustomDecodingBackendVTables = decodingBackends;
        resources.customDecodingBackendCount = 1;
        resources.jobThreadCount = 1;
        if (ma_resource_manager_init(&resources, &streamResources) != MA_SUCCESS)
            throw std::runtime_error("Streaming decoder initialization failed");
        streamResourcesReady = true;
        config.pResourceManager = &streamResources;
        config.noDevice = MA_TRUE;
        config.channels = 2;
        config.sampleRate = deviceReady ? g_device.sampleRate : g_requestedSampleRate.load();
        if (ma_engine_init(&config, &g_engine) != MA_SUCCESS)
            throw std::runtime_error("Audio graph initialization failed");
        engineReady = true;
        ma_node_graph* pg = ma_engine_get_node_graph(&g_engine);
        const ma_uint32 sr = ma_engine_get_sample_rate(&g_engine);
        if (sr < 22050 || sr > 96000) throw std::runtime_error("Unsupported DSP sample rate");
    g_audiophileEQNode.sampleRate = (float)sr;
    g_audiophileEQNode.targetBass.init(0.0f, (float)sr);
    g_audiophileEQNode.targetMid.init(0.0f, (float)sr);
    g_audiophileEQNode.targetHigh.init(0.0f, (float)sr);
    
    
    
    g_audiophileEQNode.crossBassL.init((float)sr, 80.0f);
    g_audiophileEQNode.crossBassR.init((float)sr, 80.0f);
    g_audiophileEQNode.crossMidBassL.init((float)sr, 180.0f);
    g_audiophileEQNode.crossMidBassR.init((float)sr, 180.0f);
    g_audiophileEQNode.crossTrebleL.init((float)sr, 8000.0f);
    g_audiophileEQNode.crossTrebleR.init((float)sr, 8000.0f);
    g_audiophileEQNode.presenceL.init((float)sr, 2500.0f, 0.8f, 0.0f);
    g_audiophileEQNode.presenceR.init((float)sr, 2500.0f, 0.8f, 0.0f);
    g_audiophileEQNode.iso226.init((float)sr);
    g_audiophileEQNode.env = 0.0398f;
    ma_node_config cEQ = ma_node_config_init();
    cEQ.vtable = &g_audiophile_eq_vtable;
    cEQ.pInputChannels = g_inCh;
    cEQ.pOutputChannels = g_outCh;
    initNode(pg, &cEQ, &g_audiophileEQNode.baseNode);


    g_restorationNode.init((float)sr);
    ma_node_config restCfg = ma_node_config_init();
    restCfg.vtable = &g_restoration_vtable;
    restCfg.pInputChannels = g_inCh;
    restCfg.pOutputChannels = g_outCh;
    initNode(pg, &restCfg, &g_restorationNode.baseNode);
    g_subwooferNode.crossBassL.init((float)sr, 80.0f);
    g_subwooferNode.crossBassR.init((float)sr, 80.0f);
    g_subwooferNode.crossMidBassL.init((float)sr, 180.0f);
    g_subwooferNode.crossMidBassR.init((float)sr, 180.0f);
    g_subwooferNode.analysis60L.init((float)sr, 60.0f);
    g_subwooferNode.analysis60R.init((float)sr, 60.0f);
    g_subwooferNode.analysis100L.init((float)sr, 100.0f);
    g_subwooferNode.analysis100R.init((float)sr, 100.0f);
    g_subwooferNode.subsonicL.init((float)sr, 26.0f);
    g_subwooferNode.subsonicR.init((float)sr, 26.0f);
    g_subwooferNode.currentFreq = 105.0f;
    g_subwooferNode.targetFreq = 105.0f;
    g_subwooferNode.lastTunedFreq = -1.0f;
    g_subwooferNode.lastSubHz = -1.0f;
    g_subwooferNode.lastBassGain = -1.0f;
    g_subwooferNode.isHighlightInit = false;
    g_subwooferNode.sampleRate = (float)sr;
    g_subwooferNode.drive.init(0.0f, (float)sr, 25.0f);
    g_subwooferNode.field.init(g_bassField.load(), (float)sr, 40.0f);
    g_subwooferNode.room.init(0.0f, (float)sr, 40.0f);
    g_subwooferNode.speakerProtectionL.init((float)sr, 48.0f);
    g_subwooferNode.speakerProtectionR.init((float)sr, 48.0f);
    g_subwooferNode.virtualBassL.init((float)sr, 90.0f);
    g_subwooferNode.virtualBassR.init((float)sr, 90.0f);
    g_subwooferNode.energyAttack = tauCoef(5.0f, (float)sr);
    g_subwooferNode.energyRelease = tauCoef(90.0f, (float)sr);
    g_subwooferNode.transientFastCoef = tauCoef(2.0f, (float)sr);
    g_subwooferNode.transientSlowCoef = tauCoef(55.0f, (float)sr);
    g_subwooferNode.transientFast = 0.0f;
    g_subwooferNode.transientSlow = 0.0f;
    g_subwooferNode.fullBandEnv = 0.0f;
    g_subwooferNode.bassScarcity = 0.0f;
    ma_node_config subCfg = ma_node_config_init();
    subCfg.vtable = &g_subwoofer_vtable;
    subCfg.pInputChannels = g_inCh;
    subCfg.pOutputChannels = g_outCh;
    initNode(pg, &subCfg, &g_subwooferNode.baseNode);

    g_exciterNode.hpStateL = 0; g_exciterNode.hpStateR = 0; g_exciterNode.os.reset();
    g_exciterNode.init((float)sr);
    ma_node_config c1 = ma_node_config_init();
    c1.vtable = &g_exciter_vtable;
    c1.pInputChannels = g_inCh;
    c1.pOutputChannels = g_outCh;
    initNode(pg, &c1, &g_exciterNode.baseNode);

    g_widenerNode.width.init(1.0f, (float)sr);
    g_widenerNode.sampleRate = static_cast<float>(sr);
    ma_node_config c2 = ma_node_config_init();
    c2.vtable = &g_widener_vtable;
    c2.pInputChannels = g_inCh;
    c2.pOutputChannels = g_outCh;
    initNode(pg, &c2, &g_widenerNode.baseNode);

    g_spatializerNode.crossSubwooferL.init((float)sr, 180.0f);
    g_spatializerNode.crossSubwooferR.init((float)sr, 180.0f);
    g_spatializerNode.sampleRate = (float)sr;
    g_spatializerNode.depthAmount.init(0.0f, (float)sr);
    g_spatializerNode.spatialIntensity.init(0.0f, (float)sr);
    g_spatializerNode.bandsMid.init((float)sr);
    g_spatializerNode.bandsSide.init((float)sr);
    
    // Initialize Decorrelation Allpass filters for Rear
    // Using prime-ish numbers for decorrelation delays to scatter phases completely
    ap_init(&g_spatializerNode.rearApL[0], scaled_delay(227, sr), 0.6f);
    ap_init(&g_spatializerNode.rearApL[1], scaled_delay(401, sr), 0.6f);
    ap_init(&g_spatializerNode.rearApL[2], scaled_delay(587, sr), 0.6f);
    
    ap_init(&g_spatializerNode.rearApR[0], scaled_delay(233, sr), 0.6f);
    ap_init(&g_spatializerNode.rearApR[1], scaled_delay(409, sr), 0.6f);
    ap_init(&g_spatializerNode.rearApR[2], scaled_delay(593, sr), 0.6f);
    
    ma_node_config c3 = ma_node_config_init();
    c3.vtable = &g_psychoacoustic_vtable;
    c3.pInputChannels = g_inCh;
    c3.pOutputChannels = g_outCh;
    initNode(pg, &c3, &g_spatializerNode.baseNode);

    g_reverbNode.roomSize.init(0.84f, (float)sr);
    g_reverbNode.sampleRate = (float)sr;
    g_reverbNode.wetMix.init(0.28f, (float)sr);
    g_reverbNode.damp.init(0.50f, (float)sr);
    g_reverbNode.enabled.init(true, (float)sr);
    reverb_init_filters(&g_reverbNode, (float)sr);
    g_reverbNode.hpfL.init((float)sr, 150.0f);
    g_reverbNode.hpfR.init((float)sr, 150.0f);

    ma_node_config cRev = ma_node_config_init();
    cRev.vtable = &g_reverb_vtable;
    cRev.pInputChannels = g_inCh;
    cRev.pOutputChannels = g_outCh;
    initNode(pg, &cRev, &g_reverbNode.baseNode);

    g_convolutionNode.hpfL.init((float)sr, 150.0f);
    g_convolutionNode.blockSize = 512;
    g_convolutionNode.wetMix.init(1.0f, (float)sr);
    g_convolutionNode.blockAdapterL.init(512, 2);

    g_convolutionNode.hpfR.init((float)sr, 150.0f);

    ma_node_config cConv = ma_node_config_init();
    cConv.vtable = &g_convolution_vtable;
    cConv.pInputChannels = g_inCh;
    cConv.pOutputChannels = g_outCh;
    initNode(pg, &cConv, &g_convolutionNode.baseNode);

    g_compressorNode.threshold.init(0.251f, (float)sr);
    g_compressorNode.sampleRate = (float)sr;
    g_compressorNode.enabled.init(false, (float)sr);
    g_compressorNode.detectorCoef = 1.0f - expf(-2.0f * (float)M_PI * 180.0f / sr);
    g_compressorNode.makeupGain.init(1.0f, (float)sr);
    g_compressorNode.attackCoef = expf(-1.0f / (0.005f * (float)sr));
    g_compressorNode.releaseCoef = expf(-1.0f / (0.150f * (float)sr));
    g_compressorNode.delayLpStateL = 0.0f;
    g_compressorNode.delayLpStateR = 0.0f;
    g_compressorNode.crossL.init((float)sr, 180.0f);
    g_compressorNode.crossR.init((float)sr, 180.0f);
    g_compressorNode.delaySamples = (int)(0.001f * sr); // 1ms lookahead
    memset(g_compressorNode.dlyL, 0, sizeof(g_compressorNode.dlyL));
    memset(g_compressorNode.dlyR, 0, sizeof(g_compressorNode.dlyR));
    ma_node_config c5 = ma_node_config_init();
    c5.vtable = &g_multiband_compressor_vtable;
    c5.pInputChannels = g_inCh;
    c5.pOutputChannels = g_outCh;
    initNode(pg, &c5, &g_compressorNode.baseNode);

    g_limiterNode.boost.init(1.0f, (float)sr);
    g_limiterNode.master.init(g_outputGain.load(), (float)sr, 15.0f);
    g_limiterNode.gainEnv = 1.0f;
    g_limiterNode.gainSmooth = 1.0f;
    g_limiterNode.peakEnv = 0.0f;
    g_limiterNode.loudnessEnv = 0.0f;
    g_limiterNode.loudnessGain = 1.0f;
    g_limiterNode.loudnessAttackCoef = expf(-1.0f / (0.012f * (float)sr));
    g_limiterNode.loudnessReleaseCoef = expf(-1.0f / (0.220f * (float)sr));
    g_limiterNode.loudnessGainAttackCoef = expf(-1.0f / (0.010f * (float)sr));
    g_limiterNode.loudnessGainReleaseCoef = expf(-1.0f / (0.160f * (float)sr));
    g_limiterNode.loudnessSidechainCoef = 1.0f - expf(-2.0f * (float)M_PI * 120.0f / (float)sr);
    g_limiterNode.loudnessThreshold = 1.0f;
    g_limiterNode.loudnessRatio = 1.0f;
    g_limiterNode.loudnessMakeup = 1.0f;
    g_limiterNode.loudnessControlCounter = 0;
    g_limiterNode.attackCoef = expf(-1.0f / (0.0005f * (float)sr)); // Ultra-fast attack to prevent DAC hard-clipping
    g_limiterNode.releaseCoef = expf(-1.0f / (0.150f * (float)sr));
    g_limiterNode.delaySamples = (int)(0.002f * sr); // 2ms lookahead
    if (g_limiterNode.delaySamples >= LIMITER_LOOKAHEAD_SAMPLES) {
        g_limiterNode.delaySamples = LIMITER_LOOKAHEAD_SAMPLES - 1;
    }
    memset(g_limiterNode.dlyL, 0, sizeof(g_limiterNode.dlyL));
    memset(g_limiterNode.dlyR, 0, sizeof(g_limiterNode.dlyR));
    g_limiterNode.osDetect.init();
    g_limiterNode.sr = sr;
    ma_node_config c6 = ma_node_config_init();
    c6.vtable = &g_limiter_vtable;
    c6.pInputChannels = g_inCh;
    c6.pOutputChannels = g_outCh;
    initNode(pg, &c6, &g_limiterNode.baseNode);

    g_meterNode.crossLowL.init(sr, 180.0f);
    g_meterNode.crossLowR.init(sr, 180.0f);
    g_meterNode.crossHighL.init(sr, 8000.0f);
    g_meterNode.crossHighR.init(sr, 8000.0f);
    ma_node_config cMeter = ma_node_config_init();
    cMeter.vtable = &g_meter_vtable;
    cMeter.pInputChannels = g_inCh;
    cMeter.pOutputChannels = g_outCh;
    initNode(pg, &cMeter, &g_meterNode.baseNode);

    // Init the 9-Speaker Virtual Stage
    g_8DNode.init((float)sr, hrtfPath.empty() ? nullptr : hrtfPath.c_str());

    ma_node_config c8D = ma_node_config_init();
    c8D.vtable = &g_dynamic_spatializer_vtable;
    c8D.pInputChannels = g_inCh;
    c8D.pOutputChannels = g_outCh;
    initNode(pg, &c8D, &g_8DNode.baseNode);

    // Init Headphone Compensation Node
    g_headphoneCompNode.init((float)sr);
    ma_node_config cHeadphone = ma_node_config_init();
    cHeadphone.vtable = &g_headphone_comp_vtable;
    cHeadphone.pInputChannels = g_inCh;
    cHeadphone.pOutputChannels = g_outCh;
    initNode(pg, &cHeadphone, &g_headphoneCompNode.baseNode);


        g_subwooferNode.drive.set(g_bassGain.load());
        g_subwooferNode.field.set(g_bassField.load());
        g_subwooferNode.room.set(g_roomBass.load() ? 1.0f : 0.0f);
        g_exciterNode.drive.set(g_exciterNode.drive.target.load());
        g_8DNode.setSeparation(g_spatializerNode.spatialIntensity.target.load());
        g_8DNode.setDepth(g_spatializerNode.depthAmount.target.load());
        attach(&g_restorationNode.baseNode, &g_convolutionNode.baseNode);
        attach(&g_convolutionNode.baseNode, &g_audiophileEQNode.baseNode);
        attach(&g_audiophileEQNode.baseNode, &g_compressorNode.baseNode);
        attach(&g_compressorNode.baseNode, &g_subwooferNode.baseNode);
        attach(&g_subwooferNode.baseNode, &g_exciterNode.baseNode);
        attach(&g_exciterNode.baseNode, &g_widenerNode.baseNode);
        attach(&g_widenerNode.baseNode, &g_8DNode.baseNode);
        attach(&g_8DNode.baseNode, &g_spatializerNode.baseNode);
        attach(&g_spatializerNode.baseNode, &g_reverbNode.baseNode);
        attach(&g_reverbNode.baseNode, &g_headphoneCompNode.baseNode);
        attach(&g_headphoneCompNode.baseNode, &g_limiterNode.baseNode);
        attach(&g_limiterNode.baseNode, &g_meterNode.baseNode);
        attach(&g_meterNode.baseNode, ma_engine_get_endpoint(&g_engine));
        g_engineInitialized.store(true);
        audio_restore_impulses();
        restore_audio_parameters();
        audio_apply_pending_parameters();
        engine_reset_transport();
        callbackLoad.store(0); maximumCallbackLoad.store(0); overBudgetCallbacks.store(0);
        engine_resume();
        recoveryRequested.store(false);
        g_audioGeneration.fetch_add(1);
    } catch (...) {
        uninit_audio_engine();
    }
}
#ifdef DMEX_DSP_TESTS
extern "C" bool engine_init_offline(int rate) {
    offline = true;
    g_requestedSampleRate.store(rate);
    init_audio_engine();
    return g_engineInitialized.load();
}
extern "C" void engine_render_offline(float* output, ma_uint32 frames) {
    callback(nullptr, output, nullptr, frames);
}
#endif
extern "C" void audio_set_hrtf_path(const char* path) {
    std::lock_guard<std::recursive_mutex> owner(g_audioMutex);
    if (!g_engineInitialized.load()) hrtfPath = path ? path : "";
}
void audio_rebuild_spatial_renderer() {
    g_8DNode.init(static_cast<float>(engine_get_sample_rate()), hrtfPath.empty() ? nullptr : hrtfPath.c_str());
}
extern "C" void uninit_audio_engine() {
    std::lock_guard<std::recursive_mutex> owner(g_audioMutex);
    engine_suspend();
    engine_release_source();
    while (nodeCount) ma_node_uninit(nodes[--nodeCount], nullptr);
    delete g_convolutionNode.convL.exchange(nullptr);
    delete g_convolutionNode.convR.exchange(nullptr);
    delete g_headphoneCompNode.convL.exchange(nullptr);
    delete g_headphoneCompNode.convR.exchange(nullptr);
    if (engineReady) { ma_engine_uninit(&g_engine); engineReady = false; }
    if (streamResourcesReady) { ma_resource_manager_uninit(&streamResources); streamResourcesReady = false; }
    if (deviceReady) { ma_device_uninit(&g_device); deviceReady = false; }
    g_engineInitialized.store(false);
}

extern "C" int get_audio_status_json(char* output, int capacity) {
    std::lock_guard<std::recursive_mutex> owner(g_audioMutex);
    if (!output || capacity < 512) return -1;
    const int length = std::snprintf(output, capacity,
        "{\"ready\":%s,\"bypassAll\":%s,\"ecoMode\":%s,\"sampleRate\":%d,\"requestedSampleRate\":%d,"
        "\"generation\":%llu,\"measuredHrtf\":%s,\"spatialAvailable\":%s,\"outputPeak\":%.6f,"
        "\"limiterGain\":%.6f,\"subBassHz\":%.0f,\"bassField\":%.4f,\"roomBass\":%s,"
        "\"vocalPresence\":%.4f,\"adaptiveLoudness\":%s,\"roomSize\":%.4f,\"damping\":%.4f,"
        "\"correctionAvailable\":%s,\"convolutionAvailable\":%s,\"recoveryRequested\":%s,\"processingDelayFrames\":%d,"
        "\"callbackLoadPercent\":%.4f,\"maximumCallbackLoadPercent\":%.4f,\"overBudgetCallbacks\":%u,\"irRestoreFailed\":%s,\"autoReverb\":%s,\"portableHrtf\":%s}",
        g_engineInitialized.load() ? "true" : "false", g_bypassAll.load() ? "true" : "false",
        g_ecoMode.load() ? "true" : "false", engine_get_sample_rate(), g_requestedSampleRate.load(),
        g_audioGeneration.load(), g_8DNode.upmixer.hrtfMeasured() ? "true" : "false",
        g_8DNode.hrtfAvailable() ? "true" : "false", g_outputPeak.load(), g_limiterGR.load(),
        g_subBassHz.load(), g_bassField.load(), g_roomBass.load() ? "true" : "false",
        g_presenceBoost.load(), g_isAdaptiveLoudnessOn.load() ? "true" : "false",
        g_reverbNode.roomSize.target.load(), g_reverbNode.damp.target.load(),
        g_headphoneCompNode.convL.load() ? "true" : "false",
        g_convolutionNode.convL.load() ? "true" : "false", recoveryRequested.load() ? "true" : "false",
        g_bypassAll.load() ? 0 : 1024 + 40 + g_compressorNode.delaySamples + g_limiterNode.delaySamples,
        callbackLoad.load(), maximumCallbackLoad.load(), overBudgetCallbacks.load(), g_irRestoreFailed.load() ? "true" : "false",
        g_reverbNode.automatic.load() ? "true" : "false", g_8DNode.upmixer.hrtfPortable() ? "true" : "false");
    return length >= capacity ? -1 : length;
}
