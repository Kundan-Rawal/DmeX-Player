import sys
with open('C:/DmeX-Player/audio-engine-cpp/CommandParser.cpp', 'r') as f:
    text = f.read()

idx = text.find('extern "C" void get_audio_metrics')
if idx != -1:
    print(text[idx:idx+2500])
