# Mobile Redesign: Debug Build Status

Date: 2026-11-13

This is the first implemented mobile redesign iteration, not release certification.
The approved direction is in [the redesign blueprint](MOBILE_UI_REDESIGN_BLUEPRINT.md).
The pre-redesign GitHub checkpoint is `12568e56340cea3bb46dfaa4fd3681907818dc92`.

## Implemented

- A dedicated mobile shell, isolated from desktop browsing markup and styles.
- Scrollable, centered library tabs with selection after scroll settles.
- Consistent track rows, long-press selection, track menus, and collection headers.
- Dedicated Favourites, Recently added, Recently played, and Most played destinations.
- Album, artist, folder, and grouped local-search destinations.
- Separate Discover and local-library search contexts.
- A compact artwork-tinted, translucent mini-player with direct queue access.
- A queue independent of whichever library screen the user is browsing.
- Distinct IDs for repeated occurrences of the same queued song.
- Play next, append, jump, remove, reorder, clear upcoming, and guarded undo.
- Shuffle and Off/All/One repeat behavior; manual Next is distinct from automatic completion.
- Queue persistence and paused restoration, including saved playback position.
- Protection against delayed native queue backup being overwritten by legacy last-track restoration.
- Virtualized track and queue lists rather than mounting the whole music library.
- Playlist create-and-add, rename, remove, delete confirmation, and persisted track ordering.
- Transactional native playlist saves that roll back on failure.
- Listening statistics based on advancing playback time, plus qualified play counts and recency.
- Dedicated Settings and Library activity screens, replacing persistent maintenance clutter.
- Existing duration/call-recording filters, Gemini key, appearance, and raw-stereo access retained.
- Missing-artist-artwork sync in Library activity with pause/resume and cache-clear confirmation.
- Android system-bar/cutout inset bridge and compact landscape browsing rules.
- Follow-up feedback: pitch-black dark background, neutral black/white library tabs,
  barely visible neutral separators, and a fully rounded mini-player.
- Only the active track row carries an animated three-color ambient field using
  the same extracted palette as the expanded player, not a blurred cover image.
  Its color layers move independently, pause while the expanded player is open,
  and respect reduced-motion preferences.
- The rounded mobile mini-player shares the same extracted-color animation at a
  softer strength, with stable light/dark text colors for readability. It has no
  solid outline or inset side bands; the color field fills the rounded surface.
- Removed double reservation of Android bottom insets; lists meet the mini-player
  without the previously visible gap. Verified with live WebView measurements.
- Immediate mobile launch artwork and a library-loading skeleton prevent blank or
  misleading empty-library content while the JavaScript/database initializes.

## Protected Areas

These desktop/shared layout files remain unchanged:

- `music-player-ui/src/App.css`
- `music-player-ui/src/components/layout/TopNav.tsx`

The mobile expanded-player files were subsequently changed only for the explicitly
approved queue/lyrics interaction update described below. The existing artwork,
controls, lyrics, and DSP geometry is covered by pre-change bounds checks.

App integration routes mobile transport through the new queue. The expanded player's
layout, lyrics/DSP placement, particle sizing, and visualization implementation were
not redesigned. No rendering FPS cap was introduced. Existing desktop browsing is
still rendered through its original branch.

## Verification

| Check | Result |
| --- | --- |
| TypeScript and production Vite build | Passed |
| Native database tests | 4 passed, including rollback and history preservation |
| New mobile journeys | Passed at 360x800, 320x640, and 800x360 |
| Queue isolation, duplicate IDs, repeat, and restoration | Passed |
| Delayed native backup restoration | Passed; saved position, no fallback replacement/autoplay |
| Playlist creation and ordering after remount | Passed |
| Artist sync and cancellation of cache clearing | Passed with mocked native commands |
| Desktop/mobile branding and artwork-color transitions | Passed at 1440, 360, and 320 widths |
| Expanded-player controls and lyrics/DSP placement | Passed at 360 and 320 widths |
| Expanded-player open/close/cancel transitions | Passed at 360 and 320 widths |
| Immediate mobile launch and slow-library startup | Passed; desktop launch behavior unchanged |
| List-to-mini-player spacing with native insets | Passed in portrait/landscape and measured on S25 Ultra |
| Desktop/mobile animated visualizers | Passed earlier in this implementation run |
| Library filters, scanner choices, Gemini key, and manual lyrics search | Passed earlier in this implementation run |
| Actual S25 Ultra portrait and landscape framing | Visually inspected |
| Protected layout-file diff and whitespace check | Passed |

The latest native Android debug build is installed with its frontend bundled. It
does not require the USB development server to open. This is not a release APK.
The local frontend test server remains at `http://127.0.0.1:1420`.
Automatic phone rotation was restored after the landscape check.
No music files or existing playlists were deleted during inspection.

## Follow-Up Mobile Browsing Fixes

- The library-content swipe mapping is reversed following device feedback:
  a left swipe selects the next tab and a right swipe selects the previous tab. Vertical gestures remain
  scrolling, horizontal gestures do not trigger browser Back, and swipe-generated
  clicks cannot accidentally open or play an item.
- Albums, Artists, Playlists, Folders, and Discover retain independent scroll
  positions. Album/artist detail round-trips also restore the source position.
- The header replaces the letter D with the existing transparent DmeX mark and
  keeps `meX Player` inline. Desktop and launcher assets are unchanged.
- Artist artwork has fixed circular dimensions, including in landscape.
- Album browsing restores deterministic larger feature covers among smaller ones.
- Mobile startup shares a pending library request, waits for filters/settings,
  and distinguishes loading, genuine empty libraries, and failures with Retry.
- Unknown Artist detail now matches its dictionary identity and track count.
- Added real-touch navigation, saved-scroll, header-alpha/alignment, collection
  consistency, delayed startup, and failed-load/retry regression coverage.
- Recently added, Recently played, and Most played now show real cover collages
  from their own ordered tracks instead of permanent icon placeholders. Duplicate
  covers are consolidated, a single cover fills the tile, broken images are skipped,
  and an icon is used only when usable artwork is unavailable. Counts and routes
  still use the same collection selectors. Verified at 320, 360, and 800 widths.

## Motion, Haptics, and Queue Dragging

- Tab content follows horizontal touch movement. The later motion rework below
  replaces the original directional fade with paired transform-only page motion,
  retaining just the outgoing page during settling. The tab rail preserves smooth
  centering and reserves stable label widths.
- Menus, feedback messages, and button press states have short transitions. Native
  vertical scrolling/inertia is retained; saved-position restoration is immediate.
- Queue drag capture belongs to the stable list container. A CSS specificity bug
  that replaced the handle's `touch-action: none` with `manipulation` is fixed.
- A lifted drag row follows the pointer; neighboring rows preview the new order.
  Frame-driven edge auto-scroll continues while the finger is stationary. Only a
  valid drop commits the order. Cancellation/current-track changes preserve it.
- Reduced motion disables page motion and animated reordering. No FPS cap was added.
- Added a native Android feedback plugin using `View.performHapticFeedback`, with
  version-compatible selection, tap, long-press, drag, and confirmation effects.
  It does not bypass Android touch-feedback preferences or require VIBRATE permission.
  See [Android's haptic feedback guidance](https://developer.android.com/develop/ui/views/haptics/haptic-feedback).
- Foreground button/toggle/dropdown interactions and meaningful slider steps have
  feedback. Long-press selection, tab swipes, and drag position changes have dedicated
  feedback. Settings includes a persistent Haptic feedback toggle.
- Real-touch browser tests passed at 360x800, 320x640, and 800x360: drag up/down,
  stationary edge auto-scroll, cancellation, current-item protection, moving page
  transitions, reduced motion, and feedback opt-out. Queue/playlist persistence,
  branding, expanded-player transition, and native database regressions also pass.
- Built and installed `app-universal-debug.apk`. On the S25 Ultra, the installed
  app retained 1,781 library tracks and queue entries; native haptics reported
  `performed: true`. No playback or volume changes were made during this check.

## Expanded Queue and Lyrics Access

- The mobile expanded-player lyrics toolbar button is now Play queue. It opens
  the existing playback queue inside the same upper panel area used by DSP/lyrics;
  it does not collapse the player or navigate to another page.
- Album artwork is an accessible lyrics button. Its badge indicates whether
  synced lyrics are available; without lyrics, tapping opens the existing search
  and manual-retry interface. A panel close control restores the artwork view.
- Queue styling is translucent and allows the existing ambient colors through.
  Current-row colors are lifted for contrast. The list remains virtualized and
  shares reorder, jump, move, and remove operations with the standalone queue.
- Existing artwork size/position, action row, seek bar, transport controls, taste
  buttons, DSP placement, particles, and visualization implementation were retained.
- Tests passed at 360x800 and 320x640: pre-change geometry, synced/missing lyrics,
  lyrics fetching, queue transparency, touch reordering, queue actions, shared
  order, and opening/closing transitions. Existing short-screen panel behavior is
  intentionally retained, not redesigned as part of this update.
- Installed on the S25 Ultra and verified the embedded queue while the player
  remained expanded: 1,781 queue entries, 1,781 library tracks, and a translucent
  background. The art button correctly reported synced lyrics availability.

## Landscape Expanded Player

- Revised to match the user's landscape sketch: the portrait-style top bar stays
  above a horizontally centered cover, with title/artist, progress, and transport
  stacked below. Favorite/Queue/DSP form the left rail; taste profiles form the
  right rail. Shuffle and repeat align with those rails along the bottom.
- Lyrics, Queue, and DSP replace only the central artwork stage in landscape.
  Metadata, progress, transport, and both side rails remain stationary and visible.
  Portrait geometry and the desktop layout remain unchanged.
- Beat ripples are sized and positioned relative to the artwork wrapper rather
  than the viewport. Existing full-screen album-color ambience remains intact.
- Horizontal safe insets are applied symmetrically to preserve the visual center.
  The central panel scrolls on short screens; track options are constrained to the
  available height. Previous/next hold-to-seek handlers remain unchanged.
- Dust positions are reprojected on rotation. Particle count, fixed 1-5px sizes,
  velocity, beat detection, and uncapped animation timing remain unchanged.
- Browser checks pass at 640x320, 800x360, 915x412, and 1280x720: exact artwork/ripple
  centers during animation, nonblank moving canvas, onscreen controls, ordered
  metadata/progress/transport, artwork-only panel replacement, safe insets, and
  rotation back to the original portrait layout.
- Integrated checks cover loaded cover bitmaps, a virtualized translucent queue,
  and touch reordering with edge auto-scroll in the short landscape panel.
- Existing portrait geometry/queue, desktop/Android visualizer, and DSP regression
  checks pass, including expanded-player opening/closing and deferred visuals.
  The standalone Android debug APK was built and installed successfully.
  Final on-device visual verification was skipped at the user's request; browser
  viewport checks do not establish physical-device frame pacing.

## Player and Tab Motion Rework

- The mobile mini-player no longer animates width, height, position, or its corner
  radius into a full-screen container. `MobilePlayerMotion.tsx` keeps the rounded
  pill in place and moves a separate, full-viewport sheet with a compositor
  transform. The desktop player retains its existing structure and behavior.
- Static artwork, text, and controls are already laid out during opening. The
  library stays painted underneath until the sheet covers it. Ambient visuals
  start after the motion finishes and two paint opportunities have passed; dust
  and beat effects start in a later frame, with a short ambient opacity reveal.
- Closing retains the existing visual layers until the sheet is offscreen instead
  of immediately replacing them with black. Animation cancellation preserves the
  displayed position for reversals; stale callbacks cannot restart hidden effects.
- `MobileRouteViewport.tsx` replaces the independent swipe-reset and route-entry
  animations. Finger movement translates the live page one-to-one. On release,
  that same page remains mounted while the incoming page moves alongside it with
  the same timing. Only one outgoing page is retained, then removed after landing.
- Outgoing pages are inert and hidden from accessibility, with decorative CSS
  animations paused. Scroll positions are restored when a retained page becomes
  active again, including rapid Back navigation. Browser history does not compete
  with the app's explicit nested-scroll restoration.
- Tab labels reserve their selected width, so changing selection no longer moves
  navbar snap targets. Scrolling/autoselection, swipe direction, haptics, queue
  behavior, and the approved portrait/landscape player layouts remain intact.
- Automated checks pass at 320x640, 360x800, and 800x360 for fixed geometry, a visible
  library during opening, staged effects, cancelled opening, touch handoff without
  a gap, exact landing, cancelled swipes, rapid tab taps, stable navbar widths, and
  reduced motion. Landscape checks additionally pass through 1280x720.
- Queue drag/haptics, remembered navigation, library/playlist workflows, branding,
  desktop/mobile artwork colors, and expanded queue regressions pass. Browser frame
  samples are diagnostic only, not certification of S25 or low-end-device pacing.
- Built and installed the standalone Android debug APK. No FPS cap was added.

## Shared Expansion and Android Earphone Controls

- The pre-ambient expanded-player background now follows `--bg-expanded`, removing
  the hard-coded black surface that appeared during light-mode opening.
- Expansion uses an animated rounded inset reveal from the exact mini-player
  bounds. A temporary cover layer moves from the mini-player thumbnail to the
  expanded cover while controls remain unscaled. Reversals retain the displayed
  cover/opacity state, and temporary layers are removed on completion/cancellation.
  Older WebViews without inset clipping keep the fixed-size sliding fallback.
- Added a framework Android media-session adapter around the existing C++ engine,
  not a second decoder/player. A media-playback foreground service publishes
  playback state, metadata, and a media-style notification. Headset/system media
  play, pause, seek, next, and previous actions have native callbacks. See Android's
  [media-button routing documentation](https://developer.android.com/media/legacy/media-buttons).
- Center-button taps toggle playback, two rapid taps request next, and three
  request previous. Dedicated media-next/previous keys are also supported; explicit
  fast-forward/rewind seek ten seconds. Long center holds are not mapped to app
  commands. Firmware/Android may report gestures as dedicated keys instead.
- Volume keys are deliberately not intercepted or mapped to DSP gain. The activity
  selects the music volume stream and the media session uses local media audio
  attributes, so Android remains responsible for volume steps/held-key repetition.
- Native play/pause and seek commands run through a serialized Rust worker and
  reuse the existing resolved-source command path. UI state follows native
  acknowledgements without sending a duplicate toggle. Next/previous use the
  existing frontend queue, so process-death and fully native queue ownership remain
  separate release work rather than being implied by this media-session adapter.
- Focus loss and headphone disconnection pause playback; losing audio focus does
  not automatically resume loud audio later. No audio/DSP settings are changed by
  media-button handling. Native loaded/playing queries use a nonblocking engine
  snapshot rather than blocking Android's main thread during decoding/loading.
- Verified six light/dark viewport combinations for pill-origin clipping, shared
  artwork, unscaled controls, theme-correct opening, and cancellation cleanup.
  Existing motion, embedded queue, and landscape regressions pass. Native click
  counter unit tests: five passed. Mocked native events verify state publishing,
  no duplicate engine toggle, and next/previous through the shared queue.
- Installed the corrected Android APK on the S25 Ultra after the user's approval.
  Device verification caught and fixed a real serialization defect: Jackson did
  not populate a nested `JSObject` InvokeArg field, producing a successful command
  acknowledgement without registering a session. The bridge now reads the nested
  object through `Invoke.getArgs().getJSONObject`, and the device regression checks
  Android's actual registered session rather than trusting the acknowledgement.
- On-device tests passed for actual engine-cursor advancement on session Play,
  a stationary cursor on Pause, dedicated Next/Previous keys, UI/queue agreement,
  simulated single/double/triple center-button events, and session Play/Pause with
  the activity in the background and the service running in the foreground.
  The original track/cursor was restored paused. No volume commands were sent;
  Android reports the session's local playback-volume route.
- `tests/android-media-controls.mjs` requires explicit playback-test approval via
  `ANDROID_MEDIA_TEST=approved`. These tests do not certify physical earphone
  wiring/firmware, held volume buttons, calls, process death, or long screen-off
  operation. Those hardware/lifecycle checks remain separate.

## Still Required Before Release

1. **Native playback reliability (blueprint Phase E).** The queue is currently
   frontend-owned. A media session, foreground playback service, media-button
   adapter, focus-loss pause, and notification controls now exist, but native
   end-of-track advancement, process recreation, fully native queue ownership,
   screen-off continuity, and real headset/focus/call journeys still need an
   implementation/verification pass. Do not treat a working foreground queue or
   mocked media event as proof of background correctness.
2. Test real process death and cold-start restoration on the phone, not only mocked
   native persistence and React remounts.
3. Measure frame pacing and memory on a genuinely low-powered Android device. S25
   Ultra and small browser viewports do not establish low-end-device performance.
4. Add large-text, TalkBack, keyboard, reduced-motion, and formal contrast coverage.
5. Virtualize or paginate very large album/artist catalogs as well as track lists.
6. Expand folder browsing beyond the existing grouped Android audio-library view;
   content-URI tracks do not yet provide a complete nested SAF folder tree here.
7. Finish unavailable-file recovery, bounded automatic skipping, cloud network-error
   journeys, and stale/restored metadata reconciliation in the persisted snapshot.
8. Verify full release packaging, offline startup, migration, and long-duration
   playback without the development server.

The original 320x640 expanded-player lyrics-height behavior is intentionally
retained because the user explicitly requested that layout remain untouched.

## Main Ownership

- `src/mobile/MobileShell.tsx`: mobile screens, menus, navigation, and mini-player.
- `src/mobile/MobileShell.css`: scoped mobile browsing and collapsed-player styling.
- `src/mobile/MobilePlayerMotion.tsx`: fixed mobile player overlay and motion lifecycle.
- `src/mobile/useAndroidMediaSession.ts`: native playback state and transport-event bridge.
- `src/mobile/MobileRouteViewport.tsx`: retained-page paging and touch-to-settle motion.
- `src/mobile/queue.ts`: pure queue semantics.
- `src/mobile/useMobilePlayback.ts`: queue loading, persistence, and listening events.
- `src/mobile/MobileQueueList.tsx`: virtualized queue and reorder interaction.
- `src/mobile/library.ts`: typed destinations and collection selectors.
- `src/mobile/useArtistArtwork.ts`: explicitly requested artwork maintenance.
- `tests/mobile-redesign.mjs`: mobile workflow and queue regression coverage.
