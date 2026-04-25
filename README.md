# DmeX Audio Engine 🎧⚡

**DmeX** is a master-grade, cross-platform audio processing engine and player. It was engineered from the ground up to solve the fatal flaw of modern desktop media players: bloated UI threads starving the audio pipeline. 

By aggressively decoupling a hardware-accelerated React frontend from a deterministic C++ digital signal processing (DSP) core—bridged entirely via Rust and Tauri—DmeX achieves ultra-low latency (<100ms) audio streaming alongside a locked 60 FPS visual experience.

## 📸 Visual Tour & User Guide

DmeX is designed for both casual listening and hardcore audio engineering. Here is how to navigate the core features of the engine.

### 1. The High-Speed Library (Powered by SQLite)

> *Place a screenshot of your main track list and sidebar here.*

* **Instant Search & Sort:** Unlike standard players that parse massive JSON files into memory, DmeX queries a native SQLite database. You can search a 15,000+ track library in milliseconds.
* **Bulk Management:** Click "☑ Select Multiple" to engage the bulk-selection mode. You can instantly add or remove hundreds of tracks from custom playlists without UI lag.
* **Smart Scan:** Clicking "+ Add Folder" utilizes Rust to scan your file system, extracting bitrates, durations, and metadata via `music-metadata`, while SQLite seamlessly ignores duplicates (`ON CONFLICT DO UPDATE`).

### 2. The Holographic 3D Visualizer

> *Place a screenshot of the Lava Lamp or Radar visualizer running here.*

* **Phase-Accurate Representation:** This is not a random animation. The C++ engine calculates RMS volume, Left/Right Panning, and Phase Correlation every 32ms.
* **Reading the Visuals:** If the "Treble Dust" or "Lava Lamp" elements push to the extreme edges of your screen, it means the audio phase correlation is out-of-phase (< 0.0), indicating a wide 3D stereo image.
* **Zero CPU Lag:** Rendered at 60 FPS using GPU-accelerated off-screen canvas blitting (`ctx.drawImage`), ensuring your battery doesn't drain while watching the visualizer.

### 3. The DSP Dashboard (Manual Overrides)

> *Place a screenshot of the Fine Tune DSP menu showing the sliders here.*

Click the 🎛️ (Equalizer) icon in the player bar to open the DSP Dashboard.

* **Tube Exciter (Air):** Pushes the high frequencies through an asymmetric tube distortion algorithm. Dial this up to 50%+ to add "sparkle" to dull, poorly mastered tracks.
* **Acoustic Environment:** Applies Convolution Reverb using real-world Impulse Responses (IRs) like "Yoga Studio" or "EMT-140 Plate."
* **Stereo Width & 3D Depth:** Manipulates the Mid/Side (M/S) channels and utilizes Haas effect delays to physically push the sound outside the boundaries of your headphones.

## 🏗️ System Architecture

Standard Electron/Web-based audio players suffer from audio dropouts because DOM updates block the main thread. DmeX solves this using a strict, tri-layer isolation model:

1. **The Core (C++):** A purely lock-free audio thread. It handles bit-perfect audio decoding, dynamic memory allocation, and real-time DSP matrix math. It never waits on the UI.
2. **The Bridge (Rust/Tauri):** Acts as the high-speed interconnect. It intercepts IPC calls, manages raw OS-level commands, and directly queries the local filesystem without standard ORM overhead.
3. **The Interface (React/TypeScript):** The frontend only reads telemetry data. It utilizes `useRef` polling and `requestAnimationFrame` to mutate the DOM directly, entirely bypassing the React Virtual DOM diffing cycle during heavy visualizer loads.

## 🎛️ Audiophile DSP Engine

The C++ core is built around mastering-grade acoustic math, eschewing standard "cheap" algorithms for phase-accurate processing:

* **Phase-Coherent Crossovers:** Standard IIR filters leak sound and cause 3dB volume humps at crossover frequencies. DmeX utilizes **Linkwitz-Riley 24dB/octave** crossovers to split sub-bass and mid/high frequencies with absolute zero phase cancellation.
* **4-Band Dynamic Compression:** Independent frequency band compression prevents "audio pumping" (where a loud kick drum incorrectly ducks the volume of the lead vocal).
* **Oversampled Tube Exciter:** An asymmetric distortion pipeline adds warm, even-order harmonics. To prevent digital aliasing (hiss), the signal is **4x oversampled to 176.4kHz** internally before being decimated back to the target sample rate.
* **Real-Time 3D Spatial Imager:** Widens the stereo field utilizing phase correlation manipulation and Haas effect delays. These delays are dynamically scaled to the DAC's sample rate to preserve the 3D effect on 192kHz audiophile hardware.
* **True Peak Limiting:** An oversampled limiter with a hard -0.3 dBFS brickwall ceiling ensures zero inter-sample clipping during downstream Digital-to-Analog (D/A) conversion.

## 🧠 Zero-NN Acoustic Machine Learning

Machine Learning in audio usually implies heavy, CPU-melting Neural Networks. DmeX takes a systems-engineering approach, utilizing deterministic acoustic feature extraction to instantly "fingerprint" a track and apply the perfect EQ/DSP profile in milliseconds:

* **Crest Factor Analysis:** Measures the Peak-to-RMS ratio to instantly differentiate highly compressed electronic tracks from highly dynamic classical/acoustic recordings.
* **Zero-Crossing Rate (ZCR):** Analyzes high-frequency noise density to identify tracks dominated by hi-hats, cymbals, or electronic synths.
* **Spectral Centroid:** Calculates the frequency "center of mass" to determine the fundamental brightness or darkness of the mix.

*Engine Logic Example:* `If Crest Factor > 18 and RMS < 0.08 -> Classify: Ambient/Chill -> Auto-Apply: Convolution Reverb & Wide Spatial Imager.`

## 🛠️ Tech Stack

| **Component** | **Technology** | **Purpose** |
|---|---|---|
| **Audio Core DSP** | Modern C++ | Real-time audio buffer processing, lock-free architecture. |
| **Backend & IPC** | Rust, Tauri | System bridge, memory-safe OS interactions. |
| **Database Engine** | SQLite3 (`rusqlite`) | Bundled C-driver for millisecond relational queries. |
| **Frontend Framework** | React.js, TypeScript | Component architecture and state management. |
| **Visual Rendering** | HTML5 Canvas API | 60 FPS off-screen blitting and direct DOM manipulation. |
| **Metadata Parsing** | `music-metadata` | Extracting ID3 tags, FLAC headers, and album art. |

## ⚙️ Build Instructions

### Prerequisites

* [Node.js](https://nodejs.org/) (v18+)
* [Rust](https://www.rust-lang.org/tools/install) (latest stable)
* C++ Build Tools:
  * **Windows:** Visual Studio C++ Build Tools (MSVC)
  * **macOS:** Xcode Command Line Tools
  * **Linux:** `build-essential`, `libwebkit2gtk-4.0-dev`, `libgtk-3-dev`

### Installation

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/Kundan-Rawal/DmeX-Player.git](https://github.com/Kundan-Rawal/DmeX-Player.git)
   cd DmeX-Player
   ```
2. **Install frontend dependencies:**
   ```bash
   npm install
   ```
3. **Compile and run the development build:**
   ```bash
   npm run tauri dev
   ```
4. **Build for production:**
   ```bash
   npm run tauri build
   ```
### Latest Releases

* Windows Release (ver 1.0.5): [Drive Link](https://drive.google.com/file/d/176Shuywno5A5tVQJXWsY2ugW16HcmkzZ/view?usp=drive_link)  *
* Android Release (ver 1.0.3): [Drive Link]()
