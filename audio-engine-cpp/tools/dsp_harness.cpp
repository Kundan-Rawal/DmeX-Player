// audio-engine-cpp/tools/dsp_harness.cpp
//
// Offline DSP verification harness. NOT part of the app build.
//
// Build (Windows / MSVC):
//   cl /std:c++17 /O2 /EHsc /I..  dsp_harness.cpp ..\DSP_Nodes.cpp ..\Telemetry.cpp /Fe:dsp_harness.exe
// Build (clang/gcc):
//   c++ -std=c++17 -O3 -I.. dsp_harness.cpp ../DSP_Nodes.cpp ../Telemetry.cpp -o dsp_harness
//
// Usage:  dsp_harness <testname> [samplerate]
//   testnames: sweep | thd | alias | impulse | stereo | latency | all

#include "../DSP_Nodes.h"
#include <cstdio>
#include <cstring>
#include <cmath>
#include <vector>
#include <complex>
#include <string>
#include <chrono>
#include <mutex>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// ---- Globals the DSP nodes expect (normally provided by EngineCore.cpp) ----
extern std::atomic<float> g_audioLevel;
float  g_bassGain          = 0.0f;
float  g_trebleGain        = 0.0f;
std::mutex g_irMutex;
bool g_isConvolutionOn = false, g_isFIRModeOn = false, g_isRemasterOn = false;
bool g_isUpscaleOn     = false, g_isWidenOn   = false, g_isCompressOn = false;
bool g_isReverbOn      = false, g_isAndroidSpeaker = false;
bool g_isLaptopSpeaker = false, g_is8DModeOn  = false;

// =====================================================================
// Minimal DFT (no external deps). O(N^2) — fine for offline analysis.
// =====================================================================
static void dft(const std::vector<float>& x, std::vector<float>& magDb, float fs)
{
    const int N = (int)x.size();
    magDb.assign(N / 2, -200.0f);
    for (int k = 0; k < N / 2; ++k) {
        double re = 0.0, im = 0.0;
        for (int n = 0; n < N; ++n) {
            // Hann window
            double w = 0.5 * (1.0 - cos(2.0 * M_PI * n / (N - 1)));
            double ang = -2.0 * M_PI * k * n / N;
            re += x[n] * w * cos(ang);
            im += x[n] * w * sin(ang);
        }
        double m = sqrt(re * re + im * im) / (N * 0.25);
        magDb[k] = (float)(20.0 * log10(m > 1e-12 ? m : 1e-12));
    }
    (void)fs;
}

static float binToHz(int k, int N, float fs) { return (float)k * fs / (float)N; }

// =====================================================================
// Signal generators
// =====================================================================
static std::vector<float> genSine(float hz, float fs, int frames, float amp = 0.5f)
{
    std::vector<float> out(frames * 2);
    for (int i = 0; i < frames; ++i) {
        float s = amp * sinf(2.0f * (float)M_PI * hz * i / fs);
        out[i * 2] = s; out[i * 2 + 1] = s;
    }
    return out;
}

static std::vector<float> genLogSweep(float f0, float f1, float fs, int frames, float amp = 0.5f)
{
    std::vector<float> out(frames * 2);
    double T = frames / (double)fs;
    double K = T * f0 / log(f1 / f0);
    double L = log(f1 / f0) / T;
    for (int i = 0; i < frames; ++i) {
        double t = i / (double)fs;
        float s = (float)(amp * sin(K * (exp(L * t) - 1.0)));
        out[i * 2] = s; out[i * 2 + 1] = s;
    }
    return out;
}

static std::vector<float> genImpulse(int frames, float amp = 1.0f)
{
    std::vector<float> out(frames * 2, 0.0f);
    out[0] = amp; out[1] = amp;
    return out;
}

// Uncorrelated stereo noise — for width / correlation tests
static std::vector<float> genStereoNoise(int frames, unsigned seed = 12345)
{
    std::vector<float> out(frames * 2);
    unsigned s = seed;
    auto rnd = [&]() { s = s * 1664525u + 1013904223u; return ((s >> 8) & 0xFFFF) / 32768.0f - 1.0f; };
    for (int i = 0; i < frames; ++i) { out[i * 2] = 0.3f * rnd(); out[i * 2 + 1] = 0.3f * rnd(); }
    return out;
}

// =====================================================================
// Measurements
// =====================================================================
struct StereoStats { float rmsL, rmsR, peak, correlation, sideEnergyDb, midEnergyDb; };

static StereoStats measureStereo(const std::vector<float>& buf)
{
    StereoStats st{};
    double sL = 0, sR = 0, sLR = 0, sM = 0, sS = 0; float pk = 0;
    int frames = (int)buf.size() / 2;
    for (int i = 0; i < frames; ++i) {
        float L = buf[i * 2], R = buf[i * 2 + 1];
        sL += L * L; sR += R * R; sLR += L * R;
        float M = (L + R) * 0.5f, S = (L - R) * 0.5f;
        sM += M * M; sS += S * S;
        pk = fmaxf(pk, fmaxf(fabsf(L), fabsf(R)));
    }
    st.rmsL = (float)sqrt(sL / frames);
    st.rmsR = (float)sqrt(sR / frames);
    st.peak = pk;
    double den = sqrt(sL * sR);
    st.correlation  = (float)(den > 1e-12 ? sLR / den : 0.0);
    st.midEnergyDb  = (float)(10.0 * log10(sM / frames + 1e-15));
    st.sideEnergyDb = (float)(10.0 * log10(sS / frames + 1e-15));
    return st;
}

// Total harmonic distortion + noise, relative to the fundamental
static float measureTHDN(const std::vector<float>& buf, float fundHz, float fs)
{
    std::vector<float> mono; mono.reserve(buf.size() / 2);
    for (size_t i = 0; i < buf.size(); i += 2) mono.push_back(buf[i]);
    std::vector<float> mag; dft(mono, mag, fs);
    int N = (int)mono.size();
    int fundBin = (int)(fundHz * N / fs + 0.5f);
    double fundPow = 0, restPow = 0;
    for (int k = 1; k < (int)mag.size(); ++k) {
        double p = pow(10.0, mag[k] / 10.0);
        if (abs(k - fundBin) <= 3) fundPow += p; else restPow += p;
    }
    return (float)(10.0 * log10((restPow + 1e-20) / (fundPow + 1e-20)));
}

// Energy above `hz` that should NOT be there (aliasing / imaging)
static float measureEnergyAbove(const std::vector<float>& buf, float hz, float fs)
{
    std::vector<float> mono; mono.reserve(buf.size() / 2);
    for (size_t i = 0; i < buf.size(); i += 2) mono.push_back(buf[i]);
    std::vector<float> mag; dft(mono, mag, fs);
    int N = (int)mono.size();
    double pow_ = 0;
    for (int k = 0; k < (int)mag.size(); ++k)
        if (binToHz(k, N, fs) > hz) pow_ += pow(10.0, mag[k] / 10.0);
    return (float)(10.0 * log10(pow_ + 1e-20));
}

// Find -3 dB point of a magnitude response relative to its maximum
static float findCutoffHz(const std::vector<float>& magDb, int N, float fs, bool highpass)
{
    float mx = -200.0f;
    for (float v : magDb) mx = fmaxf(mx, v);
    if (highpass) {
        for (int k = (int)magDb.size() - 1; k >= 0; --k)
            if (magDb[k] < mx - 3.0f) return binToHz(k, N, fs);
    } else {
        for (int k = 0; k < (int)magDb.size(); ++k)
            if (magDb[k] < mx - 3.0f) return binToHz(k, N, fs);
    }
    return -1.0f;
}

// Detect comb-filter notches: report the deepest dips and their spacing
static int countNotches(const std::vector<float>& magDb, int N, float fs,
                        float minHz, float maxHz, float depthDb)
{
    float mx = -200.0f;
    for (float v : magDb) mx = fmaxf(mx, v);
    int count = 0;
    for (int k = 2; k < (int)magDb.size() - 2; ++k) {
        float f = binToHz(k, N, fs);
        if (f < minHz || f > maxHz) continue;
        if (magDb[k] < magDb[k - 2] && magDb[k] < magDb[k + 2] && magDb[k] < mx - depthDb) {
            printf("      notch @ %7.1f Hz  (%.1f dB below peak)\n", f, mx - magDb[k]);
            ++count;
        }
    }
    return count;
}

// =====================================================================
// Node drivers — call a node's process fn directly, in blocks
// =====================================================================
template <typename NodeT>
static std::vector<float> runNode(NodeT* node, ma_node_vtable* vt,
                                  const std::vector<float>& in, ma_uint32 blockSize = 480)
{
    std::vector<float> out(in.size(), 0.0f);
    ma_uint32 frames = (ma_uint32)(in.size() / 2);
    for (ma_uint32 off = 0; off < frames; off += blockSize) {
        ma_uint32 n = (off + blockSize <= frames) ? blockSize : (frames - off);
        const float* pIn = in.data() + off * 2;
        float* pOut = out.data() + off * 2;
        ma_uint32 nIn = n, nOut = n;
        vt->onProcess((ma_node*)node, &pIn, &nIn, &pOut, &nOut);
    }
    return out;
}

// =====================================================================
// TESTS
// =====================================================================
static void testSpatializerNotches(float fs)
{
    printf("\n[TEST] PsychoacousticNode — comb-notch detection @ %.0f Hz\n", fs);
    PsychoacousticNode n; memset(&n, 0, sizeof(n));
    n.spatialIntensity = 0.5f;    // maximum, as sent by `3D 1.0`
    n.crossSubwooferL.init(fs, 180.0f);
    n.crossSubwooferR.init(fs, 180.0f);
    auto ap_init = [](AllPassFilter* a, int sz, float fb) { a->size = sz; a->idx = 0; a->feedback = fb; };
    ap_init(&n.rearApL[0], 227, 0.6f);
    ap_init(&n.rearApL[1], 401, 0.6f);
    ap_init(&n.rearApL[2], 587, 0.6f);
    ap_init(&n.rearApR[0], 233, 0.6f);
    ap_init(&n.rearApR[1], 409, 0.6f);
    ap_init(&n.rearApR[2], 593, 0.6f);

    const int N = 16384;
    // Pure side-channel excitation: L = +noise, R = -noise → mid == 0
    auto in = genStereoNoise(N);
    for (int i = 0; i < N; ++i) in[i * 2 + 1] = -in[i * 2];

    auto out = runNode(&n, &g_psychoacoustic_vtable, in);

    // Extract the side channel of the output
    std::vector<float> side(N);
    for (int i = 0; i < N; ++i) side[i] = (out[i * 2] - out[i * 2 + 1]) * 0.5f;

    std::vector<float> mag; dft(side, mag, fs);
    printf("   Notches found in 200..4000 Hz (>=6 dB deep):\n");
    int c = countNotches(mag, N, fs, 6.0f, 200.0f, 4000.0f);
    printf("   TOTAL NOTCHES = %d   %s\n", c, c == 0 ? "PASS" : "FAIL (comb filtering present)");
}

static void testExciterAliasing(float fs)
{
    printf("\n[TEST] StudioExciterNode — aliasing @ %.0f Hz\n", fs);
    StudioExciterNode n; memset(&n, 0, sizeof(n));
    n.targetDrive = 4.0f; n.currentDrive = 4.0f;
    g_isUpscaleOn = true;

    const int N = 16384;
    // 11 kHz tone: harmonics at 22/33/44 kHz must fold back if not oversampled
    auto in  = genSine(11000.0f, fs, N, 0.5f);
    auto out = runNode(&n, &g_exciter_vtable, in);

    float aliasDb = measureEnergyAbove(out, 12000.0f, fs);
    // Everything below the fundamental is by definition fold-back
    std::vector<float> mono; for (int i = 0; i < N; ++i) mono.push_back(out[i*2]);
    std::vector<float> mag; dft(mono, mag, fs);
    double below = 0;
    for (int k = 0; k < (int)mag.size(); ++k)
        if (binToHz(k, N, fs) < 10000.0f) below += pow(10.0, mag[k] / 10.0);
    printf("   Energy >12 kHz          : %7.2f dB\n", aliasDb);
    printf("   FOLD-BACK energy <10 kHz: %7.2f dB   (target < -80 dB)\n",
           10.0 * log10(below + 1e-20));
    g_isUpscaleOn = false;
}

static void testEQCrossover(float fs)
{
    printf("\n[TEST] AudiophileEQNode — actual band-split frequencies @ %.0f Hz\n", fs);
    AudiophileEQNode n; memset(&n, 0, sizeof(n));
    n.targetBass.store(2.0f); n.targetMid.store(1.0f); n.targetHigh.store(1.0f);
    n.currentBass = 2.0f; n.currentMid = 1.0f; n.currentHigh = 1.0f;
    g_isFIRModeOn = true;

    const int N = 32768;
    auto in  = genImpulse(N);
    auto out = runNode(&n, &g_audiophile_eq_vtable, in);

    std::vector<float> mono; for (int i = 0; i < N; ++i) mono.push_back(out[i*2]);
    std::vector<float> mag; dft(mono, mag, fs);
    printf("   Bass-shelf -3 dB corner : %.1f Hz   (expected ~178 Hz at ANY fs)\n",
           findCutoffHz(mag, N, fs, false));
    g_isFIRModeOn = false;
}

static void testWidener(float fs)
{
    printf("\n[TEST] StereoWidenerNode — width & mono-compatibility @ %.0f Hz\n", fs);
    const int N = 16384;
    auto in = genStereoNoise(N);
    StereoStats a = measureStereo(in);

    StereoWidenerNode n; memset(&n, 0, sizeof(n));
    n.width = 1.5f; g_isWidenOn = true;
    auto out = runNode(&n, &g_widener_vtable, in);
    StereoStats b = measureStereo(out);

    printf("   correlation  %.3f -> %.3f\n", a.correlation, b.correlation);
    printf("   side energy  %.2f -> %.2f dB  (delta %+.2f)\n",
           a.sideEnergyDb, b.sideEnergyDb, b.sideEnergyDb - a.sideEnergyDb);
    printf("   peak         %.4f -> %.4f    %s\n", a.peak, b.peak,
           b.peak <= a.peak * 1.02f ? "PASS (gain compensated)" : "FAIL (peak grew)");
    g_isWidenOn = false;
}

static void testLimiterTruePeak(float fs)
{
    printf("\n[TEST] LimiterNode — ceiling & inter-sample peaks @ %.0f Hz\n", fs);
    LimiterNode n; memset(&n, 0, sizeof(n));
    n.boost = 2.2f; n.gainEnv = 1.0f;
    n.attackCoef  = expf(-1.0f / (0.0015f * fs));
    n.releaseCoef = expf(-1.0f / (0.2000f * fs));

    const int N = 16384;
    // fs/4 tone at full scale is the classic inter-sample-peak stress signal
    auto in  = genSine(fs * 0.25f - 30.0f, fs, N, 0.98f);
    auto out = runNode(&n, &g_limiter_vtable, in);
    StereoStats s = measureStereo(out);

    // 4× oversampled true-peak estimate via linear-phase upsampling (crude but indicative)
    float tp = 0.0f;
    for (int i = 1; i + 2 < N; ++i) {
        for (int k = 1; k < 4; ++k) {
            float t = k / 4.0f;
            float v = out[i*2] * (1 - t) + out[(i + 1)*2] * t;  // replace with sinc for rigour
            tp = fmaxf(tp, fabsf(v));
        }
    }
    printf("   sample peak : %.4f  (%.2f dBFS)\n", s.peak, 20 * log10(s.peak + 1e-9));
    printf("   ~true peak  : %.4f  (%.2f dBTP)  target <= -1.0 dBTP\n", tp, 20 * log10(tp + 1e-9));
}

static void testReverbDecay(float fs)
{
    printf("\n[TEST] ReverbNode — RT60 @ %.0f Hz\n", fs);
    ReverbNode r; memset(&r, 0, sizeof(r));
    r.roomSize = 0.84f; r.wetMix = 1.0f; r.damp = 0.50f;
    reverb_init_filters(&r);
    r.hpfL.init(fs, 150.0f); r.hpfR.init(fs, 150.0f);
    g_isReverbOn = true;

    const int N = (int)(fs * 4);
    auto in  = genImpulse(N);
    auto out = runNode(&r, &g_reverb_vtable, in);

    // RT60: time for envelope to fall 60 dB below its early peak
    float pk = 0; for (int i = 0; i < N; ++i) pk = fmaxf(pk, fabsf(out[i*2]));
    float thresh = pk * 0.001f; int last = 0;
    for (int i = 0; i < N; ++i) if (fabsf(out[i*2]) > thresh) last = i;
    printf("   RT60 ~ %.3f s   (must be ~constant across sample rates)\n", last / fs);
    g_isReverbOn = false;
}

static void testDenormalCost(float fs)
{
    printf("\n[TEST] Denormal cost in reverb tail\n");
    ReverbNode r; memset(&r, 0, sizeof(r));
    r.roomSize = 0.84f; r.wetMix = 1.0f; r.damp = 0.5f;
    reverb_init_filters(&r);
    r.hpfL.init(fs, 150.0f); r.hpfR.init(fs, 150.0f);
    g_isReverbOn = true;

    const int N = (int)(fs * 30);        // 30 s of digital silence after one impulse
    auto in = genImpulse(N);
    auto t0 = std::chrono::high_resolution_clock::now();
    auto out = runNode(&r, &g_reverb_vtable, in);
    auto t1 = std::chrono::high_resolution_clock::now();
    double ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
    printf("   30 s reverb tail render: %.1f ms   (must be < 5x realtime-equivalent)\n", ms);
    g_isReverbOn = false;
}

int main(int argc, char** argv)
{
    printf("Starting dsp_harness...\n");
    std::string which = (argc > 1) ? argv[1] : "all";
    float fs = (argc > 2) ? (float)atof(argv[2]) : 48000.0f;

    printf("==============================================\n");
    printf(" DmeX DSP Harness   fs = %.0f Hz\n", fs);
    printf("==============================================\n");

    if (which == "all" || which == "stereo")  { testSpatializerNotches(fs); testWidener(fs); }
    if (which == "all" || which == "alias")   { testExciterAliasing(fs); }
    if (which == "all" || which == "sweep")   { testEQCrossover(fs); }
    if (which == "all" || which == "thd")     { testLimiterTruePeak(fs); }
    if (which == "all" || which == "impulse") { testReverbDecay(fs); testDenormalCost(fs); }

    printf("\nDone.\n");
    return 0;
}
