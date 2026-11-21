#pragma once

#include <algorithm>
#include <cmath>
#include <cstring>

#include "SmoothedParam.h"
#include "SteamAudioHrtf.h"

class NineSpeakerUpmixer
{
public:
    static constexpr int kFrameSize = SteamAudioHrtf::kFrameSize;
    static constexpr int kSourceCount = SteamAudioHrtf::kMaxSources;

    void init(float sampleRate, const char* sofaFile = nullptr)
    {
        sampleRate_ = sampleRate > 0.0f ? sampleRate : 48000.0f;
        ambienceHpfL_.init(sampleRate_, 300.0f);
        ambienceHpfR_.init(sampleRate_, 300.0f);
        ambienceSplitL_.init(sampleRate_, 4500.0f);
        ambienceSplitR_.init(sampleRate_, 4500.0f);
        separation_.init(0.0f, sampleRate_, 80.0f);
        depth_.init(0.0f, sampleRate_, 80.0f);
        midExtractor_.init(sampleRate_);
        highExtractor_.init(sampleRate_);
        hrtf_.init(static_cast<int>(sampleRate_), sofaFile);
        reset();
    }

    void setSeparation(float value) { separation_.set((std::clamp)(value, 0.0f, 1.0f)); }
    void setDepth(float value) { depth_.set((std::clamp)(value, 0.0f, 1.0f)); }
    float separationTarget() const { return separation_.target.load(std::memory_order_relaxed); }
    bool hrtfAvailable() const { return hrtf_.available(); }
    bool hrtfMeasured() const { return hrtf_.measured(); }
    bool hrtfPortable() const { return hrtf_.portableMeasured(); }
    int sampleRate() const { return static_cast<int>(sampleRate_); }
    int hrtfSampleRate() const { return hrtf_.sampleRate(); }
    int hrtfInitStatus() const { return hrtf_.initStatus(); }

    void reset()
    {
        ambienceHpfL_.reset();
        ambienceHpfR_.reset();
        ambienceSplitL_.reset();
        ambienceSplitR_.reset();
        midExtractor_.reset();
        highExtractor_.reset();
        hrtf_.reset();
        std::memset(sourceInputs_, 0, sizeof(sourceInputs_));
        std::memset(wetOutputL_, 0, sizeof(wetOutputL_));
        std::memset(wetOutputR_, 0, sizeof(wetOutputR_));
        std::memset(dryBlockL_, 0, sizeof(dryBlockL_));
        std::memset(dryBlockR_, 0, sizeof(dryBlockR_));
        writePos_ = 0;
        wetReadPos_ = 0;
        wetReady_ = false;
    }

    // The original stereo master is always the direct path. Only dynamically
    // extracted diffuse residual is rendered into fixed surround zones.
    inline void process(float inL, float inR, float& outL, float& outR)
    {
        float wetL = 0.0f;
        float wetR = 0.0f;
        if (wetReady_) {
            wetL = wetOutputL_[wetReadPos_];
            wetR = wetOutputR_[wetReadPos_];
            if (++wetReadPos_ == kFrameSize) {
                wetReadPos_ = 0;
                wetReady_ = false;
            }
        }

        // Dry is immediate and untouched. The 64-sample ambient delay behaves
        // as early spatial energy and cannot comb-filter coherent vocals.
        outL = inL + wetL;
        outR = inR + wetR;

        const float filteredL = ambienceHpfL_.process(inL);
        const float filteredR = ambienceHpfR_.process(inR);
        float midL = 0.0f, highL = 0.0f;
        float midR = 0.0f, highR = 0.0f;
        ambienceSplitL_.process(filteredL, midL, highL);
        ambienceSplitR_.process(filteredR, midR, highR);

        float ambientMidL = 0.0f, ambientMidR = 0.0f;
        float ambientHighL = 0.0f, ambientHighR = 0.0f;
        midExtractor_.process(midL, midR, ambientMidL, ambientMidR);
        highExtractor_.process(highL, highR, ambientHighL, ambientHighR);

        const float separation = separation_.next();
        const float depth = depth_.next();
        const float sideGain = separation * (0.20f - 0.03f * depth);
        const float rearGain = separation * depth * 0.19f;
        const float heightGain = separation * depth * 0.15f;

        dryBlockL_[writePos_] = inL;
        dryBlockR_[writePos_] = inR;
        sourceInputs_[0][writePos_] = (ambientMidL + 0.55f * ambientHighL) * sideGain;
        sourceInputs_[1][writePos_] = (ambientMidR + 0.55f * ambientHighR) * sideGain;
        sourceInputs_[2][writePos_] = (0.75f * ambientMidL + ambientHighL) * rearGain;
        sourceInputs_[3][writePos_] = (0.75f * ambientMidR + ambientHighR) * rearGain;
        sourceInputs_[4][writePos_] = ambientHighL * heightGain;
        sourceInputs_[5][writePos_] = ambientHighR * heightGain;

        if (++writePos_ == kFrameSize) {
            renderAmbientBlock(separation);
            writePos_ = 0;
            wetReadPos_ = 0;
            wetReady_ = true;
        }
    }

private:
    struct PrimaryAmbientExtractor {
        float energyL = 0.0f;
        float energyR = 0.0f;
        float cross = 0.0f;
        float fastL = 0.0f, fastR = 0.0f;
        float slowL = 0.0f, slowR = 0.0f;
        float analysisCoef = 0.0f;
        float fastCoef = 0.0f;
        float slowCoef = 0.0f;

        void init(float sampleRate)
        {
            analysisCoef = tauCoef(45.0f, sampleRate);
            fastCoef = tauCoef(3.0f, sampleRate);
            slowCoef = tauCoef(70.0f, sampleRate);
            reset();
        }

        void reset()
        {
            energyL = energyR = cross = 0.0f;
            fastL = fastR = slowL = slowR = 0.0f;
        }

        inline void process(float inL, float inR, float& ambientL, float& ambientR)
        {
            energyL += analysisCoef * (inL * inL - energyL);
            energyR += analysisCoef * (inR * inR - energyR);
            cross += analysisCoef * (inL * inR - cross);

            const float denominator = std::sqrt(energyL * energyR) + 1.0e-10f;
            const float coherence = (std::clamp)(cross / denominator, 0.0f, 1.0f);
            const float primaryStrength = (std::clamp)((coherence - 0.15f) / 0.75f, 0.0f, 1.0f);
            const float predictL = (std::clamp)(cross / (energyR + 1.0e-10f), 0.0f, 2.0f);
            const float predictR = (std::clamp)(cross / (energyL + 1.0e-10f), 0.0f, 2.0f);

            ambientL = inL - inR * predictL * primaryStrength;
            ambientR = inR - inL * predictR * primaryStrength;

            const float magnitudeL = std::abs(ambientL);
            const float magnitudeR = std::abs(ambientR);
            fastL += fastCoef * (magnitudeL - fastL);
            fastR += fastCoef * (magnitudeR - fastR);
            slowL += slowCoef * (magnitudeL - slowL);
            slowR += slowCoef * (magnitudeR - slowR);

            // Protect attacks and vocal consonants; spatial sends favor the
            // sustained residual that reads as room and recorded ambience.
            const float sustainL = (std::clamp)(slowL / (fastL + 1.0e-6f), 0.0f, 1.0f);
            const float sustainR = (std::clamp)(slowR / (fastR + 1.0e-6f), 0.0f, 1.0f);
            ambientL *= sustainL;
            ambientR *= sustainR;
        }
    };

    void renderAmbientBlock(float separation)
    {
        static constexpr float azimuth[kSourceCount] = {
            -90.0f, 90.0f, -145.0f, 145.0f, -48.0f, 48.0f
        };
        static constexpr float elevation[kSourceCount] = {
            0.0f, 0.0f, 0.0f, 0.0f, 45.0f, 45.0f
        };

        std::memset(wetOutputL_, 0, sizeof(wetOutputL_));
        std::memset(wetOutputR_, 0, sizeof(wetOutputR_));
        bool rendered = true;
        for (int source = 0; source < kSourceCount; ++source) {
            rendered = hrtf_.renderSource(source, sourceInputs_[source],
                                          azimuth[source], elevation[source], 1.0f,
                                          wetOutputL_, wetOutputR_) && rendered;
        }

        if (!rendered) {
            std::memset(wetOutputL_, 0, sizeof(wetOutputL_));
            std::memset(wetOutputR_, 0, sizeof(wetOutputR_));
            return;
        }

        double dryEnergy = 0.0;
        double wetEnergy = 0.0;
        for (int i = 0; i < kFrameSize; ++i) {
            dryEnergy += dryBlockL_[i] * dryBlockL_[i] + dryBlockR_[i] * dryBlockR_[i];
            wetEnergy += wetOutputL_[i] * wetOutputL_[i] + wetOutputR_[i] * wetOutputR_[i];
        }

        // Keep the diffuse field below 34% of dry RMS at maximum separation.
        // This preserves the mastered stereo bed and its headroom.
        const double dryRms = std::sqrt(dryEnergy / (2.0 * kFrameSize) + 1.0e-20);
        const double wetRms = std::sqrt(wetEnergy / (2.0 * kFrameSize) + 1.0e-20);
        const float maxWetRms = static_cast<float>(dryRms) * 0.34f * separation;
        const float normalization = wetRms > maxWetRms && wetRms > 1.0e-10
            ? maxWetRms / static_cast<float>(wetRms)
            : 1.0f;

        for (int i = 0; i < kFrameSize; ++i) {
            wetOutputL_[i] *= normalization;
            wetOutputR_[i] *= normalization;
        }
    }

    SteamAudioHrtf hrtf_;
    BiquadHPF ambienceHpfL_, ambienceHpfR_;
    LinkwitzRiley4 ambienceSplitL_, ambienceSplitR_;
    PrimaryAmbientExtractor midExtractor_, highExtractor_;
    SmoothedParam separation_, depth_;

    float sourceInputs_[kSourceCount][kFrameSize]{};
    float wetOutputL_[kFrameSize]{};
    float wetOutputR_[kFrameSize]{};
    float dryBlockL_[kFrameSize]{};
    float dryBlockR_[kFrameSize]{};

    int writePos_ = 0;
    int wetReadPos_ = 0;
    bool wetReady_ = false;
    float sampleRate_ = 48000.0f;
};
