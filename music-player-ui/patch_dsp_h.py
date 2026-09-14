import os

with open('../audio-engine-cpp/DSP_Nodes.h', 'r') as f:
    text = f.read()

target_subwoofer = '''    LinkwitzRiley4 crossBassL, crossBassR;       // 80Hz
    LinkwitzRiley4 crossMidBassL, crossMidBassR; // 180Hz'''

replace_subwoofer = '''    Crossover3 xoverL, xoverR;'''

text = text.replace(target_subwoofer, replace_subwoofer)

target_audiophile = '''    LinkwitzRiley4 crossBassL, crossBassR;       // 80Hz
    LinkwitzRiley4 crossMidBassL, crossMidBassR; // 180Hz
    LinkwitzRiley4 crossTrebleL, crossTrebleR;   // 8000Hz'''

replace_audiophile = '''    Crossover3 xoverL, xoverR;'''

text = text.replace(target_audiophile, replace_audiophile)

target_comp = '''    float envLow, envHigh;
    float attackCoef, releaseCoef;
    float lpStateL, lpStateR;

    // CRITICAL FIX 2: Crossover states for the delayed audio path
    float delayLpStateL, delayLpStateR;

    float dlyL[COMP_LOOKAHEAD_SAMPLES];
    float dlyR[COMP_LOOKAHEAD_SAMPLES];
    int dlyIdx, delaySamples;
    LinkwitzRiley4 crossL, crossR; // Phase-coherent 150Hz crossover'''

replace_comp = '''    struct CompBand {
        float env = 0.0f;
        float attackCoef = 0.0f;
        float releaseCoef = 0.0f;
        float ratio = 1.0f;
        float thresholdDb = 0.0f;
        float makeupGain = 1.0f;
    };
    CompBand bandLo, bandMid, bandHi;
    
    float dlyL[COMP_LOOKAHEAD_SAMPLES];
    float dlyR[COMP_LOOKAHEAD_SAMPLES];
    int dlyIdx = 0;
    
    Crossover3 xoverL, xoverR;'''

text = text.replace(target_comp, replace_comp)

with open('../audio-engine-cpp/DSP_Nodes.h', 'w') as f:
    f.write(text)
print("Updated DSP_Nodes.h for Crossover3")
