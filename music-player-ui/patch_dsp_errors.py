import os
import re

with open('../audio-engine-cpp/DSP_Nodes.h', 'r') as f:
    text = f.read()

# 1. Fix missing reset() in Biquad classes
# Sometimes python replace fails if exact whitespace differs. Let's use regex.
text = re.sub(r'(struct BiquadLPF\s*\{.*?)float process\(', r'\1void reset() { x1 = 0; x2 = 0; y1 = 0; y2 = 0; }\n\n    float process(', text, flags=re.DOTALL)
text = re.sub(r'(struct BiquadHPF\s*\{.*?)float process\(', r'\1void reset() { x1 = 0; x2 = 0; y1 = 0; y2 = 0; }\n\n    float process(', text, flags=re.DOTALL)

# 2. Fix CompBand missing init()
target_band = r'struct CompBand \{\s*float env = 0\.0f;\s*float attackCoef = 0\.0f;\s*float releaseCoef = 0\.0f;\s*float ratio = 1\.0f;\s*float thresholdDb = 0\.0f;\s*float makeupGain = 1\.0f;\s*\};'
replace_band = '''struct CompBand {
        float env = 0.0f;
        float attackCoef = 0.0f;
        float releaseCoef = 0.0f;
        float ratio = 1.0f;
        float thresholdDb = 0.0f;
        float makeupGain = 1.0f;
        void init(float sr, float attMs, float relMs, float r, float thDb, float mu) {
            attackCoef = tauCoef(attMs, sr);
            releaseCoef = tauCoef(relMs, sr);
            ratio = r;
            thresholdDb = thDb;
            makeupGain = mu;
            env = 0.0f;
        }
    };'''
text = re.sub(target_band, replace_band, text)

# 3. Move Crossover3 to the top (before AudiophileEQNode)
crossover_match = re.search(r'// Phase-coherent 3-way Linkwitz-Riley crossover.*?struct Crossover3 \{.*?\};\n', text, re.DOTALL)
if crossover_match:
    crossover_code = crossover_match.group(0)
    text = text.replace(crossover_code, '')
    
    # insert before AudiophileEQNode
    insert_pos = text.find('struct AudiophileEQNode')
    text = text[:insert_pos] + crossover_code + '\n' + text[insert_pos:]

with open('../audio-engine-cpp/DSP_Nodes.h', 'w') as f:
    f.write(text)
print("Fixed DSP_Nodes.h compilation errors")
