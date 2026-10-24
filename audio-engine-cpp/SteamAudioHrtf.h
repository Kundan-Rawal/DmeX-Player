#pragma once
#include <memory>

#ifdef DMEX_USE_STEAMAUDIO
#include "phonon.h"
#endif

class SteamAudioHrtf
{
public:
    static constexpr int kFrameSize = 64;
    static constexpr int kMaxSources = 6;

    SteamAudioHrtf();
    ~SteamAudioHrtf();

    SteamAudioHrtf(const SteamAudioHrtf&) = delete;
    SteamAudioHrtf& operator=(const SteamAudioHrtf&) = delete;

    bool init(int sampleRate, const char* sofaFile = nullptr);
    void shutdown();
    void reset();

    bool available() const;
    bool measured() const { return measured_; }
    bool portableMeasured() const { return portable_ != nullptr; }
    int sampleRate() const { return sampleRate_; }
    int initStatus() const { return initStatus_; }

    bool renderFrame(const float* inputLeft,
                     const float* inputRight,
                     float leftAzimuthDeg,
                     float leftElevationDeg,
                     float rightAzimuthDeg,
                     float rightElevationDeg,
                     float* outputLeft,
                     float* outputRight);

    bool renderSource(int sourceIndex,
                      const float* input,
                      float azimuthDeg,
                      float elevationDeg,
                      float gain,
                      float* mixLeft,
                      float* mixRight);

private:
    struct Portable;
    std::unique_ptr<Portable> portable_;
    bool initPortable();
#ifdef DMEX_USE_STEAMAUDIO
    static IPLVector3 direction(float azimuthDeg, float elevationDeg);
    IPLerror createEffect(IPLBinauralEffect& effect);

    IPLContext context_ = nullptr;
    IPLHRTF hrtf_ = nullptr;
    IPLBinauralEffect effects_[kMaxSources]{};
    IPLAudioSettings audioSettings_{};
#endif
    int sampleRate_ = 48000;
    bool measured_ = false;
    bool ready_ = false;
    float lightweightDelay_[kMaxSources][128]{};
    float lightweightShadow_[kMaxSources]{};
    int lightweightIndex_[kMaxSources]{};
    int initStatus_ = 0;

#ifdef DMEX_USE_STEAMAUDIO
    float sourceToLeft_[kMaxSources][kFrameSize]{};
    float sourceToRight_[kMaxSources][kFrameSize]{};
#endif
};
