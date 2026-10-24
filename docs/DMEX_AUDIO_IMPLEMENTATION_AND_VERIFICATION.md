# DmeX Player: Audio Implementation and Verification

Date: 2026-10-12

UI/visualizer correction verified: 2026-10-13 (section 11).

Workspace: `C:\DmeX-Player`

Reference: `C:\DmeX-Enhancer\engine\src`

Baseline: Player commit `a0e5589`; implementation is uncommitted working-tree changes.

## 1. Comparison With the Supplied Analysis

The supplied `Pasted text.txt` and the original [53-finding audit](DMEX_PLAYER_ENHANCER_AUDIO_AUDIT.md) are identical after whitespace normalization. The supplied analysis therefore adds no independent findings to that baseline. A repeat comparison confirmed 53 finding headings in the audit and an identical normalized baseline.

Implementation and testing revealed additional integration defects. They are recorded in section 7 below. The original audit remains historical evidence; its old line references do not describe the edited checkout.

This document distinguishes implemented code, executed tests, and remaining validation. It does not claim that every requirement in the original audit has been experimentally completed, that all devices are glitch-free, or that this is objectively the world's best-sounding player.

## 2. What Now Runs

The CMake test target and Tauri build use the same production C++ source files:

```text
EngineCore.cpp
CommandParser.cpp
DSP_Nodes.cpp
SteamAudioHrtf.cpp
Telemetry.cpp
pffft.c / pffft_common.c
```

`main.cpp`, old snapshots, backup files, and the original obsolete harness are not evidence for this implementation. They are not the production test target.

The enhanced signal path is:

```text
Symphonia packet decoding on a worker
 -> optional sinc source-rate conversion on the worker
 -> versioned float32 PCM disk cache
 -> miniaudio streamed source
 -> Harmonic Air
 -> acoustic IR
 -> independent stereo shelf/presence EQ
 -> linked compressor
 -> bass enhancement and optional speaker profile
 -> oversampled exciter
 -> bass-safe widening
 -> dry-preserving spatial ambience
 -> disabled legacy spatial stage
 -> algorithmic reverb
 -> headphone EQ
 -> volume/boost and final limiter
 -> meter
 -> unity endpoint
 -> shared-mode stereo device
```

The Enhancer remains fundamentally different: it processes a live capture stream. The Player owns decoding, files, caches, seeking, track boundaries, playlists and metadata. No virtual-cable installer, system-default routing modification, or service installation was copied into the Player.

## 3. Bypass All Contract

The one-click control is a compact power toggle in **Track Options** (the expanded player's three-dot menu). It no longer occupies the mini-player or expanded-player header. Its pressed state indicates Raw Stereo; its tooltip states the unity-gain contract.

```text
Source file
 -> Symphonia decoding to float32 PCM at the original source rate
 -> streamed sound source with spatialization/pitch disabled
 -> unity engine endpoint
 -> stereo device
```

- The entire Player DSP chain is disconnected, including limiter, correction, reverb, widening, speaker processing, Harmonic Air, bass, compressor and spatial renderer.
- No automatic SBR synthesis runs during decoding, in either raw or enhanced mode.
- Player volume and boost do not attenuate or amplify the raw path. Enhancement values are retained for restoration, not applied to raw output.
- The graph uses the decoded track's original rate in raw mode. Returning to enhanced mode restores the selected enhanced rate and reloads the appropriate prepared source.
- Current position and prior playback state are restored around a mode change. This reload can take time when the required PCM cache does not yet exist. It is not advertised as a seamless, zero-latency switch.
- Enhancement controls are disabled while raw mode is active. The engine exposes its actual bypass state, rather than relying solely on a frontend label.
- An offline production-graph null test preserves independent L/R float samples at unity within `1e-6`, even with every effect configured and stored Player volume at 10%. The fixture deliberately includes samples above unity to prove that the Player limiter is bypassed.

### Important Boundaries

Raw means unenhanced **decoded float32 stereo inside this application**, not a bit-perfect file-to-DAC or exclusive-output certification. Decoding, mono-to-stereo duplication where necessary, float precision, the operating-system mixer, driver conversion, hardware volume, Bluetooth codecs, external DmeX Enhancer processing and the DAC remain outside this bypass guarantee. Int32/float64 sources cannot retain all their original precision through a float32 pipeline.

Unity raw output can be louder than a previously attenuated enhanced setting. Use system/hardware volume before comparing. A source already exceeding full scale can still clip downstream; raw bypass intentionally does not modify it to prevent that.

## 4. Shared Controls and Defaults

Desktop and Android share a validated 20-value settings contract, not an all-in-one menu. `TrackOptions` holds quick bass/treble/boost, background, stage, routing, output and headphone controls. The distinct Fine-Tune DSP surface retains its studio/cinematic/relax presets and core processing controls via `AdvancedAudioPanel`.

| Control | Native Range / Semantics |
| --- | --- |
| Bass Drive | 0-2.1 internal; displayed as 0-100% |
| Sub-Bass Anchor | 30, 40, 52, 60, 70, 80 Hz |
| 3D Room Bass | Independent enable |
| Bass Field | 0-1; independent of drive |
| Treble | -12 to +12 dB stereo shelf |
| Vocal Frontness | 0-1 presence EQ, not source separation |
| Tube Exciter | 0-1 oversampled harmonic delta |
| Harmonic Air | 0-1 bounded oversampled addition, not lost-data recovery |
| Studio Compressor | Linked upper-band compression enable |
| Adaptive Loudness | Independent channel filter histories |
| Loudness Boost | 0-1 intentional pre-limiter gain |
| Spatial Stage | Enable independent of separation/depth |
| Spatial Separation | 0-1 dry-preserving ambience |
| 3D Depth | 0-1 renderer depth control |
| Stereo Width | 1-2.5x bass-safe side widening |
| Reverb Mix | 0-1 additive algorithmic room |
| Room Size | 0.2-0.98 |
| Damping | 0-0.95 |
| Hardware Profile | Headphones/line out, laptop, phone speaker |
| Player Volume | 0-1, before final protection in enhanced mode |
| Headphone EQ | Bundled model-named inverse-response presets or Off |
| Acoustic IR | Complete bundled response or paired independent L/R responses |
| Processing | Eco / Full |
| Output Rate | 44.1 / 48 kHz; 96 kHz additionally available on desktop |
| Background | Ambient / Spatial |
| Reconnect Output | Explicit serialized device recovery |

The default is mild Bass Drive `0.25`, 52 Hz anchor, unity volume, width 1, and other enhancement amounts/enables at zero. `Neutral`, `Clear`, `Spatial`, and `Relaxed` presets are deliberate atomic settings changes. Presets preserve volume, anchor, hardware profile and loaded IR selections unless explicitly changed.

Versioned settings, quality, rate, raw mode and IR selections are retained. Native status is authoritative for actual values. Rapid slider updates are coalesced without crossing transport-command boundaries, and stale status responses cannot overwrite newer local edits.

Legacy genre fingerprints remain metadata hints. They no longer automatically select a mastering preset on each track. Misleading FIR/linear-phase and codec-restoration controls were removed from the new panel. Profile-off labels say Manual rather than falsely saying Raw.

## 5. DSP and Lifecycle Changes

### 5.1 Stereo, Tone and Bass

The reference oversampler, independent loudness filters, shelf EQ, presence EQ, bass delta processing, analysis branches, rate-derived ballistics, transient handling, scarcity estimation, six sub anchors and independently controlled bass reflections were transferred together. Neutral bass/EQ tests preserve stereo rather than reconstructing the entire master through unnecessary crossovers.

Bass analysis is energy tracking, not pitch detection. Scarcity enhancement cannot recover content that was absent from the source. Generic speaker profiles are software filters, not per-device acoustic calibration or a guaranteed loudspeaker protection specification.

### 5.2 Spatial Rendering

Windows x64 Full mode uses the bundled Steam Audio runtime and measured SOFA profile. SDK initialization failure falls back to the lightweight renderer, with actual renderer type exposed in status.

Eco mode and Android use a six-source lightweight ITD/head-shadow renderer. It preserves the direct bed and adds bounded decorrelated ambience. It does not provide the measured profile's vertical localization. Full on Android still uses this portable renderer; the Windows SDK is not linked into ARM builds.

The old spatial stage is neutralized so it cannot re-render the stereo master behind the new stage. Depth and separation reach the active renderer. Room bass is separate from the spatial stage.

### 5.3 Dynamics and Timing

Volume/boost are before final detection and metering. The limiter uses corrected release/hold behavior, oversampled detection and finite-sample handling. The tested safety bound is a sample ceiling near -1 dBFS. The tests do not certify an independent standardized true-peak or loudness meter.

Compressor and oversampled dry paths retain their compensation delays in enhanced mode. Both 512-frame adapted IR stages retain their algorithmic delays even when unloaded or bypassed; off/on no longer changes those adapter delays. Eco skips unused nonlinear shaping while retaining inexpensive dry delays.

At 48 kHz, the declared fixed graph delay is `1024 + 40 + 48 + 96 = 1208` frames, about 25.2 ms. Raw graph delay is zero. These values exclude the device queue, OS output latency, IR-specific onset/phase, reverb tails and source-preparation time. All-inclusive measured output latency is still a hardware test requirement.

### 5.4 IR Preparation and Calibration Assets

IR files use a dedicated worker-side sinc conversion path at the actual graph rate. Their coefficients are scaled by source-rate/output-rate so conversion does not accidentally increase filter gain. Leading and trailing 128-source-frame padding preserve the sinc response, including pre-response and the final tail. Padding is intentional filter latency, not sample-rate labeling.

The native loader reads complete responses up to a four-second source budget plus bounded conversion padding, prepares both stereo banks before activation, and replaces/deletes banks only while callbacks are stopped. No IR allocation or ownership change occurs in the audio callback. Banks are rebuilt after rate changes. Missing restore assets disable that bank and raise a status warning rather than making the entire engine permanently unrecoverable.

The generator now writes real float32 WAV coefficients at their design rate. Eight supplied models use 44.1 kHz and two use 48 kHz. All ten saved/reloaded outputs are checked against freshly designed coefficients. A generated manifest records rate, channels, length, SHA-256, coefficient peak, maximum response gain and provenance limits.

The inverse responses are based on existing bundled files. Their measurement rig, exact hardware variant and source licensing were not established. They must be treated as EQ presets, not certified calibration. Unsubstantiated model-variant labels and the swapped paired headphone-IR path were corrected. The two-convolver topology is independent stereo filtering, not a four-channel true-stereo BRIR matrix or a licensed Dolby Atmos decoder.

### 5.5 Decoding and Transport

Decoding is packet-based on a worker with bounded in-memory buffers. Completed PCM WAV caches stream through miniaudio; the Player no longer keeps an entire long decoded track in RAM. Cache validation rejects incomplete/corrupt files. Cache eviction targets 512 MiB, but the currently prepared file is retained even if it alone exceeds that target. The RIFF format also imposes a roughly 4 GiB decoded-file limit.

The first playback of an uncached file still waits for full worker-side preparation. Progressive decode, seamless cross-track gapless output and queue prewarming have not been implemented. This is a material remaining product limitation, not a solved instant-start requirement.

Sinc conversion flushes final samples and preserves declared output length. Impulse tests additionally exposed and corrected a premature lookahead trim that advanced converted tracks. Cache version 4 prevents reuse of the earlier misaligned conversion.

Decode errors and format changes fail explicitly rather than silently shortening tracks. Supported decoded layouts are mono/stereo at 22.05-96 kHz; multichannel and higher-rate sources require an explicit future downmix/rate policy.

Native EOF plus bounded processor drain replaces early duration-threshold inference. It prevents the original premature-next-track trigger, but long effect tails and gapless transitions still need a more complete policy. Seeking resets queues, convolution histories, oversamplers, crossover histories, spatial buffers and limiter state.

The callback never takes the lifecycle lock. Transport/graph changes are serialized separately. Parameter snapshots are consumed with a non-blocking try-lock at block boundaries. Tauri status/metric queries run on workers, preventing long preparation from blocking the native UI thread. Analysis uses independent file decoders; bulk classification no longer executes LOAD on the live player.

Android headphone-disconnect handling requests immediate callback mute and schedules transport pause off the Android UI thread. Late pause requests cannot override a subsequently cleared native pause request. Explicit Play is distinguished from automatic playback so an already queued load cannot silently resume after disconnection. Physical unplug/Bluetooth tests remain necessary.

## 6. Optimization and Diagnostics

- ARM64 enables the FFT library's existing NEON implementation. ARMv7 retains the conservative scalar path rather than requiring unsupported instructions.
- There is no forced AVX2 compilation for the application DSP. Steam Audio selects supported CPU instructions up to its configured maximum.
- Android defaults to Eco; desktop defaults to Full. Eco avoids the measured renderer and skips zero-amount nonlinear shaping, with retained dry timing.
- Default device periods are 20 ms in Android/Eco initialization and 10 ms in Full initialization, with three requested periods. Changing the quality renderer alone does not rebuild an already-open device's period configuration; Reconnect Output does.
- Ambient animation remains requestAnimationFrame-driven with no application FPS limiter. Rendering is bounded by WebView/display scheduling, not an unlimited physical frame-rate guarantee.
- Hidden/collapsed backgrounds skip expensive work. Canvas sizing occurs through ResizeObserver/resize handling rather than per-frame layout reads. Motion is time-based across display refresh rates.
- Existing particle counts and size rules were retained: desktop's current 500-particle/sprite behavior and Android's 40 fixed 1-5 px motes. Android motes now use the supplied theme rather than reading the wrong DOM attribute each frame.
- Status exposes actual graph rate, requested rate, raw/quality/renderer state, output peak, limiter gain, processing delay, IR availability and device-recovery requests.
- Callback load and maximum callback load are percentages of the render-time buffer budget. Over-budget callbacks are counted. These are application timing observations, not a measured driver-xrun count or total CPU utilization.

The production frontend build still reports a roughly 516 kB main JavaScript chunk. Broader lazy-loading is a future startup optimization; it was not hidden by raising Vite's warning threshold.

## 7. Additional Findings Discovered During Implementation

| ID | Defect | Correction / Evidence |
| --- | --- | --- |
| N01 | Raw mode could retain source rate after exit | Restore selected enhanced rate; native regression and desktop UI transition verified |
| N02 | Graph rebuild discarded loaded IR banks | Remember/reprepare both banks and wet/strength settings |
| N03 | Nested suspension could resume an outer-stopped graph | Suspension guard only resumes if it owned the running state |
| N04 | Slider application paused the audio device | Publish parameter packets; callback consumes targets without waiting |
| N05 | Old asynchronous status overwrote new edits | Revision, mutation and request guards; command-boundary-aware coalescing |
| N06 | Android ARM64 C-char signedness broke status FFI | Use platform c_char; ARM64 compilation passed |
| N07 | ARM64 FFT silently used scalar implementation | Enable existing NEON path; compiler confirmed it |
| N08 | Synchronous Tauri telemetry could freeze the UI during LOAD | Worker-backed status and metrics |
| N09 | Bulk classification replaced the live sound source | Independent file preparation/analysis command |
| N10 | IR SRC changed coefficient gain | Dedicated sinc conversion, area scaling, gain/response tests |
| N11 | Lookahead trimming advanced resampled tracks | Measured impulse alignment corrected; new track/IR tests; cache v4 |
| N12 | Android noisy broadcast could wait on long decoding | Atomic output mute plus worker-side conditional pause |
| N13 | Automatic queued PLAY could resume after disconnect | Explicit PLAY_USER resume contract |
| N14 | Paired headphone spatial IR had L/R paths reversed | Corrected the asset mapping |
| N15 | Failed/corrupt cache could be reused | Header/size checks plus regeneration regression |
| N16 | Missing IR restore could strand engine initialization | Disable failed bank and expose warning |
| N17 | Fast track changes could briefly play the superseded request | Advance request ID before awaited STOP and check it before LOAD/PLAY |
| N18 | Keyboard shortcuts intercepted new select/button controls | Ignore interactive targets |
| N19 | Restored background mode disagreed with the new selector | Shared persistence/event synchronization |
| N20 | Errors outside the settings panel were silently swallowed | Shared error events and visible audio-error banner; no blind playback retry |

## 8. Original Finding Status

`Implemented` means code was changed and relevant automated checks were run, not universal hardware validation. `Partial` identifies deliberately remaining requirements.

| Finding | Status | Outcome / Remaining Boundary |
| --- | --- | --- |
| F01 | Implemented | No automatic SBR in production decoder; raw graph disconnects DSP |
| F02 | Implemented | Dormant SBR channel indexing fixed; production does not call it |
| F03 | Implemented | Empty cutoff hits guarded; short-clip tests |
| F04 | Partial | Dormant SBR overlap/channel fixes; no claim of restored codec information or complete restoration quality |
| F05 | Implemented | Correct reference oversampler and measured compensation |
| F06 | Implemented | Independent L/R loudness histories |
| F07 | Implemented | Correct limiter release/hold behavior |
| F08 | Implemented | Enhanced volume before final limiter/meter; unity raw endpoint |
| F09 | Implemented | Streamed playback separate from worker analysis; callback does not wait on analysis lock |
| F10 | Implemented | IR preparation/deletion outside callback |
| F11 | Implemented | Stereo bank swap while callback stopped; no concurrent deletion |
| F12 | Implemented | Atomic targets and serialized lifecycle, callback-owned processing state |
| F13 | Implemented | Queues and processing histories reset together |
| F14 | Implemented | Graph/source rate bounds and bounded delay sizing |
| F15 | Implemented | Numeric validation, finite/range checks and contained command exceptions |
| F16 | Implemented | Real oversampled exciter amount and zero-drive dry behavior |
| F17 | Implemented | Honest shelf/presence EQ; misleading FIR UI removed, no new FIR feature claimed |
| F18 | Implemented | Explicit vocal-frontness control; no hidden remaster spectral preset |
| F19 | Implemented | Bass delta added to original stereo; neutral tests |
| F20 | Implemented | Rate-aware analysis, persistent cadence, transient/scarcity tracking |
| F21 | Implemented | Six anchors plus independent field/room controls |
| F22 | Partial | Generic speaker processing independent of drive; acoustic protection not calibrated per phone |
| F23 | Implemented | Linked compressor smoothing and constant lookahead path |
| F24 | Partial | Unified final limiter; no independent standards-grade true-peak/physical endpoint certification |
| F25 | Implemented | Harmonic Air with honest naming; denoiser removed from new options |
| F26 | Implemented | Dry-preserving spatial ambience rather than master replacement |
| F27 | Implemented | Depth/separation reach active renderer |
| F28 | Partial | Windows SDK/SOFA/runtime packaging implemented; Android uses lightweight renderer, not measured height |
| F29 | Implemented | Correct reference all-pass behavior; impulse energy tests |
| F30 | Implemented | History-preserving directional update method |
| F31 | Implemented | Stereo additive reverb preserves dry onset; damping/room tests |
| F32 | Partial | Bounded spatial design and final protection; exhaustive combined-control listening/mono tests remain |
| F33 | Implemented | Sinc IR preparation at actual rate, gain normalization and reload |
| F34 | Implemented | Full response within explicit four-second/padding budget; no 2048-frame truncation |
| F35 | Documented | Independent L/R IRs retained; four-channel BRIR feature not implemented |
| F36 | Implemented | Generated WAV uses actual filter-design rate |
| F37 | Implemented | Float32 export, PCM-int32 reader correction and ten round-trip checks |
| F38 | Partial | Manifest/order/availability documented; source measurements and licenses still unverified |
| F39 | Partial | Fixed adapter bypass delay and matched blends; IR-specific phase/onset and seamless bank crossfade remain |
| F40 | Partial | Worker/packet decode and bounded RAM; first uncached full preparation still delays start |
| F41 | Implemented | Errors/rate changes reject rather than silently shortening track |
| F42 | Implemented | Exact length, final flush, impulse alignment and IR tail tests |
| F43 | Partial | Named metrics/native EOF with drain; gapless and arbitrary long-tail policy remain |
| F44 | Partial | Correct rate normalization and channel peak; fingerprint is still a heuristic, not reliable genre recognition |
| F45 | Implemented | Genuine separate raw mode; neutral preset and truthful Manual label |
| F46 | Implemented | Validated coherent preset/settings transaction at block boundary |
| F47 | Implemented | Native-backed shared state and persistent settings/assets |
| F48 | Partial | Explicit shared stereo configuration/actual graph rate; exclusive mode/device controls not implemented |
| F49 | Partial | Checked serialized lifecycle and manual recovery; physical device-loss tests remain |
| F50 | Implemented | Reference per-sample/rate-aware smoothing and motion cadence |
| F51 | Implemented | Production source/header dependencies and runtime resources tracked |
| F52 | Partial | Uncapped rendering, hidden-work suppression and canvas sizing fixes; no sustained phone frame-time benchmark |
| F53 | Partial | New native timing/rate/peak/status telemetry; LUFS, standardized true peak and actual driver xruns remain |

## 9. Verification

Executed checks at the completion of this implementation:

| Check | Result |
| --- | --- |
| Normalized supplied-analysis comparison | Identical original baseline; 53 findings |
| Windows Full production-DSP harness | 94 checks passed |
| Portable/no-Steam-Audio DSP harness | 94 checks passed |
| Rust unit suite | 7 tests passed, including source/IR impulse alignment, final flush and cache regeneration |
| TypeScript / Vite production build | Passed; main-chunk size warning remains |
| Android ARM64 cargo check with installed NDK | Passed; NEON compiler path confirmed |
| Android ARMv7 cargo check with installed NDK | Passed; conservative scalar FFT path |
| Headphone-filter export verification | All 10 filters passed format/rate/finite/exact coefficient checks |
| Native Windows Tauri launch | Launched through npm run tauri dev |
| Native desktop UI checks | Shared controls visible; raw 44.1 kHz switch, disabled effects, and enhanced 48 kHz restoration confirmed |
| Windows NSIS release packaging | Built with SDK DLL and resource mapping; no installation performed |

The C++ harness stubs the Rust preparation FFI to isolate native graph behavior. It does **not** validate Rubato through that stub; the separate Rust tests validate source/IR conversion. Neither harness captures analog sound from the physical output.

No Android phone/emulator playback run, APK install, sustained thermal/battery test, Bluetooth reconnection test, external loopback capture, personalized HRTF listening evaluation, LUFS compliance test, or exhaustive peak/mono test matrix was performed. Cross-compilation is not a substitute for these checks.

### Reproduction Commands

```powershell
# Production DSP tests
cmake -S C:\DmeX-Player\audio-engine-cpp -B C:\DmeX-Player\audio-engine-cpp\build-verified -A x64
cmake --build C:\DmeX-Player\audio-engine-cpp\build-verified --config Release
ctest --test-dir C:\DmeX-Player\audio-engine-cpp\build-verified -C Release --output-on-failure

# Portable renderer tests
cmake -S C:\DmeX-Player\audio-engine-cpp -B C:\DmeX-Player\audio-engine-cpp\build-portable -A x64 -DDMEX_MEASURED_HRTF=OFF
cmake --build C:\DmeX-Player\audio-engine-cpp\build-portable --config Release
ctest --test-dir C:\DmeX-Player\audio-engine-cpp\build-portable -C Release --output-on-failure

# Rust tests: close a running Windows test instance first to release phonon.dll
cd C:\DmeX-Player\music-player-ui\src-tauri
cargo test --offline --lib

# Assets
cd C:\DmeX-Player
python scripts\generate_headphone_inverses.py
python scripts\verify_headphone_filters.py

# Real application, not browser-only Vite
cd C:\DmeX-Player\music-player-ui
npm.cmd run tauri dev

# Windows release installer
npm.cmd run tauri -- build --bundles nsis --ci -- --offline
```

The Windows runtime DLL must accompany the executable. The platform-specific bundle config includes it, SDK licenses, impulse assets and HRTF notices. Do not distribute the executable alone without its resources. The produced installer is unsigned unless signing is separately configured.

The 2026-10-12 NSIS archive was also inspected with 7-Zip. It contains `phonon.dll`, the SOFA profile and notice, SDK licenses, all ten float32 headphone filters and their manifest. **That installer predates the section 11 UI/visualizer corrections and has not been rebuilt for them.** Historical installer SHA-256:

```text
0689cbc161cab009881901ab1c8f2eafdb91dea41eb4f2aa602098636944f330
```

## 10. Remaining Release Gates

1. Validate playback, seeking, repeated mode/rate/IR changes, disconnect/reconnect and audio focus on real low-power ARM64 and ARMv7 phones.
2. Measure worst-case callback budget with all effects and the longest allowed IR; run long thermal and background/foreground trials.
3. Capture output for standardized intersample-peak analysis, combined-control sweeps, mono fold-down, channel isolation and full-scale transient testing.
4. Verify codec gapless metadata and implement progressive/prewarmed decoding for immediate start and seamless adjacent-track transitions.
5. Replace unverified headphone responses with documented measurements, targets, source licenses and device variants before making calibration claims or public distribution decisions.
6. Add a measured mobile binaural renderer only with a supported ARM SDK or validated alternative and an explicit CPU/latency budget.
7. Define system/device output routing, exclusive mode where appropriate, actual output latency and source-rate policies beyond the present mono/stereo 22.05-96 kHz support.
8. Implement standards-grade loudness/true-peak diagnostics if those labels become product requirements.

These are concrete remaining engineering and measurement tasks. They cannot be honestly marked complete merely because the desktop build and regression tests pass.

## 11. UI and Visualizer Regression Corrections

Verified on 2026-10-13 after the user reported player-header crowding, merged settings surfaces and a non-reactive visualizer.

### Root Cause and Fix

Raw Stereo detached the enhanced meter along with the DSP chain. The callback only updated full-band peak level, leaving bass/mid/treble levels, stereo position and phase stale. Both desktop spatial visuals and Android beat ripples depend on those band values.

`meter_analyze` now reads rendered PCM in the raw callback. It never writes into the sample buffer, allocates memory, or takes a lock. The enhanced meter uses the same analyzer. Meter filter history and published levels are reset during suspended transport/routing changes, preventing a previous track's energy from persisting after a seek or mode change. Raw audio still travels directly from source to endpoint; no enhancement node was reconnected.

The regression fixture now renders through the production device callback in 256-frame blocks. It verifies live levels in all three bands, stereo pan/finite phase, cleared state on routing changes, and the existing unity-gain stereo null comparison even when effects are configured.

### UI Ownership

- Raw Stereo / Bypass All is a compact power toggle inside Track Options, not before mini-player artwork or expanded-header controls.
- Track Options again uses the original glass-menu sections, sliders and segmented buttons for quick adjustments. Background selection remains enabled in raw mode.
- DSP Studio is separate and uses the original Fine-Tune DSP header, Studio/Cinematic/Relax buttons and DSP-card styling. Unsupported FIR/denoising claims were not reintroduced.
- Manual changes correctly mark manual override. Segmented options tolerate float32 roundoff from native snapshots, so Low/Med boost selections remain highlighted.
- The original Android-only ripple and dust components were still embedded in `MobileExpandedPlayer.tsx`. They now live in `MobileVisualizer.tsx` with their existing rendering behavior preserved. No historical tracked file of that name was found in the inspected Git history.
- Android dust remains 40 motes with fixed 1-5 CSS-pixel diameters. Desktop particle sizing was not changed in this correction.
- The widened all-in-one menu overrides and header flex-wrap override were removed. No FPS cap was added; animation continues on requestAnimationFrame.

### Executed Verification

| Check | Result |
| --- | --- |
| Full Windows production DSP harness | 97 checks passed |
| Portable production DSP harness | 97 checks passed |
| Rust unit tests | 7 passed |
| TypeScript / Vite production build | Passed; existing chunk-size warning remains |
| Android ARM64 and ARMv7 native compilation | Both passed with the installed NDK |
| Headless Edge component tests | Desktop 1440x900/DPR1 and Android-UA 360x800/DPR3 passed |
| Visualizer checks | Nonblank canvas pixels changed over time; Android beat ripple animation active |
| UI checks | Quick menu and DSP are distinct; raw disables processing but not background selection; no DSP duplicate bypass; DSP fits viewport |
| Screenshots | Desktop and Android menu/DSP fixture images rendered and visually inspected |
| Tauri development instance | Rebuilt and restarted with npm run tauri dev, with user approval |

The browser fixture imports production visualizer/settings components and uses Tauri's `mockIPC` with simulated band telemetry. It does not prove physical-phone frame rate, actual Android audio output, or an end-to-end native WebView capture. The native callback tests separately cover the raw telemetry-to-PCM contract. A zero-lag guarantee on every phone would be unsupported.

The repeatable component test is `music-player-ui/tests/player-visualizers.mjs`. Run it while the Tauri development server is available at port 1420, with Playwright available locally and the installed Edge browser. `PLAYWRIGHT_MODULE` can point to a bundled Playwright `index.mjs`; `PLAYER_TEST_URL` overrides the development origin. Screenshots are generated under ignored `tests/artifacts/`. The fixture is not part of the release application entry point.

## 12. Grouped Controls and Mobile Navigation

Updated and verified on 2026-10-13 following the user's UI requests:

- DSP processing checkboxes are colored, keyboard-accessible switches. Library multi-selection checkboxes are unchanged because they represent selected tracks, not processing states.
- Dynamics, Tone & Harmonics, Stereo Image, Spatial Effects, Bass Field, and Room & Reverb use translucent full-width groups. Each group's slider tracks, thumbs, value readouts and switches share its accent color. Controls are not nested inside individual cards.
- Bass Field is also available as a quick slider in Track Options, using the same native parameter as DSP.
- Studio/Cinematic/Relax were removed only from the DSP surface. The expanded player's HD Clear/Immersive/Chill taste controls are unchanged.
- Player dropdowns use a reusable custom combobox/listbox with anchored, viewport-bounded portal popups, selected-option indicators, searchable long lists, keyboard navigation, Escape dismissal and outside-click/focus dismissal. Popup lists can scroll independently; scrolling the underlying panel closes the popup instead of repeatedly measuring it.
- Track Options opens below its trigger with a visible gap. Portal dropdowns are not clipped by the quick-menu or DSP scroll container.
- The user confirmed that `MobileExpandedPlayer.tsx` is the intended mobile view, not a missing `MobileExpandedView.jsx`. That component still owns the mobile lyrics/DSP placement. All detected mobile platforms now take that dedicated branch; desktop remains on its existing branch.
- The mobile navbar again scrolls and auto-selects its centered view after scrolling settles. Programmatic centering does not select intermediate tabs. Paint updates are coalesced to one requestAnimationFrame; timers are cleaned up. Favourites/most-played are no longer incorrectly mapped to Playlists in App's navigation input.

Verification: production TypeScript/Vite build passed; desktop/Android visualizer-control tests passed; `tests/mobile-player.mjs` passed scroll selection, Bass Field availability, menu spacing, custom popup bounds and horizontal-fit checks at 360x800 and 320x640. Actual mobile player components, not a replacement layout, are mounted in the fixture. At 360x800, playback-control placement remains stable across expanded, lyrics and DSP views. Screenshots were rendered and inspected.

**Retained limitation by explicit user request:** the original 320x640 layout moves the playback controls down when lyrics/DSP open. A test measured the expanded controls at y=487 and lyrics controls at y=522.78125. The user declined a narrow-screen height-constraint fix and asked to keep the layout untouched. `MobileExpandedPlayer.css` was not modified. The tests explicitly report this retained behavior; they do not claim that the layout is perfect on every screen size. Physical-device performance and accessibility testing remain necessary.
