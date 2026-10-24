# DSP Clarity and Mobile Refinement

Date: 2026-10-24

## Checkpoint

The pre-change project was committed and pushed before these refinements:
`abc996e59cd481edef5e0f6843d14f08f1fec821` on `claude-fixes`.

## Findings

1. Player's nine-zone extraction closely follows Enhancer, but Android did not
   use the desktop measured HRTF path. Its fallback used lateral delay and
   head shadow, ignored elevation, and could not distinguish front/rear sources
   with the same lateral angle. This was a real directional-information gap.
2. Stage could be enabled with Separation zero. Bass Field could be raised
   while the room route was disabled. These controls stored values but their
   required routes prevented an audible result.
3. Bass punch added a phase-rotated crossover band to the direct signal. The
   tonal blend also diluted the requested boost. Bass-room reflections could
   spread kick attacks, making more bass sound less focused.
4. Reverb had manual room and damping controls only; no automatic mode existed.
5. Mobile expansion animated broad CSS properties while expensive visual
   content was active. Conflicting visibility/transform transitions made
   opening and closing abrupt. The existing mobile layout itself is preserved.

## Implementation

- Portable measured CIPIC filters now serve Android and Eco mode. Eight fixed
  direction pairs cover front, side, rear and elevated zones. Full Windows
  retains Steam Audio. Unsupported portable rates or initialization failure
  retain a fallback; the status distinguishes the active renderer.
- IR preparation and FFT setup happen outside rendering. Processing uses the
  existing partitioned PFFFT convolver with 64-frame blocks and fixed buffers.
  Full retains 200 source-rate-equivalent taps; Eco retains 160. No Python,
  SciPy, external SDK download or model inference is needed on the phone.
- The generator preserves relative left/right gain and measured arrival times.
  It asserts that SOFA Data.Delay is zero rather than discarding extra delays.
  Generated banks cover 22.05, 32, 44.1, 48, 88.2 and 96 kHz.
- Enabling Stage seeds zero Separation/Depth with 65%/45%. Moving either
  spatial slider above zero activates Stage. Explicitly disabling Stage keeps
  amounts for later use. Enabling Room Bass seeds a zero Field at 35%; raising
  Field activates its room route. Explicit off commands remain authoritative.
- Bass punch now uses the tonal-EQ difference rather than adding a separately
  phase-rotated band. Tonal blend follows Drive more strongly. Room energy is
  reduced and ducked during detected bass onsets. The final stereo-linked
  limiter and safety ceiling are unchanged; this is not a volume-only fix.
- Automatic reverb is a separate validated `AUTO_REVERB 0|1` command, leaving
  the 20-value settings ABI unchanged. Auto derives room/damping from Amount
  and ducks wet energy on attacks; dry audio is not attenuated. A 60 ms blend
  smooths mode changes. Auto defaults on, persists locally, and presents one
  amount slider. Manual exposes the existing three sliders without overwriting
  saved room/damping values. Acoustic IR selection remains independent.
- Mobile heavy backgrounds, ripples, marquees and DSP content are deferred
  until the 420 ms expansion completes. Canceled openings cancel their timer.
  Closing fades/translates content while the shell contracts. Reduced-motion
  preferences remove the delay/transitions. No FPS cap or layout restructuring
  was introduced; lyrics/control placement remains the original design.
- Raw Stereo continues to bypass processing. These changes do not introduce
  headphone correction, widening, reverb or automatic gain into its raw route.

## Verification

- Full Windows and portable native regression suites: 147 checks each. These
  include raw unity, bass frequency/attack behavior, measured front/rear/height
  differences, left-ear direction, reset tails, auto reverb and finite peaks.
- A one-second production-graph fixture verifies rendered differences for
  Bass Drive, Treble, Exciter, Widener, 9D, Reverb, Compressor, Bass Field,
  Vocal Frontness, Adaptive Loudness, Harmonic Air, Boost and device protection.
  Manual room/damping and spatial depth also change rendered samples.
- Rust application suite: 19 tests, covering metadata, formats, streaming,
  native raw PCM, seeking, resampling, playlists and listening history.
- Browser checks cover desktop/mobile visualizers, separate Track Options/DSP,
  auto/manual visibility, effect activation, library/lyrics/settings flows,
  duration/recording filters, and expansion/cancellation at 320/360 px.
- At 360x800, lyrics and DSP preserve control placement. The original 320x640
  lyrics-height behavior is deliberately retained at the user's request.

Browser fixtures mock native commands; native tests separately exercise the
actual production DSP. They do not establish Android callback performance or
subjective headphone quality. The user requested installation only, so no
phone playback, volume changes or control manipulation will be performed.

## Installed Android Build

- Signed ARM64 release built successfully with the configured Android NDK.
- APK signature verified with Android `apksigner` (v2 signing scheme).
- APK size: 26,257,509 bytes.
- APK SHA256: `67999615bfd0009a0a24db4cb94397b24057642281794c7b13ddbdaa56e8d2c3`.
- Packaged native library SHA256 matches the newly compiled ARM64 library:
  `83f22312acbd74e1eac171c04507110e97cd3a7e3f5af683e3146a3ea179b2f0`.
- Embedded frontend: `index-CpskJAqn.js`; native status contains the new
  `portableHrtf` and `autoReverb` fields.
- `adb install -r` returned Success for Samsung SM-A217F. Package update time:
  2026-10-24 13:03:05 local time, version 0.1.0.
- Existing app data was retained. The app was not launched or operated after
  installation, following the user's Install Only instruction. Device listening
  impressions and callback-budget measurements remain unverified.

## Listening and Limits

Use wired headphones with output mode Headphones for the intended binaural
comparison. Compare Raw and Enhanced at a comfortable, similar perceived
level. More widening/reverb is not inherently clearer; excessive boosting can
activate the limiter and reduce apparent kick contrast. Start with compact
bass (Field zero) when judging impact, then add room intentionally.

DSP runs on the CPU; the DAC converts the result to analog. Weak direction
alone does not identify a DAC fault. Earphone fit, frequency response, channel
wiring, Android sound effects and individual HRTF mismatch can affect results.
No arbitrary headphone-model correction has been enabled without a model.

Stereo material does not contain discrete nine-channel stems. Upmixing cannot
recover absent source positions, and a generic eight-zone HRTF is not
personalized head tracking. The dry stereo/center is deliberately retained;
spatial extraction remains restrained instead of applying unstable extreme
side gain. No guarantee of universal externalization or zero lag is made.

## References

- [Steam Audio binaural effect](https://valvesoftware.github.io/steam-audio/doc/capi/binaural-effect.html)
- [SOFA SimpleFreeFieldHRIR convention](https://www.sofaconventions.org/mediawiki/index.php/SimpleFreeFieldHRIR)
- [Android Oboe full guide](https://github.com/google/oboe/blob/main/docs/FullGuide.md)

## Separate Security Follow-up

The checkpoint removed tracked signing files while keeping local copies for
updates. They still exist in older Git history. Removing current files does
not undo exposure. Coordinate signing-key/history remediation separately;
do not rotate keys blindly and break existing Android upgrades.
