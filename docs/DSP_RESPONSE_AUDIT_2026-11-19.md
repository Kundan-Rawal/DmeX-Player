# DSP Response Audit and Corrections

The automatic preset gain/width recommendations below were corrected after
listening feedback. See [Spatial Placement Correction](SPATIAL_PLACEMENT_CORRECTION_2026-11-19.md)
for the current recipes, center-preserving renderer and verification limits.

This supersedes the preset-value tables in the earlier November 19 iteration notes.

## Findings

There was not a single disconnected master DSP path in the production offline renderer. Bass, treble, width and vocal EQ already changed PCM. However, several effects and the old preset values were much too restrained for the requested sound-shaping range:

- Harmonic Air mostly generated very weak, high-frequency even harmonics after an 8 kHz crossover and 10 kHz high-pass. At maximum it changed the mixed test signal by only about 0.37% relative RMS.
- The spatial extractor removed coherent material from the sends. Mono-heavy recordings could sound almost unchanged at maximum separation, despite an enabled renderer.
- Bass Field was a small upper-bass reflection send, additionally gated by Room Bass and onset protection. Its full-scale response on the test mix was only about 5.8% relative RMS.
- Earlier presets often set bass to only 6-11% of its UI range and vocal presence to a fraction of a decibel. Native receipt of those values did not establish that the presets were perceptually useful.
- Full-scale material can engage the peak limiter. Tests must inspect relative frequency balance after that limiter, not assume an unlimited increase in absolute sample level is possible.

The Enhancer reference source was inspected but not modified. Some algorithms are shared; simply copying those parts would not address these response limitations.

## Corrections

1. Removed Film / Soundtrack from categories, genre classification, filters and recipes. A mixed tag such as `Soundtrack; Pop` now resolves to Pop. An era/language/container tag alone does not invent a genre; untagged material uses the existing signal-characteristic analysis. Old cached Soundtrack classifications are ignored and re-evaluated on playback/analysis.
2. Air now combines a 6.5 kHz high shelf with oversampled harmonic synthesis. The normalized control produces up to +6 dB shelf gain, rather than relying only on tiny ultrasonic additions.
3. Vocal Frontness now has a continuous +0 to +9 dB presence range around 2.5 kHz. It is presence EQ, not AI vocal-stem isolation.
4. Bass has a more useful low/mid control taper, stronger broad anchors, and stronger onset emphasis. Its 50-120 Hz consistency, stereo polarity and small-speaker protection remain tested.
5. Spatial sends now include a decorrelated coherent component, so mono and centered recordings produce spatial cues too. The direct path remains present; the wet field is bounded to 70% of dry RMS at maximum. This is not a claim of phase-free processing or universal front/back perception.
6. Separation, depth, field, vocal and air use a smooth taper `x * (1.6 - 0.6*x)`, with exact zero and full-scale endpoints. There is no artificial dead zone until 80%.
7. Bass Field has a substantially stronger room send, while keeping low bass and dry attacks direct. Turning Room Bass off clears its UI amount rather than leaving an apparently active 100% control. Moving the amount enables its required route.
8. Turning the 9D stage off clears the displayed separation/depth amounts; enabling it starts at 85% separation and 70% depth. Moving those controls still enables the stage.
9. Treble remains genuine dB, with its shelf moved from 8 kHz to 4.5 kHz to address a broader treble band. A +1 dB label has not been secretly remapped to +5 dB.
10. Exciter residual strength and reverb send strength are increased. Existing independent stereo states, smoothing and oversampling remain.
11. The full SDK HRTF renderer is level-calibrated before the wet-field cap; otherwise stronger sends could hit that cap differently for left/right and opposed test signals.

## Presets

Base recipes, before category modifiers:

| Parameter | HD Clear | Immersive | Chill |
|---|---:|---:|---:|
| Bass drive, native 0-2.1 range | .75 | .95 | .85 |
| Treble, dB | +5 | +5 | +2 |
| Vocal Frontness | 65% | 60% | 60% |
| Harmonic Air | 60% | 50% | 50% |
| Exciter | 20% | 15% | 0 |
| Stereo width | 1.12x | 1.20x | 1.15x |
| 9D enabled | No | Yes | Yes |
| Separation | 0 | 85% | 90% |
| Depth | 0 | 70% | 85% |
| Reverb | 0 | 20% | 35% |
| Bass Field / Room Bass | 0 / Off | 20% / On | 32% / On |

The automatic category-only recipes are also stronger and distinct. Category adjustments no longer reduce the quick presets to the former tiny air/presence/separation values. Speech intentionally remains centered and dry. Chill retains softer treble than HD Clear but now has audible-band air and a stronger spatial room.

Vocal and air readouts include their calibrated dB gain. For example, 50% Vocal Frontness corresponds to +5.85 dB presence; 50% Air corresponds to +3.9 dB high shelf. These are filter gains, not percentages of restored detail or improvements in audio quality.

## Measured Output

Measurements use the production graph, portable measured HRTF, a deterministic stereo mix, and a fixed 20% test master level to separate response from heavy limiting. Values below are **relative RMS difference from the reference**, expressed as percentages. They are not loudness-gain percentages, perceptual scores or guarantees for every song.

| Control | Before at 25% | After at 25% | Before at 100% | After at 100% |
|---|---:|---:|---:|---:|
| Bass | 31.59 | 41.60 | 103.67 | 151.47 |
| Treble | 10.83 | 18.34 | 55.13 | 98.61 |
| Exciter | 0.72 | 2.30 | 10.76 | 23.68 |
| Width | 14.50 | 14.50 | 58.00 | 58.00 |
| Separation | 3.22 | 13.46 | 12.89 | 37.13 |
| Depth | 3.52 | 12.73 | 14.11 | 35.16 |
| Reverb | 9.66 | 16.90 | 59.71 | 101.85 |
| Bass Field | 1.45 | 7.88 | 5.79 | 21.73 |
| Vocal Frontness | 13.74 | 32.94 | 71.00 | 128.15 |
| Air | 0.09 | 9.58 | 0.37 | 28.84 |

The centered 1.2 kHz test now has about 21% relative spatial-output change at maximum, with measured lateral energy. Tests additionally verify that separation changes increase across 25/50/75/100% on mono material.

## Verification and Limits

- Both portable/mobile-equivalent and full desktop measured-HRTF engine regression suites pass.
- Slider response is measured at 25/50/75/100%, with monotonic response checks and a minimum useful response on the specified mixed fixture.
- Additional tests cover full-master tone balance after peak limiting, room-size late energy, damping decay, anti-phase stereo, channel isolation, callback-size independence, source-rate handling, nonfinite input and raw-bypass PCM identity.
- Strong presets are tested through the same production graph, not only by comparing stored settings.
- Browser tests cover removed/mixed genre tags, exact preset vectors, status/manual/bypass behavior, routing gates, dB readouts, portrait/landscape geometry and expansion motion.
- Master volume, output-rate selection, device choice and headphone calibration are not reset. Manual positions are retained, but their new native response is stronger. Select a quick preset to load the new recipe values.
- The peak limiter remains enabled on the enhanced route, with its existing approximately -1 dBFS ceiling. Raw Stereo remains the separate unprocessed route.
- Width still needs stereo side information; it does not fabricate a stereo master from pure mono. The 9D stage now supplies an explicit synthetic spatial field for that case.
- Damping/room size apply in manual-room mode; adaptive loudness is deliberately level-dependent. These controls should not be made into unconditional boosts just to appear active.
- The app cannot defeat headphone frequency limits, Android mono/accessibility settings or other system processing. Bench results establish PCM changes, not that every user will perceive the same spatial image.

No listening test through the user's earphones was performed, and the update does not start playback or change volume for testing.

The installed S25 Ultra build passed a read-only native status check: the removed Film category was replaced by the track's measured Dynamic recording profile, and its displayed mode agreed with the native settings vector. Playback and volume were not touched by that check.
