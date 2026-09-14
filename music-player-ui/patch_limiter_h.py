import sys

with open('../audio-engine-cpp/DSP_Nodes.h', 'r') as f:
    text = f.read()

target = '''struct LimiterNode
{
    ma_node_base baseNode;
    SmoothedParam boost;
    float gainEnv;
    float attackCoef, releaseCoef;
    float peakEnv; // Anti-motorboating envelope peak follower

    float dlyL[LIMITER_LOOKAHEAD_SAMPLES];
    float dlyR[LIMITER_LOOKAHEAD_SAMPLES];
    int dlyIdx, delaySamples;
    
    // High-Pass Sidechain state to prevent Bass from ducking Vocals/Treble
    float scLpL, scLpR;
};'''

replacement = '''struct LimiterNode
{
    ma_node_base baseNode;
    SmoothedParam boost;
    float gainEnv;
    float gainSmooth; // T11.3 smoothed envelope
    float attackCoef, releaseCoef;
    float peakEnv; // Anti-motorboating envelope peak follower

    float dlyL[LIMITER_LOOKAHEAD_SAMPLES];
    float dlyR[LIMITER_LOOKAHEAD_SAMPLES];
    int dlyIdx, delaySamples;
    
    // High-Pass Sidechain state to prevent Bass from ducking Vocals/Treble
    float scLpL, scLpR;

    Oversampler4x osDetect;
    float sr;
};'''

if target in text:
    text = text.replace(target, replacement)
    with open('../audio-engine-cpp/DSP_Nodes.h', 'w') as f:
        f.write(text)
    print("Replaced LimiterNode in DSP_Nodes.h")
else:
    print("Target not found in DSP_Nodes.h")

