#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"
#include <iostream>
#include <string>

#ifdef _WIN32
#include <windows.h>
#endif

using namespace std;

int main()
{
#ifdef _WIN32
    SetConsoleOutputCP(CP_UTF8);
    SetConsoleCP(CP_UTF8);
#endif

    ma_engine engine;
    ma_sound sound;
    bool isSoundInitialized = false;
    bool isEnhanced = false;

    if (ma_engine_init(NULL, &engine) != MA_SUCCESS)
        return -1;

    // --- BUILD THE DSP REMASTER CHAIN ---
    ma_node_graph *pNodeGraph = ma_engine_get_node_graph(&engine);
    ma_uint32 channels = 2;
    ma_uint32 sampleRate = 48000;

    // 1. Bass Thump (Low Shelf: +8dB at 80Hz)
    ma_loshelf_node_config bassConfig = ma_loshelf_node_config_init(channels, sampleRate, 8.0f, 1.0f, 80.0f);
    ma_loshelf_node bassNode;
    if (ma_loshelf_node_init(pNodeGraph, &bassConfig, NULL, &bassNode) != MA_SUCCESS)
    {
        ma_engine_uninit(&engine);
        return -1;
    }

    // 2. Hollow Fix (Peaking EQ: -5dB cut at 400Hz)
    ma_peak_node_config midConfig = ma_peak_node_config_init(channels, sampleRate, -5.0f, 1.0f, 400.0f);
    ma_peak_node midNode;
    if (ma_peak_node_init(pNodeGraph, &midConfig, NULL, &midNode) != MA_SUCCESS)
    {
        ma_loshelf_node_uninit(&bassNode, NULL);
        ma_engine_uninit(&engine);
        return -1;
    }

    // 3. Hiss Denoiser (High Shelf: -12dB cut at 10000Hz)
    ma_hishelf_node_config trebleConfig = ma_hishelf_node_config_init(channels, sampleRate, -12.0f, 1.0f, 10000.0f);
    ma_hishelf_node trebleNode;
    if (ma_hishelf_node_init(pNodeGraph, &trebleConfig, NULL, &trebleNode) != MA_SUCCESS)
    {
        ma_peak_node_uninit(&midNode, NULL);
        ma_loshelf_node_uninit(&bassNode, NULL);
        ma_engine_uninit(&engine);
        return -1;
    }

    // Wire the DSP Chain: Bass -> Mid -> Treble -> Master Output
    ma_node_attach_output_bus(&bassNode, 0, &midNode, 0);
    ma_node_attach_output_bus(&midNode, 0, &trebleNode, 0);
    ma_node_attach_output_bus(&trebleNode, 0, ma_engine_get_endpoint(&engine), 0);

    cout << "READY" << endl;

    string command;
    while (cin >> command || !cin.eof())
    {
        if (cin.fail())
        {
            cin.clear();
            cin.ignore(10000, '\n');
            continue;
        }

        if (command == "LOAD")
        {
            string filepath;
            ws(cin);
            getline(cin, filepath);
            filepath.erase(filepath.find_last_not_of(" \n\r\t") + 1);
            if (filepath.empty())
                continue;

            if (isSoundInitialized)
            {
                ma_sound_stop(&sound);
                ma_sound_uninit(&sound);
                isSoundInitialized = false;
            }

            if (ma_sound_init_from_file(&engine, filepath.c_str(), MA_SOUND_FLAG_DECODE, NULL, NULL, &sound) == MA_SUCCESS)
            {
                isSoundInitialized = true;

                if (isEnhanced)
                    ma_node_attach_output_bus((ma_node *)&sound, 0, &bassNode, 0);
                else
                    ma_node_attach_output_bus((ma_node *)&sound, 0, ma_engine_get_endpoint(&engine), 0);

                cout << "LOADED_SUCCESSFULLY" << endl;
            }
        }
        else if (command == "ENHANCE")
        {
            int toggle;
            cin >> toggle;
            isEnhanced = (toggle == 1);
            if (isSoundInitialized)
            {
                if (isEnhanced)
                {
                    ma_node_attach_output_bus((ma_node *)&sound, 0, &bassNode, 0);
                    cout << "DEBUG_ACTION: DSP REMASTER ACTIVE" << endl;
                }
                else
                {
                    ma_node_attach_output_bus((ma_node *)&sound, 0, ma_engine_get_endpoint(&engine), 0);
                    cout << "DEBUG_ACTION: DSP REMASTER BYPASSED" << endl;
                }
            }
        }
        // --- RESTORED GLOBAL VOLUME COMMAND ---
        else if (command == "VOLUME")
        {
            float targetVolume;
            cin >> targetVolume;
            ma_engine_set_volume(&engine, targetVolume);
            cout << "DEBUG_ACTION: VOLUME SET TO " << targetVolume << endl;
        }
        else if (command == "GET_TIME" && isSoundInitialized)
        {
            float cursor = 0.0f;
            float length = 0.0f;
            ma_sound_get_cursor_in_seconds(&sound, &cursor);
            ma_sound_get_length_in_seconds(&sound, &length);
            cout << "TIME " << cursor << " " << length << endl;
        }
        else if (command == "PLAY" && isSoundInitialized)
        {
            ma_sound_start(&sound);
        }
        else if (command == "PAUSE" && isSoundInitialized)
        {
            ma_sound_stop(&sound);
        }
        else if (command == "SEEK" && isSoundInitialized)
        {
            float targetSeconds;
            cin >> targetSeconds;
            ma_uint64 targetFrame = (ma_uint64)(targetSeconds * sampleRate);
            ma_sound_seek_to_pcm_frame(&sound, targetFrame);
        }
        else if (command == "QUIT")
        {
            break;
        }
    }

    if (isSoundInitialized)
        ma_sound_uninit(&sound);

    ma_hishelf_node_uninit(&trebleNode, NULL);
    ma_peak_node_uninit(&midNode, NULL);
    ma_loshelf_node_uninit(&bassNode, NULL);

    ma_engine_uninit(&engine);
    return 0;
}