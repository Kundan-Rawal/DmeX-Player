# DmeX Natural: Source-Preserving Adaptive Audio

Date: 2026-11-21

Historical only: this implementation was subsequently removed by the
[pre-category engine restoration](PRE_CATEGORY_ENGINE_RESTORATION_2026-11-21.md).

The later [vocal-focus and spatial iteration](VOCAL_FOCUS_SPATIAL_ITERATION_2026-11-21.md)
supersedes the neutral automatic recipes below. This document retains the initial
adaptive-analysis design and its original measurements as history.

## Product Decision

Categories now describe the library, not how every recording must be processed.
The classic collection uses embedded release years 1980 through 2003 inclusive.
1969 and 1979 do not qualify. Missing/unrecognised genre metadata maps to Other /
Untagged, not an invented Pop classification. No automatic genre model is claimed.

The existing top-centre badge now selects DmeX Natural plus an optional pill.
Its toggle enables/disables adaptive correction, while the selected pill remains
independent. Manual Override and app-level Raw Stereo retain precedence. Existing
saved manual settings, output volume, device mode and headphone correction are
not overwritten. Tap the badge to leave Manual Override and return to Natural.

## DmeX Identity

No Dolby preset, target spectrum or proprietary processing was copied. The
identity is a direct, coherent vocal/attack foundation, unchanged bass positioning,
and optional stable measured-HRTF placement of the stereo-derived residual.
Transparency can intentionally sound the same as Normal Stereo on a good master.
Being different does not require changing every recording.

| Intent | Tone / bass / nonlinear effects | Spatial settings |
| --- | --- | --- |
| Natural | No fixed boost, exciter, Air, widening or bass reflections | Original stereo |
| HD Clear | Same neutral foundation; full permitted adaptive-cut strength | No added room/stage |
| Immersive | Same neutral foundation; 65% permitted adaptive-cut strength | Separation .32, depth .22, reverb .025 |
| Chill | Same neutral foundation; 65% permitted adaptive-cut strength | Separation .40, depth .38, reverb .06 |

Natural uses 65% permitted adaptive-cut strength. These spatial amounts are
engineering starting values, not scientifically universal optimums. The existing
manual control ranges remain available; previous compulsory percentage floors no
longer apply to automatic recipes. All automatic recipes use width 1, bass drive
0, room-bass 0, Bass Field 0, vocal presence 0, treble 0, Air 0 and excitation 0.

## Analysis Implemented

An independent Symphonia stream runs on a blocking background worker, never on
the callback or playback-owner mutex. Playback does not await analysis. The worker
analyses at most the opening 36 seconds, with a three-second processing-loop time
budget. This is explicitly not a whole-song, per-section mastering model. Decoder
open/read operations are not hard real-time deadline-guaranteed.

The analyser uses the existing sinc resampler at 22.05 kHz, 2048-sample Hann FFT
frames and separate L/R power. It does not sum to mono and accidentally lose
anti-phase material. It records active duration, sample peak, RMS-derived crest
factor, channel correlation and persistent broad spectral-ratio excesses.
These are not BS.1770 integrated loudness or true-peak measurements.

Evidence rules, deliberately conservative and subject to listening validation:

| Detector | Required power ratio | Maximum correction before intent scaling |
| --- | --- | --- |
| Low-frequency dominance | 40-160 Hz vs 160-1800 Hz, greater than 9 dB | -1.5 dB shelf at 120 Hz |
| Low-mid dominance | 160-500 Hz vs 500-5000 Hz, greater than 8 dB | -1.5 dB peak at 350 Hz |
| Upper-mid dominance | 1800-5000 Hz vs 160-1800 Hz, greater than 6 dB | -1 dB peak at 3200 Hz |
| Broadband high excess | 5000 Hz-Nyquist vs 500-5000 Hz, greater than 5 dB, high-band flatness above .35 | -1.5 dB shelf at 8000 Hz |

The excess must occur in at least 85% of active frames. Evidence coverage must
reach .8 on a duration-based coverage score, requiring approximately 15.6 active
seconds. This score is not a calibrated probability of a defect. Small candidate
cuts below .25 dB are discarded; the total absolute correction budget is 3 dB.
No automatic boost or matching to a universal reference spectrum is performed.
Even persistent excess can be artistically intentional; these rules do not prove
that a master needs correction. Unknown, short, silent or failed analysis stays
neutral. High-frequency reduction is not presented as noise removal.

## Application And Safety

- Corrections use linked L/R filters with 750 ms parameter smoothing. There is no
  note-by-note EQ chasing, vocal stem manipulation, pitch shift or formant change.
- Native commands accept only finite cuts between -3 and 0 dB. Automatic tone
  cannot enable boosts, bass reflections, excitation or saturation.
- Every LOAD changes a native source token and clears the previous correction.
  Old analysis/commands cannot be applied to the next source. Frontend intent
  generations additionally protect manual edits and rapid track changes.
- Returning bass Drive and tone controls to zero clears/bypasses residual filter
  coloration that could otherwise survive coefficient-update tolerances.
- Raw Stereo routes around the app DSP and rejects enabling adaptive correction.
  It does not bypass Android/Samsung/Dolby effects outside the app.
- The existing final limiter/clipping diagnostic remains present. Zero guard hits
  in tests do not establish universal distortion-free output.
- Versioned file-identity/size/modification-time caches retain at most 256 analyses.
  Insufficient coverage caused by the processing time budget is not cached as a
  permanent analysis. No library-wide startup rescan is added.

## Verification

- 393 standard native checks pass; 407 with the user's reference excerpt enabled.
  Both portable/mobile-equivalent and Windows builds pass the extended suite.
- Six Rust analysis tests cover silence, short material, balanced material,
  sustained excess, anti-phase preservation, invalid PCM, cached reference
  analysis and superseded-work rejection.
- Three viewport sizes (320x640, 360x800, 800x360) pass delayed-analysis playback,
  native-target acknowledgement, manual-override protection, quick-skip isolation,
  analysis-failure fallback, status/pill independence and manual-control checks.
- Raw/rate/recovery source reopenings refresh the controller's native token;
  correction can resume without falling into a stale-token Manual Override.
- Earlier single-seek-per-touch and source-ordering regressions still pass.
- The preserved 60-84 second excerpt of Hui Aankh Nam receives zero recommended
  cuts. Its Natural production render has a relative RMS residual of about
  3.63e-8 after latency alignment. Immersive and Chill change measured low-pass
  bass energy by approximately -.039 and -.048 dB respectively. All three
  reference renders have finite PCM and zero final hard-guard hits.
- The original temporary MP3 attachment is no longer present; analysis used the
  decoded excerpt retained from the preceding investigation, not an assumed
  replacement recording. No copyrighted music is added to the repository.

The Android APK was installed and restarted over paired wireless ADB. The new
bundle/native fields were confirmed on the S25 Ultra. A read-only invocation of
the native analyser returned a valid cached 36-second result without any transport,
mode or volume command. The user confirmed they were resetting/testing manual
values during verification; no baseline mismatch was silently overwritten.

The first installed package had a stale-source-token bug when leaving Raw Stereo.
The corrected package (`index-B3A3fVyc.js`) was subsequently installed. Its actual
Track Options bypass button passed five consecutive Raw-to-Natural cycles on the
S25 Ultra, with source tokens 3, 5, 7, 9 and 11. No audio-command error or Manual
Override fallback occurred. Volume remained unchanged and playback stayed paused.
This exact real-device sequence is retained in `tests/android-adaptive-cycle.mjs`;
it is an explicit opt-in device test, not an automatically executed playback test.

## Deliberately Not Claimed

This version does not remove tape wow/flutter, repair clipped masters, separate
instruments, restore missing bandwidth, classify genre from audio, recover true
360-degree objects from stereo, or guarantee a preference win over Dolby.
It does not yet implement a validated fast dynamic de-harshing detector or
whole-track/multi-passage optimisation. Such additions require separate evidence,
artifact tests, mobile performance budgets and consent for listening tests.

The next quality gate is loudness-matched, blinded listening across diverse
recordings, languages, devices and listeners, not another increase in all sliders.
BS.1770 defines measurement; it does not prescribe Dolby's tonal identity.

## Research References

- [ITU-R BS.1770 loudness and true-peak measurement](https://www.itu.int/rec/R-REC-BS.1770-5-202311-I/en)
- [ITU-R BS.1116 assessment of small audio impairments](https://www.itu.int/rec/R-REC-BS.1116-3-201502-I)
- [Essentia music feature extraction](https://essentia.upf.edu/tutorial_extractors_musicextractor.html)
- [Automatic processing/mastering research](https://arxiv.org/abs/2105.04752)
- [HRTF individualisation survey](https://arxiv.org/abs/2003.06183)
- [Restoration artifact trade-offs](https://downloads.izotope.com/docs/rx6/34-spectral-de-noise/index.html)
