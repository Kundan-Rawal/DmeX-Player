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
        lowCoef_ = 1-std::exp(-2*static_cast<float>(M_PI)*300/sampleRate_);
        midCoef_ = 1-std::exp(-2*static_cast<float>(M_PI)*4500/sampleRate_);
        separation_.init(0.0f, sampleRate_, 80.0f);
        depth_.init(0.0f, sampleRate_, 80.0f);
        attenuationAttack_ = tauCoef(5.0f, sampleRate_);
        attenuationRelease_ = tauCoef(100.0f, sampleRate_);
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
        lowL_ = lowR_ = midL_ = midR_ = 0;
        midExtractor_.reset();
        highExtractor_.reset();
        hrtf_.reset();
        std::memset(sourceInputs_, 0, sizeof(sourceInputs_));
        std::memset(wetOutputL_, 0, sizeof(wetOutputL_));
        std::memset(wetOutputR_, 0, sizeof(wetOutputR_));
        std::memset(dryBlockL_, 0, sizeof(dryBlockL_));
        std::memset(dryBlockR_, 0, sizeof(dryBlockR_));
        std::memset(routedBlockL_, 0, sizeof(routedBlockL_));
        std::memset(routedBlockR_, 0, sizeof(routedBlockR_));
        writePos_ = 0;
        wetReadPos_ = 0;
        wetReady_ = false;
        fieldAttenuation_ = 1.0f;
    }

    // One block of common latency aligns the direct bed with replacement HRTF
    // routing. Center-coherent material is not decorrelated into fake ambience.
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

        outL = wetL;
        outR = wetR;

        // Subtractive complementary splits reconstruct the input, unlike an LR4
        // sum's all-pass phase rotation against an otherwise unchanged dry bed.
        lowL_ += lowCoef_*(inL-lowL_);
        lowR_ += lowCoef_*(inR-lowR_);
        const float filteredL = inL-lowL_, filteredR = inR-lowR_;
        midL_ += midCoef_*(filteredL-midL_);
        midR_ += midCoef_*(filteredR-midR_);
        const float midL = midL_, midR = midR_;
        const float highL = filteredL-midL, highR = filteredR-midR;

        float ambientMidL = 0.0f, ambientMidR = 0.0f;
        float ambientHighL = 0.0f, ambientHighR = 0.0f;
        midExtractor_.process(midL, midR, ambientMidL, ambientMidR);
        highExtractor_.process(highL, highR, ambientHighL, ambientHighR);

        const float separation = effectAmount(separation_.next());
        const float depth = effectAmount(depth_.next());
        const float amount = .75f * separation;
        // Complementary sends: depth relocates existing residual energy rather
        // than multiplying it across front, rear and elevation speakers.
        const float rearShareL = depth * midExtractor_.sustainL * .75f;
        const float rearShareR = depth * midExtractor_.sustainR * .75f;
        const float heightShare = depth * .60f;

        dryBlockL_[writePos_] = inL;
        dryBlockR_[writePos_] = inR;
        routedBlockL_[writePos_] = amount * (ambientMidL + ambientHighL);
        routedBlockR_[writePos_] = amount * (ambientMidR + ambientHighR);
        sourceInputs_[0][writePos_] = amount * ((1-rearShareL)*ambientMidL + (1-heightShare)*ambientHighL);
        sourceInputs_[1][writePos_] = amount * ((1-rearShareR)*ambientMidR + (1-heightShare)*ambientHighR);
        sourceInputs_[2][writePos_] = amount * rearShareL * ambientMidL;
        sourceInputs_[3][writePos_] = amount * rearShareR * ambientMidR;
        sourceInputs_[4][writePos_] = amount * heightShare * ambientHighL;
        sourceInputs_[5][writePos_] = amount * heightShare * ambientHighR;

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
        float sustainL = 0.0f, sustainR = 0.0f;
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
            sustainL = sustainR = 0.0f;
        }

        inline void process(float inL, float inR, float& ambientL, float& ambientR)
        {
            energyL += analysisCoef * (inL * inL - energyL);
            energyR += analysisCoef * (inR * inR - energyR);
            cross += analysisCoef * (inL * inR - cross);

            const float denominator = std::sqrt((std::max)(energyL * energyR, 1.0e-30f));
            const float coherence = (std::clamp)(cross / denominator, 0.0f, 1.0f);
            const float balance = (std::clamp)(2*denominator / (energyL + energyR + 1.0e-20f), 0.0f, 1.0f);
            const float balanceSquared = balance * balance;
            // Protect a balanced coherent center, not every amplitude-panned
            // instrument: off-center coherent sources still need a virtual location.
            const float primaryStrength = (std::clamp)((coherence - 0.15f) / 0.75f, 0.0f, 1.0f)
                * balanceSquared * balanceSquared;
            const float predictL = (std::clamp)(cross / (std::max)(energyR, 1.0e-20f), 0.0f, 2.0f);
            const float predictR = (std::clamp)(cross / (std::max)(energyL, 1.0e-20f), 0.0f, 2.0f);

            // A broad-band estimate cannot cleanly separate a vocal sharing this
            // band with instruments. Leave uncertain correlated energy in front
            // instead of aggressively removing it from the direct mix.
            const float uncertainty = 1-primaryStrength;
            const float residualConfidence = uncertainty * uncertainty;
            ambientL = (inL - inR * predictL * primaryStrength) * residualConfidence;
            ambientR = (inR - inL * predictR * primaryStrength) * residualConfidence;

            const float magnitudeL = std::abs(ambientL);
            const float magnitudeR = std::abs(ambientR);
            fastL += fastCoef * (magnitudeL - fastL);
            fastR += fastCoef * (magnitudeR - fastR);
            slowL += slowCoef * (magnitudeL - slowL);
            slowR += slowCoef * (magnitudeR - slowR);

            // Attacks stay toward the front; sustained residual can move rearward.
            sustainL = (std::clamp)(slowL / (fastL + 1.0e-6f), 0.0f, 1.0f);
            sustainR = (std::clamp)(slowR / (fastR + 1.0e-6f), 0.0f, 1.0f);
        }
    };

    void renderAmbientBlock(float separation)
    {
        static constexpr float azimuth[kSourceCount] = {
            -45.0f, 45.0f, -145.0f, 145.0f, -48.0f, 48.0f
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
            std::memcpy(wetOutputL_, dryBlockL_, sizeof(wetOutputL_));
            std::memcpy(wetOutputR_, dryBlockR_, sizeof(wetOutputR_));
            return;
        }

        double dryEnergy = 0.0;
        double wetEnergy = 0.0;
        // The compact bank normalizes mean ear energy to one. A mono residual
        // needs unit TOTAL ear energy, hence 1/sqrt(2), before replacement mixing.
        // The SDK bank retains its independently calibrated source gain.
        const float rendererGain = hrtf_.measured() && !hrtf_.portableMeasured() ? .5f : .70710678f;
        for (int i = 0; i < kFrameSize; ++i) {
            wetOutputL_[i] *= rendererGain;
            wetOutputR_[i] *= rendererGain;
            dryEnergy += dryBlockL_[i] * dryBlockL_[i] + dryBlockR_[i] * dryBlockR_[i];
            wetEnergy += wetOutputL_[i] * wetOutputL_[i] + wetOutputR_[i] * wetOutputR_[i];
        }

        // Only attenuate excessive rendering; never auto-raise a weak spatial field.
        const double dryRms = std::sqrt(dryEnergy / (2.0 * kFrameSize) + 1.0e-20);
        const double wetRms = std::sqrt(wetEnergy / (2.0 * kFrameSize) + 1.0e-20);
        const float maxWetRms = static_cast<float>(dryRms) * 0.80f * separation;
        const float normalization = wetRms > maxWetRms && wetRms > 1.0e-10
            ? maxWetRms / static_cast<float>(wetRms)
            : 1.0f;

        for (int i = 0; i < kFrameSize; ++i) {
            // Avoid gain steps at the 64-frame boundary on changing material.
            const float coef = normalization < fieldAttenuation_ ? attenuationAttack_ : attenuationRelease_;
            fieldAttenuation_ += coef * (normalization - fieldAttenuation_);
            wetOutputL_[i] = dryBlockL_[i] + fieldAttenuation_ * (wetOutputL_[i] - routedBlockL_[i]);
            wetOutputR_[i] = dryBlockR_[i] + fieldAttenuation_ * (wetOutputR_[i] - routedBlockR_[i]);
        }
    }

    SteamAudioHrtf hrtf_;
    float lowL_ = 0, lowR_ = 0, midL_ = 0, midR_ = 0;
    float lowCoef_ = 0, midCoef_ = 0;
    PrimaryAmbientExtractor midExtractor_, highExtractor_;
    SmoothedParam separation_, depth_;

    float sourceInputs_[kSourceCount][kFrameSize]{};
    float wetOutputL_[kFrameSize]{};
    float wetOutputR_[kFrameSize]{};
    float dryBlockL_[kFrameSize]{};
    float dryBlockR_[kFrameSize]{};
    float routedBlockL_[kFrameSize]{};
    float routedBlockR_[kFrameSize]{};

    int writePos_ = 0;
    int wetReadPos_ = 0;
    bool wetReady_ = false;
    float fieldAttenuation_ = 1.0f;
    float attenuationAttack_ = 1.0f, attenuationRelease_ = 1.0f;
    float sampleRate_ = 48000.0f;
};
