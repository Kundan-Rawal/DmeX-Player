import os
import re

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'r') as f:
    text = f.read()

target_comp = '''static void multiband_compressor_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    MultibandCompressorNode *c = (MultibandCompressorNode *)pNode;
    if (!g_isCompressOn)
    {
        memcpy(ppFramesOut[0], ppFramesIn[0], (*pFrameCountIn) * 2 * sizeof(float));
        *pFrameCountOut = *pFrameCountIn;
        return;
    }
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    float thresh = c->threshold.next();
    float makeup = c->makeupGain.next();

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float L = pIn[i * 2], R = pIn[i * 2 + 1];

        // 1. ISOLATE HIGHS FOR DETECTION (So Subwoofer bass boost doesn't trigger the compressor!)
        c->lpStateL += 0.015f * (L - c->lpStateL);
        c->lpStateR += 0.015f * (R - c->lpStateR);
        float highDetL = L - c->lpStateL;
        float highDetR = R - c->lpStateR;
        float maxHighPeak = fmaxf(fabsf(highDetL), fabsf(highDetR));

        if (maxHighPeak > c->envHigh)
        {
            c->envHigh = c->envHigh * c->attackCoef + maxHighPeak * (1.0f - c->attackCoef);
        }
        else
        {
            c->envHigh = c->envHigh * c->releaseCoef + maxHighPeak * (1.0f - c->releaseCoef);
        }

        // Calculate gain reduction ONLY for the high band
        float highGain = 1.0f;
        if (c->envHigh > thresh && thresh > 0.001f)
        {
            float over = c->envHigh - thresh;
            highGain = thresh / (thresh + over * 0.35f); 
        }

        // 2. DELAY LINE
        float dL = c->dlyL[c->dlyIdx];
        float dR = c->dlyR[c->dlyIdx];
        c->dlyL[c->dlyIdx] = L;
        c->dlyR[c->dlyIdx] = R;
        c->dlyIdx = (c->dlyIdx + 1) % ((c->delaySamples > 0 && c->delaySamples <= COMP_LOOKAHEAD_SAMPLES) ? c->delaySamples : COMP_LOOKAHEAD_SAMPLES);

        // 3. SPLIT DELAYED SIGNAL INTO LOW AND HIGH (Phase-coherent LR4)
        float bassL, highL_d, bassR, highR_d;
        c->crossL.process(dL, bassL, highL_d);
        c->crossR.process(dR, bassR, highR_d);

        // Keep legacy legacy states updated in case of external inspections
        c->delayLpStateL = bassL;
        c->delayLpStateR = bassR;

        // 4. THE FIX: Apply gain ONLY to highs. Bass bypasses compression entirely!
        pOut[i * 2] = (bassL + (highL_d * highGain)) * makeup;
        pOut[i * 2 + 1] = (bassR + (highR_d * highGain)) * makeup;
    }
}'''

replace_comp = '''static float compressBand(MultibandCompressorNode::CompBand& b, float inL, float inR, float& outL, float& outR) {
    float peak = fmaxf(fabsf(inL), fabsf(inR));
    if (peak > b.env)
        b.env += (peak - b.env) * b.attackCoef;
    else
        b.env += (peak - b.env) * b.releaseCoef;
    b.env = dmexFlush(b.env);
    
    float envDb = (b.env > 1e-6f) ? 20.0f * log10f(b.env) : -120.0f;
    float gainDb = 0.0f;
    if (envDb > b.thresholdDb) {
        float over = envDb - b.thresholdDb;
        gainDb = -over * (1.0f - 1.0f / b.ratio);
    }
    float linearGain = powf(10.0f, gainDb / 20.0f);
    outL = inL * linearGain * b.makeupGain;
    outR = inR * linearGain * b.makeupGain;
    return linearGain;
}

static void multiband_compressor_process(ma_node *pNode, const float **ppFramesIn, ma_uint32 *pFrameCountIn, float **ppFramesOut, ma_uint32 *pFrameCountOut)
{
    MultibandCompressorNode *c = (MultibandCompressorNode *)pNode;
    if (!g_isCompressOn)
    {
        memcpy(ppFramesOut[0], ppFramesIn[0], (*pFrameCountIn) * 2 * sizeof(float));
        *pFrameCountOut = *pFrameCountIn;
        return;
    }
    const float *pIn = ppFramesIn[0];
    float *pOut = ppFramesOut[0];
    ma_uint32 fc = *pFrameCountIn;
    *pFrameCountOut = fc;

    // The threshold knob from UI shifts all thresholds
    float globalThresh = c->threshold.next();
    float globalThreshDb = (globalThresh > 1e-4f) ? 20.0f * log10f(globalThresh) : -80.0f;

    for (ma_uint32 i = 0; i < fc; ++i)
    {
        float L = pIn[i * 2], R = pIn[i * 2 + 1];

        // DELAY LINE (Lookahead)
        float dL = c->dlyL[c->dlyIdx];
        float dR = c->dlyR[c->dlyIdx];
        c->dlyL[c->dlyIdx] = L;
        c->dlyR[c->dlyIdx] = R;
        int dlySize = g_coef.compLookahead;
        if (dlySize > COMP_LOOKAHEAD_SAMPLES) dlySize = COMP_LOOKAHEAD_SAMPLES;
        c->dlyIdx = (c->dlyIdx + 1) % dlySize;

        // Split delayed signal into Low, Mid, High
        float loL, midL, hiL, loR, midR, hiR;
        c->xoverL.process(dL, loL, midL, hiL);
        c->xoverR.process(dR, loR, midR, hiR);
        
        // Update threshold based on global threshold
        c->bandLo.thresholdDb = globalThreshDb + 6.0f;  // Allow more bass before compression
        c->bandMid.thresholdDb = globalThreshDb + 0.0f;
        c->bandHi.thresholdDb = globalThreshDb - 2.0f;  // Compress highs earlier

        float outLoL, outLoR, outMidL, outMidR, outHiL, outHiR;
        compressBand(c->bandLo, loL, loR, outLoL, outLoR);
        compressBand(c->bandMid, midL, midR, outMidL, outMidR);
        compressBand(c->bandHi, hiL, hiR, outHiL, outHiR);

        float makeup = c->makeupGain.next();
        pOut[i * 2] = (outLoL + outMidL + outHiL) * makeup;
        pOut[i * 2 + 1] = (outLoR + outMidR + outHiR) * makeup;
    }
}'''

if target_comp in text:
    text = text.replace(target_comp, replace_comp)
else:
    print("Could not find target block! Using regex fallback.")
    # just in case legacy states comment differs
    target_pattern = r'static void multiband_compressor_process.*?pOut\[i \* 2 \+ 1\] = \(bassR \+ \(highR_d \* highGain\)\) \* makeup;\n    \}\n\}'
    text = re.sub(target_pattern, replace_comp, text, flags=re.DOTALL)

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'w') as f:
    f.write(text)
print("Updated multiband_compressor_process")
