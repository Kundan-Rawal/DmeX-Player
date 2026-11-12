# Orbit D Branding and Navy Defaults

Date: 2026-10-24

## Approved Master

`design/branding/dmex-orbit-d-light-navy-v1.png` is the user-approved lighter
navy Orbit D. Its geometry, split stem, inner crescent and lower space cut are
preserved. SHA256:
`246fbaa45c6dbf8750e6dc7c0d5824126f779ae9a8bff6908baf1d5fa5bdf79f`.

## Applied Surfaces

- Desktop and mobile app header, Settings header and empty-library state.
- Browser favicon, touch icon and document title; Vite/Tauri/React placeholder
  logos are removed.
- Windows ICO/Appx/PNG and macOS ICNS assets generated with the Tauri icon CLI.
- Android launcher images at every existing density, round launcher, adaptive
  foreground/background and Android monochrome icon.
- Android Material theme primary/secondary colors in both day and night modes.
- OS icons and small in-app marks use a pale `#f4f7fc` backing so the approved
  graphite stem remains visible on dark launchers and taskbars. No redesign of
  the approved symbol is involved.

## Default Palette

Shared frontend values are in `src/config/brand.ts`, with initial CSS tokens in
`src/App.css`. Primary navy is `#3d6390`, deep navy `#1c3d6b`, midnight
`#102c50`, and the brighter small-text accent is `#7fa5d1`.

The previous red startup state, ambient palette, broken-artwork fallback,
greyscale palette fallback, empty-color helper, red placeholder color slots,
favourites artwork, artist-sync indicator/background, cloud-button fallbacks,
and fixed red play-button glow are replaced. Reverb's coral category accent
is now steel blue. Common toggle, dropdown and lyrics-search fallback accents
also use the brand color.

Clearing the library restores the navy defaults. During track changes the
current artwork colors remain visible until the next palette is fully ready.
Theme color, contrast text and ambient colors commit together, guarded by the
current track-load ID. Delayed metadata from a skipped track cannot overwrite
the current palette. Navy is selected only once metadata confirms no artwork
or artwork decoding fails, never as an intermediate loading color. Real album
artwork still supplies its own palette, including red when actually present.

Red remains intentional for errors, delete/remove/wipe actions, cancel/stop
scan and the Windows close-button hover. Other DSP category colors remain
distinct. These are semantic/control-specific colors, not the default brand.

## Preserved Behavior

No DSP, decoding, audio commands, library storage, metadata extraction, scanning,
lyrics handling, mobile expanded layout, animation timing, navigation scroll
selection or FPS limits were changed. Existing data and settings need no reset.
Header action labels/tooltips were added without moving or removing controls.

## Reproduction

From the repository root with the frontend dependencies installed:

```powershell
node scripts/generate_brand_icons.mjs
```

The script uses the approved master and `design/branding/icon-manifest.json`.
Intermediate images remain under ignored `.tools/`; only runtime assets are
copied to `public/branding`, `src-tauri/icons` and Android's resource directory.
It does not need an image-generation API or a new application dependency.

## Verification

`tests/branding.mjs` checks runtime navy defaults, failed/greyscale artwork,
no-art track transitions, preserved red artwork colors, delayed artwork-to-artwork
transitions without a navy flash, rapid-skip race protection, Settings toggles and
portal dropdowns, header/logo bounds, light/dark mode, PNG dimensions, native
adaptive/round icon references, and absence of old red defaults in production
TypeScript/CSS. Viewports: 1440x900, 360x800 and 320x800.

The existing visualizer, mobile-player, library/lyrics/settings, duration filter
and player-transition browser suites are also run. At 320x640 the original
lyrics-height behavior is deliberately retained, as previously requested.

The approved image is raster artwork, not an editable SVG master. macOS icons
are generated, but no macOS package can be executed or verified on this Windows
machine. Android icon appearance can additionally be affected by launcher cache
and the phone's themed-icon preference.

## Verified Build

- Production frontend build passed: `index-BDXPUeHE.js`.
- Branding and no-flash tests passed at desktop, 360 px and 320 px, including
  delayed metadata, complete-palette commits, rapid-skip stale-result rejection,
  missing artwork and broken artwork.
- Existing visualizer, mobile-layout, library/lyrics/settings, library-filter
  and player-transition checks passed. The Windows Tauri app built and launched
  through `npm run tauri -- dev --no-watch`; its embedded Orbit D icon was also
  extracted and visually verified.
- Signed ARM64 Android release built and passed APK signature verification.
  Its embedded native library hash matches the current build, and it contains
  the corrected frontend and Orbit D asset.
- APK size: 26,702,033 bytes. SHA256:
  `0492ef68f295d52fc0b29742e57d8113dbc27ad55a0b6bfeffd8fe0068a99094`.
- `adb install -r` returned Success on Samsung SM-A217F. Package update time:
  2026-10-24 14:10:26 local time, version 0.1.0.
- Existing app data was preserved. No phone app launch, playback interaction,
  volume change or screen capture was performed. Phone visual inspection is
  left to the user, as requested.

## Android App-Drawer Crop Fix

The first adaptive icon used the full unpadded image as its foreground. Tauri
CLI 2.10.1 does not apply `android_fg_scale` to adaptive foreground/monochrome
layers; that option is only consulted for a legacy composite with a separate
background image. Changing that setting alone does not fix the adaptive crop.

Android now wraps the unchanged foreground and monochrome PNGs in explicit
20% insets on every edge. Both regular and round adaptive resources reference
those wrappers. The icon generator preserves this correction on regeneration;
`--android-only` updates Android assets without touching desktop/browser icons.

The regression test `tests/launcher-icons.mjs` reproduces the old failure:
2,223 of 4,090 visible mdpi pixels fell outside the central safe circle. The
corrected drawable has zero visible pixels outside that circle at all five
densities, for both color and monochrome. Maximum radius is below 32 dp against
the 33 dp safe radius. Circle and squircle previews are also rendered.

Only Android resources are repackaged for this fix. The approved master, UI,
theme, frontend code and existing native engine remain unchanged.

Sources: [Android adaptive-icon safe zone](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive),
[Tauri CLI 2.10.1 icon generator](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.10.1/crates/tauri-cli/src/icon.rs).

### Installed Crop-Fix Build

- Resource-only release packaging succeeded, and APK signature verification passed.
- APK size: 26,702,961 bytes. SHA256:
  `6c2fa81f45b600990cbb9bb75adf574f9f6931ea72be6e5b80d38ea3d40e0e14`.
- Embedded native library SHA256 remains unchanged from the previous build:
  `75ee89377f0321c83fe98d97a1aedd23de5bdf9a7c678b3b35d5724709d3282f`.
- `adb install -r` succeeded on Samsung SM-A217F with existing data preserved.
- On 2026-10-24 at 14:28 local time, the user-authorized Samsung launcher
  search for DmeX was visually checked on the phone. The full mark, including
  its left stem and lower cut, is visible without mask clipping.
- Verification image: `music-player-ui/tests/artifacts/dmex-launcher-fixed.png`
  (ignored test artifact). DmeX was not opened; playback and volume were not changed.
