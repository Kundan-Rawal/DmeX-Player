import os
import re

with open('current_DSP_Nodes.cpp', 'r') as f:
    cur_cpp = f.read()
with open('old_DSP_Nodes.cpp', 'r') as f:
    old_cpp = f.read()

# Extract new widener_process
widener_proc_match = re.search(r'static void widener_process\(.*?\nma_node_vtable g_widener_vtable = \{widener_process, NULL, 1, 1, 0\};', cur_cpp, re.DOTALL)

# Replace in old_cpp
old_cpp = re.sub(r'static void widener_process\(.*?\nma_node_vtable g_widener_vtable = \{widener_process, NULL, 1, 1, 0\};', widener_proc_match.group(0), old_cpp, flags=re.DOTALL)

# Handle flush function
# The old one had delayL, delayR, delayIdx, lpStateL, lpStateR, sideLp, sideLp2
# We replace it with xoverL.reset(), xoverR.reset(), corrEnv = 1.0f

old_flush_target = r'    memset\(g_widenerNode\.delayL, 0, sizeof\(g_widenerNode\.delayL\)\);\s*memset\(g_widenerNode\.delayR, 0, sizeof\(g_widenerNode\.delayR\)\);\s*g_widenerNode\.delayIdx = 0;\s*g_widenerNode\.lpStateL = 0\.0f;\s*g_widenerNode\.lpStateR = 0\.0f;\s*g_widenerNode\.sideLp = 0\.0f;\s*g_widenerNode\.sideLp2 = 0\.0f;'
new_flush = '''    g_widenerNode.xoverL.reset();
    g_widenerNode.xoverR.reset();
    g_widenerNode.corrEnv = 1.0f;'''

old_cpp = re.sub(old_flush_target, new_flush, old_cpp)

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'w') as f:
    f.write(old_cpp)
print("Restored old DSP_Nodes.cpp with new widener_process")
