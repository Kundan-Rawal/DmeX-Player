import sys

with open('../audio-engine-cpp/DSP_Nodes.h', 'r') as f:
    text = f.read()

text = text.replace('#define MAX_AP_BUF 600', '#define MAX_AP_BUF 1500')
text = text.replace('#define MAX_AP_BUF 1500\n\nstruct CombFilter', '\nstruct CombFilter')

with open('../audio-engine-cpp/DSP_Nodes.h', 'w') as f:
    f.write(text)
print("Fixed MAX_AP_BUF")
