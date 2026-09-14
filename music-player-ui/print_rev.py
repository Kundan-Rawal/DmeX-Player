import sys
with open('../audio-engine-cpp/DSP_Nodes.h', 'r') as f:
    text = f.read()
idx = text.find('struct ReverbNode')
if idx != -1:
    print(text[idx:idx+400])
