# Playback Startup and Library Filters

Date: 2026-10-24

## Cause of the delay

The LOAD command previously decoded the entire source with Symphonia,
resampled it with Rubato, wrote a complete floating-point WAV cache, and only
then opened that WAV for playback. Startup therefore depended on song length,
storage throughput and available cache space. This explains the reported
11-12 second delay even though metadata enrichment was already asynchronous.

## Playback change

- A custom miniaudio decoding backend now reads Symphonia packets incrementally.
- Miniaudio's resource-manager worker buffers streaming pages away from the
  real-time audio callback. Playback no longer waits for a full-song WAV.
- A path-retaining VFS bridge connects resource-manager callback initialization
  to the custom decoder. A regression assertion verifies that playback buffers
  are actually filled by that decoder, rather than a built-in fallback.
- Sources without a known frame count use miniaudio's unknown-length streaming
  flag, allowing raw AAC to start without an up-front duration scan.
- The existing Rubato sinc configuration is retained: 128 taps, cubic
  interpolation, 128x oversampling and Blackman-Harris window, in 4096-frame
  blocks. No lower-quality resampler or FPS limit was introduced.
- Native-rate Raw Stereo still avoids the sinc converter. DSP routing,
  visualizer telemetry, metadata extraction and the mobile player layout are
  unchanged.
- Seek restarts are aligned to the original sample grid. Vorbis and containers
  without reliable native seeking decode/discard from the beginning on seek;
  this can make a far-forward seek slower in those formats, but does not delay
  normal playback startup or change the audio samples.
- Audio analysis uses the same custom decoder so AAC/MP4/AIFF/CAF analysis does
  not regress when playback stops using a prepared WAV. Android content handles
  are retained independently while analysis runs.
- Whole-file preparation remains available for impulse-response work and the
  existing offline analysis command. It is no longer part of normal LOAD.
- Android logs report `DmeXAudio: Stream ready in ... ms` for measurement.

## Library controls

Settings now includes a minimum-duration custom dropdown: Off, 10, 15, 20, 30
or 60 seconds, and a colored Skip call recordings toggle. Defaults remain Off.

- Only tracks strictly shorter than the selected duration are hidden. A song
  exactly at the threshold stays visible.
- Unknown durations remain visible until metadata supplies a duration.
- The recording filter requires both whole words `call` and `recording` in the
  title, case-insensitively and in either order. Separators such as underscores
  work; `callback` and `recalling` are not mistaken for `call`.
- Filters apply to tracks, galleries, favourites, most played, playlist playback,
  shuffle, next/previous history and last-track restoration. Changing a filter
  does not abruptly stop a currently playing song.
- Settings persist in SQLite. No audio files, library rows, favourites, custom
  playlists or play history are deleted. Disabling a filter restores visibility.

## Scan warning

Scan messages now have a touch-sized, accessible dismiss button. Closing a
message does not cancel metadata extraction. An unreadable file remains eligible
for retry on a later scan; dismissing a warning does not claim to repair it.

## Verification

- Rust tests compare streaming PCM with the previous decoder for WAV, FLAC,
  MP3, M4A, MP4, Ogg, AAC, AIFF and CAF, including extensionless Android-style
  paths, raw PCM identity, resampler tails, sample-aligned seeking and analysis.
- A synthetic ten-minute WAV needs only 91,008 source frames to prepare its
  first two seconds at 48 kHz. This took approximately 37-41 ms on the development
  PC, not a prediction of every phone's startup time.
- All 19 Rust tests and 101 native DSP checks pass with the streaming resource
  manager, including actual custom-backend use and unknown-length playback.
- Mobile browser checks at 320 and 360 pixels cover threshold boundaries,
  recording names, persistence, reversible filtering and warning dismissal.
- Existing library/lyrics workflows, desktop/mobile visualizers and the
  original 360-pixel mobile lyrics/DSP placement are regression-tested.

## On-device results

- Phone: Samsung SM-A217F, Android 12, ARM64.
- The final signed release APK was verified, installed with `adb install -r`
  and opened successfully. App data was not cleared.
- Final APK SHA-256:
  `b97a9fe1bdcd1b6aea5fdb04c1a4dc260bfaca65c362a3b5c9c0f34bf34ebfdd`.
- Embedded frontend entry: `index-CAzWztmQ.js`.
- Final-build native stream preparation measurements: **59 ms and 70 ms**.
  Earlier measurements of the same streaming implementation were 62, 72 and
  297 ms. These measure LOAD preparation, not total tap-to-speaker latency.
- The new Settings controls and all six duration choices were inspected on
  the phone. The selected 30-second minimum and enabled recording filter were
  preserved. A transparent popup surface found during this check was corrected
  to an opaque theme surface and regression-tested at both mobile widths.
- The final app process remained running; its scoped checked logs contained no
  AndroidRuntime exception or fatal native error.
- Extended uninterrupted listening was not certified: the phone changed apps
  during the longer check, and an output-change recovery notice was observed.
  Existing audio-output recovery behavior was not changed by this work.
