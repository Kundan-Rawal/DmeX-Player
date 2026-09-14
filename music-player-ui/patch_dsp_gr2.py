import sys

with open('../audio-engine-cpp/DSP_Nodes.cpp', 'r') as f:
    text = f.read()

target = '''        pOut[i * 2] = (oL > 1.0f) ? 1.0f : (oL < -1.0f ? -1.0f : oL);
        pOut[i * 2 + 1] = (oR > 1.0f) ? 1.0f : (oR < -1.0f ? -1.0f : oR);
    }
}
ma_node_vtable g_limiter_vtable'''

replacement = '''        pOut[i * 2] = (oL > 1.0f) ? 1.0f : (oL < -1.0f ? -1.0f : oL);
        pOut[i * 2 + 1] = (oR > 1.0f) ? 1.0f : (oR < -1.0f ? -1.0f : oR);
    }
    
    extern std::atomic<float> g_limiterGR;
    g_limiterGR.store(p->gainSmooth, std::memory_order_relaxed);
}
ma_node_vtable g_limiter_vtable'''

if target in text:
    text = text.replace(target, replacement)
    with open('../audio-engine-cpp/DSP_Nodes.cpp', 'w') as f:
        f.write(text)
    print("Replaced DSP_Nodes.cpp for GR")
else:
    print("Not found in DSP_Nodes.cpp")
