import sys

with open('../audio-engine-cpp/EngineCore.cpp', 'r') as f:
    text = f.read()

target = '''    ma_node_attach_output_bus(&g_spatializerNode, 0, &g_reverbNode, 0);
    ma_node_attach_output_bus(&g_reverbNode, 0, &g_meterNode, 0);
    ma_node_attach_output_bus(&g_meterNode, 0, &g_limiterNode, 0);
    ma_node_attach_output_bus(&g_limiterNode, 0, ma_engine_get_endpoint(&g_engine), 0);'''

replacement = '''    ma_node_attach_output_bus(&g_spatializerNode, 0, &g_reverbNode, 0);
    ma_node_attach_output_bus(&g_reverbNode, 0, &g_limiterNode, 0);
    ma_node_attach_output_bus(&g_limiterNode, 0, &g_meterNode, 0);
    ma_node_attach_output_bus(&g_meterNode, 0, ma_engine_get_endpoint(&g_engine), 0);'''

if target in text:
    text = text.replace(target, replacement)
    with open('../audio-engine-cpp/EngineCore.cpp', 'w') as f:
        f.write(text)
    print("Replaced routing order")
else:
    print("Not found")

