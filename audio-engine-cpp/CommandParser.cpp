#define _CRT_SECURE_NO_WARNINGS
#include "EngineCore.h"
#include "StreamingDecoder.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <memory>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <vector>
#ifdef __ANDROID__
#include <android/log.h>
#endif

extern "C" {
struct RustAudioBuffer { float* data; uint64_t total_samples, capacity; uint32_t channels, sample_rate; };
char* rust_prepare_audio_file(const char*, uint32_t);
char* rust_prepare_impulse(const char*, uint32_t);
void rust_free_audio_path(char*);
}
namespace {
std::string playbackPath;
std::string correctionPath, convolutionPath;
float correctionStrength = 1.0f, convolutionWet = 0.0f;
std::array<float, 20> settings{0.25f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f,
    52.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.84f, 0.50f, 0.0f, 0.0f, 0.0f, 0.0f};

std::mutex parameterMutex;
std::array<float, 20> pendingSettings{};
std::atomic<bool> parametersPending{false};

float number(const std::string& text) {
    std::istringstream stream(text);
    float value; char extra;
    if (!(stream >> value) || (stream >> extra) || !std::isfinite(value))
        throw std::runtime_error("Invalid numeric audio control");
    return value;
}
float bounded(float v, float low, float high) { return (std::clamp)(v, low, high); }
struct Suspended {
    bool resume;
    Suspended() : resume(engine_is_rendering()) { engine_suspend(); }
    ~Suspended() { if (resume) try { engine_resume(); } catch (...) {} }
};
void installIR(const float* left, int nL, const float* right, int nR, bool correction) {
    if (!left || !right || nL <= 0 || nR <= 0 || nL > engine_get_sample_rate() * 4 + 2048 || nR > engine_get_sample_rate() * 4 + 2048)
        throw std::runtime_error("Invalid or overlong impulse response");
    auto l = std::make_unique<FFTConvolver>(), r = std::make_unique<FFTConvolver>();
    if (!l->prepare(left, nL, 512) || !r->prepare(right, nR, 512)) throw std::runtime_error("IR preparation failed");
    Suspended suspend;
    if (correction) {
        delete g_headphoneCompNode.convL.exchange(l.release());
        delete g_headphoneCompNode.convR.exchange(r.release());
        g_headphoneCompNode.blockAdapterL.reset();
        g_headphoneCompNode.blockAdapterR.reset();
        g_headphoneCompNode.enabled.set(true);
    } else {
        delete g_convolutionNode.convL.exchange(l.release());
        delete g_convolutionNode.convR.exchange(r.release());
        g_convolutionNode.blockAdapterL.reset();
        g_convolutionNode.blockAdapterR.reset();
    }
}
std::vector<float> decodeIR(const std::string& path, int channels) {
    char* prepared = rust_prepare_impulse(path.c_str(),engine_get_sample_rate());
    if (!prepared) throw std::runtime_error("Impulse response preparation failed");
    const std::string cached(prepared); rust_free_audio_path(prepared);
    ma_decoder decoder;
    auto config = ma_decoder_config_init(ma_format_f32, channels, engine_get_sample_rate());
    if (ma_decoder_init_file(cached.c_str(), &config, &decoder) != MA_SUCCESS)
        throw std::runtime_error("Impulse response could not be decoded");
    struct DecoderGuard { ma_decoder* value; ~DecoderGuard() { ma_decoder_uninit(value); } } guard{&decoder};
    ma_uint64 total = 0;
    if (ma_decoder_get_length_in_pcm_frames(&decoder, &total) != MA_SUCCESS ||
        total == 0 || total > static_cast<ma_uint64>(engine_get_sample_rate()) * 4 + 2048)
        throw std::runtime_error("Impulse response exceeds the four-second budget");
    std::vector<float> samples(total * channels);
    ma_uint64 count = 0;
    if (ma_decoder_read_pcm_frames(&decoder, samples.data(), total, &count) < 0 || count == 0)
        throw std::runtime_error("Impulse response is empty");
    samples.resize(count * channels);
    if (!std::all_of(samples.begin(), samples.end(), [](float v) { return std::isfinite(v); }))
        throw std::runtime_error("Impulse response contains invalid samples");
    return samples;
}
void loadIR(const std::string& path, bool correction) {
    if (path.empty() || path == "OFF" || path == "NONE" || path == "0") {
        if (correction) g_headphoneCompNode.enabled.set(false);
        else { g_isConvolutionOn.store(false); g_convolutionNode.wetMix.set(0.0f); }
        return;
    }
    const auto separator = path.find('|');
    std::vector<float> left, right;
    if (separator != std::string::npos) {
        left = decodeIR(path.substr(0, separator), 1);
        right = decodeIR(path.substr(separator + 1), 1);
    } else {
        const auto stereo = decodeIR(path, 2);
        for (size_t i = 0; i < stereo.size(); i += 2) { left.push_back(stereo[i]); right.push_back(stereo[i+1]); }
    }
    installIR(left.data(), static_cast<int>(left.size()), right.data(), static_cast<int>(right.size()), correction);
}
}

void audio_restore_impulses() {
    g_irRestoreFailed.store(false);
    try { if (!correctionPath.empty()) loadIR(correctionPath, true); }
    catch (...) { correctionPath.clear(); g_headphoneCompNode.enabled.set(false); g_irRestoreFailed.store(true); }
    try { if (!convolutionPath.empty()) loadIR(convolutionPath, false); }
    catch (...) { convolutionPath.clear(); convolutionWet=0; g_irRestoreFailed.store(true); }
    g_headphoneCompNode.strength.set(correctionStrength);
    g_convolutionNode.wetMix.set(convolutionWet);
    g_isConvolutionOn.store(convolutionWet > 0 && !convolutionPath.empty());
}

static void applyTargets(const std::array<float,20>& values) {
    g_bassGain.store(values[0]);
    g_trebleGain.store(values[1]);
    g_exciterNode.drive.set(values[2]);
    g_isUpscaleOn.store(values[2] > 0 || values[16] > 0);
    g_widenerNode.width.set(values[3]);
    g_isWidenOn.store(values[3] != 1);
    g_spatializerNode.spatialIntensity.set(0.0f);
    g_8DNode.setSeparation(values[4]);
    g_8DNode.setDepth(values[5]);
    g_reverbNode.wetMix.set(values[6]);
    g_isReverbOn.store(values[6] > 0);
    g_isCompressOn.store(values[7] > 0.5f);
    g_outputGain.store(values[8] * (1.0f + values[18]));
    g_masterVolume.store(values[8]);
    g_subBassHz.store(values[9]);
    g_bassField.store(values[10]);
    g_roomBass.store(values[11] > 0.5f);
    g_presenceBoost.store(values[12]);
    g_isAdaptiveLoudnessOn.store(values[13] > 0.5f);
    g_reverbNode.roomSize.set(values[14]);
    g_reverbNode.damp.set(values[15]);
    g_upscaleTarget.store(values[16]);
    g_is8DModeOn.store(values[17] > 0.5f);
    g_isAndroidSpeaker.store(values[19] == 2);
    g_isLaptopSpeaker.store(values[19] == 1);
}
void restore_audio_parameters() {
    std::lock_guard<std::mutex> publish(parameterMutex);
    pendingSettings = settings;
    parametersPending.store(true, std::memory_order_release);
}
void audio_apply_pending_parameters() {
    if (!parametersPending.load(std::memory_order_acquire)) return;
    std::unique_lock<std::mutex> publish(parameterMutex, std::try_to_lock);
    if (!publish.owns_lock()) return;
    const auto values = pendingSettings;
    parametersPending.store(false, std::memory_order_release);
    publish.unlock();
    applyTargets(values);
}
void engine_release_source() {
    if (g_soundInitialized) {
        ma_sound_stop(&g_sound);
        ma_sound_uninit(&g_sound);
        g_soundInitialized = false;
    }
    engine_reset_transport();
}
extern "C" int apply_audio_settings(const float* values, int count) {
    std::lock_guard<std::recursive_mutex> owner(g_audioMutex);
    try {
        if (!values || count != static_cast<int>(settings.size())) return -1;
        std::array<float, 20> prepared;
        std::copy(values, values + count, prepared.begin());
        if (!std::all_of(prepared.begin(), prepared.end(), [](float v) { return std::isfinite(v); })) return -1;
        if (prepared[0] < 0 || prepared[0] > 2.1f || std::abs(prepared[1]) > 12 ||
            prepared[2] < 0 || prepared[2] > 1 || prepared[3] < 1 || prepared[3] > 2.5f ||
            prepared[8] < 0 || prepared[8] > 1 || prepared[14] < 0.2f || prepared[14] > 0.98f ||
            prepared[15] < 0 || prepared[15] > 0.95f || prepared[19] < 0 || prepared[19] > 2) return -1;
        const float anchors[]{30,40,52,60,70,80};
        if (std::find(std::begin(anchors), std::end(anchors), prepared[9]) == std::end(anchors)) return -1;
        for (int i : {4,5,6,7,10,11,12,13,16,17,18}) if (prepared[i] < 0 || prepared[i] > 1) return -1;
        for (int i : {7,11,13,17}) if (prepared[i] != 0 && prepared[i] != 1) return -1;
        if (prepared[19] != std::floor(prepared[19])) return -1;
        if (!g_engineInitialized.load()) init_audio_engine();
        if (!g_engineInitialized.load()) return -1;
        settings = prepared;
        restore_audio_parameters();
        g_audioGeneration.fetch_add(1);
        return 0;
    } catch (...) { return -1; }
}
extern "C" void get_audio_settings(float* output) {
    std::lock_guard<std::recursive_mutex> owner(g_audioMutex);
    std::copy(settings.begin(), settings.end(), output);
}
extern "C" int execute_audio_command(const char* input) {
    std::lock_guard<std::recursive_mutex> owner(g_audioMutex);
    try {
        if (!input) return -1;
        const std::string full(input);
        const auto split = full.find(' ');
        const auto command = full.substr(0, split);
        const auto args = split == std::string::npos ? "" : full.substr(split + 1);
        if (!g_engineInitialized.load()) init_audio_engine();
        if (!g_engineInitialized.load()) return -1;
        if (command == "LOAD") {
            const auto loadStart = std::chrono::steady_clock::now();
            ma_uint32 originalRate = 0;
            ma_uint64 length = 0;
            g_streamTargetRate.store(g_bypassAll.load() ? 0 : engine_get_sample_rate());
            if (stream_probe(args.c_str(), g_streamTargetRate.load(), &originalRate, &length) != MA_SUCCESS) return -1;
            Suspended suspend;
            engine_release_source();
            if (g_bypassAll.load()) {
                if (static_cast<int>(originalRate) != engine_get_sample_rate()) {
                    const int selectedRate = g_requestedSampleRate.load();
                    uninit_audio_engine(); g_requestedSampleRate.store(originalRate); init_audio_engine();
                    g_requestedSampleRate.store(selectedRate);
                    if (!g_engineInitialized.load()) return -1;
                    engine_suspend();
                }
            }
            const ma_uint32 flags = MA_SOUND_FLAG_STREAM | MA_SOUND_FLAG_NO_SPATIALIZATION | MA_SOUND_FLAG_NO_PITCH |
                (length == std::numeric_limits<ma_uint64>::max() ? MA_SOUND_FLAG_UNKNOWN_LENGTH : 0);
            if (ma_sound_init_from_file(&g_engine, args.c_str(), flags, nullptr, nullptr, &g_sound) != MA_SUCCESS) return -1;
            g_soundInitialized = true;
            g_lastLoadedPath = args;
            playbackPath = args;
            dsp_flush_all_state();
            restore_audio_parameters();
            updateRouting();
            const auto elapsed = static_cast<long long>(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - loadStart).count());
#ifdef __ANDROID__
            __android_log_print(ANDROID_LOG_INFO, "DmeXAudio", "Stream ready in %lld ms", elapsed);
#else
            std::fprintf(stderr, "[Playback] Stream ready in %lld ms\n", elapsed);
#endif
        } else if (command == "STOP") {
            Suspended suspend; engine_release_source(); dsp_flush_all_state(); restore_audio_parameters();
            g_lastLoadedPath.clear(); playbackPath.clear();
        } else if (command == "AUTO_REVERB") {
            const float value = number(args);
            if (value != 0 && value != 1) return -1;
            g_reverbNode.automatic.store(value == 1);
        } else if (command == "PLAY") {
            if (!g_soundInitialized) return -1;
            g_pauseRequested.store(false, std::memory_order_release);
            if (g_trackFinished.load()) { Suspended suspend; ma_sound_seek_to_pcm_frame(&g_sound, 0); dsp_flush_all_state(); restore_audio_parameters(); engine_reset_transport(); }
            ma_sound_start(&g_sound);
        } else if (command == "PAUSE" || command == "PAUSE_DEVICE") {
            if (g_soundInitialized && (command == "PAUSE" || g_pauseRequested.load())) ma_sound_stop(&g_sound);
        } else if (command == "SEEK") {
            if (!g_soundInitialized) return -1;
            const float seconds = (std::max)(0.0f, number(args));
            ma_uint32 rate = 0;
            ma_data_source_get_data_format(ma_sound_get_data_source(&g_sound), nullptr, nullptr, &rate, nullptr, 0);
            Suspended suspend;
            ma_sound_seek_to_pcm_frame(&g_sound, static_cast<ma_uint64>(seconds * rate));
            dsp_flush_all_state(); restore_audio_parameters(); engine_reset_transport();
        } else if (command == "BYPASS_ALL") {
            const bool bypass = number(args) > 0.5f;
            if (bypass == g_bypassAll.load()) return 0;
            const bool playing = g_soundInitialized && ma_sound_is_playing(&g_sound);
            const std::string path = g_lastLoadedPath;
            float seconds = 0;
            if (g_soundInitialized) ma_sound_get_cursor_in_seconds(&g_sound, &seconds);
            Suspended suspend;
            g_bypassAll.store(bypass);
            if (!bypass && engine_get_sample_rate() != g_requestedSampleRate.load()) {
                uninit_audio_engine(); init_audio_engine();
                if (!g_engineInitialized.load()) return -1;
                engine_suspend();
            }
            dsp_flush_all_state(); restore_audio_parameters(); updateRouting();
            if (!path.empty()) {
                if (execute_audio_command(("LOAD " + path).c_str()) != 0) return -1;
                execute_audio_command(("SEEK " + std::to_string(seconds)).c_str());
                if (playing) execute_audio_command("PLAY");
            }
        } else if (command == "QUALITY") {
            const bool eco = args == "ECO";
            if (!eco && args != "FULL") return -1;
            Suspended suspend;
            g_ecoMode.store(eco);
            audio_rebuild_spatial_renderer();
            dsp_flush_all_state(); restore_audio_parameters();
        } else if (command == "SAMPLE_RATE" || command == "RECOVER") {
            const int rate = command == "RECOVER" ? g_requestedSampleRate.load() : static_cast<int>(number(args));
            if (rate != 44100 && rate != 48000 && rate != 96000) return -1;
#ifdef __ANDROID__
            if (rate == 96000) return -1;
#endif
            const int previous = g_requestedSampleRate.load();
            const std::string path = g_lastLoadedPath;
            float seconds = 0; const bool playing = g_soundInitialized && ma_sound_is_playing(&g_sound);
            if (g_soundInitialized) ma_sound_get_cursor_in_seconds(&g_sound, &seconds);
            uninit_audio_engine(); g_requestedSampleRate.store(rate); init_audio_engine();
            if (!g_engineInitialized.load()) { g_requestedSampleRate.store(previous); init_audio_engine(); }
            if (!g_engineInitialized.load()) return -1;
            if (!path.empty()) {
                if (execute_audio_command(("LOAD " + path).c_str()) != 0) return -1;
                execute_audio_command(("SEEK " + std::to_string(seconds)).c_str());
                if (playing) execute_audio_command("PLAY");
            }
            return engine_get_sample_rate() == rate ? 0 : -1;
        } else if (command == "HEADPHONE_CORRECTION") {
            loadIR(args, true);
            correctionPath = (args == "OFF" || args == "NONE" || args == "0") ? "" : args;
        } else if (command == "LOAD_IR" || command == "LOAD_IR_DUAL") {
            loadIR(args, false);
            convolutionPath = (args == "OFF" || args == "NONE" || args == "0") ? "" : args;
        } else if (command == "HEADPHONE_CORRECTION_STRENGTH") {
            correctionStrength = bounded(number(args),0,1);
            g_headphoneCompNode.strength.set(correctionStrength);
        } else if (command == "CONVOLUTION") {
            const float wet = bounded(number(args),0,1);
            if (wet > 0 && (!g_convolutionNode.convL.load() || !g_convolutionNode.convR.load())) return -1;
            g_convolutionNode.wetMix.set(wet);
            g_isConvolutionOn.store(wet > 0);
            convolutionWet = wet;
        } else if (command == "FIRMODE" || command == "FIRGAIN" || command == "REMASTER") {
            // Legacy preset compatibility: tone now has explicit shelf/presence controls.
            if (command == "REMASTER") { settings[12] = number(args) > 0.5f ? 0.25f : 0; restore_audio_parameters(); }
        } else {
            const float v = (command == "SPEAKER9D" || command == "TOGGLE_8D") ?
                (args == "ON" || args == "1" ? 1.0f : 0.0f) :
                command == "SPEAKER9D_BASS" ? (args == "ROOM" ? 1.0f : 0.0f) :
                command == "ISO226" ? (args == "ON" ? 1.0f : 0.0f) : number(args);
            if (command == "BASS") settings[0]=bounded(v,0,2.1f);
            else if (command == "TREBLE") settings[1]=bounded(v,-12,12);
            else if (command == "UPSCALE") settings[2]=bounded(v,0,1);
            else if (command == "WIDEN") settings[3]=bounded(v,1,2.5f);
            else if (command == "3D") settings[4]=bounded(v,0,1);
            else if (command == "DEPTH") settings[5]=bounded(v,0,1);
            else if (command == "REVERB") settings[6]=bounded(v,0,1);
            else if (command == "COMPRESS") settings[7]=v>0.5f;
            else if (command == "VOLUME") settings[8]=bounded(v,0,1);
            else if (command == "SUB_BASS_HZ") { const float a[]{30,40,52,60,70,80}; if (std::find(std::begin(a),std::end(a),v)==std::end(a)) return -1; settings[9]=v; }
            else if (command == "BASS_FIELD") settings[10]=bounded(v,0,1);
            else if (command == "SPEAKER9D_BASS") settings[11]=v;
            else if (command == "VOCAL_PRESENCE" || command == "RESTORE_PRESENCE") settings[12]=bounded(v,0,1);
            else if (command == "ISO226") settings[13]=v;
            else if (command == "ROOM_SIZE") settings[14]=bounded(v,0.2f,0.98f);
            else if (command == "DAMPING") settings[15]=bounded(v,0,0.95f);
            else if (command == "RESTORE_UPSCALE") settings[16]=bounded(v,0,1);
            else if (command == "SPEAKER9D" || command == "TOGGLE_8D") settings[17]=v;
            else if (command == "LIMITER") settings[18]=bounded(v,0,1);
            else if (command == "ANDROID_SPEAKER") settings[19]=v>0.5f?2:0;
            else if (command == "LAPTOP_SPEAKER") settings[19]=v>0.5f?1:0;
            else if (command == "RESTORE_DENOISE") { if (v != 0) return -1; }
            else return -1;
            restore_audio_parameters();
        }
        return 0;
    } catch (...) { return -1; }
}
extern "C" void get_audio_metrics(float* output, float* level) {
    std::lock_guard<std::recursive_mutex> owner(g_audioMutex);
    std::fill(output, output + 11, 0.0f);
    output[6] = output[9] = 1;
    output[10] = g_limiterGR.load();
    *level = g_audioLevel.load();
    if (!g_engineInitialized.load() || !g_soundInitialized) return;
    ma_sound_get_cursor_in_seconds(&g_sound, &output[0]);
    ma_sound_get_length_in_seconds(&g_sound, &output[1]);
    output[2]=g_bLvl.load(); output[3]=g_bPan.load();
    output[4]=g_mLvl.load(); output[5]=g_mPan.load(); output[6]=g_mPhase.load();
    output[7]=g_tLvl.load(); output[8]=g_tPan.load(); output[9]=g_tPhase.load();
}
extern "C" bool audio_track_finished() { return g_trackFinished.load(); }
static bool analyzeFile(const char* path, float* sc, float* cf, float* zcr, float* rms) {
    if (!path || !sc || !cf || !zcr || !rms) return false;
    ma_decoder decoder;
    auto config = ma_decoder_config_init(ma_format_f32, 2, 0);
    ma_decoding_backend_vtable* backends[]{ &g_streamingDecoder };
    config.ppCustomBackendVTables = backends;
    config.customBackendCount = 1;
    if (ma_decoder_init_file(path, &config, &decoder) != MA_SUCCESS) return false;
    struct Guard { ma_decoder* decoder; ~Guard() { ma_decoder_uninit(decoder); } } guard{&decoder};
    const auto rate = decoder.outputSampleRate;
    if (rate < 22050 || rate > 96000) return false;
    std::vector<float> input(static_cast<size_t>(rate) * 10 * 2);
    ma_uint64 frames = 0;
    ma_decoder_read_pcm_frames(&decoder, input.data(), rate * 10, &frames);
    if (!frames) return false;
    double l2=0,r2=0,lr=0,peak=0,changes=0; float previous=0;
    for(size_t i=0;i<frames;++i) {
        const float l=input[i*2],r=input[i*2+1];
        l2+=l*l;r2+=r*r;lr+=l*r;peak=(std::max)(peak,static_cast<double>((std::max)(std::abs(l),std::abs(r))));
        const float m=(l+r)*0.5f; if ((m>=0)!=(previous>=0)) ++changes;previous=m;
    }
    *rms=static_cast<float>(std::sqrt((l2+r2)/(2*frames)));
    *sc=static_cast<float>(lr/(std::sqrt(l2*r2)+1e-12));
    *cf=*rms>1e-9?static_cast<float>(20*std::log10(peak / *rms)):0;
    *zcr=static_cast<float>(changes/frames*rate/44100.0);
    return true;
}
extern "C" bool analyze_audio_file_cpp(const char* path, float* sc, float* cf, float* zcr, float* rms) {
    try { return analyzeFile(path,sc,cf,zcr,rms); } catch (...) { return false; }
}
extern "C" bool analyze_audio(float* sc, float* cf, float* zcr, float* rms) {
    try {
    std::string path;
    { std::lock_guard<std::recursive_mutex> owner(g_audioMutex); path = playbackPath; }
    return !path.empty() && analyze_audio_file_cpp(path.c_str(),sc,cf,zcr,rms);
    } catch (...) { return false; }
}
extern "C" void load_ir_from_memory_cpp(const float* l,int nL,const float* r,int nR) {
    std::lock_guard<std::recursive_mutex> owner(g_audioMutex);
    try { installIR(l,nL,r,nR,false); } catch (...) {}
}
extern "C" void load_headphone_comp_from_memory_cpp(const float* l,int nL,const float* r,int nR) {
    std::lock_guard<std::recursive_mutex> owner(g_audioMutex);
    try { installIR(l,nL,r,nR,true); } catch (...) {}
}
