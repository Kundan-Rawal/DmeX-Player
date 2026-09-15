#pragma once
#include <vector>
#include <cstring>
#include <algorithm>
#include "pffft.h"

// Uniformly-partitioned overlap-save FFT convolution, mono.
class FFTConvolver {
public:
    ~FFTConvolver() { destroy(); }

    bool prepare(const float* ir, int irLen, int blockSize)
    {
        destroy();
        if (irLen <= 0 || blockSize <= 0) return false;

        B = blockSize;
        N = 2 * B;                       // FFT length
        P = (irLen + B - 1) / B;         // number of partitions

        setup = pffft_new_setup(N, PFFFT_REAL);
        if (!setup) return false;

        scratch = (float*)pffft_aligned_malloc(sizeof(float) * N);

        // ---- Pre-transform the IR partitions ----
        H.resize((size_t)P * N);
        std::vector<float> tmp(N, 0.0f);
        for (int p = 0; p < P; ++p) {
            std::fill(tmp.begin(), tmp.end(), 0.0f);
            int n = (std::min)(B, irLen - p * B);
            memcpy(tmp.data(), ir + p * B, sizeof(float) * n);
            pffft_transform(setup, tmp.data(), &H[(size_t)p * N], scratch, PFFFT_FORWARD);
        }

        // ---- Frequency-domain delay line ----
        X.assign((size_t)P * N, 0.0f);
        xHead = 0;

        Yacc.assign(N, 0.0f);
        timeBuf.assign(N, 0.0f);
        inputHistory.assign(B, 0.0f);

        // pffft's forward/inverse pair scales by N.
        norm = 1.0f / (float)N;
        return true;
    }

    void process(const float* in, float* out)
    {
        memcpy(timeBuf.data(),     inputHistory.data(), sizeof(float) * B);
        memcpy(timeBuf.data() + B, in,                  sizeof(float) * B);
        memcpy(inputHistory.data(), in,                 sizeof(float) * B);

        float* slot = &X[(size_t)xHead * N];
        pffft_transform(setup, timeBuf.data(), slot, scratch, PFFFT_FORWARD);

        std::fill(Yacc.begin(), Yacc.end(), 0.0f);
        for (int p = 0; p < P; ++p) {
            int idx = xHead - p;
            if (idx < 0) idx += P;
            pffft_zconvolve_accumulate(setup,
                                       &X[(size_t)idx * N],
                                       &H[(size_t)p   * N],
                                       Yacc.data(),
                                       1.0f);
        }

        pffft_transform(setup, Yacc.data(), timeBuf.data(), scratch, PFFFT_BACKWARD);
        for (int i = 0; i < B; ++i) out[i] = timeBuf[B + i] * norm;

        if (++xHead >= P) xHead = 0;
    }

    void reset() {
        std::fill(X.begin(), X.end(), 0.0f);
        std::fill(inputHistory.begin(), inputHistory.end(), 0.0f);
        xHead = 0;
    }

    int latencySamples() const { return 0; }

private:
    void destroy() {
        if (setup)   { pffft_destroy_setup(setup); setup = nullptr; }
        if (scratch) { pffft_aligned_free(scratch); scratch = nullptr; }
        H.clear(); X.clear(); Yacc.clear(); timeBuf.clear(); inputHistory.clear();
    }

    PFFFT_Setup* setup = nullptr;
    float* scratch = nullptr;
    std::vector<float> H, X, Yacc, timeBuf, inputHistory;
    int B = 0, N = 0, P = 0, xHead = 0;
    float norm = 1.0f;
};

struct BlockAdapter {
    std::vector<float> inBuf, outBuf;
    int fill = 0, B = 0, ch = 1;

    void init(int blockSize, int channels = 1) {
        B = blockSize;
        ch = channels;
        inBuf.assign(B * ch, 0.0f);
        outBuf.assign(B * ch, 0.0f);
        fill = 0;
    }

    template <typename Fn>
    void process(const float* in, float* out, int nFrames, Fn&& blockFn) {
        int done = 0;
        while (done < nFrames) {
            int take = (std::min)(B - fill, nFrames - done);
            memcpy(&inBuf[fill * ch], in + done * ch, sizeof(float) * take * ch);
            memcpy(out + done * ch, &outBuf[fill * ch], sizeof(float) * take * ch);
            fill += take; done += take;
            if (fill == B) {
                blockFn(inBuf.data(), outBuf.data());
                fill = 0;
            }
        }
    }
};
