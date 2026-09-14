#pragma once
#include <atomic>
#include <cmath>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

inline float tauCoef(float timeMs, float sr) {
    if (sr <= 0.0f || timeMs <= 0.0f) return 1.0f;
    return 1.0f - std::exp(-1.0f / (timeMs * 0.001f * sr));
}

struct SmoothedParam {
    std::atomic<float> target{0.0f};
    float current = 0.0f;
    float coef    = 0.002f;

    void init(float initial, float sr = 44100.0f, float timeMs = 20.0f) {
        target.store(initial, std::memory_order_relaxed);
        current = initial;
        coef    = tauCoef(timeMs, sr);
    }
    inline void set(float v)  { target.store(v, std::memory_order_relaxed); }
    inline void snap(float v) { target.store(v, std::memory_order_relaxed); current = v; }
    inline void snap()        { current = target.load(std::memory_order_relaxed); }

    inline float next() {
        float t = target.load(std::memory_order_relaxed);
        current += (t - current) * coef;
        if (std::fabs(t - current) < 1.0e-7f) current = t;
        return current;
    }
    inline float peek() const { return current; }
};

struct SmoothedGate {
    std::atomic<bool> on{false};
    float g = 0.0f;
    float coef = 0.002f;

    void init(bool initial, float sr = 44100.0f, float timeMs = 15.0f) {
        on.store(initial, std::memory_order_relaxed);
        g = initial ? 1.0f : 0.0f;
        coef = tauCoef(timeMs, sr);
    }
    inline void set(bool v) { on.store(v, std::memory_order_relaxed); }

    inline float next() {
        float t = on.load(std::memory_order_relaxed) ? 1.0f : 0.0f;
        g += (t - g) * coef;
        if (std::fabs(t - g) < 1.0e-6f) g = t;
        return g;
    }
    inline bool fullyOff() const {
        return g <= 0.0f && !on.load(std::memory_order_relaxed);
    }
};
