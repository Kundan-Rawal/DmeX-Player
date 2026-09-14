#pragma once
#include <atomic>
#include <cmath>
#include "DSP_Coeffs.h"

struct SmoothedParam {
    std::atomic<float> target{0.0f};
    float current = 0.0f;
    float coef    = 0.002f;

    void init(float initial, float timeMs = 20.0f) {
        target.store(initial, std::memory_order_relaxed);
        current = initial;
        coef    = tauCoef(timeMs, g_coef.sr);
    }
    inline void set(float v)  { target.store(v, std::memory_order_relaxed); }
    inline void snap(float v) { target.store(v, std::memory_order_relaxed); current = v; }
    inline void snap()        { current = target.load(std::memory_order_relaxed); }

    inline float next() {
        float t = target.load(std::memory_order_relaxed);
        current += (t - current) * coef;
        if (fabsf(t - current) < 1.0e-7f) current = t;
        return current;
    }
    inline float peek() const { return current; }
};

struct SmoothedGate {
    std::atomic<bool> on{false};
    float g = 0.0f;
    float coef = 0.002f;

    void init(bool initial, float timeMs = 15.0f) {
        on.store(initial, std::memory_order_relaxed);
        g = initial ? 1.0f : 0.0f;
        coef = tauCoef(timeMs, g_coef.sr);
    }
    inline void set(bool v) { on.store(v, std::memory_order_relaxed); }

    inline float next() {
        float t = on.load(std::memory_order_relaxed) ? 1.0f : 0.0f;
        g += (t - g) * coef;
        if (fabsf(t - g) < 1.0e-6f) g = t;
        return g;
    }
    inline bool fullyOff() const {
        return g <= 0.0f && !on.load(std::memory_order_relaxed);
    }
};
