#include "Telemetry.h"
#include <cmath>
#include <algorithm>
#include <cstring>


// Define the global atomics we declared in the header
std::atomic<float> g_audioLevel{0.0f};
std::atomic<float> g_bLvl{0.0f}, g_bPan{0.0f};
std::atomic<float> g_mLvl{0.0f}, g_mPan{0.0f}, g_mPhase{1.0f};
std::atomic<float> g_tLvl{0.0f}, g_tPan{0.0f}, g_tPhase{1.0f};
std::atomic<float> g_limiterGR{1.0f};

void meter_analyze(MeterNode* p, const float* pIn, ma_uint32 fc)
{
    if (!p || !pIn || !fc) return;

    float bL2 = 0, bR2 = 0, bLR = 0, bPk = 0;
    float mL2 = 0, mR2 = 0, mLR = 0, mPk = 0;
    float tL2 = 0, tR2 = 0, tLR = 0, tPk = 0;
    float fullPk = 0;

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float L = pIn[i * 2], R = pIn[i * 2 + 1];

        float bL, nonLowL, bR, nonLowR;
        p->crossLowL.process(L, bL, nonLowL);
        p->crossLowR.process(R, bR, nonLowR);

        float mL, tL, mR, tR;
        p->crossHighL.process(nonLowL, mL, tL);
        p->crossHighR.process(nonLowR, mR, tR);

        // Keep legacy states updated in case of external inspection
        p->lowL = bL; p->lowR = bR;
        p->highStateL = L - tL; p->highStateR = R - tR;

        bL2 += bL * bL; bR2 += bR * bR; bLR += bL * bR;
        float bp = fmaxf(fabsf(bL), fabsf(bR)); if (bp > bPk) bPk = bp;

        mL2 += mL * mL; mR2 += mR * mR; mLR += mL * mR;
        float mp = fmaxf(fabsf(mL), fabsf(mR)); if (mp > mPk) mPk = mp;

        tL2 += tL * tL; tR2 += tR * tR; tLR += tL * tR;
        float tp = fmaxf(fabsf(tL), fabsf(tR)); if (tp > tPk) tPk = tp;

        float fp = fmaxf(fabsf(L), fabsf(R)); if (fp > fullPk) fullPk = fp;
    }

    float curLvl = g_audioLevel.load(std::memory_order_relaxed);
    g_audioLevel.store((fullPk > curLvl) ? (curLvl * 0.70f + fullPk * 0.30f) : (curLvl * 0.985f), std::memory_order_relaxed);

    auto smoothLvl = [](std::atomic<float> &atm, float pk) {
        float c = atm.load(std::memory_order_relaxed);
        atm.store((pk > c) ? (c * 0.50f + pk * 0.50f) : (c * 0.95f), std::memory_order_relaxed);
    };
    smoothLvl(g_bLvl, bPk); smoothLvl(g_mLvl, mPk); smoothLvl(g_tLvl, tPk);

    auto calcSpatial = [](float l2, float r2, float lr, std::atomic<float> &aPan, std::atomic<float> *aPhase) {
        float tot = l2 + r2;
        if (tot < 1e-7f) return;
        float pan = (r2 - l2) / tot;
        float cp = aPan.load(std::memory_order_relaxed);
        aPan.store(cp * 0.85f + pan * 0.15f, std::memory_order_relaxed);
        if (aPhase) {
            float phase = (2.0f * lr) / tot;
            float cph = aPhase->load(std::memory_order_relaxed);
            aPhase->store(cph * 0.85f + phase * 0.15f, std::memory_order_relaxed);
        }
    };
    calcSpatial(bL2, bR2, bLR, g_bPan, nullptr);
    calcSpatial(mL2, mR2, mLR, g_mPan, &g_mPhase);
    calcSpatial(tL2, tR2, tLR, g_tPan, &g_tPhase);
}
void meter_reset(MeterNode* p) {
    p->crossLowL.reset(); p->crossLowR.reset();
    p->crossHighL.reset(); p->crossHighR.reset();
    p->lowL = p->lowR = p->highStateL = p->highStateR = 0;
    g_audioLevel.store(0); g_bLvl.store(0); g_mLvl.store(0); g_tLvl.store(0);
    g_bPan.store(0); g_mPan.store(0); g_tPan.store(0);
    g_mPhase.store(1); g_tPhase.store(1);
}
static void meter_process(ma_node* pNode, const float** ppFramesIn, ma_uint32* pFrameCountIn,
                          float** ppFramesOut, ma_uint32* pFrameCountOut) {
    const ma_uint32 frames = (std::min)(*pFrameCountIn, *pFrameCountOut);
    *pFrameCountIn = *pFrameCountOut = frames;
    if (ppFramesIn[0] != ppFramesOut[0])
        std::memcpy(ppFramesOut[0], ppFramesIn[0], frames * 2 * sizeof(float));
    meter_analyze(reinterpret_cast<MeterNode*>(pNode), ppFramesIn[0], frames);
}
ma_node_vtable g_meter_vtable = {meter_process, NULL, 1, 1, 0};
