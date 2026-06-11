<div align="center">
  <h1>🎧 DmeX-Player</h1>
  <p><b>A Next-Generation, Audiophile-Grade Music Player built for Desktop and Mobile.</b></p>
  <p>
    <img src="https://img.shields.io/badge/Tauri-2.0-blue?logo=tauri" alt="Tauri">
    <img src="https://img.shields.io/badge/React-18-blue?logo=react" alt="React">
    <img src="https://img.shields.io/badge/Rust-Backend-orange?logo=rust" alt="Rust">
    <img src="https://img.shields.io/badge/C++-Audio_Engine-purple?logo=c%2B%2B" alt="C++">
    <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20Android-brightgreen" alt="Platforms">
  </p>
</div>

<br />

## 🌟 Overview

**DmeX-Player** is the culmination of die-hard engineering to create the ultimate local music listening experience. Stripping away the bloat of streaming services, this player brings the focus back to your local library, supercharged with a custom **C++ Digital Signal Processing (DSP) Engine** on Desktop and a seamless **Rust Symphonia Engine** on Mobile.

Whether you're looking for bit-perfect audio, crazy real-time effects like Nightcore and 8D Audio, or just a beautifully fluid UI that adapts to your music, DmeX-Player has you covered.

---

## ✨ Key Features

- 🎛️ **Custom C++ DSP Audio Engine (Desktop):** 
  - Real-time 10-Band Equalizer, Reverb, Compressor, and Low/High Pass filters.
  - Pitch & Speed Shifting (Perfect for creating Slowed+Reverb or Nightcore mixes on the fly).
  - Immersive **8D Audio** spacial panning.
- 📱 **Native Mobile Audio (Android):**
  - Uses a custom Rust `symphonia` implementation running inside a Tauri Sidecar thread.
  - Gapless continuous background playback.
- 🎨 **Dynamic Chameleon UI:** 
  - The UI dynamically extracts dominant colors from your Album Art in real-time, completely re-theming the app to match the vibe of the current song.
- 📜 **Synchronized Lyrics & Metadata:**
  - Embedded `.lrc` lyrics parser for karaoke-style synchronized singing.
  - ID3 Tag extraction and Online Artist Art fetching via the Deezer API.
- ⚡ **Lightning Fast Library:**
  - Embedded `rusqlite` database effortlessly scans and indexes tens of thousands of local tracks.

---

## 🛠️ Technology Stack

- **Frontend:** React, TypeScript, Vite, CSS (Pure Vanilla aesthetics).
- **Desktop Backend:** Tauri v2, Rust.
- **Desktop Audio:** Custom C++ Audio Engine communicating via standard I/O (Stdin/Stdout) with Tauri.
- **Mobile Backend:** Tauri v2 Android, Rust, Symphonia audio decoding library.
- **Database:** SQLite (Rusqlite).

---

## 🚀 Getting Started

### Prerequisites

To build DmeX-Player from source, you will need the following tools installed:

1. **Node.js** (v18+)
2. **Rust** (Latest stable toolchain)
3. **C++ Build Tools** (Visual Studio on Windows for compiling the Audio Engine)
4. **Android Studio** (If building for Android, including NDK and SDK components)

### Installation & Build

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/DmeX-Player.git
   cd DmeX-Player/music-player-ui
   ```

2. **Install Node dependencies:**
   ```bash
   npm install
   ```

3. **Run for Desktop (Development):**
   ```bash
   npm run tauri dev
   ```

4. **Run for Android (Development):**
   ```bash
   # Make sure your Android device is connected via USB and ADB is authorized
   npm run tauri android dev
   ```

### Building for Production

To compile the standalone `.exe` or `.apk`:

```bash
# Windows
npm run tauri build

# Android
npm run tauri android build
```

---

## 🏗️ Architecture Note

DmeX-Player relies on a dual-engine architecture to bypass the limitations of Web Audio APIs:
- On **Windows**, a sidecar C++ executable (`AudioEngine.exe`) is launched in the background. It pipes real-time telemetry (Spectrum data, Peak levels) to the UI via standard output.
- On **Android**, due to OS sandboxing, a dedicated Rust-based Symphonia thread handles the decoding and passes the raw PCM data directly to the native Android AudioTrack interface, ensuring continuous lock-screen playability.

---

## ❤️ Acknowledgements

Built with passion and lots of caffeine. 
Special thanks to the open-source community, the developers behind Tauri, and Symphonia for making high-performance Rust audio a reality.
