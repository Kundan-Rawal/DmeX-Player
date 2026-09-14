import sys

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'r') as f:
    text = f.read()

idx_start = text.find('    for (ma_uint32 i = 0; i < fc; ++i)')
idx_end = text.find('}\nma_node_vtable g_limiter_vtable', idx_start)

replacement = '''    // -1.0 dBTP. This is the EBU R128 / Apple / Spotify delivery standard.
    // Do not raise it: values above -1 dBTP clip consumer DAC reconstruction filters
    // and clip lossy re-encoders (AAC/Opus overshoot by up to 1 dB).
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

        // Final hard safety clip. Should never engage if the above is correct.
        pOut[i * 2] = (oL > 1.0f) ? 1.0f : (oL < -1.0f ? -1.0f : oL);
        pOut[i * 2 + 1] = (oR > 1.0f) ? 1.0f : (oR < -1.0f ? -1.0f : oR);
    }
'''

if idx_start != -1 and idx_end != -1:
    text = text[:idx_start] + replacement + text[idx_end:]
    with open('../audio-engine-cpp/DSP_Nodes.cpp', 'w') as f:
        f.write(text)
    print("Replaced body of limiter_process")
else:
    print("Not found")

