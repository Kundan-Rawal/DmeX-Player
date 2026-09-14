import sys

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
#endif'''

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
#endif'''

if target in text:
    text = text.replace(target, replacement)
    with open('../audio-engine-cpp/DSP_Nodes.cpp', 'w') as f:
        f.write(text)
    print("Replaced head of limiter_process")
else:
    print("Head not found")

