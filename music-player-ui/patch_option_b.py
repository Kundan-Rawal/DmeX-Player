import sys

with open('../audio-engine-cpp/EngineCore.cpp', 'r') as f:
    text = f.read()

target1 = '''        deviceConfig.playback.channels = 2;
        deviceConfig.sampleRate        = 44100; // Force 44.1kHz (bypasses miniaudio's cheap linear resampler)
        deviceConfig.performanceProfile = ma_performance_profile_conservative; // Larger buffer to handle heavy 5.1 DSP math
        deviceConfig.dataCallback      = manual_data_callback;'''

replacement1 = '''        deviceConfig.playback.channels = 2;
        deviceConfig.sampleRate        = 44100; // Force 44.1kHz (bypasses miniaudio's cheap linear resampler)
        deviceConfig.performanceProfile = ma_performance_profile_conservative; // Larger buffer to handle heavy 5.1 DSP math
        deviceConfig.dataCallback      = manual_data_callback;
        deviceConfig.resampling.algorithm = ma_resample_algorithm_linear;
        deviceConfig.resampling.linear.lpfOrder = MA_MAX_FILTER_ORDER;'''

target2 = '''    deviceConfig.wasapi.noDefaultQualitySRC = MA_TRUE;
    deviceConfig.wasapi.noHardwareOffloading = MA_TRUE;
    deviceConfig.sampleRate = 0; // Hardware Native Rate

    // THE FIX: Explicitly bind the manual callback we just wrote
    deviceConfig.dataCallback = manual_data_callback;'''

replacement2 = '''    deviceConfig.wasapi.noDefaultQualitySRC = MA_TRUE;
    deviceConfig.wasapi.noHardwareOffloading = MA_TRUE;
    deviceConfig.sampleRate = 0; // Hardware Native Rate
    deviceConfig.resampling.algorithm = ma_resample_algorithm_linear;
    deviceConfig.resampling.linear.lpfOrder = MA_MAX_FILTER_ORDER;

    // THE FIX: Explicitly bind the manual callback we just wrote
    deviceConfig.dataCallback = manual_data_callback;'''


if target1 in text:
    text = text.replace(target1, replacement1)
if target2 in text:
    text = text.replace(target2, replacement2)

with open('../audio-engine-cpp/EngineCore.cpp', 'w') as f:
    f.write(text)
print("Updated EngineCore.cpp for Option B")
