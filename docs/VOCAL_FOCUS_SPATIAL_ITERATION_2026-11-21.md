# Vocal Focus, Dual Bass And Spatial Presence

Date: 2026-11-21

This iteration supersedes the neutral automatic recipes in
`DMEX_NATURAL_ADAPTIVE_AUDIO_2026-11-21.md`. Normal Stereo (automatic off and no
pill) and Raw Stereo remain distinct neutral/reference options. DmeX Natural now
intentionally enhances vocals, compact bass and spatial presentation.

## Vocal Focus First

The Vocal Frontness control no longer applies the same 2.5 kHz boost to both
channels. It controls a 1.4 kHz mid-signal bell, blended by a smoothed estimate of
coherence and channel balance measured in the 180 Hz-4 kHz band. Hard-panned and
anti-phase material receive no focus boost; the side signal is retained.

This is centre-weighted processing, not vocal stem separation. Centred guitars,
strings and other instruments may also be affected. The filters are ordinary
minimum-phase biquads, not zero-phase filters. No pitch/formant shifting, vocal
doubler, saturation or added vocal harmonics are introduced.

The existing normalized control curve remains `9*x^3` dB at the bell's centre.
At the Natural target of .65, the coherent-centre peak is about +2.47 dB. The live
effective centre-peak estimate also reflects the smoothed centre weighting.
On a measured harsh recording, intent restraint is applied in dB using a cube
root conversion back to the control value, rather than accidentally reducing a
requested half-dB response to one eighth through the cubic gain curve.

## Compact Dual Bass

The existing full-signal dual-peaking system is active in enhanced recipes:
the selected sub anchor supplies weight and the tracked 78-118 Hz peak supplies
body/punch. A small linked transient contribution remains. The punch peak uses
Q=.65 for a broad, consistent response across the tested fundamentals.

A phase-rotated crossover/subsonic difference used to be added to the dry signal
whenever Drive was nonzero. The reference test exposed about +3.1 dB low-band
change at a modest setting. That difference path has been removed. Analysis still
uses its filtered bands; the small-speaker path retains its dedicated protection.
No room-bass reflections are enabled by automatic recipes.

The two live peak readouts report designed gains of the parallel EQ path, not a
claim that the whole output or every bass note receives that exact gain.

## Width And Placement

The widener now adds only a cascaded, 220 Hz high-passed side send. Subtracting a
two-pole low-pass from dry was not the steep high-pass that its old comment
claimed. The unrelated mid gain has been removed, so coherent mono material is
bit-identical through the widener. Switching it off retains parameter smoothing.

The measured-HRTF stage keeps its coherent-centre/direct-bed protection and
complementary front/rear/height routing. Residual confidence is no longer squared
a second time, which had heavily suppressed usable spatial material. Stronger
recipe separation/depth settings now expose that placement more clearly. This
remains stereo-derived placement, not recovery of authoritative 360-degree stems.

## Actual Recipes

Values are native control targets, not a promise of universal perceptual benefit.
They remain independent of genre/year labels and do not stack multiple EQ passes.

| Intent | Bass Drive | Vocal | Width | Separation / Depth | Reverb |
| --- | ---: | ---: | ---: | ---: | ---: |
| DmeX Natural | .30 | .65 | 1.08x | .52 / .36 | 0 |
| HD Clear | .26 | .70 | 1.05x | Off | 0 |
| Immersive | .36 | .65 | 1.16x | .72 / .62 | .05 |
| Chill | .30 | .58 | 1.12x | .66 / .80 | .10 |

All use treble=0, Air=0, exciter=0, Bass Field=0 and room-bass=0. Confidence-gated
analysis reduces bass enhancement when a persistent bass excess is measured,
and reduces vocal enhancement on persistent upper-mid excess. Low crest factor
also restrains bass. Disabling automatic correction removes these adaptations;
an independently selected pill retains its own enhancement settings.

## Visibility And Verification

The existing DSP panel now includes Live Processing readouts for centre focus,
centre weighting, both bass peaks and all four adaptive EQ bands. Actual native
settings still drive the sliders. No expanded-player layout restructuring is
included. Controls and readouts were checked at 320x640, 360x800 and 800x360.

The extended native suite passes 428 checks in portable/mobile-equivalent and
Windows builds. The portable suite passed three consecutive runs. Tests include:

- +2.460 dB coherent 1.4 kHz centre lift at the default .65 vocal setting.
- No focus boost/cross-channel relocation for hard-panned or anti-phase fixtures.
- Preserved side signal and bounded high-frequency/low-bass vocal-stage response.
- Bit-identical coherent mono through the widener, with a strong upper-side
  response and only +.017 dB change to the 60 Hz side fixture at 1.5x width.
- Reference-excerpt low-band energy changes of approximately +1.38 dB Natural,
  +1.69 dB Immersive and +1.33 dB Chill, with finite PCM and no hard-guard hits.
- Normal Stereo remains source-preserving after fixed-latency alignment.
- Raw-to-Natural source-token recovery, paused-seek behavior, single touch-seek
  commits, stale-analysis rejection and manual-override protection remain covered.

These measurements are signal-specific, not listening preference guarantees.
The supplied reference remains the preserved decoded Hui Aankh Nam excerpt;
no copyrighted audio is committed. Earphone and system-Dolby interactions still
need listening evaluation. Raw bypasses app DSP, not external system processing.

## Android Delivery

The final standalone APK (`index-Ba-Wteoh.js`) was installed and restarted over
paired wireless ADB on the S25 Ultra. Five real Track Options Raw-to-Natural
cycles passed with no command errors or Manual Override fallback. Native target
readback confirmed Bass=.30, Vocal=.65, Width=1.08, Separation=.52 and Depth=.36.
The engine exposed finite live diagnostics, including sub/body peak targets of
about 1.27/1.73 dB in that paused-state check. The displayed recipe was verified
against actual native settings and the cached per-track analysis. Volume stayed
unchanged and no playback was started by the agent.

## Technical Reference

[FabFilter's mid/side documentation](https://prod.fabfilter.com/help/pro-q/using/stereo)
describes separate mid/side processing and its phase trade-offs. It supports the
technique, not the claim that centre information is exclusively vocals or that
these DmeX settings are scientifically optimal for every recording.
