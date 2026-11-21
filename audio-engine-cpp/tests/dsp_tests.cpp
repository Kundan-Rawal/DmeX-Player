#include "EngineCore.h"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <iostream>
#include <limits>
#include <memory>
#include <stdexcept>
#include <vector>
#include <cstdio>
#include <cstdlib>
#include <array>
#include <future>
#include <thread>
#include "TransportFade.h"
extern "C" bool engine_init_offline(int rate);
extern "C" void engine_render_offline(float* output, ma_uint32 frames);
extern "C" void get_audio_settings(float*);
extern "C" unsigned test_stream_reads();
extern "C" void engine_test_realtime_transitions(bool);

namespace {
constexpr float sr = 48000.0f;
using Audio = std::vector<float>;
int checks = 0;

void check(bool condition, const char* name) {
    ++checks;
    if (!condition) throw std::runtime_error(name);
    std::cout << "PASS " << name << '\n';
}

Audio tone(float hz, int frames = 48000, float right = 0.0f) {
    Audio x(frames * 2);
    for (int i = 0; i < frames; ++i) {
        x[2*i] = 0.15f * std::sin(2.0f * (float)M_PI * hz * i / sr);
        x[2*i+1] = right * x[2*i];
    }
    return x;
}

Audio process(void* node, ma_node_vtable& table, const Audio& input, int block = 257) {
    Audio output(input.size());
    for (size_t offset = 0; offset < input.size() / 2;) {
        ma_uint32 countIn = (ma_uint32)(std::min)((size_t)block, input.size()/2 - offset);
        ma_uint32 countOut = countIn;
        const float* in = input.data() + 2*offset;
        float* out = output.data() + 2*offset;
        table.onProcess((ma_node*)node, &in, &countIn, &out, &countOut);
        if (countIn != countOut) throw std::runtime_error("callback frame count");
        offset += countIn;
    }
    return output;
}

float difference(const Audio& a, const Audio& b) {
    float error = 0.0f;
    for (size_t i = 0; i < a.size(); ++i) error = (std::max)(error, std::abs(a[i]-b[i]));
    return error;
}

double energy(const Audio& a, int channel, int skip = 4096) {
    double e = 0;
    for (size_t i = (size_t)skip*2+channel; i < a.size(); i += 2) e += a[i]*a[i];
    return e;
}

double differenceEnergy(const Audio& a, const Audio& b, int skip = 4096) {
    double e = 0.0;
    for (size_t i = (size_t)skip * 2; i < a.size(); ++i) {
        const double delta = a[i] - b[i];
        e += delta * delta;
    }
    return e;
}

double toneAmplitude(const Audio& a, float hz, int channel, int skip = 12000) {
    double sinPart = 0.0, cosPart = 0.0;
    const size_t frames = a.size() / 2;
    for (size_t i = (size_t)skip; i < frames; ++i) {
        const double phase = 2.0 * M_PI * hz * (double)i / sr;
        sinPart += a[2*i+channel] * std::sin(phase);
        cosPart += a[2*i+channel] * std::cos(phase);
    }
    return 2.0 * std::sqrt(sinPart*sinPart + cosPart*cosPart) / (frames - skip);
}

bool finite(const Audio& a) {
    return std::all_of(a.begin(), a.end(), [](float x) { return std::isfinite(x); });
}

void sampleRateModes() {
    constexpr const char* hrtfPath = "assets/hrtf/subject_003.sofa";
    for (const int sampleRate : {44100, 48000, 96000}) {
        SmoothedGate gate; gate.init(false,static_cast<float>(sampleRate),25);
        gate.set(true); for(int i=0;i<sampleRate/2;++i) gate.next();
        check(gate.g==1,"processing gate reaches unity without a permanent bypass leak");
        gate.set(false); for(int i=0;i<sampleRate/2;++i) gate.next();
        check(gate.fullyOff(),"processing gate returns to exact bypass");
        SteamAudioHrtf hrtf;
        check(hrtf.init(sampleRate, hrtfPath),
              "spatial renderer initializes at a supported rate");
        check(hrtf.available() && hrtf.sampleRate() == sampleRate,
              "spatial renderer retains the requested rate");
#ifdef DMEX_USE_STEAMAUDIO
        check(hrtf.measured(), "Full Windows renderer uses the measured HRTF bank");
#else
        check(hrtf.measured() && hrtf.portableMeasured(), "portable renderer uses the bundled measured HRTF bank");
#endif
    }
}

Audio subtract(const Audio& a, const Audio& b) {
    Audio result(a.size());
    for (size_t i = 0; i < a.size(); ++i) result[i] = a[i] - b[i];
    return result;
}

Audio stageDelay(const Audio& input) {
    Audio result(input.size());
    constexpr size_t samples = SteamAudioHrtf::kFrameSize * 2;
    if (input.size() > samples)
        std::copy(input.begin(), input.end()-samples, result.begin()+samples);
    return result;
}

std::unique_ptr<SubwooferNode> bass() {
    auto p = std::make_unique<SubwooferNode>();
    p->sampleRate = sr;
    p->crossBassL.init(sr, 80); p->crossBassR.init(sr, 80);
    p->crossMidBassL.init(sr, 180); p->crossMidBassR.init(sr, 180);
    p->analysis60L.init(sr, 60); p->analysis60R.init(sr, 60);
    p->analysis100L.init(sr, 100); p->analysis100R.init(sr, 100);
    p->subsonicL.init(sr, 26); p->subsonicR.init(sr, 26);
    p->speakerProtectionL.init(sr, 48); p->speakerProtectionR.init(sr, 48);
    p->virtualBassL.init(sr, 90); p->virtualBassR.init(sr, 90);
    p->drive.init(0, sr, 25); p->field.init(0, sr, 40); p->room.init(0, sr, 40);
    p->energyAttack = tauCoef(5, sr); p->energyRelease = tauCoef(90, sr);
    p->transientFastCoef = tauCoef(2, sr); p->transientSlowCoef = tauCoef(55, sr);
    return p;
}

std::unique_ptr<AudiophileEQNode> eq() {
    auto p = std::make_unique<AudiophileEQNode>();
    p->sampleRate = sr;
    p->targetBass.init(0, sr); p->targetHigh.init(0, sr); p->targetMid.init(0, sr);
    p->crossMidBassL.init(sr, 180); p->crossMidBassR.init(sr, 180);
    p->crossTrebleL.init(sr, 8000); p->crossTrebleR.init(sr, 8000);
    p->presenceL.init(sr, 2500, 0.8f, 0); p->presenceR.init(sr, 2500, 0.8f, 0);
    p->iso226.init(sr);
    return p;
}

std::unique_ptr<ReverbNode> reverb(float room = 0.84f, float damping = 0.5f) {
    auto p = std::make_unique<ReverbNode>();
    p->roomSize.init(room, sr); p->damp.init(damping, sr); p->wetMix.init(0.35f, sr);
    p->enabled.init(true, sr);
    p->hpfL.init(sr, 150); p->hpfR.init(sr, 150);
    reverb_init_filters(p.get(), sr);
    return p;
}

std::unique_ptr<LimiterNode> limiter() {
    auto p = std::make_unique<LimiterNode>();
    p->sr = sr; p->boost.init(1, sr); p->master.init(1, sr, 15);
    p->gainEnv = p->gainSmooth = 1;
    p->releaseCoef = std::exp(-1.0f/(0.150f*sr));
    p->loudnessAttackCoef = std::exp(-1.0f/(0.012f*sr));
    p->loudnessReleaseCoef = std::exp(-1.0f/(0.220f*sr));
    p->loudnessGainAttackCoef = std::exp(-1.0f/(0.010f*sr));
    p->loudnessGainReleaseCoef = std::exp(-1.0f/(0.160f*sr));
    p->loudnessSidechainCoef = 1.0f - std::exp(-2.0f*(float)M_PI*120.0f/sr);
    p->delaySamples = 96; p->osDetect.init();
    return p;
}

void oversampling() {
    Oversampler4x os; os.init();
    float sum = 0, maxValue = 0; int peakIndex = -1;
    for (int i = 0; i < 512; ++i) {
        float up[8], l, r;
        os.upsample(i == 0 ? 1.0f : 0.0f, 0, up);
        os.downsample(up, &l, &r);
        if (std::abs(l) > maxValue) { maxValue = std::abs(l); peakIndex = i; }
        sum += l;
        if (r != 0) throw std::runtime_error("oversampler cross-channel leakage");
    }
    check(peakIndex == (int)os.latencySamples(), "oversampler measured round-trip delay");
    check(std::abs(sum-1) < 0.001f, "oversampler impulse unity DC gain");
    os.reset();
    float up[8], l = 0, r = 0;
    for (int i = 0; i < 512; ++i) { os.upsample(1, -0.5f, up); os.downsample(up, &l, &r); }
    check(std::abs(l-1) < 0.001f && std::abs(r+0.5f) < 0.001f, "oversampler steady stereo gain");
    check(std::all_of(std::begin(up), std::end(up), [](float x) { return std::abs(x) < 1.001f; }),
          "oversampler no double-counted centre tap");
}

void allpassAndLoudness() {
    auto ap = std::make_unique<AllPassFilter>();
    ap_init(ap.get(), 227, 0.6f);
    double e = 0;
    for (int i = 0; i < 10000; ++i) { float y = ap_tick(ap.get(), i == 0 ? 1.0f : 0.0f); e += y*y; }
    check(std::abs(e-1) < 1e-5, "allpass preserves impulse energy");
    EqualLoudness iso; iso.init(sr); iso.volume.set(0.1f);
    float rightPeak = 0;
    for (int i = 0; i < 20000; ++i) {
        float l = std::sin(i*0.01f)*0.1f, r = 0;
        iso.process(l,r); rightPeak = (std::max)(rightPeak, std::abs(r));
    }
    check(rightPeak == 0, "adaptive loudness independent left/right filter states");
}

void toneAndBass() {
    g_bassGain = 0; g_bassField = 0; g_trebleGain = 0; g_presenceBoost = 0;
    g_subBassHz = 52;
    g_outputGain = 1; g_isAdaptiveLoudnessOn = false;
    g_isLaptopSpeaker = false; g_isAndroidSpeaker = false; g_roomBass = false;
    auto input = tone(60);
    auto neutral = bass();
    check(difference(input, process(neutral.get(), g_subwoofer_vtable, input)) < 1e-7f,
          "zero Drive/Field preserves original stereo samples");
    auto e = eq();
    check(difference(input, process(e.get(), g_audiophile_eq_vtable, input)) < 1e-6f,
          "neutral EQ does not introduce crossover phase rotation");
    std::vector<double> driveEnergyRatios;
    for (float probeDrive : {0.75f, 1.2f, 1.5f, 1.8f, 2.1f}) {
        g_bassGain = probeDrive;
        auto probe = bass();
        const auto probeOutput = process(probe.get(), g_subwoofer_vtable, input, 1);
        driveEnergyRatios.push_back(energy(probeOutput, 0) / energy(input, 0));
    }
    check(std::adjacent_find(driveEnergyRatios.begin(), driveEnergyRatios.end(),
                             [](double previous, double next) { return next <= previous; })
              == driveEnergyRatios.end(),
          "Bass Drive increases low-bass energy monotonically through 100 percent");
    g_bassGain = 2.1f;
    auto a = bass(), b = bass();
    const auto driven = process(a.get(), g_subwoofer_vtable, input, 1);
    check(energy(driven,0) > energy(input,0)*4.5, "full Drive adds substantial low-bass weight with Field at zero");
    check(energy(driven,1) == 0, "direct bass preserves a silent opposite channel");
    check(difference(driven, process(b.get(), g_subwoofer_vtable, input, 480)) < 1e-6f,
          "bass motion and gain independent of callback size");

    Audio bassLight(48000 * 2);
    for (int i = 0; i < 48000; ++i) {
        const float weakBass = 0.010f * std::sin(2.0f * (float)M_PI * 110.0f * i / sr);
        const float strongMusic = 0.150f * std::sin(2.0f * (float)M_PI * 2000.0f * i / sr);
        bassLight[2*i] = bassLight[2*i+1] = weakBass + strongMusic;
    }
    g_bassGain = 2.1f;
    auto recovery = bass();
    const auto recovered = process(recovery.get(), g_subwoofer_vtable, bassLight);
    const double recoveredBassRatio = toneAmplitude(recovered, 110, 0) / toneAmplitude(bassLight, 110, 0);
    check(recoveredBassRatio > 2.35,
          "full Bass Drive recovers underrepresented musical bass");
    check(toneAmplitude(recovered, 2000, 0) < toneAmplitude(bassLight, 2000, 0) * 1.03,
          "bass scarcity recovery leaves vocal and presence bands direct");

    std::vector<double> trackedGain;
    for (float bassHz : {50.0f, 75.0f, 95.0f, 120.0f}) {
        Audio mixed(48000 * 2);
        for (int i = 0; i < 48000; ++i) {
            const float weakBass = 0.012f * std::sin(2.0f * (float)M_PI * bassHz * i / sr);
            const float strongMusic = 0.150f * std::sin(2.0f * (float)M_PI * 2000.0f * i / sr);
            mixed[2*i] = mixed[2*i+1] = weakBass + strongMusic;
        }
        auto tracked = bass();
        const auto trackedOutput = process(tracked.get(), g_subwoofer_vtable, mixed);
        trackedGain.push_back(toneAmplitude(trackedOutput, bassHz, 0)
                              / toneAmplitude(mixed, bassHz, 0));
    }
    const auto gainRange = std::minmax_element(trackedGain.begin(), trackedGain.end());
    std::cout << "BASS FUNDAMENTAL GAINS"; for (double gain : trackedGain) std::cout << ' ' << gain; std::cout << '\n';
    check(*gainRange.first > 1.55,
          "full Bass Drive lifts fundamentals throughout 50-120 Hz");
    check(*gainRange.second / *gainRange.first < 1.55,
          "bass enhancement remains consistent across different song fundamentals");

    g_bassGain = 1.5f;
    auto anchorResponse = [](float anchor, float frequency) {
        g_subBassHz = anchor;
        const auto inputTone = tone(frequency);
        auto node = bass();
        const auto result = process(node.get(), g_subwoofer_vtable, inputTone);
        return toneAmplitude(result, frequency, 0) / toneAmplitude(inputTone, frequency, 0);
    };
    const double lowAt30 = anchorResponse(30, 35);
    const double lowAt80 = anchorResponse(80, 35);
    const double upperAt30 = anchorResponse(30, 80);
    const double upperAt80 = anchorResponse(80, 80);
    std::cout << "Sub-anchor response: 35 Hz [30=" << lowAt30 << ", 80=" << lowAt80
              << "], 80 Hz [30=" << upperAt30 << ", 80=" << upperAt80 << "]\n";
    check(lowAt30 > lowAt80 * 1.04, "30 Hz anchor adds more deep bass than 80 Hz anchor");
    check(upperAt80 > upperAt30 * 1.05, "80 Hz anchor adds more body than 30 Hz anchor");
    for (float anchor : {30.0f, 40.0f, 52.0f, 60.0f, 70.0f, 80.0f}) {
        const double response = anchorResponse(anchor, anchor);
        check(std::isfinite(response) && response > 1.0,
              "each selectable sub-bass anchor has a finite positive response");
    }
    g_subBassHz = 52;

    g_bassGain = 0;
    g_presenceBoost = 1;
    auto vocalEq = eq();
    const auto vocalInput = tone(2500);
    const auto vocalOutput = process(vocalEq.get(), g_audiophile_eq_vtable, vocalInput);
    check(toneAmplitude(vocalOutput, 2500, 0) > toneAmplitude(vocalInput, 2500, 0) * 1.8,
          "maximum vocal frontness produces a strong presence lift");
    check(energy(vocalOutput, 1) == 0, "vocal frontness keeps left and right independent");
    g_presenceBoost = 0;
    g_bassGain = 2.1f;

    Audio burst(48000 * 2);
    for (int i = 12000; i < 36000; ++i)
        burst[2*i] = 0.08f * std::sin(2.0f * (float)M_PI * 105.0f * (i - 12000) / sr);
    auto punch = bass();
    punch->drive.snap(1.2f);
    const auto punched = process(punch.get(), g_subwoofer_vtable, burst);
    auto windowEnergy = [&](int first, int last) {
        double sum = 0.0;
        for (int i = first; i < last; ++i) sum += punched[2*i] * punched[2*i];
        return sum / (last - first);
    };
    check(windowEnergy(12500, 14500) > windowEnergy(30000, 34000) * 1.08,
          "transient detector gives kick onset more gain than sustained bass");

    g_bassGain = 0; g_bassField = 1; g_roomBass = false;
    auto compact = bass(); const auto compactInput = tone(110);
    check(difference(compactInput, process(compact.get(), g_subwoofer_vtable, compactInput)) < 1e-7f,
          "Compact Bass disables delayed Bass Field reflections");
    g_roomBass = true;
    auto field = bass(); const auto spread = process(field.get(), g_subwoofer_vtable, compactInput);
    check(energy(spread,1) > 0.01, "Bass Field produces reflections with Drive at zero");
    check(field->currentFreq >= 78 && field->currentFreq <= 118, "adaptive bass anchor bounded 78-118 Hz");
    g_bassField = 0; g_roomBass = false;
    auto stereo = bass(); const auto opposite = process(stereo.get(), g_subwoofer_vtable, tone(60,48000,-1));
    float error = 0;
    for (size_t i = 0; i < opposite.size(); i += 2) error = (std::max)(error, std::abs(opposite[i]+opposite[i+1]));
    check(error < 1e-6f && energy(opposite,1)>0, "anti-phase source bass is not folded to mono");

    g_isLaptopSpeaker = true; g_bassGain = 1.5f;
    auto speaker = bass(); const auto speakerInput = tone(55);
    const auto speakerOutput = process(speaker.get(), g_subwoofer_vtable, speakerInput);
    check(toneAmplitude(speakerOutput, 55, 0) > toneAmplitude(speakerInput, 55, 0) * 0.90,
          "speaker protection retains musical 55 Hz bass");
    g_isLaptopSpeaker = false;
}

void spatialAndReverb() {
    g_isReverbOn = true; g_bassField = 0.7f;
    Audio impulse(48000*2); impulse[0] = 1;
    auto a = reverb(), b = reverb();
    const auto wet = process(a.get(), g_reverb_vtable, impulse, 1);
    check(finite(wet), "reverb impulse response finite");
    check(std::abs(wet[0] - impulse[0]) < 1e-7f, "reverb preserves the dry attack at unity");
    check(difference(wet, process(b.get(), g_reverb_vtable, impulse, 509)) < 1e-6f,
          "reverb smoothing independent of callback size");
    auto room = reverb(0.5f,0.5f), damp = reverb(0.84f,0.9f);
    check(difference(wet, process(room.get(), g_reverb_vtable, impulse)) > 0.001f, "Room Size changes audible tail");
    check(difference(wet, process(damp.get(), g_reverb_vtable, impulse)) > 0.001f, "Damping changes audible tail");
    double previousTail=0;
    for(float size : {.2f,.4f,.6f,.8f,.98f}) {
        auto node=reverb(size,.4f); node->wetMix.snap(.5f);
        const auto rendered=process(node.get(),g_reverb_vtable,impulse);
        const double tail=energy(rendered,0,12000)+energy(rendered,1,12000);
        check(tail>previousTail,"larger manual room produces more sustained late energy"); previousTail=tail;
    }
    previousTail=std::numeric_limits<double>::infinity();
    for(float damping : {0.f,.25f,.5f,.75f,.95f}) {
        auto node=reverb(.8f,damping); node->wetMix.snap(.5f);
        const auto rendered=process(node.get(),g_reverb_vtable,impulse);
        const double tail=energy(rendered,0,4000)+energy(rendered,1,4000);
        check(tail<previousTail,"higher manual damping reduces the room tail's energy"); previousTail=tail;
    }
    Audio monoImpulse(48000*2); monoImpulse[0] = monoImpulse[1] = 0.5f;
    auto monoRoom = reverb(); monoRoom->wetMix.snap(1.0f);
    const auto monoWet = process(monoRoom.get(), g_reverb_vtable, monoImpulse);
    auto moderateRoom = reverb(); moderateRoom->wetMix.snap(0.35f);
    const auto monoModerate = process(moderateRoom.get(), g_reverb_vtable, monoImpulse);
    check(differenceEnergy(monoWet, monoImpulse, 4000) > 0.01,
          "maximum reverb creates an audible room from centered material");
    check(differenceEnergy(monoWet, monoImpulse, 4000) >
          differenceEnergy(monoModerate, monoImpulse, 4000) * 4.0,
          "maximum reverb has a substantially stronger tail than moderate reverb");
    check(std::abs(monoWet[0] - monoImpulse[0]) < 1e-7f && finite(monoWet),
          "maximum reverb preserves the dry onset and finite output");
    auto dryBass = tone(70);
    auto bassRoom = reverb();
    const auto reverbedBass = process(bassRoom.get(), g_reverb_vtable, dryBass);
    check(difference(dryBass, reverbedBass) < 0.025f, "reverb keeps deep bass dry and punch-localized");
    const Audio stereo = tone(400,48000,-1);
    auto bypass = std::make_unique<DynamicSpatializerNode>(); bypass->init(sr); g_is8DModeOn = false;
    check(difference(stereo, process(bypass.get(), g_dynamic_spatializer_vtable, stereo)) == 0,
          "disabled 9D is bit-identical");

    auto zeroSeparation = std::make_unique<DynamicSpatializerNode>(); zeroSeparation->init(sr); g_is8DModeOn = true;
    check(difference(stereo, process(zeroSeparation.get(), g_dynamic_spatializer_vtable, stereo)) == 0,
          "zero Spatial Separation is audible bit-identical dry audio");

    auto spatial = std::make_unique<DynamicSpatializerNode>(); spatial->init(sr);
    spatial->setSeparation(1.0f); spatial->setDepth(1.0f);
    check(spatial->hrtfAvailable(), "Steam Audio HRTF initializes");
    auto output = process(spatial.get(), g_dynamic_spatializer_vtable, stereo);
    check(finite(output) && energy(output,0)+energy(output,1)>0.01, "9D retains finite anti-correlated stereo content");

    auto downstream = std::make_unique<PsychoacousticNode>();
    check(difference(output, process(downstream.get(), g_psychoacoustic_vtable, output)) == 0,
          "legacy psychoacoustic stage bypasses while 9D is active");

    // Lateral energy is a broadband property: a single HRTF notch can reverse
    // the level difference of an isolated sine without reversing its ITD cue.
    Audio leftOnly(48000*2);
    unsigned noiseSeed=71;
    for(size_t i=0;i<leftOnly.size();i+=2) {
        noiseSeed=noiseSeed*1664525u+1013904223u;
        leftOnly[i]=(static_cast<float>(noiseSeed>>8)/16777216.0f-.5f)*.3f;
    }
    Audio rightOnly(leftOnly.size());
    Audio opposed(leftOnly.size());
    for (size_t i = 0; i < leftOnly.size() / 2; ++i) {
        rightOnly[2*i+1] = leftOnly[2*i];
        opposed[2*i] = leftOnly[2*i];
        opposed[2*i+1] = -leftOnly[2*i];
    }
    auto leftNode = std::make_unique<DynamicSpatializerNode>(); leftNode->init(sr); leftNode->setSeparation(1); leftNode->setDepth(1);
    auto rightNode = std::make_unique<DynamicSpatializerNode>(); rightNode->init(sr); rightNode->setSeparation(1); rightNode->setDepth(1);
    auto opposedNode = std::make_unique<DynamicSpatializerNode>(); opposedNode->init(sr); opposedNode->setSeparation(1); opposedNode->setDepth(1);
    const auto leftRendered = process(leftNode.get(), g_dynamic_spatializer_vtable, leftOnly);
    const auto rightRendered = process(rightNode.get(), g_dynamic_spatializer_vtable, rightOnly);
    const auto opposedRendered = process(opposedNode.get(), g_dynamic_spatializer_vtable, opposed);
    std::cout << "STAGE SUPERPOSITION " << difference(opposedRendered, subtract(leftRendered, rightRendered)) << '\n';
    check(difference(opposedRendered,subtract(leftRendered,rightRendered))<2e-5f,
          "independent broadband source routing remains additive below the field cap");
    check(energy(leftRendered,0)>energy(leftRendered,1) && energy(rightRendered,1)>energy(rightRendered,0),
          "virtual stage preserves the side of independent left and right sources");

    auto vocalNode = std::make_unique<DynamicSpatializerNode>(); vocalNode->init(sr);
    vocalNode->setSeparation(1); vocalNode->setDepth(1);
    const Audio centeredVocal = tone(1200, 48000, 1.0f);
    const Audio vocalOutput = process(vocalNode.get(), g_dynamic_spatializer_vtable, centeredVocal);
    const double centeredEnergy=energy(centeredVocal,0,24000)+energy(centeredVocal,1,24000);
    const auto delayedVocal = stageDelay(centeredVocal);
    const double centeredChange=differenceEnergy(vocalOutput,delayedVocal,24000)/centeredEnergy;
    std::cout << "MONO SPATIAL relative delta=" << std::sqrt(centeredChange) << '\n';
    check(centeredChange < 1e-10,
          "maximum spatial stage preserves the coherent center after fixed latency");
    double sideEnergy=0,midEnergy=0;
    for(size_t i=48000;i<vocalOutput.size();i+=2) {
        const double side=(vocalOutput[i]-vocalOutput[i+1])*.5,mid=(vocalOutput[i]+vocalOutput[i+1])*.5;
        sideEnergy+=side*side;midEnergy+=mid*mid;
    }
    check(sideEnergy < midEnergy * 1e-10, "mono vocal is not decorrelated into artificial lateral ambience");
    for(float amount : {.25f,.5f,.75f,1.f}) {
        auto node=std::make_unique<DynamicSpatializerNode>(); node->init(sr); node->setSeparation(amount); node->setDepth(.8f);
        const auto rendered=process(node.get(),g_dynamic_spatializer_vtable,centeredVocal);
        const double change=differenceEnergy(rendered,delayedVocal,24000)/centeredEnergy;
        check(change<1e-10, "spatial amount preserves center anchoring throughout its travel");
    }
    auto bassNode=std::make_unique<DynamicSpatializerNode>(); bassNode->init(sr); bassNode->setSeparation(1); bassNode->setDepth(1);
    const auto centeredBass=tone(70,48000,1);
    check(differenceEnergy(process(bassNode.get(),g_dynamic_spatializer_vtable,centeredBass),stageDelay(centeredBass),24000)<1e-9,
          "spatial placement does not spread or attenuate centered sub-bass");
    auto pannedNode=std::make_unique<DynamicSpatializerNode>(); pannedNode->init(sr); pannedNode->setSeparation(1); pannedNode->setDepth(.7f);
    const auto panned=tone(1700,48000,.5f);
    const auto pannedOutput=process(pannedNode.get(),g_dynamic_spatializer_vtable,panned);
    check(differenceEnergy(pannedOutput,stageDelay(panned),24000)>.001 && energy(pannedOutput,0)>energy(pannedOutput,1),
          "coherent off-center instruments receive placement without reversing their side");

    Audio diffuse = tone(1700, 48000, 0.0f);
    for (int i = 0; i < 48000; ++i)
        diffuse[2*i+1] = 0.12f * std::sin(2.0f * (float)M_PI * 6100.0f * i / sr + 0.7f);
    auto energyNode = std::make_unique<DynamicSpatializerNode>(); energyNode->init(sr);
    energyNode->setSeparation(1); energyNode->setDepth(1);
    const Audio diffuseOutput = process(energyNode.get(), g_dynamic_spatializer_vtable, diffuse);
    auto halfNode = std::make_unique<DynamicSpatializerNode>(); halfNode->init(sr);
    halfNode->setSeparation(0.5f); halfNode->setDepth(1.0f);
    const Audio halfOutput = process(halfNode.get(), g_dynamic_spatializer_vtable, diffuse);
    const double dryEnergy = energy(diffuse, 0) + energy(diffuse, 1);
    const auto delayedDiffuse=stageDelay(diffuse);
    check(differenceEnergy(diffuseOutput, delayedDiffuse) >
          differenceEnergy(halfOutput, delayedDiffuse) * 1.5,
          "full spatial amount relocates more residual than half amount");
    check(differenceEnergy(diffuseOutput, delayedDiffuse) < dryEnergy * 1.5,
          "replacement field remains within its bounded routing budget");
    auto smallBlocks=std::make_unique<DynamicSpatializerNode>(); smallBlocks->init(sr); smallBlocks->setSeparation(1); smallBlocks->setDepth(1);
    check(difference(diffuseOutput,process(smallBlocks.get(),g_dynamic_spatializer_vtable,diffuse,17))<1e-6f,
          "spatial replacement is independent of host callback size");
    auto frontStage=std::make_unique<DynamicSpatializerNode>(); frontStage->init(sr); frontStage->setSeparation(1); frontStage->setDepth(0);
    const auto frontOutput=process(frontStage.get(),g_dynamic_spatializer_vtable,diffuse);
    check(differenceEnergy(frontOutput,diffuseOutput)>dryEnergy*.001,
          "depth changes front/rear/elevation allocation, not just stereo width");

    SteamAudioHrtf front, rear, height;
    constexpr const char* hrtfPath = "assets/hrtf/subject_003.sofa";
    check(front.init((int)sr, hrtfPath) && rear.init((int)sr, hrtfPath) && height.init((int)sr, hrtfPath),
          "independent HRTF test renderers initialize");
    float source[SteamAudioHrtf::kFrameSize]{};
    float silence[SteamAudioHrtf::kFrameSize]{};
    float frontL[SteamAudioHrtf::kFrameSize]{}, frontR[SteamAudioHrtf::kFrameSize]{};
    float rearL[SteamAudioHrtf::kFrameSize]{}, rearR[SteamAudioHrtf::kFrameSize]{};
    float heightL[SteamAudioHrtf::kFrameSize]{}, heightR[SteamAudioHrtf::kFrameSize]{};
    for (int i = 0; i < SteamAudioHrtf::kFrameSize; ++i)
        source[i] = 0.08f * std::sin(0.37f * i) + 0.04f * std::sin(1.13f * i);
    front.renderFrame(source, silence, -42, 0, 42, 0, frontL, frontR);
    rear.renderFrame(source, silence, -135, 0, 135, 0, rearL, rearR);
    height.renderFrame(source, silence, -50, 40, 50, 40, heightL, heightR);
    auto responseDifference = [](const float* aL, const float* aR, const float* bL, const float* bR) {
        float peak = 0.0f;
        for (int i = 0; i < SteamAudioHrtf::kFrameSize; ++i) {
            peak = (std::max)(peak, std::abs(aL[i] - bL[i]));
            peak = (std::max)(peak, std::abs(aR[i] - bR[i]));
        }
        return peak;
    };
    check(responseDifference(frontL, frontR, rearL, rearR) > 0.001f,
          "spatial renderer distinguishes different lateral directions");
    check(responseDifference(frontL, frontR, heightL, heightR) > 0.001f,
          "spatial renderer distinguishes these test directions");
}

void measuredMobileAndAutomaticRoom() {
    g_ecoMode = true;
    auto front = std::make_unique<SteamAudioHrtf>();
    auto rear = std::make_unique<SteamAudioHrtf>();
    auto elevated = std::make_unique<SteamAudioHrtf>();
    check(front->init(48000) && rear->init(48000) && elevated->init(48000) && front->portableMeasured(),
          "mobile Eco renderer prepares measured filters without the Windows SDK");
    Audio a(1024), b(1024), c(1024);
    float input[64]{}; input[0] = 1;
    for (int block = 0; block < 8; ++block) {
        float al[64]{}, ar[64]{}, bl[64]{}, br[64]{}, cl[64]{}, cr[64]{};
        front->renderSource(0, input, -45, 0, 1, al, ar);
        rear->renderSource(0, input, -135, 0, 1, bl, br);
        elevated->renderSource(0, input, -45, 45, 1, cl, cr);
        for (int i = 0; i < 64; ++i) {
            const int pos = (block*64+i)*2;
            a[pos]=al[i]; a[pos+1]=ar[i]; b[pos]=bl[i]; b[pos+1]=br[i]; c[pos]=cl[i]; c[pos+1]=cr[i];
        }
        input[0] = 0;
    }
    check(difference(a,b)>0.01f, "mobile front and rear differ even at equal lateral angle");
    check(difference(a,c)>0.01f, "mobile elevation changes measured spectral cues");
    check(energy(a,0,0)>energy(a,1,0)*1.1, "mobile left source remains stronger at the left ear");
    const double calibratedEnergy=(energy(a,0,0)+energy(a,1,0))*.5;
    check(calibratedEnergy>.90 && calibratedEnergy<1.10,
          "portable mono-source calibration preserves total two-ear impulse energy");
    front->reset(); float zero[64]{}, outL[64]{}, outR[64]{};
    front->renderSource(0, zero, -45, 0, 1, outL, outR);
    check(std::all_of(std::begin(outL),std::end(outL),[](float x){return x==0;}), "mobile filter reset removes previous-track tails");
    g_ecoMode = false;

    g_isReverbOn = true;
    Audio impulse(48000*2); impulse[12000*2] = 0.3f;
    auto small = reverb(0.2f,0.0f), large = reverb(0.98f,0.95f);
    for (auto* room : {small.get(),large.get()}) {
        room->automatic = true; room->automaticBlend.init(true,sr); room->wetMix.snap(0.7f);
    }
    auto autoA=process(small.get(),g_reverb_vtable,impulse,137);
    auto autoB=process(large.get(),g_reverb_vtable,impulse,256);
    check(difference(autoA,autoB)<1e-6f, "automatic reverb derives the room independently of saved manual controls");
    check(finite(autoA) && autoA[24000]==impulse[24000], "automatic room preserves the dry attack and stays finite");
    auto subtle = reverb(), strong = reverb();
    for (auto* room : {subtle.get(),strong.get()}) { room->automatic=true; room->automaticBlend.init(true,sr); }
    subtle->wetMix.snap(0.2f); strong->wetMix.snap(0.8f);
    const auto subtleOut=process(subtle.get(),g_reverb_vtable,impulse);
    const auto strongOut=process(strong.get(),g_reverb_vtable,impulse);
    check(differenceEnergy(strongOut,impulse)>differenceEnergy(subtleOut,impulse)*3,
          "single automatic reverb amount controls an audible bounded room tail");
}

void airAndLimiter() {
    auto input = tone(9000);
    auto air = std::make_unique<AudioRestorationNode>(); air->init(sr); g_isUpscaleOn = false;
    auto output = process(air.get(), g_restoration_vtable, input);
    float error = 0;
    for (size_t i = 40; i < input.size(); ++i) error = (std::max)(error, std::abs(output[i]-input[i-40]));
    check(error == 0, "Harmonic Air bypass has constant compensated delay");
    g_isUpscaleOn = true; g_upscaleTarget = 2;
    auto airA = std::make_unique<AudioRestorationNode>(), airB = std::make_unique<AudioRestorationNode>();
    airA->init(sr); airB->init(sr);
    auto active = process(airA.get(), g_restoration_vtable, input, 1);
    const auto delayedDry=output;
    check(toneAmplitude(active,9000,0)>toneAmplitude(delayedDry,9000,0)*1.6,
          "maximum Air supplies measurable high-frequency lift, not only inaudible ultrasonic harmonics");
    check(finite(active) && energy(active,1) == 0, "Harmonic Air channel isolation and finite output");
    check(difference(active, process(airB.get(), g_restoration_vtable, input, 512)) < 1e-6f,
          "Harmonic Air independent of callback size");
    auto exciter = std::make_unique<StudioExciterNode>(); exciter->init(sr);
    output = process(exciter.get(), g_exciter_vtable, input);
    error = 0;
    for (size_t i = 40; i < input.size(); ++i) error = (std::max)(error, std::abs(output[i]-input[i-40]));
    check(error == 0, "zero-drive exciter preserves delayed dry signal");
    const auto quiet = tone(1000);
    g_outputGain = 1;
    auto unityLimiter = limiter();
    const auto unityOutput = process(unityLimiter.get(), g_limiter_vtable, quiet);
    g_outputGain = 2;
    auto maxLimiter = limiter();
    const auto maxOutput = process(maxLimiter.get(), g_limiter_vtable, quiet);
    check(energy(maxOutput,0) > energy(unityOutput,0) * 4.0,
          "Max loudness substantially raises quiet program energy");
    check(std::all_of(maxOutput.begin(), maxOutput.end(), [](float x) { return std::abs(x) <= 0.891252f; }),
          "Max loudness remains below the true-peak ceiling");
    g_outputGain = 2;
    auto loud = tone(71,48000,0.7f);
    for (size_t i = 0; i < loud.size(); ++i) loud[i] *= (i > 10000 && i < 20000) ? 100 : 4;
    loud[40] = std::numeric_limits<float>::quiet_NaN();
    loud[60] = std::numeric_limits<float>::infinity();
    auto limitA = limiter(), limitB = limiter();
    output = process(limitA.get(), g_limiter_vtable, loud, 1);
    check(finite(output), "limiter rejects nonfinite input");
    check(std::all_of(output.begin(), output.end(), [](float x) { return std::abs(x) <= 0.891252f; }),
          "limiter holds sample ceiling with master gain before detection");
    check(difference(output, process(limitB.get(), g_limiter_vtable, loud, 511)) < 1e-6f,
          "limiter independent of callback size");
    g_outputGain = 0;
    auto zero = process(limitA.get(), g_limiter_vtable, Audio(96000));
    check(energy(zero,0,10000) == 0, "zero master gain settles to silence");
}

void convolution() {
    g_isConvolutionOn = true;
    std::vector<float> ir(1300); ir[0]=1; ir[700]=0.25f; ir[1299]=-0.1f;
    FFTConvolver l, r; check(l.prepare(ir.data(),(int)ir.size(),512) && r.prepare(ir.data(),(int)ir.size(),512), "prepare multi-partition IR");
    auto c = std::make_unique<ConvolutionNode>();
    c->convL = &l; c->convR = &r; c->blockAdapterL.init(512,2); c->wetMix.init(1,sr);
    Audio impulse(4096*2); impulse[0] = 1; impulse[1] = -0.5f;
    const auto response = process(c.get(), g_convolution_vtable, impulse, 137);
    Audio expected(response.size());
    for (size_t i=0; i<ir.size(); ++i) { expected[2*(i+512)] = ir[i]; expected[2*(i+512)+1] = -0.5f*ir[i]; }
    check(difference(response,expected) < 1e-5f, "partitioned convolution matches IR with exactly 512-sample latency");
    g_isConvolutionOn = false; c->wetMix.init(0,sr); c->blockAdapterL.reset();
    auto bypass = process(c.get(), g_convolution_vtable, impulse, 137);
    Audio dry(impulse.size()); dry[1024] = 1; dry[1025] = -0.5f;
    check(difference(bypass,dry) == 0, "room IR bypass preserves the declared 512-frame delay");
    auto headphone=std::make_unique<HeadphoneCompNode>(); headphone->init(sr);
    check(difference(process(headphone.get(),g_headphone_comp_vtable,impulse,137),dry)==0,
          "unloaded headphone correction preserves the same 512-frame delay");
    g_ecoMode = true;
    auto air=std::make_unique<AudioRestorationNode>(); air->init(sr); g_upscaleTarget=0;
    auto exciter=std::make_unique<StudioExciterNode>(); exciter->init(sr);
    Audio delayed(impulse.size()); delayed[40]=1; delayed[41]=-0.5f;
    check(difference(process(air.get(),g_restoration_vtable,impulse),delayed)==0 &&
          difference(process(exciter.get(),g_exciter_vtable,impulse),delayed)==0,
          "Eco zero-amount effects skip FFT shaping without changing dry latency");
    g_ecoMode = false;
}

void adapterAndRawRouting() {
    BlockAdapter adapter; adapter.init(512, 2);
    Audio impulse(1024); impulse[0] = 1;
    Audio output(1024);
    auto identity = [](const float* input, float* out) { std::copy(input, input+1024, out); };
    adapter.process(impulse.data(), output.data(), 512, identity);
    adapter.reset();
    std::fill(impulse.begin(), impulse.end(), 0.0f);
    adapter.process(impulse.data(), output.data(), 512, identity);
    check(energy(output,0) == 0, "adapter reset cannot replay old queued audio");
    check(engine_init_offline(48000), "production graph prepares without opening an output device");
    float settings[20]{2.1f,12,1,2.5f,1,1,1,1,0.1f,30,1,1,1,1,0.98f,0.95f,1,1,1,0};
    check(apply_audio_settings(settings,20)==0, "one coherent advanced settings snapshot accepted");
    audio_apply_pending_parameters();
    check(g_bassGain.load()==settings[0] && g_widenerNode.width.target.load()==settings[3] &&
          g_8DNode.separationTarget()==settings[4] && g_reverbNode.wetMix.target.load()==settings[6] &&
          g_roomBass.load() && g_bassField.load()==settings[10] && g_upscaleTarget.load()==settings[16] && g_is8DModeOn.load(),
          "production control snapshot reaches bass, width, stage, room and harmonic DSP targets");
    check(execute_audio_command("AUTO_REVERB 1")==0 && g_reverbNode.automatic.load(), "automatic room command reaches the native renderer");
    check(execute_audio_command("AUTO_REVERB 2")!=0, "automatic room rejects invalid modes");
    check(execute_audio_command("BASS nan") != 0 && execute_audio_command("COMPRESS invalid") != 0,
          "invalid numeric controls cannot escape the native boundary");
    settings[9] = 53;
    check(apply_audio_settings(settings,20)!=0, "unsupported bass anchor rejected atomically");
    check(execute_audio_command("BYPASS_ALL 1")==0, "Bypass All switches the production graph");
    Audio raw(8192*2);
    for (int i=0;i<8192;++i) { raw[2*i]=1.1f*std::sin(i*0.03f); raw[2*i+1]=0.2f*std::cos(i*0.07f); }
    ma_encoder encoder;
    auto config = ma_encoder_config_init(ma_encoding_format_wav,ma_format_f32,2,44100);
    check(ma_encoder_init_file("raw-fixture.wav",&config,&encoder)==MA_SUCCESS, "raw stereo fixture prepared");
    ma_encoder_write_pcm_frames(&encoder,raw.data(),8192,nullptr);
    ma_encoder_uninit(&encoder);
    check(execute_audio_command("HEADPHONE_CORRECTION raw-fixture.wav")==0,
          "correction IR loads through the same validated file path");
    const auto readsBeforeLoad = test_stream_reads();
    check(execute_audio_command("LOAD raw-fixture.wav")==0 && execute_audio_command("PLAY")==0,
          "production transport loads and plays stereo in raw mode");
    check(test_stream_reads() > readsBeforeLoad,
          "resource-manager pages are filled by the custom streaming decoder");
    Audio rendered(raw.size());
    for (size_t frame = 0; frame < 8192; frame += 256)
        engine_render_offline(rendered.data() + frame * 2, 256);
    check(difference(raw,rendered)<1e-6f, "Bypass All preserves stereo PCM at unity even with every effect configured");
    check(g_audioLevel.load() > 0 && g_bLvl.load() > 0 && g_mLvl.load() > 0 && g_tLvl.load() > 0,
          "raw production callback publishes live visualizer levels in every band");
    check(g_bPan.load() < -0.1f && std::isfinite(g_mPhase.load()) && std::isfinite(g_tPhase.load()),
          "raw visualizer publishes stereo position and finite phase");
    check(engine_get_sample_rate()==44100 && g_headphoneCompNode.convL.load()!=nullptr,
          "raw track retains its original rate and reloads correction for later use");
    float retained[20]; get_audio_settings(retained);
    check(retained[0]==2.1f && retained[8]==0.1f && retained[9]==30,
          "raw bypass retains enhancement and volume settings for restoration");
    check(ma_encoder_init_file("unknown-length.wav",&config,&encoder)==MA_SUCCESS, "unknown-length stream fixture prepared");
    ma_encoder_write_pcm_frames(&encoder,raw.data(),8192,nullptr); ma_encoder_uninit(&encoder);
    check(execute_audio_command("LOAD unknown-length.wav")==0 && execute_audio_command("PLAY")==0,
          "unknown-length sources initialize through the resource manager");
    for (size_t frame = 0; frame < 8192; frame += 256)
        engine_render_offline(rendered.data() + frame * 2, 256);
    check(difference(raw,rendered)<1e-6f, "unknown-length streams retain complete stereo PCM");
    check(execute_audio_command("BYPASS_ALL 0")==0 && engine_get_sample_rate()==48000,
          "leaving raw mode restores the selected enhanced output rate");
    check(g_headphoneCompNode.convL.load()!=nullptr,
          "correction bank survives raw-mode sample-rate rebuilds");
    check(g_bLvl.load() == 0 && g_mLvl.load() == 0 && g_tLvl.load() == 0,
          "routing changes clear stale visualizer levels");
    check(execute_audio_command("HEADPHONE_CORRECTION OFF")==0,
          "correction can be disabled independently");
    check(execute_audio_command("QUALITY ECO")==0 && g_8DNode.upmixer.hrtfMeasured() && g_8DNode.upmixer.hrtfPortable(),
          "Eco retains measured directional filters with the compact portable renderer");
    check(execute_audio_command("QUALITY FULL")==0,
          "Full quality can be restored without changing controls");
    execute_audio_command("STOP");
    uninit_audio_engine();
    std::remove("raw-fixture.wav");
    std::remove("unknown-length.wav");
}
}

void productionControlSweep() {
    g_ecoMode = true;
    check(engine_init_offline(48000), "mobile-equivalent production graph prepares for control sweep");
    execute_audio_command("BYPASS_ALL 0");
    execute_audio_command("HEADPHONE_CORRECTION OFF");
    execute_audio_command("CONVOLUTION 0");
    execute_audio_command("AUTO_REVERB 0");
    Audio input(48000*2);
    unsigned random = 12345;
    for (int i=0;i<48000;++i) {
        random = random*1664525u+1013904223u;
        const float noise = (static_cast<float>(random>>8)/16777216.0f-.5f)*.12f;
        const float bass = .16f*std::sin(2*M_PI*80*i/48000);
        const float vocal = .20f*std::sin(2*M_PI*2500*i/48000);
        input[2*i] = bass+vocal+noise+.14f*std::sin(2*M_PI*1300*i/48000);
        input[2*i+1] = bass+vocal-noise+.14f*std::sin(2*M_PI*5900*i/48000);
    }
    ma_encoder encoder;
    auto config=ma_encoder_config_init(ma_encoding_format_wav,ma_format_f32,2,48000);
    check(ma_encoder_init_file("controls-fixture.wav",&config,&encoder)==MA_SUCCESS, "control sweep stereo fixture prepared");
    ma_encoder_write_pcm_frames(&encoder,input.data(),48000,nullptr); ma_encoder_uninit(&encoder);
    const std::array<float,20> neutral{0,0,0,1,0,0,0,0,.2f,52,0,0,0,0,.84f,.5f,0,0,0,0};
    auto render = [&](const std::array<float,20>& values) {
        if (apply_audio_settings(values.data(),20)!=0 || execute_audio_command("LOAD controls-fixture.wav")!=0 || execute_audio_command("PLAY")!=0)
            throw std::runtime_error("production control sweep load failed");
        Audio result(48000*2);
        for(int frame=0;frame<48000;frame+=256) engine_render_offline(result.data()+frame*2,(std::min)(256,48000-frame));
        check(finite(result) && std::all_of(result.begin(), result.end(), [](float value) { return std::abs(value) < .9f; }),
              "control sweep retains finite output below the safety ceiling");
        return result;
    };
    const auto base=render(neutral);
    std::cout << "NEUTRAL TRANSFER " << toneAmplitude(base,2500,0)/(.2*toneAmplitude(input,2500,0)) << '\n';
    std::FILE* response = std::fopen("control-response.csv", "w");
    if (!response) throw std::runtime_error("Cannot write response measurements");
    std::fprintf(response,"control,amount,relative_rms_delta\n");
    for (const auto& control : std::array<std::pair<const char*,int>,10>{{{"bass",0},{"treble",1},{"exciter",2},{"width",3},{"separation",4},{"depth",5},{"reverb",6},{"bass_field",10},{"vocal",12},{"air",16}}}) {
        auto referenceValues=neutral;
        if (control.second==4 || control.second==5) { referenceValues[17]=1; referenceValues[4]=control.second==5?.85f:0; referenceValues[5]=control.second==4?.7f:0; }
        if (control.second==10) referenceValues[11]=1;
        const auto unalignedReference=render(referenceValues);
        const auto reference=control.second==4 ? stageDelay(unalignedReference) : unalignedReference;
        const double referenceEnergy=energy(reference,0,24000)+energy(reference,1,24000);
        double previous=0;
        for (float amount : {.25f,.5f,.75f,1.f}) {
            auto values=referenceValues;
            values[control.second]=control.second==0 ? 2.1f*amount : control.second==1 ? 12*amount : control.second==3 ? 1+1.5f*amount : amount;
            const auto output=render(values);
            const double relative=std::sqrt(differenceEnergy(reference,output,24000)/(referenceEnergy+1e-20));
            std::fprintf(response,"%s,%.2f,%.6f\n",control.first,amount,relative);
            std::cout << "RESPONSE " << control.first << " " << amount << " relative delta=" << relative << '\n';
            check(relative > .0001, "control has a measurable first-quarter production response");
            check(relative > previous, "production control response increases monotonically across its travel");
            previous=relative;
        }
    }
    std::fclose(response);
    auto fullLevel=neutral; fullLevel[8]=1;
    const auto fullBase=render(fullLevel);
    for(const auto& control : std::array<std::pair<int,float>,4>{{{0,2.1f},{1,12.f},{12,1.f},{16,1.f}}}) {
        auto values=fullLevel; values[control.first]=control.second;
        const auto shaped=render(values);
        const float band=control.first==0?80.f:control.first==12?2500.f:5900.f;
        const float referenceBand=control.first==0?2500.f:80.f;
        const double before=toneAmplitude(fullBase,band,0)/(toneAmplitude(fullBase,referenceBand,0)+1e-12);
        const double after=toneAmplitude(shaped,band,0)/(toneAmplitude(shaped,referenceBand,0)+1e-12);
        std::cout << "LIMITED BAND RATIO " << control.first << "=" << after/before << '\n';
        check(after>before*1.2,"tone shaping survives the downstream peak limiter at full master volume");
    }
    struct Case { const char* name; std::initializer_list<std::pair<int,float>> changes; };
    for(const auto& test : {
        Case{"Bass Drive",{{0,1.5f}}}, Case{"Treble",{{1,6.0f}}}, Case{"Tube Exciter",{{2,.7f}}},
        Case{"Stereo Widener",{{3,2.0f}}}, Case{"9D Stage",{{17,1.0f},{4,.8f},{5,.7f}}},
        Case{"Reverb",{{6,.5f}}}, Case{"Compressor",{{7,1.0f}}}, Case{"Bass Field",{{10,.8f},{11,1.0f}}},
        Case{"Vocal Frontness",{{12,.8f}}}, Case{"Adaptive Loudness",{{13,1.0f}}},
        Case{"Harmonic Air",{{16,.7f}}}, Case{"Speaker Boost",{{18,.6f}}}, Case{"Phone Speaker Protection",{{19,2.0f}}}
    }) {
        auto values=neutral; for(const auto& [index,value]:test.changes) values[index]=value;
        const auto output=render(values);
        const double delta=std::sqrt(differenceEnergy(base,output,24000)/48000);
        std::cout << "CONTROL " << test.name << " output delta RMS=" << delta << '\n';
        check(delta>0.00001, test.name);
    }
    auto room=neutral; room[6]=.6f;
    const auto roomBase=render(room); room[14]=.4f; room[15]=.85f;
    check(differenceEnergy(roomBase,render(room),24000)>.0001, "manual room size and damping affect production output");
    auto stage=neutral; stage[17]=1; stage[4]=.8f; stage[5]=.1f;
    const auto near=render(stage); stage[5]=.9f;
    check(differenceEnergy(near,render(stage),24000)>.0001, "depth slider affects the production measured stage");
    // Base recipes mirror soundPresets.ts; volume is lowered only in this offline harness.
    Audio lastPreset;
    for (const auto& preset : {
        Case{"HD Clear neutral recipe",{}},
        Case{"Immersive recipe",{{4,.32f},{5,.22f},{6,.025f},{14,.55f},{15,.72f},{17,1.f}}},
        Case{"Chill recipe",{{4,.40f},{5,.38f},{6,.06f},{14,.65f},{15,.78f},{17,1.f}}}
    }) {
        auto values=neutral; for(const auto& [index,value]:preset.changes) values[index]=value;
        const auto output=render(values);
        const double changed=differenceEnergy(values[17]>0 ? stageDelay(base) : base,output,24000);
        std::cout<<"RECIPE DELTA "<<preset.name<<"="<<changed<<'\n';
        check(values[17]>0 ? changed>.0001 : changed/(energy(base,0,24000)+energy(base,1,24000))<1e-8, preset.name);
        check(values[0]==0 && values[3]==1 && values[1]==0 && values[16]==0 && values[2]==0 && values[12]==0 && values[10]==0 && values[11]==0,
              "automatic recipes preserve tonal balance and focused bass");
        const double presenceDb=20*std::log10((toneAmplitude(output,2500,0)+1e-12)/(toneAmplitude(base,2500,0)+1e-12));
        const double trebleDb=20*std::log10((toneAmplitude(output,5900,1)+1e-12)/(toneAmplitude(base,5900,1)+1e-12));
        std::cout << "PRESET PRESENCE " << preset.name << "=" << presenceDb << " dB\n";
        std::cout << "PRESET TREBLE " << preset.name << "=" << trebleDb << " dB\n";
        check(presenceDb>-2 && presenceDb<3,"natural recipe keeps the reference presence band within -2/+3 dB");
        check(trebleDb<4,"natural recipe keeps the reference treble gain below 4 dB");
        if (!lastPreset.empty()) check(differenceEnergy(lastPreset,output,24000)>.0001, "quick recipes produce distinct processed PCM");
        lastPreset=output;
        auto fullMaster=values; fullMaster[8]=1;
        render(fullMaster);
        check(g_limiterNode.hardClippedSamples.load()==0,"preset does not hit the final hard-clipping guard at full master");
    }
    const auto source=g_sourceGeneration.load();
    const auto adaptive="ADAPTIVE_EQ "+std::to_string(source)+" 1 -1.5 0 -1 0";
    check(execute_audio_command(adaptive.c_str())==0,"bounded adaptive correction is accepted");
    check(execute_audio_command(("ADAPTIVE_EQ "+std::to_string(source)+" 1 1 0 0 0").c_str())!=0,"automatic tone cannot boost or add coloration");
    check(execute_audio_command(("ADAPTIVE_EQ "+std::to_string(source)+" 1 -4 0 0 0").c_str())!=0,"adaptive cuts are bounded in the native engine");
    check(execute_audio_command(("ADAPTIVE_EQ "+std::to_string(source)+" 1 -1 -1 -1 -1").c_str())!=0,"combined adaptive correction cannot exceed its native budget");
    check(execute_audio_command(("ADAPTIVE_EQ "+std::to_string(source+1)+" 1 -1 0 0 0").c_str())!=0,"stale source correction is rejected natively");
    check(execute_audio_command("LOAD controls-fixture.wav")==0,"source change with adaptive EQ succeeds");
    float actual[5];get_adaptive_audio_settings(actual);
    check(actual[0]==0 && g_audiophileEQNode.adaptiveDb[0].current==0,"new source cannot inherit an old song's correction");
    check(execute_audio_command(adaptive.c_str())!=0,"previous source token remains invalid after replacement");
    execute_audio_command("BYPASS_ALL 1");
    check(execute_audio_command(("ADAPTIVE_EQ "+std::to_string(g_sourceGeneration.load())+" 1 -1 0 0 0").c_str())!=0,"Raw Stereo cannot enable adaptive processing");
    execute_audio_command("BYPASS_ALL 0");
    execute_audio_command("STOP"); uninit_audio_engine(); std::remove("controls-fixture.wav"); g_ecoMode=false;
}

void adaptiveTone() {
    g_bassGain=0;g_trebleGain=0;g_presenceBoost=0;g_isAdaptiveLoudnessOn=false;
    auto a=eq(),b=eq();
    for(auto* node:{a.get(),b.get()}) for(int band=0;band<4;++band) node->adaptiveDb[band].init(0,sr,750);
    a->adaptiveDb[2].set(-1.5f);b->adaptiveDb[2].set(-1.5f);
    const auto input=tone(3200,48000*4,.7f);
    const auto out=process(a.get(),g_audiophile_eq_vtable,input,257);
    check(difference(out,process(b.get(),g_audiophile_eq_vtable,input,1))<1e-6,"adaptive correction is independent of callback partitioning");
    const double gain=20*std::log10(toneAmplitude(out,3200,0,48000*3)/toneAmplitude(input,3200,0,48000*3));
    check(gain < -1.4 && gain > -1.6,"adaptive presence correction is a bounded cut, not a vocal enhancer");
    check(std::abs(toneAmplitude(out,3200,1)/toneAmplitude(out,3200,0)-.7)<1e-5,"linked corrective EQ preserves channel balance");
    check(finite(out),"adaptive correction remains finite");
}

void transportAndNaturalism() {
    check(std::abs(vocalPresenceDb(.5f)-1.125f)<1e-6f && std::abs(harmonicAirDb(.2f)-.24f)<1e-6f,
          "preset-range gain curves are gentle while controls keep their percentages");
    check(vocalPresenceDb(1)==9 && harmonicAirDb(1)==6,"full manual gain endpoints remain available");
    auto harmonicRatio=[](const Audio& data,float frequency) {
        const double fundamental=toneAmplitude(data,frequency,0);
        double harmonics=0;for(int n=2;n*frequency<sr*.5f;++n){const double a=toneAmplitude(data,n*frequency,0);harmonics+=a*a;}
        return std::sqrt(harmonics)/(fundamental+1e-20);
    };
    auto exciter=std::make_unique<StudioExciterNode>(); exciter->init(sr);exciter->drive.snap(.3f);
    Audio exciterInput=tone(3500);for(float& sample:exciterInput)sample*=2;
    const auto excited=process(exciter.get(),g_exciter_vtable,exciterInput);
    const auto exciterThd=harmonicRatio(excited,3500);
    std::cout<<"NATURAL EXCITER THD="<<exciterThd*100<<" percent\n";
    check(exciterThd<.005,"30 percent exciter keeps the reference tone's harmonic distortion below 0.5 percent");
    auto air=std::make_unique<AudioRestorationNode>();air->init(sr);g_isUpscaleOn=true;g_upscaleTarget=.25f;
    const auto airy=process(air.get(),g_restoration_vtable,tone(9000));
    const auto airThd=harmonicRatio(airy,9000);
    std::cout<<"NATURAL AIR THD="<<airThd*100<<" percent\n";
    check(airThd<.005,"25 percent Air keeps the reference tone's harmonic distortion below 0.5 percent");
    for(int rate:{22050,44100,48000,96000}) {
        TransportFade fade;fade.init(static_cast<float>(rate));
        Audio constant(rate/10*2,.6f),unity=constant;fade.process(unity.data(),static_cast<unsigned>(unity.size()/2),false);
        check(difference(unity,constant)==0,"steady transport fade is bit-identical");
        auto outgoing=constant;fade.process(outgoing.data(),static_cast<unsigned>(outgoing.size()/2),true);
        check(fade.silent() && outgoing.back()==0,"transport fade-out reaches exact silence");
        fade.restart();Audio priming(rate/20*2);fade.process(priming.data(),static_cast<unsigned>(priming.size()/2),false);
        check(fade.silent(),"silent buffer priming cannot exhaust the incoming fade");
        Audio incoming(rate/10*2,-.6f);fade.process(incoming.data(),static_cast<unsigned>(incoming.size()/2),false);
        check(incoming.front()==0 && std::abs(incoming.back()+.6f)<1e-7f,"incoming audio starts at zero and reaches unity");
        double jump=0;for(size_t i=2;i<incoming.size();i+=2)jump=(std::max)(jump,static_cast<double>(std::abs(incoming[i]-incoming[i-2])));
        check(jump<.005,"transport ramp has no abrupt sample step at supported rates");
        TransportFade partitioned;partitioned.init(static_cast<float>(rate));partitioned.restart();
        Audio segmented(rate/10*2,-.6f);
        for(size_t frame=0;frame<segmented.size()/2;frame+=17)
            partitioned.process(segmented.data()+frame*2,static_cast<unsigned>((std::min)(size_t(17),segmented.size()/2-frame)),false);
        check(difference(segmented,incoming)==0,"transport fade is independent of callback partitioning");
    }
    g_ecoMode=true;check(engine_init_offline(48000),"seek regression prepares an offline engine");
    const std::array<float,20> neutral{0,0,0,1,0,0,0,0,1,52,0,0,0,0,.72f,.6f,0,0,0,0};
    auto cfg=ma_encoder_config_init(ma_encoding_format_wav,ma_format_f32,2,48000);
    Audio fixture(48000*4*2);for(size_t i=0;i<fixture.size();++i)fixture[i]=i<48000*3?.6f:-.6f;
    ma_encoder encoder;check(ma_encoder_init_file("transport-fixture.wav",&cfg,&encoder)==MA_SUCCESS,"seek fixture prepared");
    ma_encoder_write_pcm_frames(&encoder,fixture.data(),fixture.size()/2,nullptr);ma_encoder_uninit(&encoder);
    check(apply_audio_settings(neutral.data(),20)==0,"neutral seek settings accepted");
    execute_audio_command("HEADPHONE_CORRECTION OFF");execute_audio_command("CONVOLUTION 0");
    engine_test_realtime_transitions(true);
    for(bool raw:{true,false}) {
        execute_audio_command(raw?"BYPASS_ALL 1":"BYPASS_ALL 0");
        check(execute_audio_command("LOAD transport-fixture.wav")==0 && execute_audio_command("PLAY")==0,"seek fixture begins playing");
        Audio warm(24000*2);engine_render_offline(warm.data(),24000);
        auto exercise=[&](bool load) {
            auto command=std::async(std::launch::async,[load] {
                if(!load)return execute_audio_command("SEEK 2");
                const int result=execute_audio_command("LOAD transport-fixture.wav");
                return result?result:execute_audio_command("PLAY");
            });
            Audio captured;captured.reserve(48000);captured.push_back(warm[warm.size()-2]);captured.push_back(warm.back());
            for(int block=0;block<500 && command.wait_for(std::chrono::milliseconds(0))!=std::future_status::ready;++block) {
                float frames[128];engine_render_offline(frames,64);captured.insert(captured.end(),frames,frames+128);
                std::this_thread::sleep_for(std::chrono::microseconds(200));
            }
            check(command.get()==0,"native source transition completes without deadlock");
            Audio tail(8192*2);engine_render_offline(tail.data(),8192);captured.insert(captured.end(),tail.begin(),tail.end());
            double jump=0;size_t jumpAt=0;for(size_t i=2;i<captured.size();i+=2)for(int ch=0;ch<2;++ch) {
                const double delta=std::abs(captured[i+ch]-captured[i+ch-2]);
                if(delta>jump){jump=delta;jumpAt=i+ch;}
            }
            std::cout<<"TRANSPORT "<<(raw?"raw":"enhanced")<<(load?" load":" seek")<<" max step="<<jump<<'\n';
            if(jump>=.01)std::cout<<"TRANSITION discontinuity frame="<<jumpAt/2<<" previous="<<captured[jumpAt-2]<<" next="<<captured[jumpAt]<<'\n';
            check(jump<.01,"source seek/replacement has no hard discontinuity through graph resets");
            warm=std::move(tail);
        };
        exercise(false);exercise(true);
        execute_audio_command("PAUSE");
        check(execute_audio_command("SEEK 2")==0 && !ma_sound_is_playing(&g_sound),"seeking while paused cannot start playback");
    }
    engine_test_realtime_transitions(false);execute_audio_command("STOP");uninit_audio_engine();
    std::remove("transport-fixture.wav");g_ecoMode=false;
}

void referenceRecording() {
    const char* path=std::getenv("DMEX_DSP_REFERENCE"); if(!path) return;
    ma_decoder decoder;
    auto config=ma_decoder_config_init(ma_format_f32,2,44100);
    check(ma_decoder_init_file(path,&config,&decoder)==MA_SUCCESS,"reference recording opens without playback");
    ma_uint64 frames=0;ma_decoder_get_length_in_pcm_frames(&decoder,&frames);
    frames=(std::min)(frames,ma_uint64(44100*40));
    Audio input(static_cast<size_t>(frames)*2);ma_uint64 read=0;
    ma_decoder_read_pcm_frames(&decoder,input.data(),frames,&read);ma_decoder_uninit(&decoder);
    check(read>44100*2,"reference recording contains a useful passage");input.resize(static_cast<size_t>(read)*2);
    const std::array<float,20> neutral{0,0,0,1,0,0,0,0,1,52,0,0,0,0,.72f,.6f,0,0,0,0};
    double baselineBass=0;
    for(int mode=0;mode<3;++mode) {
        g_ecoMode=true;check(engine_init_offline(44100),"reference offline graph initializes");
        execute_audio_command("BYPASS_ALL 0");execute_audio_command("HEADPHONE_CORRECTION OFF");execute_audio_command("CONVOLUTION 0");
        auto values=neutral;
        if(mode) {values[17]=1;values[4]=mode==1?.32f:.40f;values[5]=mode==1?.22f:.38f;values[6]=mode==1?.025f:.06f;values[14]=mode==1?.55f:.65f;values[15]=mode==1?.72f:.78f;}
        check(apply_audio_settings(values.data(),20)==0 && execute_audio_command((std::string("LOAD ")+path).c_str())==0,"reference uses production presets and decoder");
        execute_audio_command("PLAY");
        Audio output(input.size());
        for(size_t frame=0;frame<read;frame+=256)engine_render_offline(output.data()+frame*2,static_cast<ma_uint32>((std::min)(size_t(256),static_cast<size_t>(read)-frame)));
        check(finite(output) && g_limiterNode.hardClippedSamples.load()==0,"reference preset has finite PCM and zero hard-clipping hits");
        if(mode==0) {
            constexpr size_t delay=1196;
            double error=0,original=0;
            for(size_t frame=44100;frame<read;++frame)for(int channel=0;channel<2;++channel) {
                const double source=input[(frame-delay)*2+channel];
                const double delta=output[frame*2+channel]-source;error+=delta*delta;original+=source*source;
            }
            const double relative=std::sqrt(error/(original+1e-30));
            std::cout<<"REFERENCE Natural relative residual="<<relative<<'\n';
            check(relative<.0001,"Natural preserves the supplied recording within -80 dB residual after latency alignment");
        }
        BiquadLPF lowL,lowR;lowL.init(44100,120);lowR.init(44100,120);
        double bassEnergy=0;
        for(size_t frame=0;frame<read;++frame){const float l=lowL.process(output[frame*2]),r=lowR.process(output[frame*2+1]);if(frame>44100)bassEnergy+=l*l+r*r;}
        if(mode==0)baselineBass=bassEnergy;
        else {
            const double delta=10*std::log10((bassEnergy+1e-30)/(baselineBass+1e-30));
            std::cout<<"REFERENCE "<<(mode==1?"Immersive":"Chill")<<" low-bass change="<<delta<<" dB\n";
            check(std::abs(delta)<.5,"spatial intent retains the reference low-bass weight within half a dB");
        }
        execute_audio_command("STOP");uninit_audio_engine();
    }
    g_ecoMode=false;
}

int main() {
    const auto start = std::chrono::steady_clock::now();
    try {
        sampleRateModes(); oversampling(); allpassAndLoudness(); toneAndBass(); adaptiveTone(); spatialAndReverb(); measuredMobileAndAutomaticRoom(); airAndLimiter(); convolution(); adapterAndRawRouting(); productionControlSweep(); transportAndNaturalism(); referenceRecording();
        const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now()-start).count();
        std::cout << checks << " checks passed in " << ms << " ms (offline; no audio devices opened).\n";
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "FAIL " << e.what() << '\n';
        return 1;
    }
}
