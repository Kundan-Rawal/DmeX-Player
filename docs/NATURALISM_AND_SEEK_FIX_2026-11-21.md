# Naturalism and Seek Click Correction

Date: 2026-11-21

## What Changed

The user reported harsh guitar sound at 1:12-1:20, especially 1:17, in the supplied
Hui Aankh Nam MP3, and a brief crackle on releasing the timeline slider. The two
problems have different causes. No layout redesign is included in this change.

The user chose to keep the existing preset minimum percentages and recalibrate
the gain curves. Preset vectors, category labels, reverb amounts, volume and
output-device selection remain unchanged.

## Tonal Calibration

Normalized controls now use the following curves, mirrored by native DSP and UI:

| Control | Previous curve | New curve | Example |
| --- | --- | --- | --- |
| Vocal Frontness | 9 * x * (1.6 - 0.6*x) dB | 9 * x^3 dB | 50%: +5.85 to +1.125 dB |
| Air shelf | 6 * x * (1.6 - 0.6*x) dB | 6 * x^2 dB | 20%: +1.776 to +0.24 dB |
| Exciter residual mix | 0.22 * x * (1.6 - 0.6*x) | 0.22 * x^2 | 30%: 9.37% to 1.98% mix |
| Air harmonic mix | 0.20 * x * (1.6 - 0.6*x) | 0.20 * x^2 | 20%: 5.92% to 0.8% mix |

The full manual endpoints remain +9 dB presence, +6 dB Air shelf, 22% exciter
residual mix and 20% Air harmonic mix. Lower preset settings are gentler without
making the controls cosmetic or removing the manual range. Treble's dB scale is
unchanged and remains honest. These are transfer/gain curves, not vocal-stem
separation: Vocal Frontness is still broad presence EQ on the mix.

Air and Exciter retain 4x oversampling. The final limiter and its safety clamp
remain in place; removing the clamp would conceal a protection failure rather
than solve distortion. Native status now exposes `hardClippedSamples`, reset
with DSP state, counting meaningful pre-clamp exceedances beyond floating-point
rounding tolerance. This is diagnostic telemetry, not an assurance that arbitrary
music or extreme manual settings are distortion-free.

## Seek and Source Changes

- The mobile seek input commits through Pointer Events only. The overlapping
  touch-end handler previously allowed two native seeks for one gesture.
- The command bridge shares identical in-flight seek operations. Later deliberate
  seeks still execute, and LOAD/other transport commands invalidate deduplication.
- Source changes use a 6 ms outgoing / 10 ms incoming smoothstep fade. Steady
  playback is not multiplied or changed once the fade reaches unity.
- The incoming fade waits for non-silent PCM. Buffer priming cannot consume the
  ramp before the new audio arrives.
- Seek and same-rate source replacement keep the device running on silence while
  the command thread quiesces the graph. The render callback never waits for the
  command thread or takes the audio-owner mutex.
- A callback counter protects graph mutation. Outgoing fade acknowledgement has
  a bounded wait, including a no-device/offline path; inactive devices do not wait.
- Seek/load resets both DSP buffers and miniaudio's cached processed frames,
  including the sound processing cache. Without this, old PCM could reappear
  during the incoming fade and then cut abruptly when the asynchronous seek began.
- Paused seeks remain paused. Normal Stereo and Raw Stereo keep their steady-state
  signal behavior; only deliberate transport transitions receive the brief fade.

This de-clicks source transitions; it does not claim gapless playback between files.
The existing graph's buffering latency remains present.

## Supplied Song Verification

The MP3 is 44.1 kHz stereo and has a 1991 date tag, selecting 90's Classic. It was
decoded to float PCM and run through the mobile-equivalent production graph.
Both before and after sets contain 32 renders/diagnostic ablations. No audio device
was opened, and no copyrighted audio was added to the repository.

At 76.5-77.5 seconds, after RMS matching across 72-80 seconds:

| Mode | Previous 2-4 kHz change | Corrected 2-4 kHz change |
| --- | ---: | ---: |
| 90's Classic | +2.92 dB | +0.74 dB |
| Classic + HD Clear | +2.88 dB | +0.71 dB |
| Classic + Immersive | +2.86 dB | +0.57 dB |
| Classic + Chill | +2.92 dB | +0.71 dB |

Normal Stereo remains effectively unchanged from the decoded source after latency
alignment. No final hard-clamp exceedances were detected in 72-80 seconds in the
corrected renders. The controlled, gain-matched nonlinear residual around 1:17
fell from approximately 0.148% RMS to 0.024% RMS; this diagnostic difference is
not THD of the music and is not a perceptual guarantee.

## Regression Coverage

The final native suite passes 388 checks in both portable/mobile-equivalent and
Windows desktop builds. The portable suite also passed three consecutive runs.

- Mobile touch gestures at 320x640, 360x800 and 800x360: one seek per release,
  in-flight deduplication, later repeated seeks, and source-change ordering.
- Gain readouts agree with native calibration. All category/pill minimums remain
  intact; Raw/Normal/manual/category/pill state remains independent.
- Exact unity of the inactive transport envelope; 22.05/44.1/48/96 kHz ramps;
  silent priming; callback partition invariance; and exact fade endpoints.
- Concurrent native seek/load simulation in raw and enhanced modes, checking
  sample discontinuities and no unexpected playback after paused seeks.
- Full-volume preset guard checks, finite PCM, measured directional rendering,
  raw PCM preservation and clipping/limiter regression coverage.
- Reference-tone harmonic distortion: approximately 0.016% for the 30% exciter
  test and 0.312% for the 25% Air test. These are specific reference signals,
  not guarantees for every frequency, amplitude or recording.

The user's earphones, Android system effects and DAC/output path still require
listening validation. Strong manual saturation and distortion already present in
the recording cannot be universally removed by these changes.

## Android Delivery

The standalone debug APK was installed over the existing app on the S25 Ultra
using an in-place update, then restarted with the user's approval. Read-only
device checks confirmed the corrected JavaScript bundle, ready native engine,
saved settings matching native values, Manual Override matching the status badge,
and paused playback. No playback or volume commands were sent. An interactive
badge-opening test timed out waiting for a stable visible control; the subsequent
read-only DOM/native checks passed without requiring phone interaction.
