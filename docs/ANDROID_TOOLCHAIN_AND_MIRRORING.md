# Android Toolchain and Mirroring

Restored and verified on 2026-10-24.

## Installed and Verified

| Component | State |
| --- | --- |
| Java | Existing Microsoft OpenJDK 17.0.18 verified |
| SDK | Existing Android API 36 and Build Tools 35.0.0 verified |
| Platform tools | Updated to 37.0.1 |
| NDK | Installed 27.0.12077973, matching AGP 8.11's default |
| Command-line tools | Existing version 19.0 repaired into `cmdline-tools/latest/` |
| Rust | Existing ARM64, ARMv7, x86 and x86_64 Android targets verified |
| Node packages | Existing package tree verified; production build passed |
| Gradle libraries | Missing AndroidX/Material AAR dependencies downloaded again |
| scrcpy | Installed 5.0.1 from the official GitHub release; SHA-256 verified |

The SDK is at `%LOCALAPPDATA%\Android\Sdk`. scrcpy is at
`%LOCALAPPDATA%\DmeX-Tools\scrcpy-win64-v5.0.1`.

User environment variables `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `NDK_HOME`,
`ANDROID_NDK_HOME`, `ADB`, and `DMEX_SCRCPY_HOME` are configured. User PATH entries
were added for platform-tools, SDK command-line tools and scrcpy. Already-open
terminals may retain their previous environment; the launchers below reload the
saved paths and explicitly select the SDK's ADB.

NDK 29 from the earlier setup was not downloaded in addition to NDK 27. This avoids
an unnecessary second large installation. The app's ARM64 native engine passed
compilation with NDK 27. No existing emulator images or unrelated tools were deleted.

## Mirror the Phone

From `C:\DmeX-Player` in PowerShell:

```powershell
.\scripts\Start-AndroidMirror.ps1
```

For multiple connected devices, add `-Device SERIAL` using a serial from `adb devices`.
Unlock the phone and approve its USB-debugging prompt yourself if requested.

The launcher opens a visible scrcpy window titled `DmeX Player - Android`. It
leaves audio on the phone, sets no FPS cap, and does not change screen power or
stay-awake settings. Logs are in `%LOCALAPPDATA%\DmeX-Tools\logs`. Close the mirror
window to stop mirroring. It does not replace the installed DmeX app.

## Run Android Development Over USB

```powershell
.\scripts\Start-AndroidDev.ps1
```

Keep exactly one authorized phone connected for USB development. Tauri 2.10
matches model names rather than ADB serials; this launcher lets it automatically
select that single phone. Mirroring separately supports `-Device SERIAL`.

The development launcher reloads the SDK/JDK/NDK environment, forwards ports 1420 and 1421 over ADB,
and invokes `npm.cmd run tauri -- android dev --host 127.0.0.1` for the selected
phone. Vite now respects `TAURI_DEV_HOST`, so its HMR WebSocket uses the USB-forwarded
host rather than an unrelated LAN address. Regular desktop development retains
its previous LAN-host fallback.

Do not run another Vite/Tauri instance on ports 1420/1421 at the same time. The
development command builds, installs and launches a debug app; it was prepared
but not run during restoration, so the phone's existing app/data were left alone.

## Executed Checks

- Phone authorized and connected: Samsung SM-A217F, Android 12, ARM64.
- Existing `com.dmex.player` installation detected without replacing it.
- scrcpy visible window created; logs confirmed hardware D3D11VA decoding at
  the phone's 720x1600 resolution.
- `npm.cmd run build`: passed; existing main-chunk-size warning remains.
- `cargo check --offline --target aarch64-linux-android` with the restored NDK:
  passed, including the C++ audio engine.
- Gradle `:app:checkUniversalDebugAarMetadata`: passed after missing AAR files
  were downloaded. This is a dependency/SDK check, not a new complete APK build.
- USB HMR configuration resolved to `127.0.0.1:1421`.
- ADB reverse mappings for ports 1420 and 1421 verified.
- All three PowerShell helpers parsed successfully.

The SDK updater retained a `platform-tools.backup` folder while the previously
started ADB server was in use. SDK Manager may report this duplicate backup; it
does not prevent the verified build checks or active mirroring. It was not deleted.

## Sources

- [Tauri Android prerequisites](https://v2.tauri.app/start/prerequisites/)
- [AGP 8.11 compatibility, including NDK/JDK defaults](https://developer.android.com/build/releases/agp-8-11-0-release-notes)
- [Android SDK Manager](https://developer.android.com/tools/sdkmanager)
- [scrcpy 5.0.1 release](https://github.com/Genymobile/scrcpy/releases/tag/v5.0.1)

Verified scrcpy Windows x64 archive SHA-256:

```text
b12a2c4ee8be317422451fc7dcf8ee20a71b5ea7ef9ad73ddd825a25316227a5
```

## Fresh Release Deployed on 2026-10-24

A subsequent full release build exposed missing Windows SDK headers and import
libraries that the earlier cached `cargo check` did not exercise. Microsoft Windows
SDK 10.0.26100.7705 was installed through WinGet. The existing Visual Studio 2022
MSVC tools were retained. `Use-AndroidEnvironment.ps1 -ForBuild` now loads the
Visual Studio environment and selects an installed SDK with valid headers and
libraries, skipping incomplete leftover SDK directories.

The current checkout was built with:

```powershell
. .\scripts\Use-AndroidEnvironment.ps1 -ForBuild
Push-Location .\music-player-ui
npm.cmd run tauri -- android build --target aarch64 --apk --ci
Pop-Location
```

- Result: signed, optimized ARM64 release APK; 25,654,245 bytes.
- Artifact: `music-player-ui/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`.
- APK SHA-256: `fa7ffb4742c61833b8b53cd5f7cf7c275a4e1c088736179b14126c77f7490aeb`.
- Signing certificate SHA-256: `e3b87b441dddd02ab0d519cee38b040243c2b675c9606a29c512fb587b7a88b0`.
- APK signature verification passed (v2 signing).
- Installed successfully through `adb install -r`; no uninstall, data-clear or
  automatic runtime-permission-grant command was run. At deployment time the phone
  no longer reported a previously installed `com.dmex.player` package.
- Android reported a successful cold launch of `com.dmex.player/.MainActivity`.
- Installed version: 0.1.0, version code 1000; min SDK 24, target SDK 36.
- App process remained alive, with no matching native startup crash in its logs.
- Android's first-run permission dialog appeared. Music-file access is left for
  the user to approve on the phone; physical playback/listening tests are not
  claimed by this deployment check.
- The existing scrcpy mirror remained open. Approximately 9.2 GiB remained free
  on C: after building and installation; no unrelated files were deleted.

[Microsoft Windows SDK downloads](https://learn.microsoft.com/en-us/windows/apps/windows-sdk/downloads)
