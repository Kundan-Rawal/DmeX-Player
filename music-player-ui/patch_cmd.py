import os
import re

with open('../audio-engine-cpp/CommandParser.cpp', 'r') as f:
    text = f.read()

target = r'    else if \(command == "3D"\)'
replace = '''    else if (command == "DEPTH")
    {
        float d = safe_stof(args);
        if (d < 0.0f) d = 0.0f;
        if (d > 1.0f) d = 1.0f;
        g_spatializerNode.depthAmount.set(d);
    }
    else if (command == "3D")'''

text = re.sub(target, replace, text)

with open('../audio-engine-cpp/CommandParser.cpp', 'w') as f:
    f.write(text)
print("Added DEPTH command handler")
