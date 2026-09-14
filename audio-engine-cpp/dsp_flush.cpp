extern ConvolutionNode g_convolutionNode;
extern ReverbNode g_reverbNode;
extern MultibandCompressorNode g_compressorNode;
extern LimiterNode g_limiterNode;
extern StudioExciterNode g_exciterNode;
extern AudiophileEQNode g_audiophileEQNode;
extern SubwooferNode g_subwooferNode;
extern PsychoacousticNode g_spatializerNode;
extern AudioRestorationNode g_restorationNode;
extern StereoWidenerNode g_widenerNode;
extern std::mutex g_irMutex;
extern std::atomic<float> g_audioLevel;

void dsp_flush_all_state(void)
{
    {
        std::lock_guard<std::mutex> lk(g_irMutex);
        if (g_convolutionNode.historyL)
            memset(g_convolutionNode.historyL, 0, sizeof(float) * g_convolutionNode.irLength);
        if (g_convolutionNode.historyR)
            memset(g_convolutionNode.historyR, 0, sizeof(float) * g_convolutionNode.irLength);
        g_convolutionNode.historyIdx = 0;
        g_convolutionNode.hpStateL = 0.0f;
        g_convolutionNode.hpStateR = 0.0f;
        g_convolutionNode.lpStateL = 0.0f;
        g_convolutionNode.lpStateR = 0.0f;
    }

    memset(g_reverbNode.combL, 0, sizeof(g_reverbNode.combL));
    memset(g_reverbNode.combR, 0, sizeof(g_reverbNode.combR));
    memset(g_reverbNode.apL,   0, sizeof(g_reverbNode.apL));
    memset(g_reverbNode.apR,   0, sizeof(g_reverbNode.apR));

    memset(g_compressorNode.dlyL, 0, sizeof(g_compressorNode.dlyL));
    memset(g_compressorNode.dlyR, 0, sizeof(g_compressorNode.dlyR));
    g_compressorNode.dlyIdx = 0;
    g_compressorNode.envLow  = 0.0f;
    g_compressorNode.envHigh = 0.0f;
    g_compressorNode.lpStateL = 0.0f;
    g_compressorNode.lpStateR = 0.0f;
    g_compressorNode.delayLpStateL = 0.0f;
    g_compressorNode.delayLpStateR = 0.0f;

    memset(g_limiterNode.dlyL, 0, sizeof(g_limiterNode.dlyL));
    memset(g_limiterNode.dlyR, 0, sizeof(g_limiterNode.dlyR));
    g_limiterNode.dlyIdx = 0;
    g_limiterNode.gainEnv = 1.0f;
    g_limiterNode.peakEnv = 0.0f;
    g_limiterNode.scLpL = 0.0f;
    g_limiterNode.scLpR = 0.0f;

    g_exciterNode.hpStateL = 0.0f;
    g_exciterNode.hpStateR = 0.0f;

    g_audiophileEQNode.currentBass = 0.0f;
    g_audiophileEQNode.currentMid  = 0.0f;
    g_audiophileEQNode.currentHigh = 0.0f;
    g_audiophileEQNode.envUpwardL = 0.0f;
    g_audiophileEQNode.envUpwardR = 0.0f;
    g_audiophileEQNode.dcBlockL = 0.0f;
    g_audiophileEQNode.dcBlockR = 0.0f;
    g_audiophileEQNode.env = 0.0f;

    g_subwooferNode.hp1L = 0.0f; g_subwooferNode.hp1R = 0.0f;
    g_subwooferNode.lp1L = 0.0f; g_subwooferNode.lp1R = 0.0f;
    g_subwooferNode.env30_60 = 0.0f;
    g_subwooferNode.env60_90 = 0.0f;
    g_subwooferNode.env90_130 = 0.0f;

    memset(g_spatializerNode.centerDelayBuf, 0, sizeof(g_spatializerNode.centerDelayBuf));
    g_spatializerNode.centerIdx = 0;
    for(int i = 0; i < 3; ++i) {
        memset(g_spatializerNode.rearApL[i].buf, 0, sizeof(g_spatializerNode.rearApL[i].buf));
        memset(g_spatializerNode.rearApR[i].buf, 0, sizeof(g_spatializerNode.rearApR[i].buf));
    }
    g_spatializerNode.rearLpL = g_spatializerNode.rearLpR = 0.0f;
    g_spatializerNode.notchTopL1 = g_spatializerNode.notchTopL2 = 0.0f;
    g_spatializerNode.notchTopR1 = g_spatializerNode.notchTopR2 = 0.0f;

    memset(g_widenerNode.delayL, 0, sizeof(g_widenerNode.delayL));
    memset(g_widenerNode.delayR, 0, sizeof(g_widenerNode.delayR));
    g_widenerNode.delayIdx = 0;
    g_widenerNode.lpStateL = 0.0f;
    g_widenerNode.lpStateR = 0.0f;
    g_widenerNode.sideLp = 0.0f;
    g_widenerNode.sideLp2 = 0.0f;

    g_restorationNode.x1L = 0.0f;
    g_restorationNode.x1R = 0.0f;
    g_restorationNode.prevTrebleL = 0.0f;
    g_restorationNode.prevTrebleR = 0.0f;

    g_audioLevel.store(0.0f, std::memory_order_relaxed);
}
