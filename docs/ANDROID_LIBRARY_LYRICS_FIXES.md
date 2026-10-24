# Android library, metadata, artwork and lyrics fixes

Date: 2026-10-24

## Root causes

- SQLite track insertion listed 15 columns but supplied 17 SQL placeholders. Every new-track insertion could fail, so Android discovery did not become a usable library.
- The Android scan command detached its worker and returned before completion. Event listeners inserted tracks independently; completion could overtake inserts. Its flushing interval was permanently stopped after the first scan.
- Two independent boot sequences loaded the library and settings, allowing redundant state replacement.
- Metadata parsing used truncated 256 KB Android / 5 MB desktop buffers. Containers with end-of-file metadata, larger pictures, or seek-dependent parsing were not reliably handled.
- Failed extraction incorrectly set `metadataLoaded=true`, suppressing later retries.
- AAC-in-M4A decoding required channel information before decoding a packet, although that information may only become available in the first decoded frame.
- The Settings action was an empty callback even though a Gemini-key modal existed.
- Lyrics search accepted a duration-matched search result without verifying its title, and eventually accepted mismatched-duration results.
- Artist sanitization removed generic fragments such as `audio` and `music`, damaging legitimate names. Non-Latin artists could collapse into the same dictionary/cache identity.
- Artist synchronization checked a stale progress value when deciding whether it had finished.
- Listening-time updates also incremented play counts, making pause/resume look like additional plays. History was only flushed at the end of a session.
- Playlist creation/addition/deletion did not consistently persist to the database used at startup.

## Changes

### Scanning and folders

The Android folder modal contains exactly four choices: Music folder, Internal Storage, Downloads, Custom.

Common locations query the primary external-volume MediaStore audio collection, without an `IS_MUSIC` restriction that would exclude some recordings/WAV files. Readable filesystem audio is also discovered, including unindexed supported files. Scanning runs on a dedicated native worker.

Custom opens Android's `ACTION_OPEN_DOCUMENT_TREE` picker and retains the user-approved read grant. It is not a predefined location or a text-only path field. Content-provider files are read using Android file descriptors through Tauri's filesystem resolver, without copying the entire selected library into application storage. The active descriptor remains open while the engine may reload the current source when toggling DSP/bypass modes.

The application does not request unrestricted all-files access. Audio permission or a user-selected folder grant is still required. Denied access produces an actionable error rather than an endless scan.

Scanning is awaited. Raw tracks are inserted transactionally in batches of 100 before publishing them to React. Rescans deduplicate by source path and retain existing favourites, statistics and profiles. Stored date-added values are loaded after insertion. Errors are surfaced, not silently ignored.

### Metadata and album art

Both platforms use native Symphonia parsing against the real seekable file. Only extracted fields and a cached artwork path cross the IPC boundary, rather than large base64 audio buffers.

Extracted fields include title, artists, album, date/year, genre, duration when supplied by the container, and source quality. Embedded covers are selected with front-cover preference, keyed by image contents, and repaired if a prior cache entry is truncated. The mobile player's existing blob-based palette extraction is retained to avoid canvas cross-origin regressions.

Metadata failures remain retryable, with an in-session failed-file set preventing a tight failure loop. Another scan clears that set. A queued scan arriving during enrichment is processed afterward. Metadata updates preserve concurrent user statistics and profile changes.

The decoder initializes its layout from the first decoded frame, fixing the tested M4A/AAC failure. It selects a supported audio stream instead of blindly selecting the first track in a mixed audio/video container. A bounded damaged-ID3 recovery path skips only the verified tag region, preserving the audio payload. Android's native metadata retriever is a fallback for damaged or unsupported metadata containers, including embedded artwork. Enhanced playback can resample 8-384 kHz sources to the configured output. Raw Stereo still requires an engine-supported native output rate of 22.05-96 kHz; incompatible rates are rejected explicitly, not secretly resampled under a raw label.

### Lyrics and Settings

The existing Settings action now opens the existing Gemini API-key modal. The masked key can be saved or cleared locally; a save failure keeps the dialog open with an error. Gemini is optional: standard LRCLIB search needs no key.

No bundled fallback API key is used. Gemini requests originate in Rust, use the user's saved key in a request header, have a timeout, and send song identity text rather than audio or artwork. Gemini is used only to suggest a corrected song identity, not to invent lyrics. Previously committed embedded credentials should be revoked/rotated by their owner; removing them from current code does not erase Git history.

Search uses extracted tags first and conservative filename fallback. It preserves meaningful version labels and Unicode combining marks. Returned synced lyrics must match the requested title, artist where supplied, and duration where known. Unrelated results are not accepted solely because their duration is similar.

After a failed search, the existing lyrics area displays Song name and Singer name fields with Search Again. Requests have independent loading state, timeouts and cancellation on track/view change. Library scanning no longer disables lyrics search. Lyrics persistence always has an application-vault copy, with desktop sidecar writing retained when permitted. LRC parsing handles integer timestamps, variable fractional precision, repeated timestamps and offsets.

### History, artists and playlists

- Listening time flushes every 15 seconds, on visibility/page-hide changes, and on pause/track changes. Pause does not increment play count; natural completion is recorded separately.
- End-of-queue completion stops the UI's playing state, avoiding unlimited listen-time accumulation afterward.
- Most Played retains the existing listen-time ranking.
- Artist cleaning preserves legitimate names; dictionary identities retain non-Latin letters and combining marks. Frontend/native cache names agree.
- Artist-art requests have timeouts, require a matching artist name, validate downloaded image data and bound image size. Sync completion uses the current run rather than a stale captured progress value.
- Playlist create/add/delete operations reach SQLite; resaving retains track order.
- Clear-library failure no longer wipes only the visible state, and clearing is blocked while library scanning/enrichment is active.
- Custom dropdowns reposition on surrounding scroll instead of closing immediately because an automatic scroll-to-trigger happened after opening.

## UI boundaries

No redesign of `MobileExpandedPlayer.tsx`, lyrics/DSP panel placement, navigation, playback controls or expanded-view taste buttons was made. Only the existing empty-lyrics content, folder choices, Settings wiring and one accessible menu label changed. The existing 320 px short-screen height behavior remains as explicitly requested.

The restored Settings sheet has extra Android bottom clearance and bounded scrolling so its Save action is not covered by three-button system navigation.

## Verification

- `npm run build`: passed.
- `cargo test --offline --lib`: 12 tests, passed. Includes track insertion, history/favourite preservation across metadata updates, listening-time semantics, playlist round trips and damaged-ID3 recovery. The recovered MP3's decoded PCM is compared byte-for-byte with the undamaged reference.
- Synthetic real-file fixtures: WAV, FLAC, MP3, AAC-in-M4A, Ogg Vorbis, ADTS AAC, AIFF and CAF parse and decode. A video-first MP4 fixture checks audio-track selection. FLAC/MP3/M4A embedded artwork and corrupted-cache repair are tested.
- `tests/library-workflows.mjs`: passed at 360 px and 320 px with the production App/components and mocked native/network boundaries. Covers exact folder choices, metadata triggering, deduplication, Custom selection handoff, Settings save, conservative matching, Unicode artist identity, LRC parsing and editable lyrics retry. Also verifies that retry remains inside the existing mobile lyrics panel.
- Existing `tests/mobile-player.mjs`: passed at 360 px and 320 px; original short-screen layout retained.
- Existing `tests/player-visualizers.mjs`: passed for desktop and Android rendering/animation and separate DSP controls.
- Live provider checks: Deezer returned an exact artist result with HTTPS artwork; LRCLIB returned synced lyrics and a matching duration for a known public test song. No private audio or Gemini key was sent.
- Android ARM64 release build: completed; final deployment details are recorded below after device verification.

These automated UI tests do not substitute for testing arbitrary OEM document providers or a real Gemini account. Live Gemini quota/key behavior and provider availability require the user's credentials/network. DRM-protected files, WMA, Opus decoding and arbitrary multichannel sources are not promised by the current Symphonia/native stereo engine. A file's extension alone does not establish codec support. Raw ADTS AAC may not provide a duration in its header; Android MediaStore duration is retained when available.

## References

- Android shared media and direct file access: https://developer.android.com/training/data-storage/shared/media
- Android directory grants: https://developer.android.com/training/data-storage/shared/documents-files#grant-access-directory
- Gemini search grounding: https://ai.google.dev/gemini-api/docs/google-search

## Device deployment

Installed the scanner release with `adb install -r` on Samsung SM-A217F, Android 12 / API 31, ARM64. App launch succeeded without clearing app data. The four folder choices were verified on screen. An actual Internal Storage scan imported 3,019 audio files and started native metadata enrichment; progress was visible at 410 processed tracks. Final package update and completion checks follow below.

Further device checks: Settings opened from the normal menu and displayed the masked Gemini key input. No key was entered or changed. Metadata progress reached 1,730 tracks, with no app-specific metadata failure or crash in the inspected process log. Files without embedded tags can correctly retain `Unknown Artist`; identification is not fabricated.

The complete first metadata pass finished: 2,996 files succeeded and 23 extraction failures were explicitly surfaced. These files remain in the library and retryable. Format-only native diagnostics were added to investigate them without printing song filenames or API keys.

The retry diagnostics identified nine invalid-ID3-encoding MP3s. Other reported errors included unrecognized streams, invalid MP4 headers, missing `moov` atoms, unsupported descriptors and end-of-stream. The ID3 recovery/native metadata fallback was added in response; final recovery counts are recorded after redeployment.

Custom was tested on the device: it launched `com.android.documentsui.picker.PickActivity`. The picker was cancelled without granting or selecting anything. Provider-specific reading still requires the user's chosen folder grant.

The Albums view was checked on-device: 1,066 album groups were rendered and embedded cover images were visible. This was checked without starting audio playback or changing the phone's volume.

### Final installed result

- Final signed ARM64 APK installed with `adb install -r`; launch succeeded. Existing 3,019-track library survived the update.
- Native recovery retried the 23 failures and recovered 16. Final result: 3,012 metadata-loaded files, seven still unreadable by both Symphonia and Android's retriever. No source files were edited or deleted.
- Remaining diagnostics: four MP3-extension sources with no recognized stream, two MP3-extension sources with invalid MP4 `ftyp` data, and one MP4-extension source with no recognized stream. These reports do not prove the contents are valid MP3/MP4 merely because those extensions are present. File-specific inspection or replacement is still needed; no claim of universal format support is made.
- No native crash was observed in the final app-specific process log.
- The final native library was checked for the current `index-D7GONzkI.js` frontend asset and the native recovery command. APK v2 signature verification passed.
- APK: `music-player-ui/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`.
- APK SHA-256: `1d83f7d5a0cedb6f257ffe12fb3c291d91f222207ccc104485909d797b69e956`.
- Build time: 2026-10-24 09:12:31 local time. Size: 26,087,053 bytes.
- Twelve native tests passed, including byte-identical recovered MP3 PCM and nine real container fixtures. The frontend build, mobile library/lyrics workflows, existing mobile layout suite, and desktop/Android visualizer suite passed.
- Temporary browser test server stopped. Android app and existing phone mirror are left available. C: retains approximately 8.8 GiB free.

Not claimed as tested: live Gemini calls with the user's credentials, audible playback of every personal file, arbitrary third-party SAF providers, or every background-playback/OS-kill scenario. The changes do not redesign the player or promise support for damaged, encrypted, DRM-protected or unimplemented codecs.
