import re

with open('../audio-engine-cpp/EngineCore.cpp', 'r') as f:
    text = f.read()

lines = text.split('\n')
out = []
for line in lines:
    if 'memset(&g_' in line and 'sizeof(g_' in line:
        continue # Remove all global node memsets
    out.append(line)

text = '\n'.join(out)

# Add dsp_flush_all_state() before engine start
text = text.replace('if (ma_engine_start(&g_engine) != MA_SUCCESS)', 'dsp_flush_all_state();\n    if (ma_engine_start(&g_engine) != MA_SUCCESS)')

with open('../audio-engine-cpp/EngineCore.cpp', 'w') as f:
    f.write(text)
