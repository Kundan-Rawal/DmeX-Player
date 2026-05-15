#define _CRT_SECURE_NO_WARNINGS
#include "EngineCore.h"
#include "Telemetry.h"
#include <string>
#include <vector>
#include <cstring>
#include <cmath>
#include <mutex>

#define MAX_IR_SAMPLES 2048

using namespace std;

// ================================================================
// SYMPHONIA RUST FFI BRIDGE
// ================================================================
extern "C"
{
    struct RustAudioBuffer
    {
        float *data;
        uint64_t total_samples;
        uint64_t capacity; // <-- CRITICAL: YOU MUST ADD THIS LINE HERE
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
    std::lock_guard<std::mutex> lock(g_audioMutex); // <-- PROTECT THIS
    MemoryDataSource *m = (MemoryDataSource *)pDS;

    if (!m->buffer || m->buffer->channels == 0)
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
    std::lock_guard<std::mutex> lock(g_audioMutex); // <-- PROTECT THIS
    MemoryDataSource *m = (MemoryDataSource *)pDS;
    if (!m->buffer || m->buffer->channels == 0)
        return MA_INVALID_OPERATION;
    uint64_t total_frames = m->buffer->total_samples / m->buffer->channels;
    m->cursor_frames = (frameIndex > total_frames) ? total_frames : frameIndex;
    return MA_SUCCESS;
}

static ma_result mem_ds_get_format(ma_data_source *pDS, ma_format *pFormat, ma_uint32 *pChannels, ma_uint32 *pSampleRate, ma_channel *pChannelMap, size_t cmCap)
{
    // CRITICAL FIX: Silence compiler warnings for parameters we don't need to use
    (void)pChannelMap;
    (void)cmCap;

    MemoryDataSource *m = (MemoryDataSource *)pDS;
    if (!m->buffer || m->buffer->channels == 0 || m->buffer->sample_rate == 0)
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
    if (!m->buffer || m->buffer->channels == 0)
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

ma_data_source_vtable g_mem_vtable = {mem_ds_read, mem_ds_seek, mem_ds_get_format, mem_ds_get_cursor, mem_ds_get_length, NULL, 0};
MemoryDataSource g_symSource;
bool g_usingSymphonia = false;

// ================================================================
// EXPORTED API FOR RUST/REACT
// ================================================================
static std::mutex g_commandMutex;

extern "C" void execute_audio_command(const char *cmd_in)
{
    std::lock_guard<std::mutex> cmdLock(g_commandMutex);

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

            {
                std::lock_guard<std::mutex> lock(g_audioMutex);
                if (g_usingSymphonia && g_symSource.buffer)
                {
                    rust_free_audio_buffer(g_symSource.buffer);
                    g_symSource.buffer = nullptr;
                    g_usingSymphonia = false;
                }
            }
            g_soundInitialized = false;
        }
        g_audioLevel.store(0.0f, std::memory_order_relaxed);

        RustAudioBuffer *new_buf = rust_decode_file(args.c_str());
        if (new_buf)
        {
            {
                std::lock_guard<std::mutex> lock(g_audioMutex);
                memset(&g_symSource, 0, sizeof(g_symSource));
                ma_data_source_config baseConfig = ma_data_source_config_init();
                baseConfig.vtable = &g_mem_vtable;
                ma_data_source_init(&baseConfig, &g_symSource.base);
                g_symSource.buffer = new_buf;
                g_symSource.cursor_frames = 0;
            }

            if (ma_sound_init_from_data_source(&g_engine, &g_symSource, 0, NULL, &g_sound) == MA_SUCCESS)
            {
                g_usingSymphonia = true;
                g_soundInitialized = true;
                {
                    std::lock_guard<std::mutex> lk(g_pathMutex);
                    g_lastLoadedPath = args;
                }
                updateRouting(); // <--- ONLY NEEDED ON LOAD NOW
            }
            else
            {
                std::lock_guard<std::mutex> lock(g_audioMutex);
                rust_free_audio_buffer(new_buf);
                g_symSource.buffer = nullptr;
                std::lock_guard<std::mutex> lk(g_pathMutex);
                g_lastLoadedPath.clear();
            }
        }
        else
        {
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
                updateRouting(); // <--- ONLY NEEDED ON LOAD NOW
            }
        }
    }
    else if (command == "STOP")
    {
        if (g_soundInitialized)
        {
            ma_sound_stop(&g_sound);
            ma_sound_uninit(&g_sound);
            {
                std::lock_guard<std::mutex> lock(g_audioMutex);
                if (g_usingSymphonia && g_symSource.buffer)
                {
                    rust_free_audio_buffer(g_symSource.buffer);
                    g_symSource.buffer = nullptr;
                    g_usingSymphonia = false;
                }
            }
            g_soundInitialized = false;
        }
    }
    else if (command == "PLAY" && g_soundInitialized)
        ma_sound_start(&g_sound);
    else if (command == "PAUSE" && g_soundInitialized)
        ma_sound_stop(&g_sound);
    else if (command == "VOLUME" && !args.empty())
        ma_engine_set_volume(&g_engine, stof(args));
    else if (command == "SEEK" && g_soundInitialized)
    {
        ma_uint32 sr = ma_engine_get_sample_rate(&g_engine);
        ma_sound_seek_to_pcm_frame(&g_sound, (ma_uint64)(stof(args) * (float)sr));

        g_subwooferNode.lp1L = g_subwooferNode.lp2L = g_subwooferNode.lp1R = g_subwooferNode.lp2R = 0.0f;
        memset(g_spatializerNode.haasBufL, 0, sizeof(g_spatializerNode.haasBufL));
        memset(g_spatializerNode.itdBufL, 0, sizeof(g_spatializerNode.itdBufL));
        memset(g_spatializerNode.itdBufR, 0, sizeof(g_spatializerNode.itdBufR));
        g_spatializerNode.shadowStateL = g_spatializerNode.shadowStateR = 0.0f;
        g_spatializerNode.notchStateL1 = g_spatializerNode.notchStateL2 = 0.0f;
        g_spatializerNode.notchStateR1 = g_spatializerNode.notchStateR2 = 0.0f;
        g_spatializerNode.crossHpL = g_spatializerNode.crossHpR = 0.0f;
        g_spatializerNode.sideHp = 0.0f;
    }
    else if (command == "REMASTER")
    {
        g_isRemasterOn = (stoi(args) == 1);
        if (g_isRemasterOn)
        {
            g_audiophileEQNode.targetBass.store(1.6f, std::memory_order_relaxed);
            g_audiophileEQNode.targetMid.store(0.7f, std::memory_order_relaxed);
            g_audiophileEQNode.targetHigh.store(1.4f, std::memory_order_relaxed);
        }
        else if (!g_isFIRModeOn)
        {
            g_audiophileEQNode.targetBass.store(1.0f, std::memory_order_relaxed);
            g_audiophileEQNode.targetMid.store(1.0f, std::memory_order_relaxed);
            g_audiophileEQNode.targetHigh.store(1.0f, std::memory_order_relaxed);
        }
    }
    else if (command == "FIRMODE")
    {
        g_isFIRModeOn = (stoi(args) == 1);
    }
    else if (command == "FIRGAIN")
    {
        float b = 1.15f, m = 0.90f, h = 1.15f;
        sscanf(args.c_str(), "%f %f %f", &b, &m, &h);
        auto clamp = [](float v)
        { return v < 0.0f ? 0.0f : v > 2.0f ? 2.0f
                                            : v; };
        if (g_isFIRModeOn)
        {
            g_audiophileEQNode.targetBass.store(clamp(b), std::memory_order_relaxed);
            g_audiophileEQNode.targetMid.store(clamp(m), std::memory_order_relaxed);
            g_audiophileEQNode.targetHigh.store(clamp(h), std::memory_order_relaxed);
        }
    }
    else if (command == "COMPRESS")
    {
        g_isCompressOn = (stoi(args) == 1);
    }
    else if (command == "UPSCALE")
    {
        float d = stof(args);
        g_exciterNode.targetDrive = d * 4.0f;
        g_isUpscaleOn = (d > 0.01f);
    }
    else if (command == "WIDEN")
    {
        float w = stof(args);
        g_widenerNode.width = w;
        g_isWidenOn = (w > 1.01f);
    }
    else if (command == "3D")
    {
        float val = stof(args);
        g_spatializerNode.spatialIntensity = val * 0.50f;
    }
    else if (command == "BASS")
    {
        g_bassGain = stof(args);
    }
    else if (command == "LOAD_IR")
    {
        if (g_convolutionNode.irDataL)
        {
            free(g_convolutionNode.irDataL);
            g_convolutionNode.irDataL = nullptr;
        }
        if (g_convolutionNode.irDataR)
        {
            free(g_convolutionNode.irDataR);
            g_convolutionNode.irDataR = nullptr;
        }
        if (g_convolutionNode.historyL)
        {
            free(g_convolutionNode.historyL);
            g_convolutionNode.historyL = nullptr;
        }
        if (g_convolutionNode.historyR)
        {
            free(g_convolutionNode.historyR);
            g_convolutionNode.historyR = nullptr;
        }

        if (args.empty())
        {
            std::lock_guard<std::mutex> lock(g_irMutex);
            g_convolutionNode.irLength = 0;
            g_convolutionNode.historyIdx = 0;
            g_convolutionNode.hpStateL = g_convolutionNode.hpStateR = 0.0f;
            g_convolutionNode.lpStateL = g_convolutionNode.lpStateR = 0.0f;
            g_convolutionNode.wetMix = 0.0f;
            g_isConvolutionOn = false;
            return;
        }

        ma_decoder_config dcfg = ma_decoder_config_init(ma_format_f32, 2, 44100);
        ma_decoder dec;
        if (ma_decoder_init_file(args.c_str(), &dcfg, &dec) != MA_SUCCESS)
            return;

        float *tempInterleaved = (float *)calloc(MAX_IR_SAMPLES * 2, sizeof(float));
        ma_uint64 framesRead = 0;
        ma_decoder_read_pcm_frames(&dec, tempInterleaved, MAX_IR_SAMPLES, &framesRead);
        ma_decoder_uninit(&dec);

        if (framesRead == 0)
        {
            free(tempInterleaved);
            return;
        }

        float *newIrL = (float *)calloc(framesRead, sizeof(float));
        float *newIrR = (float *)calloc(framesRead, sizeof(float));
        float *newHistL = (float *)calloc(framesRead, sizeof(float));
        float *newHistR = (float *)calloc(framesRead, sizeof(float));
        for (ma_uint64 i = 0; i < framesRead; i++)
        {
            newIrL[i] = tempInterleaved[i * 2];
            newIrR[i] = tempInterleaved[i * 2 + 1];
        }
        free(tempInterleaved);

        {
            std::lock_guard<std::mutex> lock(g_irMutex);
            g_convolutionNode.irDataL = newIrL;
            g_convolutionNode.irDataR = newIrR;
            g_convolutionNode.historyL = newHistL;
            g_convolutionNode.historyR = newHistR;
            g_convolutionNode.irLength = (int)framesRead;
            g_convolutionNode.historyIdx = 0;
            g_convolutionNode.hpStateL = g_convolutionNode.hpStateR = 0.0f;
            g_convolutionNode.lpStateL = g_convolutionNode.lpStateR = 0.0f;
        }
    }
    else if (command == "LOAD_IR_DUAL")
    {
        size_t delimiter = args.find('|');
        if (delimiter == string::npos)
            return;
        string pathL = args.substr(0, delimiter);
        string pathR = args.substr(delimiter + 1);

        ma_decoder_config dcfg = ma_decoder_config_init(ma_format_f32, 1, 44100);
        ma_decoder decL, decR;

        if (ma_decoder_init_file(pathL.c_str(), &dcfg, &decL) != MA_SUCCESS)
            return;
        float *tempL = (float *)calloc(MAX_IR_SAMPLES, sizeof(float));
        ma_uint64 framesL = 0;
        ma_decoder_read_pcm_frames(&decL, tempL, MAX_IR_SAMPLES, &framesL);
        ma_decoder_uninit(&decL);

        if (ma_decoder_init_file(pathR.c_str(), &dcfg, &decR) != MA_SUCCESS)
        {
            free(tempL);
            return;
        }
        float *tempR = (float *)calloc(MAX_IR_SAMPLES, sizeof(float));
        ma_uint64 framesR = 0;
        ma_decoder_read_pcm_frames(&decR, tempR, MAX_IR_SAMPLES, &framesR);
        ma_decoder_uninit(&decR);

        ma_uint64 maxFrames = (framesL > framesR) ? framesL : framesR;
        if (maxFrames == 0)
        {
            free(tempL);
            free(tempR);
            return;
        }

        float *newIrL = (float *)calloc(maxFrames, sizeof(float));
        float *newIrR = (float *)calloc(maxFrames, sizeof(float));
        float *newHistL = (float *)calloc(maxFrames, sizeof(float));
        float *newHistR = (float *)calloc(maxFrames, sizeof(float));
        for (ma_uint64 i = 0; i < framesL; i++)
            newIrL[i] = tempL[i];
        for (ma_uint64 i = 0; i < framesR; i++)
            newIrR[i] = tempR[i];
        free(tempL);
        free(tempR);

        {
            std::lock_guard<std::mutex> lock(g_irMutex);
            g_convolutionNode.irDataL = newIrL;
            g_convolutionNode.irDataR = newIrR;
            g_convolutionNode.historyL = newHistL;
            g_convolutionNode.historyR = newHistR;
            g_convolutionNode.irLength = (int)maxFrames;
            g_convolutionNode.historyIdx = 0;
            g_convolutionNode.hpStateL = g_convolutionNode.hpStateR = 0.0f;
            g_convolutionNode.lpStateL = g_convolutionNode.lpStateR = 0.0f;
        }
    }
    else if (command == "REVERB")
    {
        float w = stof(args);
        g_reverbNode.wetMix = w;
        g_isReverbOn = (w > 0.005f);
        if (g_isReverbOn)
            g_isConvolutionOn = false;
    }
    else if (command == "CONVOLUTION")
    {
        float w = stof(args);
        g_convolutionNode.wetMix = w;
        g_isConvolutionOn = (w > 0.005f);
        if (g_isConvolutionOn)
            g_isReverbOn = false;
    }
    else if (command == "LIMITER")
    {
        float val = stof(args);
        g_limiterNode.boost = 1.0f + (val * 1.2f);
        g_limiterNode.gainEnv = 1.0f;
    }
    else if (command == "ANDROID_SPEAKER")
    {
        g_isAndroidSpeaker = (stoi(args) == 1);
    }
}

extern "C" void get_audio_metrics(float *out_data, float *out_level)
{
    if (!g_soundInitialized || !g_engineInitialized)
    {
        memset(out_data, 0, 10 * sizeof(float));
        out_data[6] = 1.0f;
        out_data[9] = 1.0f;
        *out_level = 0.0f;
        return;
    }

    {
        std::lock_guard<std::mutex> lock(g_audioMutex); // <-- PROTECT THIS
        if (g_usingSymphonia && g_symSource.buffer)
        {
            uint32_t ch = g_symSource.buffer->channels;
            uint32_t sr = g_symSource.buffer->sample_rate;
            if (ch == 0 || sr == 0)
                return;

            out_data[0] = (float)g_symSource.cursor_frames / (float)sr;
            out_data[1] = (float)(g_symSource.buffer->total_samples / ch) / (float)sr;
        }
        else
        {
            ma_sound_get_cursor_in_seconds(&g_sound, &out_data[0]);
            ma_sound_get_length_in_seconds(&g_sound, &out_data[1]);
        }
    }
    out_data[2] = g_bLvl.load(std::memory_order_relaxed);
    out_data[3] = g_bPan.load(std::memory_order_relaxed);
    out_data[4] = g_mLvl.load(std::memory_order_relaxed);
    out_data[5] = g_mPan.load(std::memory_order_relaxed);
    out_data[6] = g_mPhase.load(std::memory_order_relaxed);
    out_data[7] = g_tLvl.load(std::memory_order_relaxed);
    out_data[8] = g_tPan.load(std::memory_order_relaxed);
    out_data[9] = g_tPhase.load(std::memory_order_relaxed);
    *out_level = g_audioLevel.load(std::memory_order_relaxed);
}

extern "C" bool analyze_audio(float *sc_out, float *cf_out, float *zcr_out, float *rms_out)
{
    std::lock_guard<std::mutex> lock(g_audioMutex); // <-- PROTECT THIS
    if (g_usingSymphonia && g_symSource.buffer)
    {
        uint64_t total = g_symSource.buffer->total_samples;
        uint32_t ch = g_symSource.buffer->channels;
        // CRITICAL FIX: Safe exit if buffer states zero channels
        if (ch == 0)
            return false;

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
    return false;
}