#pragma once
#include <cmath>
#include <cstring>
#include <vector>
#include <algorithm>
#include "DenormalGuard.h"

// ---------------------------------------------------------------------
// Kaiser-windowed halfband FIR, designed at runtime.
//   N must be odd; the centre tap is 0.5 and every other even-indexed tap is 0.
// ---------------------------------------------------------------------
static inline double besselI0(double x) {
    double s = 1.0, t = 1.0;
    for (int i = 1; i < 40; ++i) {
        t *= (x * 0.5) / i;
        s += t * t;
        if (t * t < 1e-18 * s) break;
    }
    return s;
}

static inline void designHalfband(std::vector<float>& h, int taps, double stopbandDb = 90.0)
{
    if ((taps & 1) == 0) ++taps;          // force odd
    h.assign(taps, 0.0f);
    int M = taps - 1;
    int mid = M / 2;

    double A = stopbandDb;
    double beta = (A > 50.0) ? 0.1102 * (A - 8.7)
                : (A >= 21.0) ? (0.5842 * pow(A - 21.0, 0.4) + 0.07886 * (A - 21.0))
                : 0.0;
    double i0beta = besselI0(beta);

    for (int n = 0; n <= M; ++n) {
        int k = n - mid;
        double sinc = (k == 0) ? 0.5 : (sin(M_PI * k * 0.5) / (M_PI * k));
        double r = (double)(2 * n) / M - 1.0;
        double w = besselI0(beta * sqrt(1.0 - r * r)) / i0beta;
        h[n] = (float)(sinc * w);
    }
    for (int n = 0; n <= M; ++n)
        if (n != mid && ((n - mid) % 2) == 0) h[n] = 0.0f;

    double sum = 0.0;
    for (float v : h) sum += v;
    if (sum > 1e-12) for (float& v : h) v = (float)(v / sum);
}

// ---------------------------------------------------------------------
// 2x up / 2x down stage, mono.
// ---------------------------------------------------------------------
struct Halfband2x {
    std::vector<float> h;
    std::vector<float> zUp, zDown;
    int taps = 0, idxUp = 0, idxDown = 0;

    void init(int numTaps = 31) {
        designHalfband(h, numTaps);
        taps = (int)h.size();
        zUp.assign(taps, 0.0f);
        zDown.assign(taps, 0.0f);
        idxUp = idxDown = 0;
    }
    void reset() {
        std::fill(zUp.begin(),   zUp.end(),   0.0f);
        std::fill(zDown.begin(), zDown.end(), 0.0f);
        idxUp = idxDown = 0;
    }

    inline void up(float x, float* out2) {
        if (zUp.size() == 0 || taps == 0 || h.size() == 0) { out2[0] = x; out2[1] = x; return; }
        zUp[idxUp] = x;
        int centre = taps / 2;
        int ic = idxUp - centre; if (ic < 0) ic += taps;
        out2[0] = zUp[ic] * 1.0f;

        float acc = 0.0f;
        for (int n = 1; n < taps; n += 2) {
            int i = idxUp - n; if (i < 0) i += taps;
            acc += h[n] * zUp[i];
        }
        out2[1] = acc * 2.0f;

        if (++idxUp >= taps) idxUp = 0;
    }

    inline float down(const float* in2) {
        if (zDown.size() == 0 || taps == 0 || h.size() == 0) return in2[0];
        float acc = 0.0f;
        for (int k = 0; k < 2; ++k) {
            zDown[idxDown] = in2[k];
            if (k == 1) {
                int centre = taps / 2;
                int ic = idxDown - centre; if (ic < 0) ic += taps;
                acc = zDown[ic] * 0.5f;
                for (int n = 1; n < taps; n += 2) {
                    int i = idxDown - n; if (i < 0) i += taps;
                    acc += h[n] * zDown[i];
                }
            }
            if (++idxDown >= taps) idxDown = 0;
        }
        return acc;
    }
};

// ---------------------------------------------------------------------
// 4x oversampler, stereo.
// ---------------------------------------------------------------------
struct Oversampler4x {
    Halfband2x s1L, s1R, s2L, s2R;

    void init(int taps1 = 31, int taps2 = 15) {
        s1L.init(taps1); s1R.init(taps1);
        s2L.init(taps2); s2R.init(taps2);
    }
    void reset() { s1L.reset(); s1R.reset(); s2L.reset(); s2R.reset(); }

    inline void upsample(float L, float R, float* out8) {
        float aL[2], aR[2];
        s1L.up(L, aL);
        s1R.up(R, aR);
        float bL[2], bR[2];
        for (int i = 0; i < 2; ++i) {
            s2L.up(aL[i], bL);
            s2R.up(aR[i], bR);
            out8[(i * 2 + 0) * 2 + 0] = bL[0];
            out8[(i * 2 + 0) * 2 + 1] = bR[0];
            out8[(i * 2 + 1) * 2 + 0] = bL[1];
            out8[(i * 2 + 1) * 2 + 1] = bR[1];
        }
    }

    inline void downsample(const float* in8, float* outL, float* outR) {
        float aL[2], aR[2];
        for (int i = 0; i < 2; ++i) {
            float pL[2] = { in8[(i * 2 + 0) * 2 + 0], in8[(i * 2 + 1) * 2 + 0] };
            float pR[2] = { in8[(i * 2 + 0) * 2 + 1], in8[(i * 2 + 1) * 2 + 1] };
            aL[i] = s2L.down(pL);
            aR[i] = s2R.down(pR);
        }
        *outL = s1L.down(aL);
        *outR = s1R.down(aR);
    }

    float latencySamples() const {
        return (s1L.taps / 2) * 0.5f + (s2L.taps / 2) * 0.25f;
    }
};
