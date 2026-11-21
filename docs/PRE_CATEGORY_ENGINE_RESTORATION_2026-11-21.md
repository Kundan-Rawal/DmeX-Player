# Pre-Category Audio Engine Restoration

Date: 2026-11-21

## Scope

Restored the audio implementation from `842a9f2` (November 14), before the
category/preset overhaul in `242b9a7` (November 19). This is a restoration, not
another tuning iteration. The later Natural/adaptive and centre-focus experiments
are superseded.

The current mobile/desktop UI, expanded-player layouts, library, queue, metadata,
headset controls and notification handling remain in place. Library categories
remain available for browsing. The classic year range remains 1980-2003 inclusive;
it does not change DSP settings.

## Restored Sound Implementation

These four files match the historical checkpoint exactly after normalising line
endings, including its original whitespace:

- `audio-engine-cpp/DSP_Nodes.cpp`
- `audio-engine-cpp/DSP_Nodes.h`
- `audio-engine-cpp/NineSpeakerUpmixer.h`
- `audio-engine-cpp/SmoothedParam.h`

This restores the original dual-peak bass, 2.5 kHz Vocal Frontness response,
harmonic air and exciter curves, stereo processing, reverb and HRTF spatial
rendering. The newer centre-only vocal treatment, adaptive EQ retuning, additional
air shelf and changed spatial mixing are removed. No new minimum percentages or
replacement sound recipes were introduced.

## Actual Historical Runtime Recipes

The old `App.applySmartSettings` ignored its category argument. Its actual runtime
recipes, rather than the unused category tables, are restored:

| Selection | Changes relative to neutral |
| --- | --- |
| HD Clear | Bass 25%, Vocal Frontness 12% |
| Immersive | Bass 35%, spatial on, separation 55%, depth 40%, reverb 8% |
| Chill | Bass 15%, treble -1 dB, reverb 12% |

Neutral means bass/treble/exciter/separation/depth/reverb/compressor/bass field/
room bass/vocal/air/spatial/speaker boost off and width 1x. These recipes do not
change volume, output device, loudness, room size, damping or sub-bass frequency.

Explicitly selecting a pill applies its recipe. Loading another track does not
zero configured controls or invent per-song adjustments. DmeX Original preserves
configured processing, matching the pre-category runtime behaviour. Its label is
not a promise that every control is enabled: neutral saved controls remain neutral.

Existing saved/manual knob values are preserved. Historical user-specific knob
values cannot be recovered from a Git checkpoint and were not fabricated. Turning
processing off explicitly applies neutral; turning it back on within that session
restores the captured controls. Bypass remains the raw reference path.

## Retained Transport Fixes

The engine wrapper retains only the later seek/source-change safety work:

- Short transport fade-out/fade-in around seek/source replacement.
- Callback quiescence while mutating the audio graph.
- Clearing miniaudio processed-PCM caches alongside DSP state.
- Seek error checking and paused-seek protection.

The transport envelope is unity during steady playback. These fixes do not add
continuous EQ, widening, vocal processing or adaptive sound decisions. The native
status exposes `engineRevision: "842a9f2"` for installation verification.

## Verification

- Exact historical source comparison and TypeScript-AST extraction of the old
  runtime recipes passed (`tests/pre-category-restore.mjs`).
- Both Windows and portable/mobile-equivalent native suites passed: 186 checks
  each, including original DSP assertions, raw/enhanced seek/source transitions,
  paused seeking and transport continuity. The portable suite also passed three
  consecutive runs during validation.
- Android arm64 debug APK built successfully with the restored native sources.
- Original-control preservation, processing status, DSP control response,
  seek/slider behaviour and preset/alphabet regressions passed at 360x800,
  320x640 and 800x360 browser viewports.
- Installed on the S25 Ultra over paired wireless ADB using an in-place update.
  The running app reported native revision `842a9f2` and bundle
  `index-mxNeghAm.js`.
- Five actual-phone Raw Stereo / DmeX Original cycles passed without command
  errors or falling back to Manual Override. The test restored the starting
  Normal Stereo selection and all 20 controls, including volume. Playback stayed
  stopped throughout; no listening or volume test was performed.

These checks establish implementation parity and transport/control correctness,
not a guarantee of subjective sound quality or that arbitrary manual boosts can
never distort. Listening comparison remains the user's next check.

## Build Artifact

`music-player-ui/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`

This is the installed native build, not a phone pointed at the temporary browser
test server. Earlier audio iteration reports are retained as history only.
