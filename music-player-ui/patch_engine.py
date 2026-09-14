import sys

with open('../audio-engine-cpp/EngineCore.cpp', 'r') as f:
    text = f.read()

target = '''        ma_engine_config engineConfig = ma_engine_config_init();
        engineConfig.noDevice    = MA_TRUE;'''

replacement = '''        ma_engine_config engineConfig = ma_engine_config_init();
        engineConfig.resourceManager = NULL;
        engineConfig.noDevice    = MA_TRUE;'''

text = text.replace(target, replacement)

target2 = '''    ma_engine_config engineConfig = ma_engine_config_init();
    engineConfig.noDevice = MA_TRUE; // Disconnect engine from automatic OS routing'''

replacement2 = '''    ma_engine_config engineConfig = ma_engine_config_init();
    engineConfig.resourceManager = NULL;
    engineConfig.noDevice = MA_TRUE; // Disconnect engine from automatic OS routing'''

text = text.replace(target2, replacement2)

with open('../audio-engine-cpp/EngineCore.cpp', 'w') as f:
    f.write(text)
print("Updated EngineCore.cpp resourceManager")
