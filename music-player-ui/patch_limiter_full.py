import sys
import re

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'r') as f:
    text = f.read()

target = '''static void limiter_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    LimiterNode *p = (LimiterNode *)pNode;
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    // Hard ceiling for the safety clipper
    float b = p->boost.next();
        float thresh = (b > 1.01f) ? 0.92f : 0.999f;

#ifdef __ANDROID__
    if (g_isAndroidSpeaker)
    {
        // THE LOUDNESS WAR CLIPPER (Android Speakers Only)
        // Bypasses the clean envelope to aggressively maximize RMS volume.
        for (ma_uint32 i = 0; i < fc; ++i)
        {
            float L = pIn[i * 2] * p->boost;
            float R = pIn[i * 2 + 1] * p->boost;

            auto clip = [](float x)
            {
                float ax = fabsf(x);
                // Clean up to 70% volume.
                if (ax < 0.70f)
                    return x;
                // Hyperbolic tangent saturation for the top 30% to prevent hard clipping crackle.
                float over = ax - 0.70f;
                float lim = 0.70f + 0.30f * tanhf(over / 0.30f);
                return (x > 0) ? lim : -lim;
            };

            pOut[i * 2] = clip(L);
            pOut[i * 2 + 1] = clip(R);
        }
        return; // Exit early, skipping the clean Lookahead limiter below
    }
#endif

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        // 1. Read raw input and apply the user's boost
        float multiplier = g_isLaptopSpeaker ? 1.3f : 1.0f; // Give laptop speakers a reasonable boost without squashing the limiter
        float L = pIn[i * 2] * b * multiplier;
        float R = pIn[i * 2 + 1] * b * multiplier;

        // 2. High-Pass Sidechain Peak Detection
        // We use a gentle 1-pole high-pass (subtracting a low-pass) for the envelope detector.
        // This makes the limiter "blind" to the massive 45Hz sub-bass, completely preventing 
        // the bass from ducking (depriving) the treble and vocals in Max/Max+ modes!
        float scCoef = 0.05f; // ~300Hz cutoff for sidechain
        p->scLpL += scCoef * (L - p->scLpL);
        p->scLpR += scCoef * (R - p->scLpR);
        float scHighPassL = L - p->scLpL;
        float scHighPassR = R - p->scLpR;

        // Peak detection using the high-passed signal!
        float rawPeak = fmaxf(fabsf(scHighPassL), fabsf(scHighPassR));
        if (rawPeak > p->peakEnv) {
            p->peakEnv = rawPeak;
        } else {
            p->peakEnv = p->peakEnv * 0.9995f + rawPeak * 0.0005f; // ~35ms inertia at 44.1kHz
        }
        float peak = p->peakEnv;

        // 3. Calculate Target Gain (How much do we need to duck to prevent clipping?)
        float targetGain = 1.0f;
        if (peak > thresh)
        {
            targetGain = thresh / peak;
        }

        // 4. Smooth the Envelope (Fast Attack, Slow Release)
        if (targetGain < p->gainEnv)
        {
            // Volume is too high -> Duck quickly (Attack)
            p->gainEnv = p->gainEnv * p->attackCoef + targetGain * (1.0f - p->attackCoef);
        }
        else
        {
            // Volume is safe -> Recover slowly (Release)
            p->gainEnv = p->gainEnv * p->releaseCoef + targetGain * (1.0f - p->releaseCoef);
        }

        // 5. Read the DELAYED Signal (The signal from ~2ms ago)
        float delayedL = p->dlyL[p->dlyIdx];
        float delayedR = p->dlyR[p->dlyIdx];

        // 6. Push the CURRENT signal into the delay buffer for the future
        p->dlyL[p->dlyIdx] = L;
        p->dlyR[p->dlyIdx] = R;
        p->dlyIdx = (p->dlyIdx + 1) % ((p->delaySamples > 0 && p->delaySamples <= LIMITER_LOOKAHEAD_SAMPLES) ? p->delaySamples : LIMITER_LOOKAHEAD_SAMPLES);

        // 7. Apply the smoothed gain envelope to the delayed signal
        float outL = delayedL * p->gainEnv;
        float outR = delayedR * p->gainEnv;

        // 8. Safety Soft-Clip (Just in case the attack wasn't fast enough)
        pOut[i * 2] = (outL > 1.0f) ? 1.0f : (outL < -1.0f ? -1.0f : outL);
        pOut[i * 2 + 1] = (outR > 1.0f) ? 1.0f : (outR < -1.0f ? -1.0f : outR);
    }
}'''

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
        // Bypasses the clean envelope to aggressively maximize RMS volume.
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
    
    extern std::atomic<float> g_limiterGR;
    g_limiterGR.store(p->gainSmooth, std::memory_order_relaxed);
}'''

if target in text:
    text = text.replace(target, replacement)
    with open('../audio-engine-cpp/DSP_Nodes.cpp', 'w') as f:
        f.write(text)
    print("Replaced limiter_process completely")
else:
    print("Not found. Check exactly if target string matches.")
