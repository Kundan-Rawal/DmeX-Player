#include "Telemetry.h"
#include <cmath>

// Define the global atomics we declared in the header
std::atomic<float> g_audioLevel{0.0f};
std::atomic<float> g_bLvl{0.0f}, g_bPan{0.0f};
std::atomic<float> g_mLvl{0.0f}, g_mPan{0.0f}, g_mPhase{1.0f};
std::atomic<float> g_tLvl{0.0f}, g_tPan{0.0f}, g_tPhase{1.0f};

static void meter_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    MeterNode *p = (MeterNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    float bL2 = 0, bR2 = 0, bLR = 0, bPk = 0;
    float mL2 = 0, mR2 = 0, mLR = 0, mPk = 0;
    float tL2 = 0, tR2 = 0, tLR = 0, tPk = 0;
    float fullPk = 0;

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float L = pIn[i * 2], R = pIn[i * 2 + 1];
        pOut[i * 2] = L; pOut[i * 2 + 1] = R;

        p->lowL += 0.02f * (L - p->lowL);
        p->lowR += 0.02f * (R - p->lowR);
        float bL = p->lowL, bR = p->lowR;

        p->highStateL += 0.40f * (L - p->highStateL);
        p->highStateR += 0.40f * (R - p->highStateR);
        float tL = L - p->highStateL, tR = R - p->highStateR;

        float mL = L - bL - tL, mR = R - bR - tR;

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
ma_node_vtable g_meter_vtable = {meter_process, NULL, 1, 1, 0};