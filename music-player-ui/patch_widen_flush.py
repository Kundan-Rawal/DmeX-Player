import os
import re

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'r') as f:
    text = f.read()

target = r'    memset\(g_widenerNode\.delayL, 0, sizeof\(g_widenerNode\.delayL\)\);\s*memset\(g_widenerNode\.delayR, 0, sizeof\(g_widenerNode\.delayR\)\);\s*g_widenerNode\.delayIdx = 0;\s*g_widenerNode\.lpStateL = 0\.0f;\s*g_widenerNode\.lpStateR = 0\.0f;\s*g_widenerNode\.sideLp = 0\.0f;\s*g_widenerNode\.sideLp2 = 0\.0f;'

replace = '''    g_widenerNode.xoverL.reset();
    g_widenerNode.xoverR.reset();
    g_widenerNode.corrEnv = 1.0f;'''

text = re.sub(target, replace, text)

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'w') as f:
    f.write(text)
print("Updated flush for widener")
