#include "SteamAudioHrtf.h"
#include "FFTConvolver.h"
#include "PortableHrtfData.h"

#include <algorithm>
#include <cmath>
#include <atomic>
#include <cstring>

extern std::atomic<bool> g_ecoMode;

bool SteamAudioHrtf::available() const { return ready_; }

namespace {
constexpr float kPi = 3.14159265358979323846f;
}

struct SteamAudioHrtf::Portable {
    FFTConvolver filters[kMaxSources][dmex_hrtf::kDirectionCount][2];
    float left[kFrameSize]{}, right[kFrameSize]{};
    bool prepare(int rate, bool eco) {
        for (const auto& bank : dmex_hrtf::banks) {
            if (bank.rate != rate) continue;
            const int taps = eco ? (std::min)(bank.taps, (int)std::ceil(160.0 * rate / 44100.0)) : bank.taps;
            for (auto& source : filters) for (int direction = 0; direction < dmex_hrtf::kDirectionCount; ++direction)
                for (int ear = 0; ear < 2; ++ear)
                    if (!source[direction][ear].prepare(bank.data + (direction * 2 + ear) * bank.taps, taps, kFrameSize)) return false;
            return true;
        }
        return false;
    }
    void reset() { for (auto& source : filters) for (auto& direction : source) for (auto& ear : direction) ear.reset(); }
    void render(int source, const float* input, float az, float el, float gain, float* outL, float* outR) {
        const float radians = kPi / 180.0f;
        int nearest = 0; float best = -2.0f;
        for (int i = 0; i < dmex_hrtf::kDirectionCount; ++i) {
            const float score = std::sin(el*radians)*std::sin(dmex_hrtf::elevation[i]*radians)
                + std::cos(el*radians)*std::cos(dmex_hrtf::elevation[i]*radians)*std::cos((az-dmex_hrtf::azimuth[i])*radians);
            if (score > best) { best = score; nearest = i; }
        }
        filters[source][nearest][0].process(input, left);
        filters[source][nearest][1].process(input, right);
        for (int i = 0; i < kFrameSize; ++i) { outL[i] += left[i]*gain; outR[i] += right[i]*gain; }
    }
};

SteamAudioHrtf::SteamAudioHrtf() = default;
bool SteamAudioHrtf::initPortable() {
    try {
        portable_ = std::make_unique<Portable>();
        if (!portable_->prepare(sampleRate_, g_ecoMode.load())) { portable_.reset(); return true; }
        measured_ = true;
    } catch (...) { portable_.reset(); measured_ = false; initStatus_ = 400; }
    return true;
}

SteamAudioHrtf::~SteamAudioHrtf()
{
    shutdown();
}

bool SteamAudioHrtf::init(int sampleRate, const char* sofaFile)
{
#ifndef DMEX_USE_STEAMAUDIO
    (void)sofaFile;
#endif
    shutdown();
    initStatus_ = 0;
    sampleRate_ = sampleRate;
    measured_ = false;
    ready_ = true;
    reset();
#ifdef DMEX_USE_STEAMAUDIO
    if (g_ecoMode.load()) return initPortable();

    IPLContextSettings contextSettings{};
    contextSettings.version = STEAMAUDIO_VERSION;
    contextSettings.simdLevel = IPL_SIMDLEVEL_AVX2;
    contextSettings.flags = static_cast<IPLContextFlags>(0);
    const IPLerror contextResult = iplContextCreate(&contextSettings, &context_);
    if (contextResult != IPL_STATUS_SUCCESS) {
        initStatus_ = 100 + static_cast<int>(contextResult);
        shutdown();
        ready_ = true;
        return initPortable();
    }

    audioSettings_.samplingRate = (std::max)(sampleRate, 8000);
    audioSettings_.frameSize = kFrameSize;

    IPLHRTFSettings hrtfSettings{};
    hrtfSettings.type = sofaFile ? IPL_HRTFTYPE_SOFA : IPL_HRTFTYPE_DEFAULT;
    hrtfSettings.sofaFileName = sofaFile;
    hrtfSettings.volume = 1.0f;
    hrtfSettings.normType = IPL_HRTFNORMTYPE_RMS;
    const IPLerror hrtfResult = iplHRTFCreate(context_, &audioSettings_, &hrtfSettings, &hrtf_);
    if (hrtfResult != IPL_STATUS_SUCCESS) {
        initStatus_ = 200 + static_cast<int>(hrtfResult);
        shutdown();
        ready_ = true;
        return initPortable();
    }

    for (int index = 0; index < kMaxSources; ++index) {
        const IPLerror effectResult = createEffect(effects_[index]);
        if (effectResult != IPL_STATUS_SUCCESS) {
            initStatus_ = 300 + index * 10 + static_cast<int>(effectResult);
            shutdown();
            ready_ = true;
            return initPortable();
        }
    }

    measured_ = true;
    ready_ = true;
#else
    return initPortable();
#endif
    return true;
}

#ifdef DMEX_USE_STEAMAUDIO
IPLerror SteamAudioHrtf::createEffect(IPLBinauralEffect& effect)
{
    IPLBinauralEffectSettings settings{};
    settings.hrtf = hrtf_;
    return iplBinauralEffectCreate(context_, &audioSettings_, &settings, &effect);
}
#endif

void SteamAudioHrtf::shutdown()
{
    portable_.reset();
#ifdef DMEX_USE_STEAMAUDIO
    for (auto& effect : effects_) {
        if (effect) iplBinauralEffectRelease(&effect);
    }
    if (hrtf_) iplHRTFRelease(&hrtf_);
    if (context_) iplContextRelease(&context_);
#endif
    ready_ = false;
    measured_ = false;
}

void SteamAudioHrtf::reset()
{
    if (portable_) portable_->reset();
#ifdef DMEX_USE_STEAMAUDIO
    for (auto effect : effects_) {
        if (effect) iplBinauralEffectReset(effect);
    }
#endif
    std::memset(lightweightDelay_, 0, sizeof(lightweightDelay_));
    std::memset(lightweightShadow_, 0, sizeof(lightweightShadow_));
    std::memset(lightweightIndex_, 0, sizeof(lightweightIndex_));
}

#ifdef DMEX_USE_STEAMAUDIO
IPLVector3 SteamAudioHrtf::direction(float azimuthDeg, float elevationDeg)
{
    const float azimuth = azimuthDeg * kPi / 180.0f;
    const float elevation = elevationDeg * kPi / 180.0f;
    const float horizontal = std::cos(elevation);
    return {std::sin(azimuth) * horizontal,
            std::sin(elevation),
            -std::cos(azimuth) * horizontal};
}
#endif

bool SteamAudioHrtf::renderFrame(const float* inputLeft,
                                 const float* inputRight,
                                 float leftAzimuthDeg,
                                 float leftElevationDeg,
                                 float rightAzimuthDeg,
                                 float rightElevationDeg,
                                 float* outputLeft,
                                 float* outputRight)
{
    if (!available() || !inputLeft || !inputRight || !outputLeft || !outputRight) return false;

    std::fill(outputLeft, outputLeft + kFrameSize, 0.0f);
    std::fill(outputRight, outputRight + kFrameSize, 0.0f);
    return renderSource(0, inputLeft, leftAzimuthDeg, leftElevationDeg, 1.0f, outputLeft, outputRight)
        && renderSource(1, inputRight, rightAzimuthDeg, rightElevationDeg, 1.0f, outputLeft, outputRight);
}

bool SteamAudioHrtf::renderSource(int sourceIndex,
                                  const float* input,
                                  float azimuthDeg,
                                  float elevationDeg,
                                  float gain,
                                  float* mixLeft,
                                  float* mixRight)
{
    if (!available() || sourceIndex < 0 || sourceIndex >= kMaxSources
        || !input || !mixLeft || !mixRight) return false;
    if (portable_) {
        portable_->render(sourceIndex, input, azimuthDeg, elevationDeg, gain, mixLeft, mixRight);
        return true;
    }
#ifndef DMEX_USE_STEAMAUDIO
    (void)elevationDeg;
#endif

    if (!measured_) {
        const float lateral = std::sin(azimuthDeg * kPi / 180.0f);
        const int delay = (std::min)(127, static_cast<int>(std::abs(lateral) * 0.0006f * sampleRate_));
        const float shadow = 1.0f - std::exp(-2.0f * kPi * 2500.0f / sampleRate_);
        const float nearGain = 0.65f;
        const float farGain = 0.65f - 0.35f * std::abs(lateral);
        for (int i = 0; i < kFrameSize; ++i) {
            int& w = lightweightIndex_[sourceIndex];
            lightweightDelay_[sourceIndex][w] = input[i];
            const float delayed = lightweightDelay_[sourceIndex][(w + 128 - delay) % 128];
            float& lp = lightweightShadow_[sourceIndex];
            lp += shadow * (delayed - lp);
            const float far = lp * farGain * gain;
            const float near = input[i] * nearGain * gain;
            mixLeft[i] += lateral < 0.0f ? near : far;
            mixRight[i] += lateral < 0.0f ? far : near;
            w = (w + 1) % 128;
        }
        return true;
    }
#ifdef DMEX_USE_STEAMAUDIO
    float* inputData[] = {const_cast<float*>(input)};
    float* outputData[] = {sourceToLeft_[sourceIndex], sourceToRight_[sourceIndex]};
    IPLAudioBuffer inputBuffer{1, kFrameSize, inputData};
    IPLAudioBuffer outputBuffer{2, kFrameSize, outputData};

    IPLBinauralEffectParams params{};
    params.direction = direction(azimuthDeg, elevationDeg);
    params.interpolation = IPL_HRTFINTERPOLATION_NEAREST;
    params.spatialBlend = 1.0f;
    params.hrtf = hrtf_;
    iplBinauralEffectApply(effects_[sourceIndex], &params, &inputBuffer, &outputBuffer);

    for (int i = 0; i < kFrameSize; ++i) {
        mixLeft[i] += sourceToLeft_[sourceIndex][i] * gain;
        mixRight[i] += sourceToRight_[sourceIndex][i] * gain;
    }
    return true;
#else
    return false;
#endif
}
