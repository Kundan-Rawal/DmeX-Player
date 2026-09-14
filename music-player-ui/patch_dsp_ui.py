import os

with open('src/types/index.ts', 'r', encoding='utf-8') as f:
    text = f.read()
text = text.replace('spatial: number;\n  reverb: number;', 'spatial: number;\n  depth: number;\n  reverb: number;')
with open('src/types/index.ts', 'w', encoding='utf-8') as f:
    f.write(text)

with open('src/config/audio.ts', 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace('spatial:0.08, reverb:0.10', 'spatial:0.08, depth:0.0, reverb:0.10')
text = text.replace('spatial:0.05, reverb:0.05', 'spatial:0.05, depth:0.15, reverb:0.05')
text = text.replace('spatial:0.05, reverb:0.04', 'spatial:0.05, depth:0.25, reverb:0.04')
text = text.replace('spatial:0.08, reverb:0.04', 'spatial:0.08, depth:0.0, reverb:0.04')
text = text.replace('spatial:0.06, reverb:0.03', 'spatial:0.06, depth:0.05, reverb:0.03')
text = text.replace('spatial:0.20, reverb:0.18', 'spatial:0.20, depth:0.1, reverb:0.18')
text = text.replace('spatial:0.07, reverb:0.06', 'spatial:0.07, depth:0.05, reverb:0.06')

text = text.replace('s.spatial = 0.0;                \n    s.reverb = 0.01;', 's.spatial = 0.0;                \n    s.depth = 0.0;\n    s.reverb = 0.01;')
text = text.replace('s.spatial = Math.max(0.25, base.spatial + 0.15); \n    s.reverb = Math.max(0.12, base.reverb + 0.08);', 's.spatial = Math.max(0.25, base.spatial + 0.15); \n    s.depth = Math.max(0.35, base.depth + 0.20);\n    s.reverb = Math.max(0.12, base.reverb + 0.08);')
text = text.replace('s.spatial = Math.min(0.30, base.spatial + 0.10); \n    s.reverb = Math.min(0.30, base.reverb + 0.12);', 's.spatial = Math.min(0.30, base.spatial + 0.10); \n    s.depth = Math.max(0.20, base.depth + 0.10);\n    s.reverb = Math.min(0.30, base.reverb + 0.12);')

with open('src/config/audio.ts', 'w', encoding='utf-8') as f:
    f.write(text)

with open('src/App.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace('setSpatialExtra(s.spatial);\n      setDepthAmount(0.0);', 'setSpatialExtra(s.spatial);\n      setDepthAmount(s.depth);\n      await writeToEngine(DEPTH );')

with open('src/App.tsx', 'w', encoding='utf-8') as f:
    f.write(text)

with open('../audio-engine-cpp/DirectionalBands.h', 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace('f_gain = 4.0f * frontness * depth;', 'f_gain = 8.0f * frontness * depth;')
text = text.replace('b_gain = -2.0f * frontness * depth;', 'b_gain = -4.0f * frontness * depth;')
text = text.replace('b_gain = 4.0f * (-frontness) * depth;', 'b_gain = 8.0f * (-frontness) * depth;')
text = text.replace('f_gain = -2.0f * (-frontness) * depth;', 'f_gain = -4.0f * (-frontness) * depth;')

with open('../audio-engine-cpp/DirectionalBands.h', 'w', encoding='utf-8') as f:
    f.write(text)
print("Updated config and DSP")
