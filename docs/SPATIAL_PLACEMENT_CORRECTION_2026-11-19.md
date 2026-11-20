# DmeX: Placement and Tonal Balance Correction

Historical iteration: its automatic recipe values are superseded by
[Preset and Alphabet Iteration](PRESET_AND_ALPHABET_ITERATION_2026-11-21.md).
The current source retains complementary band reconstruction and confidence-
weighted center protection, added during the final renderer verification.

Date: 2026-11-19

This correction supersedes the automatic tuning recommendations in
`DSP_RESPONSE_AUDIT_2026-11-19.md`. Larger slider values and greater PCM difference
were not evidence of better sound. The user's comparison with Raw Stereo exposed
a real design regression: excessive width, brightness and diffuse added energy.

## What Was Wrong

- Every automatic profile increased stereo width; the quick profiles used 1.12-1.20.
- HD Clear and Immersive combined +5 dB treble, strong 2.5 kHz presence, Harmonic
  Air's high shelf and, in some cases, an exciter. These are overlapping boosts,
  not independent improvements. They can sound harsh and reduce limiter headroom.
- The virtual stage added the same residual to side, rear and elevated sources.
  Increasing depth mostly added overlapping copies instead of reallocating energy.
- A decorrelated coherent-center send spread even mono vocals into the field.
- Immediate dry audio was summed with block-delayed spatial copies. More wet
  level could increase phase coloration and apparent width rather than focus.
- The quick spatial profiles also enabled reflected Bass Field and appreciable
  reverb, working against localized bass impact and source definition.
- Genre and a few signal statistics were treated too confidently as reasons for
  tonal boosts. They do not establish that a recording needs more treble or bass.
- A float rounding stall could prevent an enabled processing gate reaching exact
  unity. This left a tiny permanent parallel-bypass contribution.

## Renderer Correction

The existing production HRTF engine is retained, including the portable measured
bank used on Android. This is not a new stereo-widener implementation.

1. Keep the balanced, coherent center in the direct bed. Do not manufacture a
   decorrelated vocal send. Level imbalance reduces center protection so that
   coherent off-center instruments can still receive directional processing.
2. Keep the below-300 Hz bed predominantly direct; centered bass is preserved.
3. Split the residual at 4.5 kHz. Use complementary front/rear sends for the mid
   band and complementary front/elevation sends for the high band.
4. Front speakers are at -45/+45 degrees, rear at -145/+145, elevated at
   -48/+48 with 45 degrees elevation. These match available portable directions.
5. Depth reallocates the residual. Sustained mid-band material favors the rear;
   attacks favor the front. High-band residual can receive elevation cues.
6. Remove the routed portion from the direct bed and replace it with its HRTF
   result. Do not simply stack another full copy on the original stereo signal.
7. Delay the direct bed by the same 64-frame block as the renderer: 1.33 ms at
   48 kHz, 1.45 ms at 44.1 kHz. HRTF filter propagation is additional. Inactive
   stage/zero separation retains the existing exact bypass path. Stage toggles
   retain the existing smoothed gate; active-stage PCM comparisons account for
   this fixed block delay rather than mistaking latency for an audible effect.
8. Retain attenuation-only field protection and the downstream peak limiter.
   Field attenuation uses 5 ms attack / 100 ms release instead of block steps.
   Renderer failure falls back to the latency-aligned direct bed.
9. Fix gate convergence without raising volume or removing peak protection.

No per-sample allocations, file/network access, new inference model or additional
convolution voices are introduced. The six existing HRTF voices are reused.

## Automatic Profiles

All category and quick profiles now keep Width at 1.00, Air and Exciter at zero,
and Room Bass/Bass Field off. They do not change master volume, output device,
headphone calibration or processing-quality mode. Category and pill still resolve
to one acknowledged parameter snapshot, not stacked independent processors.

Base quick profiles, before conservative category modifiers:

| Parameter | HD Clear | Immersive | Chill |
| --- | ---: | ---: | ---: |
| Bass Drive (native 0-2.1) | 0.10 | 0.18 | 0.20 |
| Treble | 0 dB | 0 dB | -0.8 dB |
| Vocal Frontness | 0.04 (~+0.57 dB) | 0.03 (~+0.43 dB) | 0 |
| Spatial Stage | Off | On | On |
| Separation / routing amount | 0 | 0.75 | 0.70 |
| Depth / directional allocation | 0 | 0.65 | 0.80 |
| Reverb amount | 0 | 0.045 | 0.10 |
| Room Size | 0.72 | 0.60 | 0.74 |
| Damping | 0.60 | 0.75 | 0.80 |

HD Clear is close to the source, not a brightness maximizer. Immersive emphasizes
the directional stage with a small room contribution. Chill uses a deeper stage,
a darker balance and a slightly longer/damped room. Category modifiers reduce
processing for already-wide, dense, dynamic or voice-focused material; they do
not add another treble/air stack. Speech remains non-spatial. Unrecognized genre
metadata is not silently converted into a film/soundtrack category.

Manual controls retain their full existing ranges. Manual overrides, Raw Stereo,
volume and saved preferences are not silently reset. To audition a new automatic
recipe while in Manual Override, select the relevant pill or return via the
existing active-sound badge. Raw Stereo remains an honest unmodified reference.

## Verification

The regression suite now tests center anchoring, sub-bass preservation,
broadband left/right placement, off-center coherent instruments, distinct depth
allocation, callback-size independence, gate convergence, HRTF front/rear/height
differences, finite output, limiter bounds and exact Raw Stereo PCM identity.

Automatic recipes are checked for zero widening, no positive treble, no exciter/
air stack and no reflected bass. Production-graph presence measurements must stay
below a 2 dB boost on the deterministic mixed test fixture. This is a regression
fixture, not a claim that every recording has the same frequency response.

The previous full-level linear-superposition assertion was not appropriate for
the adaptive, bounded residual extractor. It is replaced with broadband lateral
direction checks and explicit center/coherent-source tests. A single sine can
sit in an HRTF notch; its ear-level difference alone is not a localization test.
All spatial response comparisons use latency-aligned references where needed.

Frontend regressions verify category/pill/manual/Raw Stereo state, acknowledged
native parameter snapshots, library behavior and 320x640, 360x800 and 800x360
layouts. No expanded-player layout redesign is included in this correction.

## Limits and Listening Validation

Ordinary stereo does not contain recoverable original 360-degree object/stem
coordinates. This remains a synthetic, source-aware virtual stage, not true
object decoding. A mono lead is deliberately not forced behind the listener.
A generic measured HRTF may produce different front/back/elevation perception
for different listeners and headphones. No preset can be proven preferable to
Raw Stereo for every recording. Use level-matched listening, not loudness alone,
for the final decision; the phone installation does not replace that audition.

Engine references:
- [Valve: HRTF rendering and normalization](https://valvesoftware.github.io/steam-audio/doc/capi/hrtf.html)
- [Valve: Binaural effect](https://valvesoftware.github.io/steam-audio/doc/capi/binaural-effect.html)
- [Valve: Spatial blend and HRTF interpolation](https://github.com/ValveSoftware/steam-audio/blob/master/core/doc/guide.rst)
