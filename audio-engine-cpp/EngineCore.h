#pragma once
#include "miniaudio.h"
#include "DSP_Nodes.h"
#include "Telemetry.h"
#include <atomic>
#include <mutex>
#include <string>

extern ma_engine g_engine;
extern ma_device g_device;
extern ma_sound g_sound;
extern std::atomic<bool> g_engineInitialized;
extern bool g_soundInitialized;
extern std::recursive_mutex g_audioMutex;
extern std::mutex g_irMutex, g_pathMutex;
extern std::string g_lastLoadedPath;
extern std::atomic<float> g_bassGain, g_subBassHz, g_bassField, g_bassMotionHz;
extern std::atomic<float> g_trebleGain, g_denoiseIntensity, g_upscaleTarget, g_presenceBoost;
extern std::atomic<float> g_outputGain, g_masterVolume, g_outputPeak;
extern std::atomic<bool> g_roomBass, g_bypassAll, g_ecoMode;
extern std::atomic<bool> g_pauseRequested;
extern std::atomic<bool> g_irRestoreFailed;
extern std::atomic<bool> g_isRemasterOn, g_isFIRModeOn, g_isUpscaleOn, g_isWidenOn;
extern std::atomic<bool> g_isCompressOn, g_isReverbOn, g_isConvolutionOn;
extern std::atomic<bool> g_isAndroidSpeaker, g_isLaptopSpeaker, g_is8DModeOn;
extern std::atomic<bool> g_isAdaptiveLoudnessOn, g_trackFinished;
extern std::atomic<int> g_requestedSampleRate;
extern std::atomic<unsigned long long> g_audioGeneration;
extern StudioExciterNode g_exciterNode;
extern StereoWidenerNode g_widenerNode;
extern PsychoacousticNode g_spatializerNode;
extern AudiophileEQNode g_audiophileEQNode;
extern ReverbNode g_reverbNode;
extern ConvolutionNode g_convolutionNode;
extern MultibandCompressorNode g_compressorNode;
extern LimiterNode g_limiterNode;
extern MeterNode g_meterNode;
extern SubwooferNode g_subwooferNode;
extern DynamicSpatializerNode g_8DNode;
extern AudioRestorationNode g_restorationNode;
extern HeadphoneCompNode g_headphoneCompNode;
extern ma_uint32 g_channels, g_inCh[1], g_outCh[1];

extern "C" void init_audio_engine();
extern "C" void uninit_audio_engine();
extern "C" int engine_get_sample_rate();
extern "C" int execute_audio_command(const char* command);
extern "C" int get_audio_status_json(char* output, int capacity);
extern "C" int apply_audio_settings(const float* values, int count);
void updateRouting();
void engine_suspend();
bool engine_is_rendering();
void engine_resume();
void engine_reset_transport();
void engine_release_source();
void restore_audio_parameters();
void audio_apply_pending_parameters();
extern "C" void audio_set_hrtf_path(const char* path);
extern "C" void audio_request_device_pause();
void audio_rebuild_spatial_renderer();
void audio_restore_impulses();
