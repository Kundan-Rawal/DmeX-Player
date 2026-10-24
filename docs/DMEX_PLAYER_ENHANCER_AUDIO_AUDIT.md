# DmeX Player: Audio Quality Audit and Enhancer Migration Plan

Date: 2026-10-12  
Player inspected: `C:\DmeX-Player`, Git HEAD `a0e5589`  
Enhancer reference: `C:\DmeX-Enhancer\engine\src` and `engine\tests`  
Deliverable: observations, proposed corrections, and implementation requirements for review.

> Historical baseline audit. Implementation subsequently authorized by the user is documented in
> [Implementation and Verification](DMEX_AUDIO_IMPLEMENTATION_AND_VERIFICATION.md). The source-line
> references below describe the pre-migration checkout, not the newly edited files.

## 1. Decision and Scope

The Player can move substantially closer to the Enhancer's sound. Much of the DSP shares an earlier implementation, and the processing order is already similar. The largest immediate gains are correcting channel independence, oversampling, limiter behavior, impulse-response handling, state transitions, and decoding. Adding stronger bass or more spatial effects before these corrections would make the result harder to evaluate.

This audit did not change application source, audio settings, drivers, output devices, or either application's playback state. Temporary offline diagnostics were compiled to inspect existing headers. No listening test, DAC capture, sustained playback test, or full Tauri application build was performed. The conclusions describe the inspected code and the explicitly recorded offline measurements, not a guarantee of perfect sound on every device.

Evidence labels used below:

- **Measured:** executed offline against the specified existing code or executable.
- **Confirmed:** follows directly from the inspected implementation, including deterministic indexing or mathematical errors.
- **Risk:** the code permits the failure, but its frequency or audible severity needs runtime validation.
- **Requirement:** necessary design or validation work, not a claim that a feature already exists.

Priority meanings:

- **P0:** memory safety, process termination, or invalid output under a supported trigger; fix before a migration release.
- **P1:** audible correctness, real-time reliability, misleading bypass, or a control that does not reach its intended DSP.
- **P2:** quality improvement, consistency, diagnostics, performance, or maintainability.

"Clear sound" should mean preserved direct stereo, controlled intentional coloration, stable transients, bounded peaks, correct timing, predictable controls, and no discontinuities. It does not mean maximally boosting every band. Source mastering, headphone fit, speaker response, the physical output path, and listener preference remain relevant.

## 2. Which Code Actually Runs

### 2.1 Player build ownership

[Tauri build script](../music-player-ui/src-tauri/build.rs) compiles these C++ units into the Rust application:

```text
EngineCore.cpp
DSP_Nodes.cpp
Telemetry.cpp
CommandParser.cpp
pffft.c + pffft_common.c
```

[Standalone CMakeLists](../audio-engine-cpp/CMakeLists.txt) instead builds `AudioEngine` from `main.cpp` alone. That file contains an older, self-contained DSP implementation. It is not the C++ entry point compiled by the current Tauri build. Likewise, backup files and the `old_*` / `current_*` snapshots under the UI folder are not the authoritative Tauri implementation.

**P1, confirmed:** testing or porting only `audio-engine-cpp/main.cpp` would test or update a different engine from the one used by DmeX Player. Consolidate the production DSP sources into a library target and make the offline test target consume that same library. Preserve Rust FFI and transport separately.

The intended native development command remains:

```powershell
cd C:\DmeX-Player\music-player-ui
npm.cmd run tauri dev
```

Tauri's `beforeDevCommand` starts Vite as part of that workflow. A browser-only Vite preview cannot validate Rust FFI, the C++ graph, endpoint negotiation, or actual sound.

### 2.2 Existing Player signal path

```text
File
 -> Rust Symphonia full-file decode
 -> optional automatic offline SBR modification
 -> optional Rubato offline sample-rate conversion
 -> C++ MemoryDataSource / miniaudio sound
 -> Restoration
 -> Convolution
 -> Audiophile EQ
 -> Compressor
 -> Bass engine
 -> Exciter
 -> Widener
 -> 9D upmixer
 -> Legacy psychoacoustic spatializer
 -> Algorithmic reverb
 -> Headphone correction
 -> Limiter
 -> Meter
 -> Engine endpoint volume
 -> Device callback / physical output
```

If Rust decoding fails, the Player uses a miniaudio file-loading fallback. That fallback can have different preprocessing and resampling behavior. See [CommandParser.cpp](../audio-engine-cpp/CommandParser.cpp:216), [Rust decoder](../music-player-ui/src-tauri/src/lib.rs:66), and [graph wiring](../audio-engine-cpp/EngineCore.cpp:406).

### 2.3 Enhancer signal path and fundamental difference

The Enhancer accepts live stereo through a duplex capture/playback device, supplies that input to a headless miniaudio graph, and processes broadly the same stage order. Its source is a virtual-cable stream, not a decoded track owned by the application.

The Player owns track metadata, decoder state, source rate, seeking, end-of-stream, playlists, and potentially gapless playback. It does not need the Enhancer's virtual-cable discovery, system-default routing, or service installer to reuse its DSP. Copying those components would introduce unnecessary system routing and another opportunity for resampling or double processing.

## 3. Executed Evidence

### 3.1 Enhancer regression executable

Executed the existing `C:\DmeX-Enhancer\engine\build-audit\Release\dmex-dsp-tests.exe` from its own directory.

Result: **69 checks passed in 2047 ms**, with no audio devices opened. The existing binary was used; the full Enhancer was not rebuilt in this audit. Its test source was also inspected.

The checks cover oversampler gain and delay, all-pass impulse energy, loudness channel isolation, bass behavior, selected sub-bass anchors, vocal presence, reverb, spatial dry preservation, HRTF initialization, Harmonic Air, limiter sample ceiling, and partitioned convolution. Most DSP fixtures run at 48 kHz; the explicit 48/96 kHz checks initialize and verify the HRTF. This is not full-chain audio-quality coverage at both rates.

### 3.2 Fresh header diagnostics

A small C++ diagnostic was freshly compiled twice with MSVC `/O2`: once against the Player's current headers and once against the Enhancer's current headers. It injected an impulse into the oversampler, checked settled DC gain, and fed a left-only impulse through loudness filters initialized at 48 kHz with volume 0.25.

| Measurement | Player | Enhancer | Interpretation |
| --- | --- | --- | --- |
| Oversampler impulse sum | 1.000020742 | 1.000000000 | DC gain alone does not reveal the Player's timing/filter defects |
| Oversampler measured impulse peak | sample 27 | sample 20 | Actual round-trip peak position |
| Oversampler reported delay | 9.25 samples | 20 samples | Player's declared delay does not match measurement |
| Settled DC output, L=1 / R=-0.5 | 1.000020742 / -0.500010371 | 0.999999940 / -0.499999970 | Both preserve approximate steady DC gain |
| Loudness output in initially silent R | peak 0.013397247 | exactly 0 | Player shares channel filter state |
| Adapter output after only resetting `fill` | old impulse value 1 | old impulse value 1 | Shared adapter reset defect; neither implementation clears queued output |

The right-channel leakage is about -37.46 dB relative to the unit input impulse. These measurements are isolated-node/header diagnostics, not measurements of the installed application's output.

### 3.3 Player test harness status

A syntax-only MSVC compile of [existing DSP harness](../audio-engine-cpp/tools/dsp_harness.cpp) fails against current headers. Examples include removed `targetDrive`, `currentDrive`, `currentBass` members, calls to nonexistent `SmoothedParam::store`, and obsolete `reverb_init_filters` arguments.

**P1, confirmed:** the Player has a harness file, but it is not a usable current regression suite. Do not treat its presence, printed test names, or README claims as proof of tested DSP.

### 3.4 Impulse-response asset inspection

Parsed the WAV headers in `music-player-ui/src-tauri/resources/impulses` and `headphone_comp` without changing files:

- Many original headphone-named assets: mono, 44.1 kHz, 24-bit PCM, 1024 frames.
- Original `SennheiserHD.wav`: stereo, 48 kHz, 24-bit PCM, 1200 frames.
- `xiaomipiston2.wav` and `Head360.wav`: stereo, 48 kHz, 2400 frames.
- `DTSXHeadphonewide.wav`, `XHRQSurround.wav`, `XHRStudioSurround.wav`, and `dolbybassboost.wav`: stereo, 48 kHz, 4800 frames / 100 ms.
- All ten generated `*_harman_inv.wav` assets: stereo, 48 kHz, 16-bit PCM, 1024 frames.

The assets exist. Their names do not establish measurement provenance, accuracy for a particular headphone, or successful loading at the DSP rate.

## 4. Highest-Priority Correctness Findings

### F01. Automatic SBR can violate the user's intended bypass

**P1, confirmed.** [Rust decoder](../music-player-ui/src-tauri/src/lib.rs:133) calls `sbr::apply_sbr_offline` for every stereo decode before consulting restoration, taste, or profile controls. If cutoff detection succeeds, PCM is changed before it reaches the real-time DSP. Turning real-time restoration off cannot restore that original decoded PCM.

**Enhancer comparison:** its Harmonic Air stage is explicitly controlled and generates a bounded wet addition to a delayed original signal. It does not run an automatic full-file SBR pass in a decoder.

**Required change:** preserve immutable decoded PCM; make spectral enhancement opt-in, versioned, separately cached, and reversible. Define Original/Reference mode to bypass automatic synthesis. Detection may run in the background without changing samples. Test SBR disabled with a PCM null comparison.

### F02. SBR writes both processed channels into the left-channel slots

**P1, confirmed.** In [sbr.rs](../music-player-ui/src-tauri/src/sbr.rs:172), the loop variable `ch` is omitted from both the source index at line 180 and output index at line 214. Both iterations read channel 0 and accumulate into positions `offset + i * channels`. Channel 1 is never reconstructed into its own positions. The final interleaved copy then replaces right-channel values with zeros in the processed interior.

**Consequence:** a stereo file can lose its right channel and have an incorrect left gain whenever SBR actually processes a detected cutoff. This is deterministic from the indexing; no listening test is needed to establish the bug.

**Required change:** use `offset + i * channels + ch` for both read and write, then validate L-only, R-only, dual mono, anti-phase stereo, and different signals per channel. Preserve stereo coherence in any randomized synthesis design.

### F03. Short full-band clips can panic in cutoff detection

**P0, confirmed trigger by inspection.** [detect_cutoff_stable](../music-player-ui/src-tauri/src/sbr.rs:40) uses `frames.len() / 5` as an agreement threshold. With one to four analysis frames and no cutoff hits, this threshold is zero, so an empty `hits` vector passes the guard and `hits[0]` is accessed.

The decode function is `extern "C"`; an uncaught Rust panic at this boundary can terminate the process. The current code does not guard that boundary. Clips producing one to four windows are a concrete trigger, not every short clip.

**Required change:** explicitly reject empty hits, round the required agreement count upward with a minimum of one, handle non-finite spectral values, and return a structured error through FFI. Add a short-clip/no-cliff regression case.

### F04. SBR normalization and applicability do not match the intended algorithm

**P1, confirmed.** [Overlap-add code](../music-player-ui/src-tauri/src/sbr.rs:209) divides by 2 after applying Hann windows in both analysis and synthesis. A steady interior sum of squared Hann windows at this overlap is approximately 1.5, so this is not unity reconstruction. Boundary regions are copied from the original while the interior is processed, allowing gain discontinuities.

[replicate_band](../music-player-ui/src-tauri/src/sbr.rs:61) returns without synthesis when `cutoff_bin * 2 > nyquist_bin`. At 44.1 kHz, a detected 16 kHz cutoff is above this condition's 11.025 kHz limit. The surrounding FFT/OLA pass may still alter samples even though no high band was added. Cutoff detection examines a limited initial segment and a frequency cliff is not proof of lossy encoding.

**Required change:** validate identity reconstruction first, accumulate and divide by the actual window-squared weights, handle final windows and boundaries, and restrict or redesign synthesis for the frequency range supported. Use a shared stereo random-phase policy where appropriate. Do not classify a file as lossless using cutoff alone.

### F05. Oversampler phase selection and latency are wrong

**P1, measured and confirmed.** [Oversampler.h](../audio-engine-cpp/Oversampler.h:71) defaults to 31/15 taps. With these lengths, the loops over odd absolute tap indices select the center tap while omitting the non-center taps that the designed halfband filter needs. The downsampler also adds a separate center term and visits the center in that loop. This is not the corrected full FIR interpolation/decimation used by the Enhancer.

The measured impulse peak is at 27 samples, while `latencySamples()` reports 9.25. The Player's exciter rounds that reported value to 9 for dry alignment. Its wet path therefore has a substantial relative timing error. Oversampling-based peak detection also depends on these filters.

**Port candidate:** Enhancer `Oversampler.h`, which processes the full zero-stuffed interpolation FIR, uses even-phase decimation, defaults to 33/17 taps, and reports a measured 20-sample round trip.

**Required change:** port the corrected implementation together with all dependent delay buffers and initialization. Test impulse delay, DC gain, frequency response, alias rejection, nonlinear IMD, and L/R independence. An oversampler header-only substitution without changing dry alignment and resets is incomplete.

### F06. Loudness filters crossfeed channels and reset every block

**P1, measured.** [EqualLoudness](../audio-engine-cpp/DSP_Nodes.h:269) has one `lowShelf` and one `highShelf` instance. The same filter history is used for L and then R. The probe measured 0.013397247 peak leakage into a silent right channel.

The fields are actually `BiquadPeak` filters, not shelving filters. In addition, [EQ processing](../audio-engine-cpp/DSP_Nodes.cpp:382) calls `update` each callback, which calls `.init` and clears filter histories. Adaptive loudness can be skipped entirely by the EQ's early-return condition. `init` also initially calls `update(-20.0f)` although the update parameter is treated as a linear volume.

**Port candidate:** Enhancer `EqualLoudness` uses separate L/R low/high shelves, preserves history during coefficient changes, and smooths both enable and volume.

**Required change:** independent per-channel states, actual shelf equations, sample-rate-aware smoothing, coefficient updates only when needed, and explicit enable ownership. A digital slider position is not a measurement of acoustic SPL, so describe this as gentle volume compensation rather than exact ISO 226 calibration. Shelf equations are documented in the [W3C Audio EQ Cookbook](https://www.w3.org/TR/audio-eq-cookbook/).

### F07. Limiter release coefficient is used in the wrong direction

**P1, confirmed.** [Initialization](../audio-engine-cpp/EngineCore.cpp:363) sets `releaseCoef = exp(-1/(0.150 * sr))`, close to one. [Limiter release](../audio-engine-cpp/DSP_Nodes.cpp:1035) multiplies the difference by that coefficient rather than `1 - releaseCoef`. The intended 150 ms release becomes an almost immediate return before the additional gain smoothing.

There is no hold spanning the delayed transient. The smoothed gain may recover before the stored peak is emitted. Final output is clamped to +/-1 instead of the stated 0.891251 ceiling. NaN input is not sanitized; comparisons do not remove NaNs.

**Port candidate:** Enhancer's limiter includes original-sample plus oversampled peak detection, a hold across lookahead, the correct release factor, finite-value handling, and a sample clamp at 0.891251.

**Required change:** port the limiter as a unit with its corrected oversampler, buffers, rate setup, reset state, and gain controls. Validate intersample peaks independently; passing a sample ceiling check is not full true-peak certification. The -1 dB value should be an explicit project target, not an assertion that all platforms have one universal delivery standard.

### F08. Volume is downstream of limiting and metering

**P1, confirmed ordering.** [VOLUME command](../audio-engine-cpp/CommandParser.cpp:314) invokes `ma_engine_set_volume`. The bundled [miniaudio implementation](../audio-engine-cpp/miniaudio.h:78052) applies this on the graph endpoint output bus, after the custom limiter and meter.

For normal 0-1 volume, this does not by itself boost above the ceiling, but lowering volume does not reduce upstream limiting. Values above one are accepted by the native parser and can increase samples after protection. Metering does not represent the final volume-scaled output.

**Required change:** one smoothed master gain before final limiting, a defined gain range, and final-output telemetry after all gains. Keep digital attenuation separate from optional loudness maximization. Preserve mute settling and avoid instant gain jumps.

### F09. The real-time decoder read can block on analysis work

**P1, confirmed shared lock; underrun severity unmeasured.** [MemoryDataSource read](../audio-engine-cpp/CommandParser.cpp:44) holds `g_audioMutex` in the audio pull path. [analyze_audio](../audio-engine-cpp/CommandParser.cpp:660) holds the same mutex while allocating and copying up to ten seconds of PCM. Metrics and seeking also use this lock.

**Required change:** immutable PCM ownership, audio-thread-owned cursor and state, published telemetry snapshots, and an analysis view whose lifetime is secured without holding a mutex against the callback. For streaming, use a bounded producer/consumer ring. Do not simply remove the lock while retaining unsafe buffer destruction.

### F10. Convolution allocates and destroys heap objects in the callback

**P1, confirmed.** [Convolution](../audio-engine-cpp/DSP_Nodes.cpp:756) creates six vectors per completed 512-frame block. Both convolution and headphone correction delete retired FFT objects from the audio callback. FFT preparation itself can remain on the worker thread; repeated allocation and deletion in rendering is the issue.

**Port candidate:** Enhancer convolution has fixed node-owned scratch arrays and removes the callback's countdown deletion mechanism.

**Required change:** allocate scratch storage during preparation, perform bounded processing, and retire objects on a non-audio owner after an acknowledged handoff. Count callback allocations in tests. Keep error reporting and logging outside the callback.

### F11. Atomic IR pointers do not establish safe stereo ownership

**P0 risk.** [IR publication](../audio-engine-cpp/CommandParser.cpp:187) exchanges L and R separately and writes plain `pendingDelete*` and `deleteCountdown` fields while callbacks read them. A ten-callback countdown is not a lifetime protocol. Rapid reloads can overwrite pending retirements, leak objects, mix left/right generations, or race reclamation.

The memory-loading FFI functions do not take `g_commandMutex`, so they can also publish independently of ordinary string commands. `g_irMutex` inside reset does not protect callback access because the processing path does not use it.

**Required change:** publish one immutable stereo bank with a generation ID. For the initial port, fade and stop device callbacks, install/reset the bank, then resume with a fade. For uninterrupted changes, use explicit audio-thread acknowledgment, prepared parallel banks, a crossfade, and deferred worker reclamation. Use the same ownership rules for both IR loaders.

### F12. Plain shared settings and state mutation are data races

**P1, confirmed shared access.** [Engine globals](../audio-engine-cpp/EngineCore.cpp:24) include plain float/bool settings written by commands and read by DSP. `LIMITER` also writes the live gain envelope, and `dsp_flush_all_state` mutates filter/delay state from command execution. `g_commandMutex` serializes command callers, not command-vs-audio access.

Hardware-aligned loads do not make unsynchronized C++ access valid. The Enhancer's atomics are a useful improvement for scalar control targets, but independent atomic stores alone do not make a multi-control preset coherent.

**Required change:** use atomic control targets or immutable parameter snapshots, and let the audio thread own all filter state. Apply presets as one versioned transaction at a block boundary. Perform large reset/rebuild operations only while callbacks are suspended or through a proven handoff.

### F13. Flush/reset leaves old samples and important histories alive

**P1, measured adapter behavior and confirmed omissions.** [dsp_flush_all_state](../audio-engine-cpp/DSP_Nodes.cpp:1205) resets adapter `fill` but not `outBuf`. The diagnostic emitted the old impulse after this reset in both codebases. The Player also omits multiple crossover, restoration, oversampler, dry-delay, adaptive-loudness, and 9D histories. Spatial all-pass indices are not all reset, and limiter `gainSmooth` is not restored together with `gainEnv`.

**Consequence:** seeking or loading a new track can output stale prepared samples or inherit old filter/tail state. Resetting while playing adds a separate race and discontinuity risk.

**Required change:** each node needs a complete, tested `reset` contract, including input/output adapter buffers and indices. Invoke it under safe lifecycle ownership. Specify seek policy, tail preservation on pause, tail suppression on stop/new track, and startup fade. The Enhancer also needs the adapter buffer fix; copying its current reset is insufficient.

### F14. Unsupported native rates can overflow fixed reverb buffers

**P0, confirmed capacity calculation; hardware trigger untested.** Player [reverb_init_filters](../audio-engine-cpp/DSP_Nodes.cpp:413) scales delay lengths to the engine rate. `comb_init` and `ap_init` assign these lengths without checking fixed storage. At 192 kHz, a 1617-sample base comb becomes roughly 7040 samples, exceeding `MAX_COMB_BUF=4000`; a 556-sample all-pass also exceeds its 1500-element capacity.

Windows device configuration requests rate zero/native, so the code does not itself limit the graph to rates whose delays fit. The failure requires a negotiated rate above the safe capacity range.

**Required change:** define supported rates, validate every derived delay before starting, and allocate correctly sized delay storage during preparation or reject unsupported modes cleanly. Enhancer clamps lengths and explicitly accepts 48/96 kHz, but silently clamping a delay can change acoustics; valid preparation is preferable to hiding a rate mismatch.

### F15. Parsing failures and non-finite controls cross FFI unsafely

**P0/P1, confirmed parser behavior.** [safe_stof](../audio-engine-cpp/CommandParser.cpp:11) uses `strtof` without checking full consumption, range, or finiteness. Several commands use uncaught `stoi`; malformed input can throw across `extern "C"`. Some IR loader allocations are dereferenced without checking success. Rust `CString::new(cmd).unwrap()` can also panic for embedded NUL.

**Required change:** validate typed controls in Rust and again at the native boundary, reject NaN/Inf and malformed strings, clamp documented ranges, catch errors inside FFI, and return explicit status. Keep the previous good DSP state on failed preparation. Enhancer's parser already checks finite numeric values and returns command/status errors; use that behavior as a baseline.

## 5. Tone, Bass, Dynamics, and Restoration

### F16. The Exciter control does not activate its processing path

**P1, confirmed.** `g_isUpscaleOn` starts false in [EngineCore.cpp](../audio-engine-cpp/EngineCore.cpp:36). [exciter_process](../audio-engine-cpp/DSP_Nodes.cpp:59) bypasses while this flag is false. The Player's `UPSCALE` command only sets `drive`; no current command assignment turns this flag on. The slider can show a value while the exciter continues bypassing.

Even if the flag is activated, its shaping law adds filtered high-band content at zero drive instead of making the harmonic delta scale to zero. The Enhancer uses a clean oversampled comparison path and adds `drive * 0.10 * (shaped - clean)` to correctly delayed dry PCM.

**Required change:** give enable and amount explicit semantics, port the corrected clean/wet exciter paths, and test zero-drive transparency after latency compensation. Do not reuse the Enhancer's control values blindly: Player `UPSCALE` multiplies its input by four, whereas Enhancer drive is normalized 0-1.

### F17. The "FIR / Linear Phase" EQ is implemented with IIR crossovers

**P1, confirmed.** [audiophile_eq_process](../audio-engine-cpp/DSP_Nodes.cpp:285) uses recursive `LinkwitzRiley4` and `BiquadPeak` filters. It does not implement an FIR linear-phase equalizer. A complementary LR crossover sum is not zero phase, and serial multiway splitting requires its own reconstruction/phase analysis.

The `FIRMODE` flag changes bypass/parameter behavior, not the filter topology. The UI's linear-phase label and the code comments promising zero phase distortion are unsupported by this implementation.

**Port candidate:** the Enhancer's ordinary independent L/R shelves and 2.5 kHz presence peak, with zero-gain filters returning identity. This is a simpler route to neutral EQ when controls are zero, but remains IIR.

**Required change:** choose an honest IIR EQ mode or implement a real FIR mode with measured frequency response, declared latency, and acceptable pre-ringing. Rename legacy commands in a versioned API. If FIR is added, delay all corresponding parallel dry paths and update transport timing.

### F18. Remaster changes more than vocal clarity

**P1/P2, confirmed behavior.** [REMASTER](../audio-engine-cpp/CommandParser.cpp:338) assigns bass/mid/high gains of 1.6/0.7/1.4. Inside EQ, non-neutral mid gain or Remaster also triggers harmonic processing, a side boost, upward gain, and, on desktop, fixed presence EQ. Android omits some of these operations and applies a separate 0.707 gain for headphone output when this EQ path runs.

This can simultaneously reduce mid level, add saturation, change stereo width, increase quiet-band gain, and change total loudness. A mode called "clear" cannot be evaluated without disentangling those changes.

**Required change:** independent controls for tone, vocal presence, exciter, compression, and output headroom. Prefer Enhancer's smoothed presence peak for Vocal Frontness. It raises everything near 2.5 kHz, including guitars or percussion; it is not vocal-stem extraction. Recalibrate platform differences explicitly instead of hiding gain changes inside one node.

### F19. Bass reconstructs the whole signal through crossovers and an internal saturator

**P1/P2, confirmed behavior.** [Player bass](../audio-engine-cpp/DSP_Nodes.cpp:497) splits at 180/80 Hz, applies a 32 Hz high-pass, processes separate branches with 60 Hz and moving 95-125 Hz peaks, adds broad linear gain, then applies `softCeiling` to the reconstructed bass.

Turning the effect on therefore changes phase, low-frequency rolloff, gain, and potentially harmonics at once. Its `softCeiling` has a derivative change at the 0.85 threshold: the slope changes from 1 to 0.5. This is continuous in value but is not the claimed continuously smooth, distortion-free behavior. No digital formula guarantees absence of physical speaker rattling.

**Port candidate:** Enhancer bass uses broad full-signal peaking filters, adds their difference to dry PCM, has a separate linked transient contribution, and leaves absolute peak control to the downstream limiter. This avoids the specific branch-delta cancellation problem described in the Enhancer code.

**Required change:** port the complete bass node and preparation rather than just stronger gain constants. Validate low-frequency magnitude/phase, monotonic drive, onset-to-sustain behavior, mono compatibility, and limiter reduction. Retune presets with level-matched music.

### F20. The Player's bass analysis is less complete and less rate-consistent

**P2, confirmed.** Player envelope names imply three frequency regions, but the active implementation mainly analyzes two branches. Its tracking slew uses a callback-local `i == 0 || (i & 31) == 0`, so update cadence depends on block size. Attack/release constants are fixed per sample rather than computed from physical time at the negotiated rate. Bass command input itself is not smoothed.

Enhancer adds 60/100 Hz analysis branches, a persistent sample counter, sample-rate-derived ballistics, full-band-relative scarcity detection, a bounded 78-118 Hz punch anchor, and an explicit selectable broad sub anchor.

**Required change:** transfer these methods together. Scarcity compensation must require existing bass activity and cannot recover a missing fundamental from silence. Energy-weighted band tracking is not pitch estimation or source identification. Tests should include deliberately bass-light mixes and artistic low-bass material to avoid overcorrection.

### F21. Missing independent Sub-Bass Frequency and Bass Field controls

**P2, confirmed capability gap.** Player bass has a fixed 60 Hz anchor and its room bass belongs to the older 9D upmixer. Enhancer separates bass drive, sub anchor, room enable, and field amount.

**Required change:** introduce separately stored controls for the six currently accepted Enhancer anchors (30, 40, 52, 60, 70, 80 Hz), Bass Drive, Bass Field, and Compact/Room. Room should send only the intended upper-bass content into reflections, with direct deep bass preserved. Anchor selection must survive presets and track changes unless a user explicitly changes it.

30/40 Hz should not be the default way to increase loudness on a small speaker. Validate device profiles and avoid claiming that a frequency selection can overcome hardware rolloff.

### F22. Speaker protection is skipped at zero bass drive

**P1, confirmed.** [subwoofer_process](../audio-engine-cpp/DSP_Nodes.cpp:505) returns before the Android/laptop protection branches when bass gain is below 0.001. This contradicts the later comment that speaker protection always runs. Speaker profiles also use fixed one-pole coefficients and aggressive nonlinear bass synthesis without the corrected oversampling path.

**Port candidate:** Enhancer separates small-speaker protection from drive and uses rate-aware protection plus transient-weighted virtual bass.

**Required change:** output-profile protection must work independently of the enhancement slider. Calibrate phone, laptop, headphones, and external speakers separately; a single high-pass choice is not validated for every physical device. Preserve the actual device profile through every DSP preset.

### F23. Compressor bypass changes latency and neutral reconstruction

**P1, confirmed.** [Compressor](../audio-engine-cpp/DSP_Nodes.cpp:901) bypasses immediately when disabled, but enabled output has lookahead delay and LR crossover processing. Threshold and makeup smoothing advance once per callback. The detector and processed crossover are not the same filter design.

Enhancer keeps the delay active, smoothly changes the compression contribution, processes a complementary residual high band, and advances controls per sample. That supports a stable neutral path.

**Required change:** use constant declared latency in enhanced mode and smoothly transition gain reduction. Test compression off/on with already running audio, unity settings, asymmetrical stereo, low-frequency bursts, and varied callback sizes. This code is a linked upper-band compressor, not a complete independent multiband mastering compressor merely because of its type name.

### F24. Limiting is mixed with speaker loudness and clipping

**P1/P2, confirmed.** The Android speaker branch bypasses the ordinary lookahead limiter and uses a nonlinear clipper. Desktop/laptop processing applies a hidden 1.3 multiplier in the ordinary limiter. `LIMITER` maps an input amount to boost and resets live gain state.

**Required change:** one final protection stage for all output profiles, with intentional speaker loudness processing before it. Port Enhancer's stereo-linked loudness-maximizer controls only after limiter correctness is established. Report gain reduction and cap combined enhancement, rather than relying on repeated clipping across stages.

### F25. Restoration's names overstate its processing

**P1/P2, confirmed.** [audio_restoration_process](../audio-engine-cpp/DSP_Nodes.cpp:1112) attenuates the high branch for denoise, squares treble with linear-interpolation/averaging, high-passes synthesized content, and then low-passes the complete reconstructed signal at 18 kHz. `lowPassSinc` is a `BiquadLPF`, not a sinc filter. This path is not an FFT denoiser and does not reconstruct lost original codec information.

Nonlinear operations can produce in-band IMD and alias components; filtering afterward does not undo components that have already folded into the audible band. A crossover does not guarantee that every vocal component remains outside a high-frequency processor.

**Required change:** port Enhancer's properly oversampled, bounded Harmonic Air wet addition with matched dry delay. Keep a real denoiser as a separate, optional future feature requiring noise estimation and artifact tests. Treat "presence" as tonal EQ, and eliminate bit-rate-quality labels implying synthesized harmonics turn a lossy source into lossless data.

## 6. Spatial Processing and Reverb

### F26. Player spatialization re-renders the direct stereo master

**P1/P2, confirmed design difference.** [Player NineSpeakerUpmixer](../audio-engine-cpp/NineSpeakerUpmixer.h) removes bass, estimates center using a smoothed instantaneous correlation, routes the residual into nine synthetic feeds, and renders them through hand-designed delay, shadow, and pinna filters. This is a plausible creative effect but does not preserve the original full-band stereo bed directly.

It does not provide recovered original objects, measured individualized HRTFs, physical nine-channel playback, or guaranteed height localization. Center estimation can change with the source, and the gain matrix is not proven unit-power merely by a comment.

**Port candidate:** Enhancer upmixer retains `outL = inL + wetL` and `outR = inR + wetR`. It extracts diffuse residual in separate mid/high analysis bands, suppresses attacks, renders six fixed side/rear/height feeds, and caps wet RMS at 34% of dry RMS times separation. Its ambience input is high-passed at 300 Hz; the direct stereo signal is not replaced by the spatial renderer.

**Required change:** use dry-preserving spatial ambience as the reference advanced mode, with explicit separation/depth and headphone-only defaults. Keep the old matrix as an optional legacy mode only if it is wanted and separately tested. A wet energy cap controls headroom but does not guarantee no perceptual combing for every source.

### F27. Depth/Separation do not reach the active Player 9D renderer

**P1, confirmed.** [DEPTH and 3D commands](../audio-engine-cpp/CommandParser.cpp:401) update only the legacy psychoacoustic node. That node bypasses when 9D is enabled. The Player's `DynamicSpatializerNode` has no matching separation/depth setters for its renderer.

Enhancer publishes these controls to both legacy and HRTF paths and explicitly bypasses the 9D node when separation is zero.

**Required change:** route active controls to the active renderer, expose applied state, and specify 9D off and zero-separation behavior. Turning 9D off with nonzero legacy separation can still modify audio; decide whether Stereo means all spatial processing off and implement that policy consistently.

### F28. HRTF integration requires more than copying one header

**P2, requirement.** Enhancer `NineSpeakerUpmixer.h` depends on `SteamAudioHrtf.h/.cpp`, Steam Audio headers and libraries, runtime `phonon.dll`, and a SOFA asset. It processes HRTF frames of 64 samples within potentially larger callbacks. The 64-frame wet scheduling delay is about 1.33 ms at 48 kHz or 0.67 ms at 96 kHz; it is not the entire device/output latency or HRTF tail duration.

**Required change:** compile/link/package the renderer in Tauri `build.rs`; initialize and release it off the audio thread; load licensed/versioned assets; publish availability and actual rate; retain dry playback if creation fails. Valve documents that HRTF creation is expensive and not thread-safe: [Steam Audio HRTF API](https://valvesoftware.github.io/steam-audio/doc/capi/hrtf.html). Binaural effects use the configured audio frame size: [Binaural Effect API](https://valvesoftware.github.io/steam-audio/doc/capi/binaural-effect.html).

Provide architecture-compatible binaries for Windows and a separately validated Android backend/build. Do not copy an x64 DLL or global AVX2 compiler flag into Android. Benchmarks must include six active binaural feeds under worst-case combined DSP.

### F29. Legacy all-pass implementation does not preserve all-pass magnitude

**P1, confirmed mathematical defect.** [ap_tick](../audio-engine-cpp/DSP_Nodes.cpp:40) writes `state = in + feedback * delayed` and returns `delayed - in`. Enhancer returns `delayed - feedback * state`. The latter is the proper lossless all-pass recurrence for this structure; the Player's expression is a different magnitude-shaping filter.

**Required change:** port and test the recurrence as well as clamping/preparation. Use an impulse-energy and frequency-response test. The separate `SimpleAllpass` in the Player upmixer already has a different, conventional recurrence, so this finding should not be indiscriminately applied to every similarly named type.

### F30. Directional coefficient changes reset histories during motion

**P1/P2, confirmed.** [DirectionalBands](../audio-engine-cpp/DirectionalBands.h:28) calls `.init` on every positional update. `.init` clears biquad histories. The Player changes position when smoothed depth differs by a threshold, which can repeatedly restart filters during adjustment.

Enhancer uses `update_coeffs` and preserves histories. However, its stronger directional gains and some fixed per-sample legacy constants still require separate timbre and sample-rate validation.

**Required change:** preserve filter histories, use bounded coefficient interpolation or proven smoothing, rate-scale delay/filter definitions, and keep this legacy stage bypassed when the HRTF renderer owns the field.

### F31. Player reverb weakens the dry onset and is channel-biased

**P1/P2, confirmed.** [reverb_process](../audio-engine-cpp/DSP_Nodes.cpp:442) feeds both comb banks from `0.2 * Mid + 0.8 * Side`, equivalent to `0.5 * L - 0.3 * R`. A left-only source and right-only source therefore excite the room with unequal magnitudes, and centered material gets relatively little excitation.

The output crossfades the high-passed direct signal down as wet rises, while retaining an approximation of low-frequency dry signal. Raising wet can reduce consonant/transient clarity. The initialized all-pass diffuser arrays are not used in this processing loop. `roomSize` and `damp` are not advanced and applied to the combs during processing.

**Port candidate:** Enhancer's independent stereo sends, active all-pass diffusers, per-sample room/damp updates, and additive wet output retaining the direct signal.

**Required change:** port preparation, processing, smoothing, and tails as a unit. Expose Wet, Room, and Damping with bounded feedback. Centered and stereo impulses must produce finite tails, and maximum reverb must keep a dry onset. Strong wet sound is a creative mode and can still mask detail or consume limiter headroom; it should not be the clarity default.

### F32. Spatial gain, width, bass-room, and reverb can accumulate

**P2, confirmed combinations; audible outcome unmeasured.** The Player can combine widened side energy, a full 9D matrix, room-bass reflections, reverb, convolution/correction, bass boosts, and final boost. Bypassing the legacy spatializer when 9D is on already avoids one direct duplication, but does not establish a gain budget for the rest.

**Required change:** use one spatial owner, a controlled wet-send budget, linked output protection, and level-matched presets. Reference, Headphone Spatial, and Small Speaker profiles should have different defaults. Speakers generally need spatial processing reduced or disabled because binaural ear separation is not preserved through ordinary loudspeakers.

## 7. Impulse Responses and Headphone Calibration

### F33. File IR loading forces 44.1 kHz irrespective of engine rate

**P1, confirmed.** [Correction file loader](../audio-engine-cpp/CommandParser.cpp:138), `LOAD_IR`, and `LOAD_IR_DUAL` all decode IRs to 44.1 kHz. The audio graph can be 48/96 kHz or another negotiated rate. Convolution interprets IR samples at the graph rate, so filter frequency and timing are wrong when these differ.

For example, an IR decoded at 44.1 kHz but processed at 48 kHz shifts its frequency response by a factor of 48000/44100, about 1.0884. At 96 kHz the mismatch is much larger. The Android memory loader decodes asset samples without rate conversion, so it has a separate original-asset-rate mismatch.

**Required change:** include source rate in the IR preparation contract; resample the IR to actual DSP rate on the worker; rebuild on rate changes; verify the bank rate before activation. Returning a filesystem path or `MEMORY_LOADED` string is not proof the correct-rate bank became active.

### F34. Room IRs are truncated to 2048 frames

**P1/P2, confirmed.** [MAX_IR_SAMPLES](../audio-engine-cpp/CommandParser.cpp:16) limits desktop loading to 2048 frames after 44.1 kHz decoding, about 46.44 ms. Several bundled responses contain 100 ms at 48 kHz, so their later energy is discarded. The FFT convolver itself supports multiple partitions; this truncation is imposed by the loader rather than an unavoidable algorithm limit.

**Required change:** separate correction-filter and room-response limits. Read complete IRs up to a deliberate duration/memory budget, trim only according to a documented energy/tail policy, and report truncation. Long-room responses need callback-time benchmarks and may benefit from nonuniform partitioning; short correction filters may prefer a lower-latency strategy.

### F35. "Stereo IR" is not a full stereo-to-binaural room matrix

**P2, confirmed limitation.** Current two-convolver processing implements L->L and R->R. It does not implement four independently measured LL/LR/RL/RR filters. Player convolution adds a fixed 20% opposite-channel bleed, plus filtering of the send/return; those are creative approximations rather than measured cross-ear transfers.

**Required change:** specify asset type explicitly: ordinary per-ear EQ, mono-source binaural IR, stereo diagonal coloration, or full 2x2 BRIR. Use appropriate routing for each. Headphone response correction needs independent diagonal filtering; proper room binaural rendering may need cross terms. Port Enhancer's transparent diagonal convolution for ordinary filters instead of treating its math as a full BRIR engine.

### F36. Correction generator can label 44.1 kHz filter taps as 48 kHz

**P1, confirmed.** [generate_headphone_inverses.py](../scripts/generate_headphone_inverses.py:124) computes the frequency grid and inverse from each input rate, but [output generation](../scripts/generate_headphone_inverses.py:235) always writes a 48000 Hz WAV without resampling the generated taps. Many inputs inspected are 44100 Hz.

This creates a rate-label mismatch before the runtime loader's independent forced-44.1 kHz conversion. Regenerating assets with the unchanged script would reproduce the problem.

**Required change:** resample measured data to one deliberate design rate first, or preserve the actual design rate and resample the filter when loading. Assert input/output metadata and validate response at the final graph rate.

### F37. Correction asset export clips and quantizes the intended filter

**P1/P2, confirmed export behavior.** The function called `write_wav_float32` actually writes 16-bit PCM and clips each tap to [-1,1]. The inverse design permits up to +12 dB frequency-domain correction and then normalizes; clipping a filter's taps changes its response. The current assets are indeed 16-bit PCM, as their headers confirm. This finding does not assert that every generated asset has already clipped.

The WAV reader treats any four-byte sample as float and does not distinguish PCM int32 from IEEE float. Input metadata parsing should reflect actual WAV format, and PCM24 conversion should be verified on signed edge values.

**Required change:** export a real float WAV or use a uniform scale with explicit compensation/preamp metadata, preserve dynamic range, and compare the saved/reloaded impulse and frequency response with the designed filter. Reassess the +/-12 dB policy against headroom and measurement reliability.

### F38. Headphone correction provenance and ordering need verification

**P2, evidence gap and confirmed ordering.** Headphone-named input assets are used as measured responses in the inversion script, but this inspection did not establish the measurement rig, target normalization, listener/device variant, or licensing provenance. A spatial preset IR is not automatically a raw headphone-response measurement.

The UI says correction happens before spatial staging; [actual graph](../audio-engine-cpp/EngineCore.cpp:418) places it after spatializer/reverb and before limiter. Post-render headphone equalization can be a reasonable deliberate design; the issue is documenting and measuring the intended order, not assuming one location is universally correct.

**Required change:** asset manifest with measurement source, rate, channels, target/version, gain/preamp, checksum, and license; verify the intended order. Hide or report unavailable correction. The Enhancer's audit explicitly notes that its correction path is unavailable until actual IRs are loaded, so the Player's bundled assets are a capability to preserve and validate rather than discard.

### F39. Convolution bypass and partial correction need latency policy

**P1/P2, confirmed architecture.** `BlockAdapter` produces one block of queued output: at 512 samples, 10.67 ms at 48 kHz or 5.33 ms at 96 kHz. `FFTConvolver::latencySamples()` returning zero does not include this adapter latency. Two active adapted stages add two blocks before their IR-specific delay.

Fully bypassed correction/convolution returns immediate input, changing timing when toggled. Within a block, blending direct and minimum-phase corrected samples is not guaranteed to follow a linear dB target at intermediate strength because their phases can differ.

**Required change:** declare effective node and total graph latency, provide delay-matched bypass in enhanced mode, test partial-strength response, and use click-free transitions. Keep Reference mode semantics explicit if it is permitted to have a different latency.

## 8. Player-Specific Decoding, Transport, and Controls

### F40. Full-file decode and enhancement are synchronous and memory-heavy

**P1/P2, confirmed design; maximum-resource behavior unmeasured.** [rust_decode_file](../music-player-ui/src-tauri/src/lib.rs:109) accumulates the whole file in PCM, may allocate a full SBR output, then deinterleaves/reinterleaves for offline resampling. The synchronous `audio_command` invokes this under the native command mutex during `LOAD`.

Five minutes of stereo float PCM alone is roughly 101 MiB at 44.1 kHz or 220 MiB at 96 kHz, before intermediate buffers. The 120 MiB guard applies only to one resampling estimate and does not cap total decode or SBR memory. Very large tracks can behave differently because resampling is skipped while small tracks get Rubato preprocessing.

**Required change:** worker decode with generation/cancellation and an immutable prepared result, or a streaming decoder/resampler producing a bounded PCM ring. Preload the next track without blocking controls. Keep callback allocation-free. The Player's ownership of source files is an advantage for pre-analysis; retain it without forcing all processing into one synchronous load.

### F41. Decode errors can silently shorten or alter a track

**P1 risk.** Decode loops continue on errors and stop on broad IO errors. They do not expose whether playback is complete, partially decoded, corrupt, or a fallback. The source sample rate/channels are taken from initial metadata and not explicitly validated against each decoded packet.

**Required change:** separate EOF, recoverable packet corruption, fatal decode, and format-change handling; return source metadata and decoder identity. Preserve and validate codec delay/padding for gapless playback. Reject unsupported changing formats cleanly rather than treating all packets as one fixed interleaved layout.

### F42. Offline resampling does not explicitly flush the filter tail

**P1, confirmed missing drain path; exact truncation requires fixtures.** [resample_offline](../music-player-ui/src-tauri/src/lib.rs:249) pads its last input chunk, then removes `output_delay` and truncates to the expected length. It does not keep feeding/draining until the desired delayed output tail exists. For an input exactly divisible by the chunk size, no extra padding chunk is processed; delay removal can leave fewer output samples than expected. `truncate` cannot restore missing samples.

**Required change:** use the pinned Rubato version's supported partial-input/flush behavior or process zero input until the expected valid output has been emitted; trim delay and padding precisely afterward. Test impulses at the first/last sample and lengths around multiples of 4096, for 44.1<->48 and 48<->96 kHz. The [Rubato documentation](https://docs.rs/rubato/latest/rubato/) explains delay/tail accounting and preallocated processing; API changes must be checked against the Player's pinned 0.15 dependency before implementation.

The comment claiming greater than 140 dB image rejection is not a result established by this audit. Measure passband, stopband, gain, length, and phase behavior with the selected converter settings.

### F43. Metrics indexing is inconsistent and track ends are inferred early

**P1, confirmed.** [Rust audio_metrics](../music-player-ui/src-tauri/src/lib.rs:369) returns:

```text
0 time, 1 duration
2 bass level, 3 bass pan
4 mid level, 5 mid pan, 6 mid phase
7 treble level, 8 treble pan, 9 treble phase
10 limiter gain, 11 audio level, 12 finished
```

[App polling](../music-player-ui/src/App.tsx:576) uses index 10 as audio level and index 11 as the finished flag. The visualizer therefore uses limiter gain instead of audio activity, and an audio level exactly equal to one can be interpreted as completion. There is also a direct `duration - time <= 0.2` transition condition. Rust's separate finished heuristic uses a 0.5-second margin; simply switching indices to 12 would therefore still cut endings early.

**Required change:** replace this numeric array with a named, versioned telemetry struct. Use native actual EOF/drained-output state, not an amplitude value or time-margin heuristic. Track source frames consumed separately from frames presented; include graph/device latency and reverb-tail policy. Test very short tracks, fade-outs, loud clipped masters, and consecutive album tracks.

### F44. Fingerprinting is rate-dependent and not a reliable genre classifier

**P2, confirmed method.** [analyze_audio](../audio-engine-cpp/CommandParser.cpp:653) limits input with a hardcoded `44100 * 10` count instead of source rate times duration. At 96 kHz it samples about 4.59 seconds rather than ten. It estimates crest peak from `(L+R)/2`, so anti-phase peaks can cancel while stereo RMS remains nonzero. ZCR is per sample and depends on sample rate.

[classifyAudio](../music-player-ui/src/config/audio.ts:23) maps a few thresholds to genre-like profiles. It does not establish actual genre or isolate instruments, and analysis can see already SBR-modified/resampled PCM. Initial seconds may be unrepresentative of the full track.

**Required change:** analyze original samples over rate-correct, representative windows; stereo peak should use max channel magnitude for crest measurements; record confidence and algorithm version. Prefer explicit automatic tonal/dynamic recommendations over pretending to identify a genre definitively. Invalidate saved fingerprints after algorithm or source changes.

### F45. "Original" and profile-off are not complete neutral modes

**P1, confirmed.** [applySmartSettings](../music-player-ui/src/App.tsx:632) applies the profile's effect settings before selecting a neutral EQ base for profile-off. Taste modifiers are still added afterward, and the function always enables `FIRMODE`. For ORIGINAL taste with an active profile, the base profile EQ/effects remain. SBR preprocessing and other saved controls can also still affect the PCM.

**Required change:** define one Reference/Original state that bypasses every enhancement, independent of profile guesses, with an explicit volume/output-safety policy. Preserve a separate Customized/Enhanced state. At safe signal levels, reference output should null against decoded PCM after accounting for agreed transport/conversion delay. Bit-perfect hardware output is a separate claim requiring a matching, validated output mode.

### F46. Preset application is not an atomic audio transaction

**P1 risk.** The Player sends many separate commands, sometimes through `Promise.all`, and sets UI state before receiving native acknowledgment. Commands are individually serialized but the preset can be audible in intermediate combinations. `writeToEngine` catches and ignores errors, and the Rust command returns no applied-state result.

**Required change:** one validated DSP snapshot with a generation ID and a native acknowledgment. Smooth it into effect coherently, keep the old snapshot on failure, and publish requested versus actual state. Coalesce slider updates to the latest target while preserving audio-rate smoothing. Store hardware preferences separately from profile parameters so a song preset does not silently replace device calibration.

### F47. Restored settings and current effect state can disagree

**P1/P2, confirmed incomplete replay paths.** Startup restores React values for depth and restoration settings, but the shown boot native replay does not send all those corresponding commands. Per-track loading sends a reset set before applying a profile. The startup path loads the remembered track twice, duplicating full decode/preprocessing. FIR mode and custom gains do not have one complete authoritative persisted snapshot.

**Required change:** a single settings schema and migration version, stored by the backend with applied snapshot/state readback. Restore one prepared track and one coherent DSP state. Define which values are device-wide, session-wide, per-track, and automatic. Make track-change reset policy explicit; do not inherit hidden settings or unexpectedly discard manual preferences.

### F48. The device layer does not verify its advertised output mode

**P1/P2, confirmed configuration.** [Windows init](../audio-engine-cpp/EngineCore.cpp:159) is described as exclusive, but never sets `deviceConfig.playback.shareMode` to exclusive. In the bundled miniaudio enum, shared mode is zero; SRC-related WASAPI flags do not themselves request exclusive mode. Android requests 44.1 kHz but does not explicitly negotiate/verify the advertised exclusive direct path.

**Required change:** separate requested source rate, graph rate, device-client rate, backend, sharing mode, and actual physical-output format in status. Negotiate and validate the mode; accept a well-defined shared fallback. Float DSP does not prove float DAC format, and enhanced/resampled audio is not bit-identical to the source.

Port the Enhancer's rate-verification and lifecycle concepts, adapted for playback-only devices. Do not copy its virtual-cable-specific endpoint management. When comparing the two apps, route both to the same physical output and disable unintended double enhancement; Player -> virtual cable -> Enhancer processes two graphs unless deliberately bypassed.

### F49. Initialization, teardown, and recovery need a serialized lifecycle

**P1 risk, confirmed ordering.** Player marks the engine initialized before all custom nodes are wired; its custom device is started earlier. Many node-init/attach return values are ignored. Rust calls `init_audio_engine` before the native command mutex is acquired. Teardown uninitializes the device and engine without a matching comprehensive custom-node/IR/data-source lifecycle and settings restore strategy.

No corresponding device-notification callback or explicit recovery-state API was found in the current Player core. Android already has an unplug/noisy pause bridge; retain it, but it is not complete rate/endpoint recovery.

**Required change:** prepare graph and assets, validate every result, attach, publish ready, then start device callbacks. Serialize init/reinit/teardown, own every native allocation, and add suspend/rebuild/resume with a short fade. Preserve playback position and source generation on device changes; reload/resample IRs for the new rate. Log device failure outside the callback and avoid restart loops.

## 9. Optimization Without Sacrificing Sound or Visuals

### F50. Parameter smoothing depends on callback size or the wrong rate

**P1/P2, confirmed.** EQ band targets, legacy spatial intensity, and compressor parameters often advance `.next()` once per callback even though `SmoothedParam` defines a per-sample coefficient. Several `.init` calls also omit the real engine rate and use the 44.1 kHz default. This changes transition speed with device callback size/rate.

**Required change:** advance controls per sample or use a mathematically equivalent block coefficient `1 - (1 - k)^frames`. Retain persistent control counters across callbacks for coefficient updates. Test 64/128/137/256/480/509/512/1024-frame partitions with the same control event timeline. Atomics provide targets; they do not substitute for smooth DSP transitions.

### F51. Rebuild dependencies omit DSP headers and resources

**P2 risk.** [build.rs](../music-player-ui/src-tauri/build.rs:6) explicitly lists several files in `cargo:rerun-if-changed`, but not all DSP headers, telemetry files, or PFFFT sources. Depending on other inputs and build tooling, header-only edits may not reliably trigger the intended native rebuild.

**Required change:** include every relevant native source/header and generated-asset manifest in build dependency tracking. Publish a native DSP version/hash in status so the user can distinguish old binaries from reviewed code. Use the production library in tests and CI instead of maintaining separate DSP copies.

### F52. High UI load needs budgeting, not an FPS cap

**P2, source observations; performance unmeasured.** [AmbientBackground](../music-player-ui/src/components/player/AmbientBackground.tsx:87) only skips hidden work in its Android condition; desktop spatial updates can continue while the expanded view is hidden. The loop reads canvas layout and resizes a DPR-backed canvas inside the frame loop, scans particles, and allocates some arrays. Per-frame motion/fading also changes behavior on high-refresh displays.

**Required change after separate visual review:** stop hidden rendering, move canvas sizing to a resize observer, cache stable arrays/context/sprites, pool active particles, and make animation motion time-based. Retain `requestAnimationFrame` with no fixed FPS throttle. Its cadence is still governed by display/WebView scheduling; spinning an unrestricted timer does not create more presented frames.

Preserve dust's intended CSS-pixel size, density, brightness, and glow while optimizing. Raster backing dimensions and CSS dimensions must be handled consistently so DPI changes do not enlarge sprites. No visual change is necessary to port the audio DSP, and this audit applies none.

Audio callbacks have deadlines independent of visual FPS. Their budget is `callbackFrames / sampleRate`, not the UI animation interval. Prefer preallocated bounded DSP over trying to increase thread priority to cover unbounded allocations or lock contention.

### F53. Diagnostics cannot yet explain perceived sound faults

**P2, capability gap.** Current band telemetry helps visualization but does not expose source/graph/device rate differences, actual DSP snapshot, callback cost/late counts, IR rate/length/generation, decoder fallback, HRTF availability, full output peak, or graph latency. Meter smoothing is block-based, and the meter precedes endpoint volume.

**Required change:** a diagnostics view/export with named versioned fields, stable-rate meter ballistics, and final output observations. Display linear limiter gain as dB reduction using `-20*log10(gain)` with a safe floor. Add loudness/ReplayGain support only with a proven implementation and defined pre-limiter gain placement; no current standards-based integrated LUFS normalization was found in the inspected active pipeline.

## 10. What to Port, Retain, and Reconsider

| Area | Enhancer method to adopt | Player adaptation / prerequisite |
| --- | --- | --- |
| Oversampling | Correct full FIR phases, 33/17 taps, measured 20-sample delay | Resize/update every dependent delay, test all supported rates |
| Tone EQ | Independent L/R shelves and presence filter; zero-gain identity | Version old FIRGAIN linear values into explicit dB controls; label IIR honestly |
| Loudness compensation | Independent stereo histories, preserved coefficient state, smoothed volume | Use the agreed pre-limiter master gain; no exact acoustic ISO claim |
| Bass | Three-region analysis, broad full-signal peak delta, scarcity and linked transient contribution | Port the full node/init; retune Player presets and mobile profiles |
| Bass controls | Sub anchor, independent drive, field, compact/room | Persist anchor and hardware preferences separately from track profile |
| Exciter / Harmonic Air | Correct oversampling and matched delayed dry/wet delta | Separate enable and amount; remove implicit decoder enhancement from Reference |
| Compressor | Smoothed enable, complementary residual band, stable delay | Declare latency, test true neutral settings and transitions |
| Reverb | Independent stereo sends, active diffusion, dry-preserving additive wet | Define tail/seek policy and room/damp limits; test max combined headroom |
| Spatial ambience | Primary/ambient extraction; six HRTF wet feeds over original dry stereo | Add renderer library/assets and Tauri build packaging; proper failure status |
| Spatial control | Separation/depth sent to the active renderer; reset on waking | Decide full Stereo bypass semantics for legacy stage too |
| Convolution | Fixed scratch arrays, simpler transparent diagonal processing | Safe stereo bank ownership, correct IR rate/full length, adapter reset fix |
| Limiter | Correct release, peak hold, pre-detection master, finite sanitization | Single final ceiling, proper reset and metering; validate actual true peaks |
| Lifecycle | Explicit preparation/teardown, generation/recovery counters, fade-in | Playback-only endpoint recovery plus source cursor and IR rate rebuild |
| Verification | Offline node regressions sharing production code | Add Player decoder, transport, FFI, preset, and complete-chain tests |

Retain the Player's Symphonia source handling, high-quality Rubato conversion concept, track/seek functionality, metadata, playlist integration, Android transport, and bundled calibration capability. These are not automatically supplied by the live Enhancer.

Do not copy virtual-cable input, system-device-default changes, service/task installer behavior, or named-pipe transport as prerequisites for better Player audio. A reusable DSP core should accept PCM blocks and an explicit sample rate; each application supplies its own source and output adapters.

### 10.1 Shared or reference-engine issues to avoid carrying forward

- Both inspected `BlockAdapter` reset paths leave queued output intact when only `fill` is reset. Correct this in the shared design.
- Enhancer still has legacy spatial processing when 9D is off and separation/depth are nonzero; its audit flags this. Product semantics need an explicit decision.
- Enhancer width and legacy spatial filters retain fixed per-sample constants in places. Use rate-aware coefficient definitions instead of assuming all code is fully rate-invariant.
- Enhancer's MSVC build uses `/arch:AVX2` globally. Its renderer SIMD setting does not establish broad CPU compatibility for the executable. Keep a compatible baseline or runtime-dispatched build.
- Enhancer Harmonic Air, exciter, and compressor keep their dry delays active at zero amount. This helps transitions but means "off" can be delayed unity rather than zero-latency whole-graph bypass.
- Enhancer correction/convolution code is present but actual measured IR availability must still be checked. Reuse the math and tests, not unsupported marketing assumptions.
- The two codebases share FFT storage assumptions. Validate allocation success, supported PFFFT transform sizes, required alignment, and ownership/copy restrictions before extending the convolver. Preallocate aligned buffers if required by the backend.
- Existing Enhancer checks prove selected invariants, not personalized front/back/height perception, full true-peak compliance, mobile performance, or full-chain neutral output.
- More pronounced directional-band EQ, stronger wet fields, or scarcity boosts are aesthetic choices. Default strength requires level-matched music evaluation.

## 11. Target Architecture and Control Contract

### 11.1 Reusable DSP core

Create one maintained DSP library, consumed by each application through its own adapter. Avoid two independently edited copies of the same filters.

```text
Player transport                  Enhancer live input
decode / seek / EOS               duplex / capture recovery
            \                    /
             prepared stereo PCM
                       |
              common DSP processor
              common parameter schema
              common tests and version
                       |
          application-specific output adapter
```

The initial port can keep Player's miniaudio node graph while extracting common nodes. A later block-processor API can reduce duplicated graph ownership if measurements justify it. Replacing all transport and graph code at once is unnecessary.

### 11.2 Proposed interface for review

```cpp
struct DspPrepareSpec {
    uint32_t sampleRate;
    uint32_t channels;          // Initially 2; explicitly validated.
    uint32_t maximumBlockSize;
};

// Exact definitions/versioning would be agreed during implementation.
bool prepare(const DspPrepareSpec& spec, PreparedAssets assets);
void publishParameters(const DspParameters& snapshot, uint64_t generation);
void process(const float* input, float* output, uint32_t frames) noexcept;
void reset(ResetReason reason); // Safe lifecycle context / acknowledged handoff.
DspStatus status() const;
```

This is a design sketch, not a patch already applied. `prepare` may allocate; `process` must not allocate, block, decode, read files, log, prepare IRs, or destroy resource banks. Snapshot publication needs a proven preallocated exchange protocol. A reset touching large buffers must not race a callback.

### 11.3 Units and compatibility

| Current Player control | Current meaning | Proposed explicit meaning |
| --- | --- | --- |
| BASS | Rough normalized 0-1.5 drive, direct unsmoothed global | Bounded Bass Drive; separate optional bass cut in dB |
| TREBLE | Added linear high-band gain | Treble shelf gain in dB with smoothed coefficients |
| UPSCALE | Exciter drive times four, processing gate currently inactive | Tube Exciter enable + normalized amount |
| RESTORE_UPSCALE | Treble synthesis amount | Harmonic Air enable + normalized amount |
| RESTORE_PRESENCE | High-band scaling in restoration | Distinct from Vocal Frontness at 2.5 kHz |
| FIRGAIN | Three linear band gains | Versioned EQ settings; new shelf/presence units defined separately |
| 3D | Legacy spatial intensity times 0.5 | Spatial Separation applied to active renderer |
| DEPTH | Legacy directional-band depth | Depth applied to active renderer with documented mapping |
| SPEAKER9D_BASS | Old 9D room-sub reflection toggle | Independent Compact/Room + Bass Field amount |
| LIMITER | Boost `1 + 1.2 * amount`, resets envelope | Separate Loudness Boost and final protection settings |
| VOLUME | Endpoint post-limiter gain | Smoothed master attenuation before final limiter |
| HEADPHONE_CORRECTION | File path, optimistic activation | Prepared correction bank ID with rate/hash/availability status |

Do not silently interpret old saved numbers in new units. Convert old linear EQ gains with a deliberate policy, e.g. `20*log10(gain)` only where that old control truly represents a gain. A three-way crossover EQ is not acoustically identical to one shelf, so preserving user intent requires retuning, not only a numeric conversion.

### 11.4 Recommended operating modes

- **Reference:** original decoded PCM, explicit resampling/output policy, all enhancement bypassed, safe volume. If a protection stage remains, disclose its threshold and delay. Exact source-bit output requires a separate verified rate/format mode.
- **Clear:** modest intentional tone/presence, low or zero harmonic additions, compact bass, minimal room, conservative peak limiting.
- **Headphone Spatial:** original stereo bed plus bounded HRTF ambience; correction validated for the selected headphone; adjustable separation/depth; direct bass by default.
- **Small Speaker:** independent rate-aware protection, calibrated virtual bass, restrained stereo processing, one final limiter.
- **Custom:** explicit applied-state controls, no automatic profile overwrite without a defined user policy.

## 12. Implementation Order and Review Gates

### Phase 1: Establish a truthful and testable baseline

1. Document the active Tauri DSP library and fix obsolete test source/build ownership.
2. Create production-linked offline tests before changing sound algorithms.
3. Correct the metrics schema and native actual EOF behavior.
4. Make automatic SBR opt-in; correct indexing, short-window panic, and identity reconstruction before enabling it again.
5. Define Reference behavior and parameter units, including preserved legacy settings.

**Exit criteria:** playback controls and status agree; short clips do not crash; no unintended SBR in Reference; decoded PCM and reference output match under the declared conversion/delay contract; track endings are not truncated.

### Phase 2: Make rendering deterministic and safe

1. Move shared control writes to validated atomic targets/snapshots with audio-owned state.
2. Remove callback allocation, deletion, and shared analysis mutex waits.
3. Define stereo IR-bank ownership and full reset/adapter-buffer clearing.
4. Correct supported-rate/delay capacities and checked initialization.
5. Port corrected oversampling and final limiter together with pre-limiter master gain.

**Exit criteria:** no callback heap operations or blocking locks in owned DSP; finite output at extreme controls; repeatable behavior across block sizes; sample ceiling respected; resets do not replay old samples; supported rates prepare correctly.

### Phase 3: Port clear tone, bass, and dynamics

1. Port independent loudness filters and shelf/presence EQ.
2. Port complete bass node/preparation, sub anchor, field, and protection profiles.
3. Port corrected exciter, Harmonic Air, and compressor transitions.
4. Recalibrate Player presets and freeze a reviewed Clear default.

**Exit criteria:** independent L/R paths where expected; monotonic bass controls; neutral settings reconstruct as intended; no unexplained gain jumps; level-matched music checks show no repeated vocal masking or transient softening.

### Phase 4: Port room and spatial methods

1. Integrate renderer library/assets in Tauri, including failure/status reporting.
2. Port diffuse residual extraction and bounded six-feed HRTF ambience.
3. Route separation/depth to the active mode; decide true Stereo bypass semantics.
4. Port additive stereo reverb and room/damp controls.
5. Validate combined spatial/width/reverb headroom and headphone/speaker defaults.

**Exit criteria:** direct coherent vocal bed preserved in offline tests; HRTF unavailable path retains dry playback; zero separation bypass works; only one spatial owner; stereo/mono/anti-phase material remains finite and intelligible; CPU deadline budget holds.

### Phase 5: Finish the Player advantages

1. Worker/streaming decode with cancellation, bounded memory, next-track preparation, and correct resampler tail accounting.
2. Correct-rate/full-length IR preparation; regenerate and verify headphone assets.
3. Complete applied-state persistence and device recovery with source-position preservation.
4. Add graph latency, final-output diagnostics, and optional proven track loudness normalization.
5. Verify native Tauri packaging and separately validate Android architectures.

**Exit criteria:** actual Tauri playback verified, correct track lengths, stable hardware changes, assets load at advertised rate, and a sustained mixed-feature playback run passes.

Each phase should produce a small reviewable code diff plus measured results. The report is authorization to plan and assess; it does not assume approval of the proposed sonic defaults.

## 13. Verification Matrix

| Area | Test inputs / triggers | Required observations |
| --- | --- | --- |
| Reference decode | WAV/FLAC and representative MP3/AAC/Ogg; mono/stereo | Correct source length/channels/rate; no hidden synthesis; documented fallback |
| SBR | Full-band/no-cliff clips with 1-4 windows; detected-cliff stereo | No panic; independent channel writes; unity identity OLA; no boundary gain jumps |
| Resampling | First/last impulse; lengths around 4096 multiples | Correct expected output length; no missing tail; measured response/gain |
| Oversampler | Impulse, DC, high-frequency tones, two tones | Reported/measured delay agree; unity DC; bounded imaging/aliasing and IMD |
| EQ/loudness | L-only/R-only impulses; zero/nonzero controls | Silent opposite channel stays silent for independent filters; no reset artifacts |
| Bass | 30-180 Hz tones, kick bursts, anti-phase bass, weak/strong masters | Monotonic drive; no narrow-band cancellation; direct stereo retained; limits finite |
| Speaker profiles | Zero/nonzero drive, 30/40/55/100 Hz inputs | Protection works independently; intentional gain/rolloff measured |
| Compressor | Unity settings, vocal bursts over sustained bass | Stable declared delay; smooth enable/disable; bounded pumping |
| Reverb | Centered and L/R impulses, max room/wet | Dry onset preserved; finite tail; both channels excite appropriately; room/damp audible |
| Spatial | Coherent vocal, L-only/R-only, diffuse/anti-phase sources | Preserved direct bed, bounded wet energy, zero-separation bypass, failure fallback |
| IR/correction | Identity IR, asymmetric stereo IR, long tail, reload burst | Correct-rate response, complete intended tail, one L/R generation, no unsafe reclamation |
| Resets/transport | Seek during music, pause/resume, stop/load, rapid skipping | No stale adapter output, old tails, lost samples, or uncontrolled click |
| Limiter | Bursts, reconstructed intersample peaks, extreme boost, NaN/Inf | Finite output; sample and separately estimated true peak meet targets; correct recovery |
| Presets | Rapid taste/device/profile changes; restart | One coherent native snapshot; requested/applied state agree; device calibration persists |
| Callback partitions | Same PCM/events through varied frame sizes | Equivalent result within agreed float tolerance and declared latency |
| Rates | 44.1/48/96 where supported; unsupported 192 request | Valid delay storage/filters/IRs; full verification or explicit rejection |
| Performance | Worst combined DSP, long IR, silence tails, heavy visualizer | No callback allocations/locks; callback p99/max tracked; no observed underruns |
| Device lifecycle | Unplug/replug, rate change, sleep/resume, failed reopen | Serialized recovery, fade, preserved position/state, no repeated restart loop |
| Packaging | Clean native install/dev; missing library/asset | Correct native DSP version; availability/status accurate; working dry fallback |

Proposed engineering targets, to be agreed and measured rather than presented as current results:

- Independent filter leakage should be exactly zero in the simple zero-input opposite channel fixture.
- Neutral-node PCM differences should be zero or within approximately 1e-6 where float arithmetic is unavoidable, after explicitly aligning latency.
- No NaN/Inf should reach the output, and the agreed limiter sample ceiling must always hold. True peaks need an independent reconstruction test.
- Parameter timing should be invariant to callback partitioning for the same sample-indexed automation.
- Worst DSP callback duration must stay below its deadline. A practical initial target is p99 below half the deadline with no overruns in a sustained run; this is a budget to validate, not a guarantee from source inspection.
- For example, 480 frames at 48 kHz allows 10 ms, while 128 frames allows about 2.67 ms. A 96 kHz mode halves the deadline for an unchanged frame count.
- Measure total latency separately from source cursor, processing delay, device buffering, and HRTF wet-tail behavior.
- Compare perceived quality with level-matched A/B across quiet/dynamic classical, dense pop, percussion, vocals, bass-light material, bright masters, and several headphones/speakers.

## 14. Remaining Evidence and Product Boundaries

The following remain unverified in this audit: full Player native compilation, listening preference, physical endpoint rate/format, exact DAC output peaks, full-chain latency/CPU, Android renderer availability/performance, correction measurement provenance, and gapless codec handling. The existing Enhancer tests are useful reference evidence, not substitutes for Player transport/hardware validation.

Avoid claims of recovered original objects, guaranteed externalized height/360 localization, universally distortion-free maximum loudness, exact acoustic loudness compensation from a software slider, or restored lossless information. The inspected implementations do not establish these properties. Source-quality labels, "FIR", "Sinc", "FFT Denoise", and "9.1" should match actual algorithms and output channels.

The best achievable closeness is shared validated DSP behavior at a matched graph rate, using the same parameters/assets, feeding equivalent PCM, and reaching the same physical output without another unintended enhancer. The Player may actually have a cleaner source path because it owns decoding and can avoid a virtual-cable stage. A different master, endpoint path, output rate, gain, or headphone profile can still make the two applications sound different.

## 15. Source Index and Reproduction Notes

### Player sources

- [Native build](../music-player-ui/src-tauri/build.rs): authoritative compiled source set, optimization and rebuild rules.
- [Core graph/device initialization](../audio-engine-cpp/EngineCore.cpp): order, rate initialization, device start, final output.
- [DSP processing](../audio-engine-cpp/DSP_Nodes.cpp): actual equations, bypasses, scratch allocation, limiter, reset paths.
- [DSP state/types](../audio-engine-cpp/DSP_Nodes.h): buffer capacities, loudness channel state, filter topology.
- [Command/data-source bridge](../audio-engine-cpp/CommandParser.cpp): controls, source locking, IR publication, analysis, seeking.
- [Oversampler](../audio-engine-cpp/Oversampler.h): interpolation/decimation and declared delay.
- [Convolver/adapter](../audio-engine-cpp/FFTConvolver.h): partitioned FFT and queued-block timing.
- [Current spatial matrix](../audio-engine-cpp/NineSpeakerUpmixer.h): hand-designed virtual speakers and bass room.
- [Directional filters](../audio-engine-cpp/DirectionalBands.h): coefficient updates and histories.
- [Telemetry](../audio-engine-cpp/Telemetry.cpp): band/phase meters and block-based smoothing.
- [Rust native commands/decoder](../music-player-ui/src-tauri/src/lib.rs): source decode, conversion, metrics layout, asset loaders.
- [Offline SBR](../music-player-ui/src-tauri/src/sbr.rs): indexing, cutoff, reconstruction.
- [Player control orchestration](../music-player-ui/src/App.tsx): metrics consumption, presets, startup/load replay.
- [Profiles](../music-player-ui/src/config/audio.ts): fingerprint thresholds and taste/gain values.
- [DSP UI](../music-player-ui/src/components/player/ExpandedPlayerUI.tsx): control wiring and algorithm labels.
- [Mobile expanded UI](../music-player-ui/src/components/player/MobileExpandedPlayer.tsx): platform-specific controls/loading.
- [Correction generator](../scripts/generate_headphone_inverses.py): inverse design, sample-rate labeling, output format.
- [Existing harness](../audio-engine-cpp/tools/dsp_harness.cpp): current syntax incompatibilities.

### Enhancer reference sources

- [EngineCore.cpp](C:/DmeX-Enhancer/engine/src/EngineCore.cpp): preparation, rate checks, lifecycle, output probes/fade.
- [DSP_Nodes.cpp](C:/DmeX-Enhancer/engine/src/DSP_Nodes.cpp): corrected EQ, bass, limiter, dynamics, reverb, and air.
- [DSP_Nodes.h](C:/DmeX-Enhancer/engine/src/DSP_Nodes.h): new state and buffers.
- [Oversampler.h](C:/DmeX-Enhancer/engine/src/Oversampler.h): corrected FIR implementation.
- [NineSpeakerUpmixer.h](C:/DmeX-Enhancer/engine/src/NineSpeakerUpmixer.h): dry-preserving ambient rendering.
- [SteamAudioHrtf.cpp](C:/DmeX-Enhancer/engine/src/SteamAudioHrtf.cpp): binaural wrapper and creation status.
- [main.cpp](C:/DmeX-Enhancer/engine/src/main.cpp): validated controls, persistence, status and recovery commands.
- [DSP test source](C:/DmeX-Enhancer/engine/tests/dsp_tests.cpp): 69 existing offline assertions.
- [CMakeLists](C:/DmeX-Enhancer/engine/CMakeLists.txt): native library/assets/test build integration.
- [HRTF notice](C:/DmeX-Enhancer/engine/assets/hrtf/NOTICE.md): bundled dataset attribution; verify distribution terms when porting.
- [Earlier Enhancer audit](C:/DmeX-Enhancer/docs/closed-testing-audit-2026-10-10.md): reference limitations and prior test record, checked against current source rather than assumed authoritative.

Re-run the existing Enhancer binary without starting its audio service:

```powershell
cd C:\DmeX-Enhancer\engine\build-audit\Release
.\dmex-dsp-tests.exe
```

The header diagnostic used the same input procedures in both builds: default `Oversampler4x::init`, 512 samples of unit L impulse / silent R, 4096 samples of L=1 and R=-0.5 after reset, and `EqualLoudness::init(48000)` followed by `update(0.25)` and a 4096-frame left-only impulse. The adapter check filled an identity 512-frame stereo block with an impulse, reset only `fill`, then processed a silent block. All diagnostic execution stayed offline. Temporary diagnostic files were not application changes.

No sound implementation described in this report has been applied. The next useful implementation is Phase 1 followed by the coupled oversampler/limiter and channel-state corrections, with each phase reviewed against measured evidence.
