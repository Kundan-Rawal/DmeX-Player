# Preset and Alphabet Iteration

Date: 2026-11-21

## Scope

This iteration implements the requested stronger listening preferences. It
supersedes the automatic recipe values in the November 19 audits. These are
preference targets, not a claim that raising these controls improves every mix.
No expanded-player layout, raw route, engine parameter limits, master volume,
output device or headphone calibration is changed by the preset minimums.

## Recipe Minimums

Category-only, standalone pill and category-plus-pill recipes all maintain:

| Control | Minimum |
| --- | ---: |
| Harmonic Air | 20% |
| Tube Exciter | 30% |
| Vocal Frontness | 50% |
| Stereo Width | 1.20x |
| Subwoofer Bass | 20% (0.42 on the native 0-2.1 drive range) |
| Treble | +2.0 dB |

HD Clear uses zero reverb, whether standalone or combined with a category.
Immersive uses at least 12% and Chill at least 18%, exceeding the requested 10%
minimum. Category-only reverb varies independently with the source category.
Immersive uses 1.35x width and Chill 1.25x before category composition; neither
has its widener removed. Category Bass Field varies from 4% to 20%, and its Room
Bass route is enabled so those values actually reach the reflection processor.

Category and pill resolve to ONE complete parameter vector. Tone/width targets
are selected, not summed or multiplied, and only one DSP chain processes audio.
Normal Stereo (category off, no pill) remains neutral. Manual controls can still
reach zero, width 1.00 and negative treble. Raw Stereo remains its distinct
unmodified path. No minimum is added to AudioSettingsContext, the C++ parameter
validator, or the native engine defaults.

The peak limiter remains in the enhanced route. Strong combined boosts can use
headroom and increase limiter activity: compare at matched perceived loudness.

## Categories

The visible list is reduced from 19 to 10:

- Pop / Standard
- Classical / Orchestral
- Acoustic / Vocal (also handles folk/country/world tags)
- Electronic / Dance
- Hip-Hop / R&B (includes the former RNB category)
- Jazz / Blues
- Rock / Metal (includes the former Metal category)
- Speech / Podcast
- Ambient
- 90's Classic

Release-year metadata has priority for 90's Classic. The existing inclusive
1880-2003 rule is retained; the year range is no longer printed in the label.
No inference from file modification time, language or signal dynamics is used
to label a track as a classic. Missing/unsupported genre metadata receives the
Pop / Standard optimized profile rather than an Unclassified category.

Dynamic recording previously described signal statistics, not the release era.
Dynamic/Dense/Centered/Wide/Balanced are no longer visible categories. Old saved
category identifiers migrate to a current category. Playback and refreshed
metadata resolve the current profile directly, rather than trusting stale
cached labels or waiting two seconds for a fingerprint.

The bulk category updater uses metadata and batches library/database updates,
yielding between batches. It no longer decodes every file just to assign a
genre/era label that those signal statistics could not establish.

## Title Sorting and Index

Title sorting groups tracks with an initial ASCII A-Z letter first. Lowercase
letters match their uppercase section. The original titles are never rewritten.
Numbers, punctuation, emoji, accented/non-ASCII initials and other scripts are
preserved and grouped under # at the bottom, including in reversed title sort.
Whitespace is ignored when finding the initial letter. Artist sorting follows
the same indexing rules for consistency.

The alphabet rail always contains A-Z plus #, including letters with no tracks.
Missing letters are dimmed; scrubbing them moves to the next available section,
or the list end if none follows. Keyboard Home/End and arrow navigation remain
available. On short viewports the rail uses two columns instead of dropping
letters or overlapping labels. Release-year sorting retains its year index.

## Validation

- Frontend type-check and production bundle.
- All current categories, standalone pills, combinations and legacy aliases:
  requested minimums, reverb rules, finite vectors and no volume/device mutation.
- Normal Stereo remains zero-effect; manual/Raw Stereo state remains independent.
- Correct classic boundaries and standard fallback; no misleading statistics tags.
- English-first sorting, # at the end in both directions, all 27 index labels,
  non-overlap and keyboard jumps at 320x640, 360x800 and 800x360.
- Existing processing-status, year-index, lazy missing-track recovery, DSP route
  and portrait/landscape regression scripts.
- Portable and full desktop production DSP suites: actual preset PCM response,
  directional/center preservation, callback-size independence, raw PCM identity
  and full-master preset limiter safety. Both pass 341 checks. These tests do
  not open an audio device.

The shared spatial renderer corrections retained from the preceding iteration
use complementary reconstructing bands, confidence-weighted center protection,
calibrated portable HRTF energy and a latency-aligned replacement field. They do
not reconstruct original object/stem coordinates from stereo. Headphone listening
preference remains a user validation step, not something a status snapshot proves.
