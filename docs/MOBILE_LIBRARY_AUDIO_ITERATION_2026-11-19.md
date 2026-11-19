# Mobile Library and Audio Iteration

Date: 2026-11-19

## Checkpoint and Scope

The pre-change version is saved on GitHub under `codex/pre-iteration-2026-11-19`, commit `842a9f2`.
The expanded-player layout, album-art colors, visualizer, gestures, desktop layout and volume controls are retained.

## Deleted Local Files

The proposed lazy approach is appropriate: no new startup existence scan is needed.
After a local playback failure, a native source-status check distinguishes a confirmed missing file from denied permission, a corrupt but present file, an unavailable provider, and disconnected storage.
Only confirmed missing records are removed. No music files are physically deleted by this feature.

- Remove the library record and its saved playlist memberships in one database transaction.
- Remove matching favourites, recent-history entries and duplicate queue entries from frontend state.
- Advance to the next upcoming entry, even when Repeat One was enabled.
- With no upcoming entry, choose a random remaining library track, put it first, and shuffle the rest into a Tracks queue.
- Preserve a restored queue's paused state; recovery during restore does not start music unexpectedly.
- Bound each recovery attempt to 64 distinct sources to prevent an endless failure loop.
- Do not prune online tracks or unknown content providers on a generic error.
- Require readable, mounted storage and sufficient access before treating Android paths as missing.
- Prevent delayed metadata work from inserting a removed source again; a deliberate rescan can import it again.

For ambiguous provider failures, the row remains retryable. This is intentional protection against losing a library because a USB device, permission or document provider was temporarily unavailable.

## Notification and Audio Focus

The service previously abandoned its focus request when interrupted playback became paused. That removed the callback needed to recover.
It now retains the focus request and foreground service during a transient interruption, and remembers whether music was actually playing.
On focus gain, it resumes only that interrupted playback. Already-paused music, an explicit user pause/stop, headphone disconnection and permanent focus loss do not trigger automatic playback.
Android-managed ducking can restore sound without a focus callback; this behavior is left to Android.

This follows [Android audio-focus guidance](https://developer.android.com/media/optimize/audio-focus), not a notification-access workaround. The app does not read notifications.

## Years, Categories and Index

Year sorting uses embedded release/recording-year metadata, never the filename, file creation time or date added.
Year-only values and ISO-style dates such as `2001-07-15` are accepted. Missing/invalid years appear under **Unknown year**, last in either direction.

- The sort sheet includes Release year, with reversible order.
- Year headings appear between sections; the current section remains visible while scrolling.
- Title and artist sorting provide alphabet headings.
- The right-side touch index scrubs to section starts, supports keyboard navigation and does not initiate a tab swipe.
- Rows and section offsets remain virtualized rather than mounting the full library.
- Sort/filter-specific scroll positions remain separate.
- The classics filter is strictly **1880 through 2003 inclusive**, exactly as requested. Despite the historical "90s Bollywood" label, no language, artist, album-name or genre condition is used for this filter.
- Other category filters use embedded genre tags. Untagged songs are not silently assigned a genre from their filenames.

The mobile header is 16 px shorter, tab padding is reduced modestly, and the tab separator uses the same barely-visible neutral color as track separators. Touch targets and the expanded-player geometry are retained.

## Real DSP Recipes

The old preset application ignored its category argument. Four broad audio statistics also cannot reliably identify a musical genre or recording era.
Genre tags now select Pop, Classical, Acoustic/Vocal, Electronic/Dance, Hip-Hop, R&B/Soul, Jazz/Blues, Rock, Metal, Folk/World, Film/Soundtrack, Speech/Podcast or Ambient.
Without usable tags, measured stereo correlation, crest factor and RMS describe the signal as dynamic, dense, center-focused, wide or unclassified, rather than pretending to identify a genre.
Old untagged genre guesses are re-evaluated when a track is played/analyzed; no new full-library launch analysis is added.

The existing category badge enables/disables category adaptation. With adaptation disabled, the quick pill still applies its base recipe. Manual DSP changes remain manual; Raw Stereo prevents preset writes.

### Base Values

These are engineering starting points, not clinically or universally proven improvements.
All amounts except treble/width are normalized engine controls, not decibels or percentages of perceived improvement.

| Parameter | HD Clear | Immersive | Chill |
|---|---:|---:|---:|
| Bass drive | 0.12 | 0.24 | 0.18 |
| Treble shelf gain, dB | +1.4 | +0.6 | -0.8 |
| Harmonic exciter | 0.04 | 0.025 | 0 |
| Stereo width | 1.02 | 1.08 | 1.06 |
| Vocal presence | 0.10 | 0.08 | 0.04 |
| Harmonic air | 0.10 | 0.06 | 0.03 |
| 9D enabled | No | Yes | Yes |
| Separation | 0 | 0.45 | 0.62 |
| Depth | 0 | 0.34 | 0.52 |
| Reverb wet | 0 | 0.08 | 0.16 |
| Manual room size | 0.72 | 0.72 | 0.76 |
| Manual damping | 0.60 | 0.60 | 0.68 |

HD Clear favors a small high-frequency/presence lift and avoids spatial/reverb masking. It does not increase the file's actual resolution or reconstruct missing frequencies.
Immersive combines restrained spatial rendering, modest width and a low reverb send.
Chill uses a softer treble shelf, deeper spatial settings and more reverb without enabling a loudness boost or compressor.
The existing automatic-room option remains the user's choice; room-size/damping values are manual-mode targets, not an override of automatic adaptation.

### Category Modifiers

- Classical, Jazz, Dynamic: bass x0.6, exciter x0.5, reverb x0.65, depth x0.85.
- Ambient, Soundtrack, Wide: reverb x0.6, separation x0.75, depth x0.8, to avoid stacking excessive space onto spacious material.
- Electronic, Hip-Hop, Metal, Dense: exciter off, treble x0.7, reverb x0.65, bass x0.85.
- Vocal, Folk, R&B, Center-focused: vocal presence +0.03, separation x0.65, depth x0.75.
- Speech: dry, centered output; no bass drive, exciter or 9D, vocal presence 0.12.
- Legacy Classics profile: no exciter, treble/air x0.5 and separation x0.6. This DSP profile is separate from the year-only library filter.
- Rock: reverb x0.75 and exciter x0.5. Pop/unclassified use the base recipe.

Every recipe disables compressor, extra loudness, bass-field processing and speaker boost. It preserves volume, output rate, quality mode, output-device choice and loaded headphone/room assets. Selecting a pill therefore does not erase device calibration; only Bypass All provides the application's raw route.

### Scientific Limits

Filter gain and frequency have physical definitions, as in the [W3C/RBJ filter cookbook](https://www.w3.org/TR/audio-eq-cookbook/). Preferred spatial intensity, bass and reverberation remain listening preferences and depend on the recording and headphones.
[ITU-R BS.1770](https://www.itu.int/rec/R-REC-BS.1770/en) defines loudness/true-peak measurement, not an enhancement preset or a guarantee that one preset improves every song.
No BS.1770 certification, restored high-resolution detail, level-matched preference study or headphone-specific optimum is claimed by this change.

## Verification

- Production TypeScript/Vite build passed.
- Android native unit tests passed, including transient/permanent focus, explicit cancellation and already-paused playback.
- Five SQLite tests passed, including idempotent missing-source cleanup and retained playlist order/history.
- Production offline DSP suite passed with distinct, finite, bounded PCM output for the three base recipes; existing raw-route checks passed.
- Mobile library tests passed at 320x640, 360x800 and 800x360: year boundaries/order, touch index, filter count, safe failure classification and Tracks fallback.
- Existing mobile library, navigation, playlist, queue, player portrait/landscape, motion, haptics, media-session and duration/call-recording-filter regressions passed.
- S25 Ultra device verification passed with real Android focus ownership and native cursor measurements: transient interruption/resume, already-paused protection, manual-pause cancellation, permanent-loss protection and unchanged volume. The silent helper was uninstalled afterward, and the original cursor was restored paused.
- The final installed package also passed native absent-file detection and year-sort/classics-filter smoke tests on the S25 Ultra. The library count remained unchanged during these non-destructive checks; prior sort/filter choices were restored afterward.

The short-screen portrait lyrics-height behavior is deliberately retained because changing that layout was previously declined.
