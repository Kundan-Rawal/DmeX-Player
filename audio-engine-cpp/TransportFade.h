#pragma once
#include <algorithm>
#include <cmath>

// Owned by the render thread; reset only while the graph is quiescent.
class TransportFade {
public:
    void init(float rate) {
        outStep_ = 1.0f / (std::max)(1.0f, rate * .006f);
        inStep_ = 1.0f / (std::max)(1.0f, rate * .010f);
        phase_ = 1; waiting_ = false;
    }
    void restart() { phase_ = 0; waiting_ = true; }
    bool silent() const { return phase_ == 0; }
    void process(float* samples, unsigned frames, bool mute) {
        if (!mute && phase_ == 1 && !waiting_) return;
        for (unsigned i=0; i<frames; ++i) {
            if (mute) {
                phase_ = phase_ <= outStep_ ? 0 : phase_ - outStep_;
                waiting_ = false;
            } else if (waiting_) {
                // Buffer priming must not consume the fade before music arrives.
                waiting_ = (std::max)(std::abs(samples[2*i]), std::abs(samples[2*i+1])) < 1e-8f;
            }
            const float gain = phase_ * phase_ * (3 - 2 * phase_);
            samples[2*i] *= gain; samples[2*i+1] *= gain;
            if (!mute && !waiting_) phase_ = phase_ >= 1-inStep_ ? 1 : phase_ + inStep_;
        }
    }
private:
    float phase_ = 1, outStep_ = 1, inStep_ = 1;
    bool waiting_ = false;
};
