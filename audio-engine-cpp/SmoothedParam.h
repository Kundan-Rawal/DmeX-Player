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

// Continuous normalized control taper: more useful travel below the last quarter.
inline float effectAmount(float value) {
    const float x = value < 0 ? 0 : value > 1 ? 1 : value;
    return x * (1.6f - 0.6f * x);
}
inline float vocalPresenceDb(float value) { return 9.0f * effectAmount(value); }
inline float harmonicAirDb(float value) { return 6.0f * effectAmount(value); }

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
        const float next = g + (t - g) * coef;
        // At high rates float rounding can stall just below unity indefinitely.
        if (next == g || std::fabs(t - next) < 1.0e-6f) g = t;
        else g = next;
        return g;
    }
    inline bool fullyOff() const {
        return g <= 0.0f && !on.load(std::memory_order_relaxed);
    }
};
