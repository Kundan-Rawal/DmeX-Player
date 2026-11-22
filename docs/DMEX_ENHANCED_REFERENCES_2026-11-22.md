# DmeX Enhanced: Recording-Adaptive References

Date: 2026-11-22

## Product Contract

The user's Immersive, HD Clear and Chill settings are reference signatures, not
rigid per-genre recipes. Each recording can adjust any continuous preset-owned
control, not just those originally accompanied by a range. DmeX Enhanced defaults
to the Immersive reference. Selecting a pill chooses that reference instead;
references are not added together or stacked into duplicate boosts.

The restored November 14 DSP algorithms and transport de-clicking remain intact.
No additional adaptive EQ node, centre-only vocal process or altered exciter/air
gain curve is introduced. Actual acknowledged native values populate the sliders.

## Reference Settings

| Control | Enhanced / Immersive | HD Clear | Chill |
| --- | ---: | ---: | ---: |
| Tube exciter | 60% | 90% | 40% |
| Harmonic air | 50% | 70% | 30% |
| Vocal frontness | 50% | 80% | 80% |
| Stereo width | 1.50x | 1.10x | 1.75x |
| 9D stage | On | Off | On |
| Spatial separation | 90% | 0% | 90% |
| 3D depth | 80% | 0% | 90% |
| 3D room bass | On | Off | On |
| Bass anchor | 60 Hz | 60 Hz | 60 Hz |
| Bass field | 20% | 0% | 30% |
| Digital reverb | 25% | 0% | 70% |
| Subwoofer bass | 30% | 45% | 50% |
| Crystal treble | +2.5 dB | +4 dB | +5.5 dB |

The chosen starting points inside the user's ranges are explicit above. Bass
percentages use the actual UI scale: 100% equals internal drive 2.1, so 30% is
0.63, 45% is 0.945 and 50% is 1.05. This corrects the earlier percentage mismatch.

## Adaptation

An independent Rust decoder measures source PCM, not already-enhanced output.
It measures channel correlation, side-energy ratio, bass/low-mid/presence/high
power ratios, active-sample RMS, sample peak and crest factor. Anti-phase material
is analysed using separate L/R spectra rather than a cancelling mono sum.

The policy uses these as broad tonal/spatial proxies. It does not identify singers,
separate instruments, infer taste from release year or claim semantic vocal detection.
Low-mid dominance and recessed presence can raise Vocal Frontness; already-present
upper mids can reduce it. Narrow material can receive more width, separation and
depth; already-wide/negative-correlation material receives less. Bass, treble,
harmonics, reverb and bass field can all move around their references. The anchor
can select 52, 60 or 70 Hz. HD Clear deliberately keeps 9D and room-bass routing
off and retains its predominantly dry identity.

This first implementation samples the first twelve seconds at 22.05 kHz. Its
confidence is capped at 65% because an intro does not establish the whole song's
character. Changes are confidence-weighted and bounded near the reference. It is
not whole-song mastering, full-band analysis, a source-separation model or a claim
to have found the objectively best settings. Confidence below 35%, decoding errors
or unsupported analysis retain the reference without entering Manual Override.

Analysis starts after loading on a background worker, with a cooperative two-second
budget, cancellation checks, a bounded fingerprinted cache and no playback-owner
lock. Individual decoder/filesystem calls can still block internally. Results from
old sources, bypassed sessions or superseded modes cannot retune the current song.
The analysis is not awaited before PLAY; only the normal settings batch is applied.

## Independent Controls

Preset-owned controls are bass, treble, exciter, air, vocal frontness, width, 9D,
separation, depth, room-bass routing, anchor, bass field and reverb amount. Editing
one explicitly enters Manual Override and stops automatic tone/spatial updates.

Compressor, adaptive loudness, automatic room mode, room size, damping, acoustic
environment, headphone correction, output quality/rate/device, volume and speaker
boost are independent. They do not trigger Manual Override and presets do not
overwrite them. This applies in the dedicated mobile player and desktop controls.

Automatic speaker boost may select None or Low, including while tone controls are
Manual. A deliberate speaker-boost selection turns its automatic toggle off and
survives preset changes. Re-enabling the toggle restores automatic operation.
Quiet active-sample RMS alone is insufficient: confidence, active duration, sample
peak headroom and crest factor must also qualify. This heuristic is not LUFS or
true-peak loudness measurement; those require the separate methods specified in
[ITU-R BS.1770](https://www.itu.int/rec/R-REC-BS.1770-5-202311-I/en).

Bypass remains raw stereo. Loading while bypassed must not alter saved manual
boost. Analysis errors do not block playback. DSP-setting failures remain visible
and dismissible without being misclassified as missing tracks.

## Verification

- Four sound-algorithm source files still match `842a9f2` exactly after line-ending
  normalisation; no restored DSP response curve was recalibrated.
- Windows and portable/mobile-equivalent native suites: 192 checks each, including
  all three references through the full production graph, finite bounded fixture
  output, raw routing and source-transition de-clicking.
- Native signature suite: ten tests for mono/stereo/anti-phase, spectral bands,
  RMS/crest, noise flatness, invalid data, cancellation and cache invalidation.
- Policy suite: 4,000 generated feature cases plus reference scaling, independent
  control ownership and None/Low speaker-boost rules.
- Browser workflows passed at 360x800, 320x640 and 800x360: actual applied values,
  assets/independent controls, bypass recovery, Manual authority, stale-source
  isolation, selection labels and preserved volume. Settled screenshots inspected.
- Edge cases passed: valid files still play after a DSP-setting failure; that error
  remains dismissible; Manual automatic boost follows new recordings; raw track
  changes preserve saved boost; analysis failure falls back to reference settings.
- Existing seek, category-year (1980-2003), sorting and full A-Z/# index regressions
  passed. Android arm64 debug packaging passed.
- Installed and restarted on the S25 Ultra over wireless ADB. Running bundle
  `index-CHNXiVPp.js` matched the packaged frontend, and the native engine retained
  revision `842a9f2`. The native analyser returned a valid 12-second signature;
  the active HD Clear values matched the policy computed from that exact result.
  Its saved selection, volume and independent settings were preserved. No command
  errors appeared and playback remained stopped.

On that verification recording, HD Clear acknowledged about 93% exciter, 73% air,
80% Vocal Frontness, 1.10x width, 48% displayed bass, +4.4 dB treble and a 70 Hz
anchor. 9D, separation, depth, room-bass routing and reverb remained off. This is an
observed per-recording result, not a new hard-coded preset.

Fixture checks do not establish subjective superiority or guarantee that arbitrary
boost combinations can never distort. No listening or volume test is performed
under the user's install-only/no-playback approval.
