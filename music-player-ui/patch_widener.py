import os
import re

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'r') as f:
    text = f.read()

target = r'static void widener_process\(ma_node \*pNode, const float \*\*ppFramesIn, ma_uint32 \*pFrameCountIn, float \*\*ppFramesOut, ma_uint32 \*pFrameCountOut\).*?ma_node_vtable g_widener_vtable = \{widener_process, NULL, 1, 1, 0\};'

replace = '''static void widener_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    StereoWidenerNode *n = (StereoWidenerNode *)pNode;
    const float *in = ppFramesIn[0];
    float *out = ppFramesOut[0];
    ma_uint32 N = *pFrameCountIn;
    *pFrameCountOut = N;

    if (g_widenGate.fullyOff()) { memcpy(out, in, sizeof(float) * N * 2); return; }

    const float corrCoef = tauCoef(50.0f, g_coef.sr);

    for (ma_uint32 i = 0; i < N; ++i) {
        float gate = g_widenGate.next();
        float w    = n->width.next();

        float L = in[i*2], R = in[i*2 + 1];

        // ---- Correlation guard ----
        float instCorr = (L * R) / (0.5f * (L * L + R * R) + 1e-9f);
        instCorr = fmaxf(-1.0f, fminf(1.0f, instCorr));
        n->corrEnv += (instCorr - n->corrEnv) * corrCoef;

        float guard = (n->corrEnv + 0.5f) / 0.8f;
        guard = fmaxf(0.0f, fminf(1.0f, guard));
        float wEff = 1.0f + (w - 1.0f) * guard;

        // ---- 3-band split ----
        float loL, midL, hiL, loR, midR, hiR;
        n->xoverL.process(L, loL, midL, hiL);
        n->xoverR.process(R, loR, midR, hiR);

        // Per-band width.
        float wLo  = 1.0f;                            // 20-200 Hz   : mono
        float wMid = 1.0f + (wEff - 1.0f) * 0.6f;     // 200 Hz-4 kHz: moderate
        float wHi  = 1.0f + (wEff - 1.0f) * 1.0f;     // 4 kHz+      : full

        auto ms = [](float a, float b, float width, float& oa, float& ob) {
            float m = (a + b) * 0.5f;
            float s = (a - b) * 0.5f * width;
            oa = m + s; ob = m - s;
        };

        float oLoL, oLoR, oMidL, oMidR, oHiL, oHiR;
        ms(loL,  loR,  wLo,  oLoL,  oLoR);
        ms(midL, midR, wMid, oMidL, oMidR);
        ms(hiL,  hiR,  wHi,  oHiL,  oHiR);

        float wetL = oLoL + oMidL + oHiL;
        float wetR = oLoR + oMidR + oHiR;

        // Energy compensation
        float wAvg = (wLo + wMid + wHi) / 3.0f;
        float comp = 1.0f / sqrtf(1.0f + (wAvg * wAvg - 1.0f) * 0.5f);
        wetL *= comp; wetR *= comp;

        out[i*2]     = L + (wetL - L) * gate;
        out[i*2 + 1] = R + (wetR - R) * gate;
    }
}
ma_node_vtable g_widener_vtable = {widener_process, NULL, 1, 1, 0};'''

text = re.sub(target, replace, text, flags=re.DOTALL)

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'w') as f:
    f.write(text)
print("Updated widener_process")
