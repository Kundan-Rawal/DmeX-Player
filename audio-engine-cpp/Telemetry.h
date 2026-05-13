#pragma once
#include "miniaudio.h"
#include <atomic>

// Global Atomics for React UI
extern std::atomic<float> g_audioLevel;
extern std::atomic<float> g_bLvl, g_bPan;
extern std::atomic<float> g_mLvl, g_mPan, g_mPhase;
extern std::atomic<float> g_tLvl, g_tPan, g_tPhase;

struct MeterNode {
    ma_node_base baseNode;
    float lowL, lowR, highStateL, highStateR;
};

extern ma_node_vtable g_meter_vtable;

// Functions to expose data to React
extern "C" {
    void get_audio_metrics(float *out_data, float *out_level);
    bool analyze_audio(float *sc_out, float *cf_out, float *zcr_out, float *rms_out);
}