import sys
import re

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'r') as f:
    text = f.read()

pattern = re.compile(r"static void limiter_process\(ma_node \*pNode.*?}\nma_node_vtable g_limiter_vtable", re.DOTALL)

replacement = '''static void limiter_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    LimiterNode *p = (LimiterNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

#ifdef __ANDROID__
    if (g_isAndroidSpeaker)
    {
        // THE LOUDNESS WAR CLIPPER (Android Speakers Only)
        for (ma_uint32 i = 0; i < fc; ++i)
        {
            float L = pIn[i * 2] * p->boost;
            float R = pIn[i * 2 + 1] * p->boost;

            auto clip = [](float x)
            {
                float ax = fabsf(x);
                if (ax < 0.70f) return x;
                float over = ax - 0.70f;
                float lim = 0.70f + 0.30f * tanhf(over / 0.30f);
                return (x > 0) ? lim : -lim;
            };

            pOut[i * 2] = clip(L);
            pOut[i * 2 + 1] = clip(R);
        }
        return; 
    }
#endif

    // -1.0 dBTP. This is the EBU R128 / Apple / Spotify delivery standard.
    const float CEILING = 0.891251f;   // 10^(-1/20)
    
    float sr = p->sr > 0.0f ? p->sr : 44100.0f;
    float tauCoef = 1.0f - std::exp(-1.0f / (1.5f * 0.001f * sr));

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float boost = p->boost.next();
        float multiplier = g_isLaptopSpeaker ? 1.3f : 1.0f;
        float L = pIn[i * 2] * boost * multiplier;
        float R = pIn[i * 2 + 1] * boost * multiplier;

        // --- TRUE-PEAK DETECTION on a 4x oversampled copy ---
        float up[8];
        p->osDetect.upsample(L, R, up);
        float tp = 0.0f;
        for (int k = 0; k < 8; ++k) tp = fmaxf(tp, fabsf(up[k]));

        // --- Gain computation ---
        float targetGain = (tp > CEILING) ? (CEILING / tp) : 1.0f;

        // Asymmetric envelope: instant attack (lookahead absorbs it), smooth release.
        if (targetGain < p->gainEnv)
            p->gainEnv = targetGain;                                        // attack
        else
            p->gainEnv += (targetGain - p->gainEnv) * p->releaseCoef;       // release
        
        p->gainEnv = dmexFlush(p->gainEnv);
        p->gainSmooth += (p->gainEnv - p->gainSmooth) * tauCoef;

        // --- Lookahead delay so the gain reduction arrives BEFORE the transient ---
        int w = p->dlyIdx;
        p->dlyL[w] = L;
        p->dlyR[w] = R;
        int r = w - p->delaySamples;
        if (r < 0) r += LIMITER_LOOKAHEAD_SAMPLES;
        
        float dL = p->dlyL[r];
        float dR = p->dlyR[r];
        if (++p->dlyIdx >= LIMITER_LOOKAHEAD_SAMPLES) p->dlyIdx = 0;

        float oL = dL * p->gainSmooth;
        float oR = dR * p->gainSmooth;

        // Final hard safety clip.
        pOut[i * 2] = (oL > 1.0f) ? 1.0f : (oL < -1.0f ? -1.0f : oL);
        pOut[i * 2 + 1] = (oR > 1.0f) ? 1.0f : (oR < -1.0f ? -1.0f : oR);
    }
    
    extern std::atomic<float> g_limiterGR;
    g_limiterGR.store(p->gainSmooth, std::memory_order_relaxed);
}
ma_node_vtable g_limiter_vtable'''

if pattern.search(text):
    text = pattern.sub(replacement, text)
    with open('../audio-engine-cpp/DSP_Nodes.cpp', 'w') as f:
        f.write(text)
    print("Replaced with regex!")
else:
    print("Regex not matched!")
