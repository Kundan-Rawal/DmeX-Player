import os
import re

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'r') as f:
    text = f.read()

target = r'        // Energy compensation\s*float wAvg = \(wLo \+ wMid \+ wHi\) / 3\.0f;\s*float comp = 1\.0f / sqrtf\(1\.0f \+ \(wAvg \* wAvg - 1\.0f\) \* 0\.5f\);\s*wetL \*= comp; wetR \*= comp;'

replace = '''        // Energy compensation ONLY on the bands that are widened (Mids/Highs)
        // so we don't accidentally turn down the Sub-Bass volume!
        float compMid = 1.0f / sqrtf(1.0f + (wMid * wMid - 1.0f) * 0.5f);
        float compHi = 1.0f / sqrtf(1.0f + (wHi * wHi - 1.0f) * 0.5f);
        
        oMidL *= compMid; oMidR *= compMid;
        oHiL *= compHi; oHiR *= compHi;

        float wetL = oLoL + oMidL + oHiL;
        float wetR = oLoR + oMidR + oHiR;'''

text = re.sub(target, replace, text)

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'w') as f:
    f.write(text)
print("Updated widener_process to preserve bass volume")
