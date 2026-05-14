#pragma once
#include "miniaudio.h"
#include "DSP_Nodes.h"
#include "Telemetry.h"
#include <string>
#include <mutex>

// Miniaudio core
extern ma_engine g_engine;
extern ma_sound g_sound;
extern bool g_soundInitialized;
extern bool g_engineInitialized;

// Global settings
extern float g_bassGain;
extern std::mutex g_irMutex;
extern std::mutex g_pathMutex;
extern std::mutex g_audioMutex;
extern std::string g_lastLoadedPath;

// Effect Toggles (Notice g_isLimiterOn is intentionally DELETED)
extern bool g_isRemasterOn;
extern bool g_isFIRModeOn;
extern bool g_isUpscaleOn;
extern bool g_isWidenOn;
extern bool g_isCompressOn;
extern bool g_isReverbOn;
extern bool g_isConvolutionOn;

// Node Instances
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

// Channel Config
extern ma_uint32 g_channels;
extern ma_uint32 g_inCh[1];
extern ma_uint32 g_outCh[1];

// Core Functions
extern "C" void init_audio_engine();
void updateRouting();