# DmeX Player Mobile: UI Audit and Redesign Blueprint

Date: 2026-11-12
Status: Proposal for review. No application implementation changes made during this audit.

## 1. Executive Decision

DmeX needs a dedicated mobile browsing experience, not another layer of small-screen overrides on the desktop interface. The expanded mobile player is the visual anchor worth preserving. The surrounding application should become calmer, more predictable, and easier to operate with one hand.

Recommended direction: **Samsung Music's interaction discipline, DmeX's artwork-driven color and restrained glass surfaces.** Borrow its clarity, not its exact branding or every layout choice.

The most important work, in order:

1. Establish a real, persistent playback queue independent of the screen being browsed.
2. Repair navigation and Android Back behavior, including sheets and collection destinations.
3. Give mobile its own shell, safe-area handling, and portrait/landscape layouts.
4. Standardize track rows, menus, selection, search, and collection detail screens.
5. Fix smart-collection definitions, counts, ordering, and persistence failure handling.
6. Add controlled glassmorphism and accessible artwork-derived colors on top of those foundations.
7. Validate Android background playback and system controls as a product feature, not just a foreground UI behavior.

More blur or animation alone will not resolve the current messiness. The main issue is that navigation, playback context, and maintenance tools compete with ordinary listening.

## 2. Scope and Non-Negotiable Boundaries

- Desktop UI, window controls, layout, navigation, and current workflows remain unchanged.
- `MobileExpandedPlayer.tsx`, its layout CSS, lyrics placement, DSP placement, visualizers, artwork sizing, particles, and existing expansion/collapse presentation are frozen for this redesign.
- Improvements to the expanded player are listed separately for later approval, not included in the proposed first implementation.
- No changes to DSP algorithms, gain, output volume, particle sizes, or visualizer FPS limits belong to this UI project.
- Keep existing library data, favourites, playlists, artist images, lyrics, filters, and audio settings through migrations.
- Keep artwork-based theming and the existing no-navy-flash behavior during track changes.
- Queue can initially be accessed from the redesigned mini-player and library actions. Adding a button inside the frozen expanded player requires separate approval.
- This audit created only this Markdown report and ignored visual evidence. It did not build, install, or modify application code.

### GitHub Checkpoint

The existing application changes were committed and pushed before this proposal:

- Branch: `claude-fixes`.
- Commit: `12568e56340cea3bb46dfaa4fd3681907818dc92`.
- [GitHub checkpoint](https://github.com/Kundan-Rawal/DmeX-Player/commit/12568e56340cea3bb46dfaa4fd3681907818dc92).
- The remote branch was checked and points to that commit.
- The unrelated untracked `audio-engine-cpp.zip` was deliberately not included.
- This proposal is local for review and is not an approved implementation.

## 3. Evidence and Verification Boundary

### On-Phone Inspection

Device: connected Samsung Galaxy S25 Ultra, model `SM-S938B`. Screenshots were 1080 x 2340 in portrait and 2340 x 1080 in landscape. These are physical pixels, not CSS pixels or Android dp.

Installed DmeX reports version `0.1.0`, installed/updated 2026-11-05. Its binary was not proven byte-identical to the source checkout; phone observations and source findings are therefore distinguished below.

Inspected directly:

- Samsung Music: Tracks, Playlists/smart cards, Recently played detail, mini-player, queue, queue-item menu, player navigation, and collection detail in landscape.
- DmeX: Tracks, Playlists, Favourite tracks detail, Albums, Artists, library menu, Discover, Settings, Android Back from Settings, scroll-selected navigation, expanded-player baseline, embedded DSP view, and collection browsing in landscape.
- DmeX retained the paused Zehnaseeb mini-player during the inspected browsing session. I did not intentionally start songs, edit DSP values, change volume, sync artwork, scan folders, delete files, or modify playlists.
- Temporary USB stay-awake was approved by the user. Its original value `0` was restored. Original rotation mode `free` was restored.

### Source Inspection

Reviewed the main application controller, mobile navigation, mini-player, expanded player integration, track-list implementations, playlist/album/artist views, cloud search/playback, Settings/modals, metadata and lyrics services, library filters, SQLite persistence, Android activity, and media-session plugin integration points.

Evidence labels in this report:

- **Phone:** observed directly on the installed application.
- **Source:** a concrete behavior or gap in the current checkout.
- **Risk:** plausible failure needing a targeted runtime test; not claimed as reproduced.
- **Proposal:** desired behavior for approval, not an existing bug.

This was not an exhaustive audio, codec, background-lifecycle, network-service, accessibility, or destructive-operation certification. No fresh regression suite was executed in this documentation-only pass. Required verification is specified in section 16.

## 4. Samsung Music: What Is Worth Learning

| Observed pattern | Why it helps | DmeX adaptation |
| --- | --- | --- |
| Readable title/artist rows with a consistent overflow action | The same item behaves the same way across screens | One mobile track-row contract everywhere |
| Scrollable category navigation with a clear selected label | Familiar browsing without a crowded permanent toolbar | Preserve DmeX's scroll-to-select behavior, improve contrast and spacing |
| Persistent mini-player with Queue | Playback context is always reachable | Add an explicitly labelled queue icon to DmeX's mobile mini-player |
| Recently played opens a named detail page | User knows where they are and how to get back | Dedicated routes for every smart collection |
| Compact collection title/count, play and shuffle actions | Songs are immediately available | Reduce DmeX's oversized browsing headers |
| Queue has current-position count, order controls, edit/add actions, and track menus | Queue is a first-class object, not an accidental list | Define a complete queue model and editing screen |
| Landscape collection remains usable and avoids system bars | Rotation is handled as a real layout | Dedicated short-height mobile layout and actual insets |
| Artwork color enriches the mini-player and listening views | Personality without sacrificing library readability | Artwork tint in chrome/glass, stable high-contrast text |
| Accessible native labels identify controls and playback state | Easier operation and automation | Semantic buttons, names, selected states, and TalkBack testing |

Do not copy Samsung's purple branding, oversized smart cards, exact icon shapes, or all of its empty-state spacing. DmeX can be denser and more personal while retaining its own identity.

## 5. Confirmed Problems and Their Fixes

### P0: Playback Context Changes When the User Browses

**Source:** `App.tsx:532` reads `stateRefs.current.displayedTracks` for Next. When the playing track is not in that list, it falls back to the whole visible library. Shuffle is also constructed from the currently displayed list (`App.tsx:662`).

Example: start from favourites, inspect an album or type a search, then press Next. The successor is selected from the new view or library, not necessarily from the collection that started playback.

**Fix:** snapshot a playback session when a playback action is initiated. Navigation, search, sort changes, favourites changes, and scrolling must not rewrite that session. A new explicit Play/Shuffle/Play next/Add to queue action can change it. See section 9 for exact semantics.

### P0: Landscape Is Not a Usable Browsing Layout

**Phone:** in landscape, DmeX's wordmark overlaps system status text. The navigation bar occupies the right side, but content and controls do not reserve it consistently. The metadata warning, category strip, collection artwork, floating Optimize action, and large mini-player consume almost all the usable height.

**Source:** many adjustments depend only on `max-width: 768px`; a rotated phone can exceed that width while remaining a mobile device. Other rules use the Android platform selector, creating mixed layouts. `MainActivity.kt` intentionally draws edge-to-edge and into cutout areas, while CSS relies on fixed offsets in several places (`App.css:1842`, `App.tsx:1315`).

**Fix:** retain mobile identity in landscape; use window width AND height for adaptive composition. Bridge actual native system-bar/cutout insets when WebView CSS environment values are insufficient. Reserve all four edges. Use a compact collection header and mini-player; remove persistent maintenance overlays. Never turn a rotated phone into the desktop UI.

### P0: Back Handling Is Fragmented and Sometimes Does Nothing

**Phone:** pressing Android Back while DmeX Settings was open left Settings open.

**Source:** two separate `popstate` listeners manage different subsets of UI (`App.tsx:296`, `App.tsx:503`). Settings, search, selection, playlist popup, sort menu, and track menus are not all represented consistently. Prefix routing also treats `PLAYLIST_GALLERY` as a playlist detail because it starts with `PLAYLIST_`; this can push artificial history entries even for the gallery.

**Fix:** a single mobile route stack plus overlay stack, one Back dispatcher, explicit route types, and a single bridge to Android navigation. Do not independently push fake browser history from multiple effects.

### P1: Smart Collections Do Not Have Stable Definitions

**Source:** `PlaylistGalleryView.tsx:28` routes Recently added to `ALL`. It uses the library array's first four entries for artwork and counts the whole library. Changing the general Tracks sort changes what Recently added effectively means.

**Source:** Most played card counts every track with positive listen time, while the detail selector takes only the first 50 (`App.tsx:332`). The card and detail therefore can disagree. Favourite card uses `favoritesSet.size`, whereas detail uses only visible tracks; hidden/unavailable entries can inflate the card count.

**Phone:** Favourite tracks opened a large generic detail presentation, with duplicated single-cover collage, `1 tracks`, and its only song pushed near/under the mini-player. The collection does work, but its hierarchy is unsuitable for fast browsing.

**Fix:** dedicated collection selectors and routes. Count, artwork, membership, sort, and displayed list must derive from the exact same selector. Favourites stays a first-class collection; Recently added is not an alias for Tracks. Add Recently played only after recording real listening events.

### P1: The Same Track Has Different Actions in Different Screens

**Source:** All Tracks uses `VirtualList`/`TrackRow`; custom playlists use `DraggablePlaylistView`; album/artist/favourite/top detail uses a separate inline mapped row (`App.tsx:1618`). Detail rows lack the regular playlist-add action. Custom playlist rows expose a direct red remove button instead of the same overflow menu.

**Phone/Source:** the mobile stylesheet hides `.time-cell`, including its actions (`App.css:1852`). There is no standard row overflow menu on the inspected Tracks screen. Long press is implemented differently across these row types.

**Fix:** one mobile row with consistent title, artist, artwork, state, optional duration, overflow, and selection behavior. Reorder handles appear only in explicit edit mode. Keep multi-select checkboxes as selection controls; they are not settings toggles.

### P1: Global Maintenance UI Dominates Listening

**Phone:** the warning "Metadata unavailable for 5 tracks" persisted across Tracks, Albums, Artists, Favourites, and Discover. It does have a close button in this build; this is not a claim that dismissal is impossible. The floating Optimize count overlapped sorting or content on detail screens.

**Source:** a shared `scanProgress` string carries scan results, errors, lyrics-save messages, and other operations. Metadata failures are kept in a process-local set and retried via scanning; bulk audio fingerprinting is labelled generically as optimization.

**Fix:** non-blocking activity/status center under Library settings. Transient results can show a short dismissible snackbar. Failed metadata has a named list and Retry failed action. Ordinary listening must not be presented as incomplete because optional fingerprint analysis has not run. Rename the operation to Analyze audio profiles; do not promise a perfect DSP profile.

### P1: Search Scope Is Ambiguous

**Source:** the header search filters `displayedTracks`, but Albums and Artists render independent local search state from `visiblePlaylist`. The header promises tracks/artists/albums while those galleries do not consume its query. Closing the overlay does not clear the shared query. A later detail view can silently remain filtered.

**Phone:** Albums and Artists show separate searches, while the header still offers another search. Discover has another search system and a Search button that overlaps its long placeholder.

**Fix:** one mobile search route with grouped Tracks/Albums/Artists/Playlists results and explicit local/online scope. A collection can offer Search in this collection as a separately labelled action. Back restores the originating view, scroll position, and selection context.

### P1: Text Contrast and CSS Ownership Are Unreliable

**Phone:** unselected category labels, smart-card counts, My Playlists, empty-playlist text, and some artist/album metadata were excessively dark on a dark background. No numeric contrast measurement was performed on those phone pixels.

**Source:** `--text-muted` begins at white alpha 0.28 (`App.css:84`), then opacity is reduced further in places. A broad structural selector at `App.css:1498` changes descendant colors/backgrounds in the first content child; it can affect more than the intended sorting bar. Numerous repeated `!important` rules make ownership unclear.

**Fix:** scoped mobile tokens and named component selectors. Measured contrast against the final composited glass surface, not against its unblurred source color. Use opaque-enough text and distinguish disabled state from ordinary secondary information. Do not modify shared typography globals as part of mobile work.

### P1: Playlist Editing Has Persistence and Interaction Gaps

**Source:** gallery creation uses browser `prompt`; deletion uses `confirm`. The add-to-playlist flow creates a playlist through `createPlaylist`, but does not automatically add the pending tracks. User has to select the newly created playlist again. Remove/reorder failures are console-only; optimistic state can look saved when persistence fails.

**Source:** `db.rs:136` replaces playlist items using multiple statements without an explicit transaction. A failure midway can leave partial contents. No rename flow is exposed by the reviewed gallery.

**Fix:** one accessible create/rename sheet, predictable Create and add behavior when invoked from tracks, transactional saving, error feedback, and Undo where suitable. Distinguish removing a playlist entry, deleting a playlist, removing a library item, and deleting a physical file.

### P1: Android Playback-Service Integration Needs Completion/Verification

**Source:** the repository contains a media-session plugin, notification service, media-button callbacks, and audio-focus handling. The reviewed application builder does not register that plugin (`src-tauri/src/lib.rs:764`), and no corresponding media-session state/action bridge was found in the current frontend. Presence of a plugin directory is not proof that the installed app uses it.

**Source/Risk:** end-of-track advancement currently depends on WebView polling (`App.tsx:555`). Screen-off/background scheduling can differ from foreground behavior. This was not reproduced as a playback failure in this audit.

**Fix:** native playback service/session must own authoritative transport state and queue advancement, with the React UI acting as a controller. Reuse and validate the existing bridge first; do not replace the C++ decoder/DSP with ExoPlayer just to obtain a queue. If Media3 is adopted, adapt the existing engine to its player/session contract after a separate technical spike. Test headset, lock-screen, notification, audio-focus and process-lifecycle behavior explicitly.

### P2: Transport Rules Need a Consistent Contract

**Source:** Repeat One is checked inside the shared Next handler, so a user pressing Next can replay the current track instead of advancing. Previous can wrap from the first track even when repeat is Off. Playback history is pushed by Next, not uniformly by every successful track transition.

**Fix:** separate automatic completion from explicit Next. Repeat One affects automatic completion; manual Next advances. Previous restarts after a defined elapsed threshold, otherwise returns to the prior queue/history entry; it does not unexpectedly wrap with repeat Off. All entry points use the same controller.

### P2: Listening Statistics Are Not a Clear Product Model

**Source:** Most played is ranked by accumulated seconds, not play count. Frontend wall-clock accumulation drives listen time. Play count is recorded at completion. There is no reviewed last-played event table for Recently played. `db.rs:36` falls back to Unix ctime for added-date inference; ctime is not generally file creation time, and `content://` URIs cannot be inspected with ordinary filesystem metadata.

**Fix:** preserve existing totals, define eligible listening events from real playback position/state, and explicitly select whether Most played means qualified plays or listening time. Recommend qualified play count with listening-time tie-break. Save library-added time separately from MediaStore added time and file modification time. No silent reinterpretation of old timestamps or destructive migration.

### P2: Album and Artist Data Need Better Identity Rules

**Source:** album gallery groups by album name alone, merging unrelated releases with the same title. Track model lacks album-artist/disc/track-number fields, so album sequencing falls back to global sort. Artist splitting treats ampersands and words such as "and" as delimiters; some actual band names can be split incorrectly. Artist dictionary initializes no local art fallback.

**Phone:** Artists begins with low-value names such as `.Se` and `.Social`; generic placeholders dominate the visible sample. This demonstrates noisy identity data, not that every artist is wrong.

**Fix:** stable album IDs using album/album-artist/disambiguation metadata, disc/track ordering, non-destructive display cleanup, conservative artist parsing, and manual merge/exclude corrections. Do not auto-fetch images for obvious website/unknown identities. Use confirmed artwork or neutral initials; do not assign unrelated playing-track artwork to a collection.

### P2: Album Browsing Is Visually Irregular

**Source/Phone:** hash-selected large mosaic tiles, overlaid titles, and a Shuffle Albums operation make library scanning unpredictable. Shuffle Albums rearranges gallery cards; it does not shuffle playback. This is easy to confuse with a transport action.

**Fix:** uniform artwork grid or compact list, labels outside artwork, explicit sort, optional view mode. Remove gallery shuffle from the mobile primary toolbar or name it unambiguously. No desktop gallery change is required.

### P2: Artist Maintenance Is Too Prominent and Can Be Wasteful

**Phone/Source:** Wipe Art is a primary artist-screen action; its handler has no confirmation. Sync state belongs to a gallery component. The sync effect depends on `allArtists`, which is derived from the changing playlist; periodic statistics updates can change that array and restart the effect during a long sync.

**Fix:** move cache reset into Settings with clear scope and confirmation. Give artwork jobs stable artist IDs, cancellation, persisted checkpoints, deduplication, and bounded concurrency. Keep normal browsing and audio playback prioritized.

### P2: Cloud Playback Bypasses the Normal Loading Path

**Source:** `App.tsx:1416` downloads and directly loads cloud audio, then updates only some UI state. It does not use the normal `playTrack` path, complete metadata/palette/lyrics updates, or a cloud queue. Local Next can fall back to a local track because the temporary cloud path is not in the local library. Search failures are converted to an empty result list and console messages. Request cancellation/stale-result protection is absent in the reviewed view.

**Fix:** one source-aware load pipeline and queue-entry model for local URI and cloud ID. Distinguish offline, no matches, provider error, download, buffering, and playback failure. Online playback is optional and must not block local music. Provider permissions/availability must be reviewed before presenting it as a production dependency.

### P2: Accessibility and Long-List Behavior Are Inconsistent

**Source:** many clickable cards/rows/sort controls are plain divs; several icon-only mini-player and playlist actions lack accessible names. The All Tracks list is virtualized but detail and custom-playlist lists mount all rows. Scroll restoration observes the parent container while several children own their own scrolling.

**Fix:** semantic interactive controls, visible focus, TalkBack names/states, consistent selection, one scroll owner per screen, and a unified virtualized track list with a virtual header. Reorder must also have accessible Move up/Move down alternatives. Restore per-route scroll using an item anchor plus offset.

## 6. Proposed Mobile Information Architecture

### Main Browsing Categories

Keep the familiar horizontally scrollable category navigation and autoselect-on-settle behavior. Proposed order:

`Favourites | Playlists | Tracks | Albums | Artists | Folders | Discover`

- Default landing category: Tracks, or restore the user's last main category after a successful session.
- Folders is a genuine browser based on permitted storage roots, not a second scanner. It is a later increment if it delays essential queue/navigation work.
- Discover remains separate and optional; a local music task must never require a network request.
- The selected category stays clearly legible. Nearby categories remain readable, not almost black.
- Detail pages get a compact back/title/count header instead of retaining the full app masthead and full category strip above a huge title.
- Preserve tab scroll position and autoselection; prevent programmatic centering from causing another unintended navigation.

No new permanent bottom navigation bar is recommended initially. A category strip plus another full bottom navigation would compete with the mini-player and duplicate destinations.

### Mobile Shell Wireframe

```text
Portrait library
+-------------------------------------------+
| system inset                              |
| DmeX Player                 Search  More   |
| ... Playlists  TRACKS  Albums ...          |
| count / sort                     Shuffle  |
| artwork  Title                   menu     |
|          Artist                           |
| artwork  Title                   menu     |
|          Artist                           |
| ... one continuous scrolling list ...     |
| [art] Current song   Prev Play Next Queue |
| bottom system inset                       |
+-------------------------------------------+

Collection detail
+-------------------------------------------+
| Back  Favourites               More       |
|       24 tracks                           |
| compact artwork   Play    Shuffle         |
| track rows immediately visible            |
| ...                                       |
| persistent mini-player                    |
+-------------------------------------------+

Landscape library/detail
+-------------------------------------------------------------+
| side inset | compact title/actions              | side inset |
|            | compact categories, if main page   |            |
| optional   | list/grid: owns remaining height   |            |
| summary    | no large stacked browsing hero     |            |
|            | mini-player: compact, single row   |            |
+-------------------------------------------------------------+
```

Wireframes show hierarchy, not final dimensions or approved screen designs.

## 7. Screen-by-Screen Specification

| Screen | Required mobile behavior |
| --- | --- |
| Tracks | Compact count/sort/action bar; persistent sort and direction; uniform rows; optional alphabet index for title/artist sort; no mandatory Optimize overlay |
| Favourites | Same destination from tab, smart card, or shortcut; count only available visible favourites; inline unfavourite via menu; undo; no automatic queue replacement |
| Playlists | Compact smart collections followed by user playlists; plus button opens a named creation sheet; playlist overflow offers rename/edit/delete; distinguish smart from user-created |
| Recently added | Own route; descending immutable library-added timestamp; proposed default is latest 100 available tracks, with a visible configurable limit; artwork/count match that same set |
| Recently played | Own route; unique tracks by last qualified listening event; proposed latest 100; replay updates position rather than duplicating the collection row; separate from editable queue history |
| Most played | Own route; visible ranking definition; proposed top 50 qualified-play ranking with listened-time tie-break; card/detail count agree |
| Playlist detail | Compact cover/name/count/duration; Play and Shuffle establish playback context; Edit mode enables reorder/select; remove entries with undo; empty state can add tracks |
| Albums | Uniform adaptive grid/list; actual artwork; names/artists below image; stable sort; no hash-based prominence; no play-shuffle icon that only rearranges cards |
| Album detail | Artist/year/track count/total duration; disc and track sequence; per-track overflow; Play/Shuffle; no unrelated albums merged solely by title |
| Artists | Readable list or adaptive grid; tracks/albums count; album-art fallback or initials; maintenance hidden from primary toolbar |
| Artist detail | Clear identity, albums and tracks sections, consistent menus; no giant generic collage required before seeing songs |
| Folders | Only permission-backed roots; folder tree/breadcrumbs, counts, include/exclude management; no permission bypass or hardcoded nonexistent paths |
| Search | Dedicated route; grouped results and explicit scope; keyboard-safe; cancellation and empty/error states; return to origin without losing position |
| Queue | Current item, Up next, source context, total count, reorder, add/remove, save as playlist, clear upcoming with undo, jump to current |
| Settings | Dedicated mobile page with Library, Appearance, Playback, Audio, Lyrics, Storage, About; accessible Back; optional nested sheets only for small choices |
| Library activity | Scanning, metadata, profile analysis and art sync shown as distinct jobs; failures list/retry; pause/cancel where supported; no permanent global error banner |
| Discover | Compact search/results-first page; optional provider; local/online boundary clear; errors and loading visible; source-aware playback pipeline |
| Expanded player | Frozen. Continue to render the existing dedicated mobile component, not the desktop expanded view |

Collection limits, ordering, and Most played semantics above are explicit proposals for approval, not changes made to your library.

## 8. Standard Track Actions and Selection

Tap a track: play it with a snapshot of the list context. If another session has manually queued items, show a compact replacement choice rather than silently discarding them. A user preference can later choose Replace queue or Play now and keep upcoming.

Overflow menu, in stable order:

1. Play next.
2. Add to queue.
3. Add to playlist.
4. Add/remove favourite.
5. Go to album / Go to artist.
6. Track details.
7. Share, only if the URI and permission model supports it.
8. Context-only Remove from playlist or Hide from library.

Deleting a physical file is not required for this redesign; if introduced later, it needs its own explicit destructive confirmation and Android permission flow.

Long press enters selection mode consistently. The toolbar shows selected count, Select all, Play, Queue, Add to playlist, and context-appropriate removal. Android Back first exits selection. Taps on menu buttons must never also start playback. A drag gesture must not become a track tap on release.

Artist/album navigation and queue operations must work from search results and smart collections, not only All Tracks.

## 9. Queue: Complete Behavioral Contract

### Queue Is Not a Playlist and Not a View

- A playlist is a saved collection.
- A library view is a browsing query.
- A playback queue is an ordered session with an active entry, history and upcoming entries.
- Changing one does not silently rewrite the others.

### Proposed Data Shape

```ts
type QueueEntry = {
  id: string;                 // unique per occurrence, not per song
  trackId: string;
  source: 'local' | 'cloud';
  sourceId: string;           // stable URI/ID; do not persist expiring stream URLs
};

type PlaybackSession = {
  version: 1;
  entries: QueueEntry[];
  currentEntryId: string | null;
  originalOrder: string[];
  shuffleOrder: string[];
  historyEntryIds: string[];
  repeat: 'off' | 'all' | 'one';
  shuffle: boolean;
  origin: { kind: string; id?: string; title: string };
  positionSeconds: number;
  revision: number;
};
```

This is a design contract, not a patch. Stable track identity must be introduced without losing existing path-keyed favourites/lyrics. Duplicate queue occurrences are valid and need distinct IDs.

### Exact Rules

| Action | Expected outcome |
| --- | --- |
| Play collection | Snapshot its eligible order and begin at first entry; explicit replacement policy applies |
| Tap a song | Start at that occurrence within its current collection snapshot |
| Shuffle collection | Create a session with stable shuffled order, not a new random choice each Next |
| Play next | Insert immediately after current; repeated selections retain their insertion order in a next-up block |
| Add to queue | Append after the current upcoming entries |
| Edit/reorder upcoming | Commit atomically; never reload or cut off the current audio |
| Remove upcoming | Remove that occurrence only; offer undo |
| Remove current | Require explicit skip/stop semantics; never make the UI and native engine disagree |
| Clear upcoming | Retain current playback; remove future entries with undo |
| Save queue | Create playlist from chosen session entries in their current order; explain duplicate policy |
| Manual Next | Advance regardless of Repeat One; do not reselect current just because repeat is enabled |
| Automatic completion | Repeat current only in Repeat One; otherwise advance; stop at end with repeat Off |
| Previous | Restart current after proposed 3-second threshold; otherwise return to prior history entry; do not wrap with repeat Off |
| Toggle shuffle | Preserve current item; shuffle only future traversal; disabling restores remaining original order without replaying completed items unexpectedly |
| Browse/search/sort | Never mutate the active queue |
| Unfavourite/delete playlist | Queue snapshot remains, provided underlying tracks are still accessible |
| Missing/filtered/revoked URI | Mark unavailable, explain and skip according to policy; bounded attempts prevent loops |
| Rapid taps/skips | Serialize session revisions; newest intent wins; stale load/palette/lyrics cannot overwrite active entry |
| App restart | Restore queue/current position paused; never autoplay unexpectedly |
| Screen off | Native queue advancement continues; UI timers are not required for transport correctness |

The queue screen should offer a compact queue-empty state, current-position indicator, source title, drag handles in edit mode, and accessible move actions. It must not open the expanded player just to inspect upcoming tracks.

## 10. Navigation and Back Contract

Use explicit discriminated routes, not string prefix parsing:

```ts
type MobileRoute =
  | { kind: 'library'; tab: 'tracks' | 'favourites' | 'playlists' | 'albums' | 'artists' | 'folders' | 'discover' }
  | { kind: 'collection'; collection: 'recentlyAdded' | 'recentlyPlayed' | 'mostPlayed' }
  | { kind: 'playlist'; playlistId: string }
  | { kind: 'album'; albumId: string }
  | { kind: 'artist'; artistId: string }
  | { kind: 'search'; originKey: string; scope: 'library' | 'collection' | 'online' }
  | { kind: 'queue' }
  | { kind: 'settings'; section?: string };
```

Back dismisses one highest-priority state only: open option popup, input/sheet, selection, search/detail route, then expanded overlay where applicable, then normal Android root behavior. Keyboard dismissal must cooperate with Android rather than manually racing its IME. Preserve the frozen player's existing close behavior through an adapter, not a layout rewrite.

Store originating route and scroll anchor for every detail/search transition. Favourites opened from Playlists returns to Playlists; Favourites opened as a main tab remains a main tab. Route identity and collection identity are separate.

All sheets need focus containment, a visible dismissal action, focus restoration, safe-area/keyboard sizing, and a maximum scrollable content height. Do not stack unrelated modals merely by giving each a higher z-index.

## 11. Visual Direction: Colorful Glass Without Visual Noise

### Surface Hierarchy

1. Stable neutral dark/light base for the library.
2. Low-intensity artwork tint behind browsing chrome.
3. Glass only where it communicates layering: mini-player, top chrome, action sheets, small contextual controls.
4. Real artwork remains sharp and inspectable.
5. Text-heavy lists remain high-contrast and mostly unblurred.

No floating page-section cards inside other cards. Track lists are continuous unframed content. Repeated album/playlist tiles can be framed. Keep tile radii at 8 px or below in new browsing components; modal/sheet and existing player geometry are handled separately.

### Proposed Tokens

- Semantic names: `mobile-bg`, `mobile-surface`, `mobile-glass`, `mobile-border`, `mobile-text`, `mobile-text-secondary`, `mobile-accent`, `mobile-on-accent`, `mobile-danger`.
- Navy is the fallback only when confirmed artwork is missing or invalid.
- Playing-track palette tints global chrome; a collection may own its small artwork/header tint without changing playback or the mini-player palette.
- Cache palette by stable artwork identity. Retain previous palette until the next complete palette is ready.
- Do not assume white text is readable on every album-derived color. Derive foregrounds against actual resulting surfaces and constrain tint luminance/saturation.
- Do not add decorative gradients/orbs behind library content. Color comes from media and controlled translucent layers.
- Semantic red remains reserved for destructive/error states, not routine audio or navigation defaults.

### Typography and Controls

- Proposed browsing title 20-24 CSS px; track title 15-16; artist 13-14; metadata 12-13. These are initial tokens, validated with system font scaling, not viewport-scaled fonts.
- Zero letter spacing for new UI. No viewport-width font scaling.
- Artwork thumbnails 44-48 CSS px and rows initially 68-76 CSS px; verify CSS-to-dp mapping on actual devices.
- Aim for Android's minimum 48 dp interactive target with spacing; small icons can live inside larger invisible hit areas.
- Use Lucide icons, accessible labels, pressed/selected state, and consistent placement. Use toggles for binary settings, radio-style custom sheets for option sets, sliders for numeric values.
- Do not convert multi-selection checkboxes into on/off setting switches.
- No overlapping placeholders/buttons, clipped final words, invisible secondary labels, or dual moving marquees in normal library browsing.
- Mini-player can use one delayed title marquee only when needed; respect reduced motion. Artist can ellipsize.

### Motion and Performance

- New browsing motion should be short and purposeful, predominantly opacity/transform. No decorative animation on every list row.
- Avoid a live full-screen blur under a scrolling list. Blur a bounded static tint layer, with a visually compatible low-cost fallback.
- Do not put `will-change` and separate compositor layers on every long-lived item without measurement.
- Virtualize all large track collections, including favourites and custom playlists, using one scroll owner.
- Do not introduce animation frame caps. Rendering should follow available display refresh while heavy background work is kept off the interaction path.
- Do not touch current expanded-player transition or visualizer implementation in this phase.

## 12. Portrait, Landscape, Large Phones, and Small Phones

| Condition | Proposed behavior |
| --- | --- |
| Portrait phone | Compact app header, scroll categories, one content region, mini-player above bottom inset |
| Short landscape phone | Single compact title/action row; condensed category row only on root; horizontal collection summary; 56-64 CSS px mini-player starting target; full list height prioritized |
| Wider landscape/tablet | Optional collection summary/list split; artwork grid gains columns based on available content width, not a forced two-column Android rule |
| Small width | Title/artist flex children use `min-width: 0`; actions retain hit areas; secondary toolbar actions move into overflow |
| Large text | Rows may grow; virtualization measures changed heights; no fixed-height clipping of translated or multiline labels |
| Keyboard open | Search/sheet content remains reachable; use visual viewport/native IME insets; mini-player may be temporarily tucked away on search, without stopping playback |
| Gesture navigation | Bottom gesture area reserved without double padding |
| Three-button navigation | Bottom or side navigation bar reserved in both rotations |
| Fold/split-window resize | Recompute container layout, not device identity; preserve route, queue, scroll and playback |

Use `100dvh` where appropriate for the new shell, and real inset values, not a universal 60 px top spacer or hardcoded popup top. Expanded-player geometry remains frozen; its landscape limitations are a separate approval item.

## 13. Functionality and Data Work Beyond Appearance

### Library and Metadata

- Keep exactly the existing four scan entry choices: Music folder, Internal Storage, Downloads, Custom. Custom must invoke the real Android folder picker.
- Scan progress distinguishes discovery, database import, metadata extraction, and optional audio analysis.
- Track known metadata status and failures per item with reason, retry count, and last attempt; suppress repeated generic warnings.
- Do not delay local playback until art, lyrics, fingerprint analysis, or online lookups finish.
- Reuse cached metadata unless source identity/modification changes; preserve existing concurrent-request deduplication.
- Keep minimum-duration and call-recording filters. Explain unknown durations rather than permanently discarding unparsed files.
- Folder exclusion is separate from deletion. Rescan must not reset favourites, stats, playlist order, or already-added timestamps.
- Support every format the native decoder genuinely supports; test MP3, FLAC, WAV, M4A/AAC, Ogg/Opus and other advertised types with real fixtures. Never claim every extension is supported without decoder verification.

### Playlists and Favourites

- SQLite is authoritative; avoid divergent copies in vault and component state.
- Playlist mutations use a transaction and structured result. Optimistic changes have rollback or retry.
- Create/rename names are trimmed and nonempty, with clear duplicate-name policy.
- Create and add must add the selected tracks in one completed workflow.
- User playlists store stable ordered references; show unavailable entries without silently replacing the playlist with all tracks.
- Favourites membership and counts use one eligible selector; toggles report persistence failures and can undo.
- Keep legacy path/URI mappings during stable-ID migration.

### Listening History

- Native playback state/position should determine actual audible listening, not elapsed JS wall-clock alone.
- Define qualification for a play, skip, completion and last-played update. Suggested qualification: at least 30 seconds or half of a short track, whichever is less; this needs approval and fixture tests.
- Do not count seek jumps as listened time. Pause/buffering must not accumulate it.
- Preserve historical accumulated seconds. Introduce explicit event versioning instead of rewriting old totals.
- Recently played, play count and queue history are different concepts and must not share one ambiguous array.

### Lyrics

- Keep the Gemini API-key setting; it exists in the inspected build and is not currently missing.
- Keep manual song-name/singer-name retry inputs. They already exist after failed search in `LyricsSearch.tsx`.
- Add a clear key configured/not configured indicator, optional key validation, remove-key action, and safe local storage review. Never log or expose the key.
- Distinguish no synced lyrics, instrumental, no match, offline, provider failure and save failure.
- Keep lyrics request cancellation and current-track identity guards. Late results may be saved to the correct track, but must not replace another track's display.
- A future plain-text lyrics fallback, manual LRC import/edit/offset, and search-history UI require separate approval because they affect the frozen player experience.

### Audio/DSP User Understanding

- Keep quick Track Options distinct from advanced DSP controls.
- Raw Stereo/Bypass is a global processing state, not a queue action. Preserve the existing function and communicate state consistently outside the frozen player if approved.
- Do not equate output sample rate with improved source quality or make DAC claims without measurement.
- The current `applySmartSettings(_profile, taste)` does not use its profile argument (`App.tsx:643`). Fingerprint analysis should not be advertised as automatically choosing profile-specific DSP until that linkage is defined and tested.
- Show actual native accepted values, bypass state and asset availability. UI animation alone does not prove audible processing.
- Auto reverb, existing single intensity control, manual expansion, and processing quality should remain intact. No replacement or retuning in this UI proposal.

### Online and Recovery

- Local music remains usable offline, without an API key, without artist art, and after online provider failure.
- Source-aware queue entries re-resolve cloud streams; cache files are bounded and do not become broken permanent library identities.
- Connectivity and decode failures offer retry/skip rather than unexplained stop or a console-only error.
- No silent resume after user pause or permanent audio-focus loss. Existing plugin code resumes on focus gain; integrate only after validating user-intent rules.

## 14. Architecture That Protects Desktop and the Player

Proposed boundaries, not files created in this audit:

```text
shared domain/data services
  library repository / metadata / lyrics / audio controls
  playback-session commands and native events

desktop presentation (existing, unchanged)

mobile presentation
  MobileAppShell
  MobileNavigation + route/overlay controller
  MobileLibraryScreens
  MobileTrackList + MobileTrackActions
  MobileMiniPlayer + MobileQueueScreen
  MobileSettingsScreens + MobileActivityStatus

existing MobileExpandedPlayer (unchanged)
  adapter supplies existing props and callbacks
```

Implementation rules:

1. Select platform presentation once; use available window size only to adapt within mobile. Android platform identity must not flip on rotation.
2. New mobile shell CSS is scoped below a unique root, such as `.dmex-mobile-shell`. Do not change global `.track-item`, `.bottom-player`, `.glass-options-menu`, or text tokens and assume desktop/player will be unaffected.
3. Avoid wrapping the protected player in new typography or layout inheritance. Explicitly preserve its palette, props, mount behavior, stacking and event contract.
4. Introduce a typed mobile route reducer and overlay dispatcher with unit tests before replacing screen markup.
5. Introduce queue state and commands behind a clear API. Shared native/data changes need desktop regression tests even when no desktop UI is changed.
6. Stage mobile opt-in wiring so the desktop controller is not silently switched to new transport rules during the UI rollout. Shared engine changes should be separately reviewable.
7. Use existing React, TypeScript, Tauri, Lucide and local controls unless a focused dependency clearly reduces real complexity. No wholesale framework rewrite is needed.
8. Do not maintain two competing truths for playback, queue index, favourite state or saved playlist content.
9. Make database migrations additive, backed up, versioned and testable against an existing populated library.
10. Keep audio decoding/DSP off the rendering thread. UI events submit commands and reconcile acknowledged state.

## 15. Proposed Implementation Order and Approval Gates

### Phase A: Behavioral Foundations

Deliver typed routes/Back handling, source-aware queue model, collection selectors, transactional playlist mutations, and focused regression tests. Keep visual changes minimal while contracts stabilize.

Approval evidence: queue is independent of browsing; collection destinations/counts are correct; Back closes one layer; migrated data survives restart.

### Phase B: Dedicated Mobile Shell

Deliver scoped mobile header/navigation, safe-area bridge, compact mini-player with queue access, accessible rows/menus, and portrait/landscape browsing. Freeze desktop and expanded-player snapshots.

Approval evidence: actual phone screenshots and interaction checks, not browser mockups alone. No overlap with system bars and no desktop/player layout diff.

### Phase C: Library and Collection Screens

Deliver Playlists/Favourites/Recently added/Recently played/Most played, album/artist identity improvements, unified search, Settings organization, and maintenance/status center.

Approval evidence: end-to-end journeys, restart persistence, no hidden filters, real content/error/empty/loading states.

### Phase D: Artwork Glass and Motion

Apply approved mobile tokens, bounded translucency/blur, artwork tint transitions and restrained browsing motion. Do not change the expanded player's theme logic or visuals.

Approval evidence: measured contrast, low-end-device frame pacing, bright/dark artwork, missing art, large text and reduced motion.

### Phase E: Android Product Reliability

Complete or repair native service/media-session integration, native end-of-track queue advancement, headset/system controls, and resume behavior. Use a separate technical change set and explicit audio/device tests.

Approval evidence: screen-off and background sessions, focus changes, output disconnect, media buttons, process recreation, and regression of existing C++ DSP.

Native queue/service correctness is a release prerequisite even if Phase E is developed in parallel. A polished foreground queue alone is not the finished feature.

Do not combine every phase into one large unreviewable commit. Each phase should have an APK and a brief list of changed behaviors for approval.

## 16. Acceptance and Test Matrix

### Essential User Journeys

| Journey | Pass condition |
| --- | --- |
| Open app and resume | Last item/position restored paused; one tap resumes; no unexpected autoplay or scan prerequisite |
| Find a known song | Search produces clearly scoped results; play starts without waiting for art/lyrics |
| Browse while listening | Navigation, sort, search and favourites changes do not change upcoming order |
| Recently added | Opens named collection in correct order, not general Tracks; card/count/art match |
| Favourite song | All entry points reflect membership; persistence failure is visible; restart retains it |
| Create playlist from selection | Name -> Create and add -> success -> selected tracks present, no second unexplained action |
| Edit playlist | Reorder/remove/rename persist after restart; cancellation and failures leave recoverable data |
| Queue a duplicate | Two occurrences remain distinct; removing one does not remove both |
| Play next repeatedly | Selected insertion order is deterministic and visible |
| Repeat/shuffle/history | Off/All/One and manual/automatic advances follow section 9 exactly |
| Android Back | Menu/sheet/selection/search/detail each dismisses one layer; Settings does not remain stuck |
| Rotate while browsing | No system-bar overlap, lost route, queue restart or hidden actions |
| Receive missing-file error | Clear unavailable state; bounded skip/retry; no endless transition loop |
| Lyrics unavailable | Current manual title/singer retry and key settings remain accessible; no unrelated track overwrite |
| Background playback | Automatic next and system controls remain correct with WebView inactive |

### Required Devices and Layouts

- S25 Ultra: portrait, both landscape directions, current font/display scale, gesture and three-button navigation where practical.
- Smaller/lower-powered Android device or emulator: approximately 320/360 CSS px widths and short landscape heights; not merely a desktop window resized to look like a phone.
- Browser component tests: 320x640, 360x800, 412x915, 640x360, 800x360, 915x412, tablet/split-window sizes. Resolve native CSS viewport sizes separately from screenshot pixels.
- Font scaling 100%, 130%, 150%, 200%; long Hindi/Gujarati/Korean/Latin titles; RTL where supported.
- Dark/light, bright/dark/monochrome/no artwork, rapid A->B->C metadata completion out of order.
- Empty library; 1 track; 50 tracks; 2,000+ tracks; large favourites and large custom playlists.
- Permission granted/denied/revoked, valid persisted tree URI, removable/missing source, offline and provider timeout.
- Real supported audio fixtures including FLAC and WAV; format-specific unsupported/corrupt cases reported honestly.

### Performance and Safety Gates

- Proposed touch feedback target: next visible frame under ordinary load; measure p50/p95 for menu/search/navigation rather than claiming zero lag.
- Profile scrolling against the current baseline on the same device; record frame pacing, dropped frames, memory and CPU. Do not infer low-end performance from S25 Ultra alone.
- No fixed FPS limiter. Budget expensive effects so display-refresh rendering remains possible.
- Local warm-start playback target can initially be p95 under 500 ms on agreed fixtures; cold/large/lossless cases reported separately. This is a target, not a result measured in this audit.
- No long-list DOM explosion, layout thrash on each scroll event, repeated global palette extraction, or synchronous metadata work in a tap handler.
- Desktop screenshot/interaction regression must remain unchanged. Native shared-service regressions must be tested on desktop too.
- Protected expanded-player screenshots, geometry, lyrics/DSP placement, visualizer nonblank checks and transition behavior must match baseline. No new queue control is inserted there during this phase.
- Test process death, database write failures and interrupted playlist transactions before claiming persistence complete.
- No destructive manual tests on the user's real music library. Use test data and reversible fixtures.

## 17. Expanded Player: Observations Only, Deferred

The inspected player has a coherent composition: large artwork, track identity, atmospheric visual background, stable lower transport controls and intentionally placed lyrics/DSP access. Preserve it.

Potential later improvements, requiring separate approval:

- Readability of inactive taste options and secondary text over all artwork palettes.
- Explain Manual Override and Raw Stereo states consistently without making disabled controls look broken.
- Queue access from the player after the standalone queue is established.
- Short-height landscape and very large system-font behavior.
- Accessibility names/states for favourite, transport and repeat/shuffle controls.
- Expanded DSP/lyrics readability, scroll behavior and reduced-motion preferences.
- Any particles, ripple scale, art crop, motion timing or visualizer changes.

These are not permission to alter the current player now. Improvements to shared parents/tokens must not accidentally implement them.

## 18. Evidence Files and Source Map

Phone references are ignored local artifacts under `music-player-ui/tests/artifacts/`. Do not upload screenshots containing the user's library to GitHub by default.

| Evidence | Local artifact |
| --- | --- |
| Samsung category/playlist layout | `audit-samsung-playlists.png` |
| Samsung queue | `audit-samsung-queue.png` |
| Samsung collection detail | `audit-samsung-recently-played.png` |
| Samsung landscape collection | `audit-samsung-landscape.png` |
| DmeX Tracks / navigation | `audit-dmex-tracks.png`, `audit-dmex-navigation.png` |
| DmeX smart cards | `audit-dmex-playlists.png` |
| DmeX favourite detail | `audit-dmex-favourites.png` |
| DmeX landscape | `audit-dmex-landscape.png` |
| DmeX Albums / Artists | `audit-dmex-albums.png`, `audit-dmex-artists.png` |
| DmeX menu / Settings / Back result | `audit-dmex-menu.png`, `audit-dmex-settings.png`, `audit-dmex-back.png` |
| Protected player / embedded DSP | `audit-dmex-expanded-baseline.png`, `audit-dmex-dsp.png` |

Some screenshot captures include transient system UI, such as a volume overlay, that is not attributed to an application bug. No personal notification screenshot is retained as audit evidence.

Primary source locations (relative to repository root; line numbers refer to checkpoint):

- `music-player-ui/src/App.tsx:296`: overlay Back listener and history.
- `music-player-ui/src/App.tsx:312`: string-prefix route decoding and collection filtering.
- `music-player-ui/src/App.tsx:497`: parent scroll restoration.
- `music-player-ui/src/App.tsx:503`: second Back listener.
- `music-player-ui/src/App.tsx:532`: Next tied to displayed list.
- `music-player-ui/src/App.tsx:555`: metrics polling/end-of-track advancement.
- `music-player-ui/src/App.tsx:643`: taste settings ignore profile argument.
- `music-player-ui/src/App.tsx:683`: Previous behavior.
- `music-player-ui/src/App.tsx:710`: scan entry and import workflow.
- `music-player-ui/src/App.tsx:807`: metadata jobs and global status.
- `music-player-ui/src/App.tsx:900`: normal track-load pipeline.
- `music-player-ui/src/App.tsx:1010`: playlist mutations.
- `music-player-ui/src/App.tsx:1302`: create/add popup wiring.
- `music-player-ui/src/App.tsx:1308`: header search overlay.
- `music-player-ui/src/App.tsx:1416`: separate cloud-load path.
- `music-player-ui/src/App.tsx:1472`: large detail headers.
- `music-player-ui/src/App.tsx:1618`: three list presentation paths.
- `music-player-ui/src/components/layout/TopNav.tsx`: category/centering/menu implementation.
- `music-player-ui/src/components/library/TrackLists.tsx`: rows, selection, virtualization, dragging.
- `music-player-ui/src/views/PlaylistGalleryView.tsx:28`: Recently added redirect and smart counts.
- `music-player-ui/src/views/AlbumGalleryView.tsx`: album identity and gallery shuffle.
- `music-player-ui/src/views/ArtistGalleryView.tsx`: art jobs and destructive cache action.
- `music-player-ui/src/utils/artistEngine.ts:26`: artist delimiter parsing.
- `music-player-ui/src/components/player/MiniPlayer.tsx`: no queue entry and icon semantics.
- `music-player-ui/src/modals/modals.tsx`: folder choices, playlist popup and Settings.
- `music-player-ui/src/services/metadata.ts`: in-flight metadata deduplication; preserve it.
- `music-player-ui/src/components/player/LyricsSearch.tsx`: existing manual search retry.
- `music-player-ui/src-tauri/src/db.rs:36`: timestamp inference.
- `music-player-ui/src-tauri/src/db.rs:121`: listening statistics.
- `music-player-ui/src-tauri/src/db.rs:136`: playlist multi-statement persistence.
- `music-player-ui/src-tauri/src/lib.rs:764`: active plugin registration.
- `music-player-ui/src-tauri/gen/android/app/src/main/java/com/dmex/player/MainActivity.kt`: edge-to-edge and disconnect handling.
- `tauri-plugin-media-session/android/src/main/java/app/tauri/mediasession/MediaSessionCleanupService.kt`: existing service/focus implementation to assess, not assume active.
- `music-player-ui/src/App.css:1498`, `music-player-ui/src/App.css:1837`: broad structural styling and width-only mobile overrides.

## 19. Platform References

These are implementation constraints, not evidence of testing the finished redesign:

- Android recommends separating background playback/session ownership from the UI activity: [Background playback with a MediaSessionService](https://developer.android.com/media/media3/session/background-playback).
- Edge-to-edge content must account for system bars and available window space: [Display content edge-to-edge](https://developer.android.com/develop/ui/views/layout/edge-to-edge).
- Cutout behavior varies by orientation and must not obscure important controls: [Support display cutouts](https://developer.android.com/develop/ui/views/layout/display-cutout).
- Use adequate contrast and touch targets; Android recommends at least 48 dp interaction areas and 4.5:1 contrast for small ordinary text: [Make apps more accessible](https://developer.android.com/guide/topics/ui/accessibility/apps).

## 20. Approval Checklist

- [ ] Approve dedicated mobile shell; preserve current desktop and expanded player.
- [ ] Approve mobile navigation/category order and compact detail-header direction.
- [ ] Approve queue contract, replacement policy and mini-player queue entry.
- [ ] Approve smart-collection limits and Most played definition.
- [ ] Approve unified row actions, selection and playlist workflows.
- [ ] Approve landscape/safe-area work and native integration boundary.
- [ ] Approve restrained glass/artwork color treatment after a small visual prototype.
- [ ] Approve phased implementation, device tests, and reviewable commits/APKs.

Recommended first approval: Phase A plus a static/mobile-shell visual prototype for Phase B. Review the prototype before replacing the rest of the browsing screens. The current expanded player remains the protected baseline throughout.
