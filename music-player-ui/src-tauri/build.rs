fn main() {
    // FIX: Restore the core Tauri build script! (This generates the missing Gradle files)
    tauri_build::build();

    // Compile the custom C++ DSP engine
    println!("cargo:rerun-if-changed=../../audio-engine-cpp/main.cpp");
    println!("cargo:rerun-if-changed=../../audio-engine-cpp/CommandParser.cpp");
    println!("cargo:rerun-if-changed=../../audio-engine-cpp/DSP_Nodes.cpp");
    println!("cargo:rerun-if-changed=../../audio-engine-cpp/DSP_Nodes.h");
    println!("cargo:rerun-if-changed=../../audio-engine-cpp/EngineCore.cpp");
    for entry in std::fs::read_dir("../../audio-engine-cpp").expect("DSP sources") {
        let path = entry.expect("DSP file").path();
        if path.is_file() && matches!(path.extension().and_then(|v| v.to_str()), Some("h" | "cpp" | "c")) {
            println!("cargo:rerun-if-changed={}", path.display());
        }
    }
    
    let mut native = cc::Build::new();
    native.cpp(true)
        .std("c++17")
        .flag_if_supported("/EHsc")
        .file("../../audio-engine-cpp/EngineCore.cpp")
        .file("../../audio-engine-cpp/DSP_Nodes.cpp")
        .file("../../audio-engine-cpp/Telemetry.cpp")
        .file("../../audio-engine-cpp/CommandParser.cpp")
        .file("../../audio-engine-cpp/StreamingDecoder.cpp")
        .file("../../audio-engine-cpp/SteamAudioHrtf.cpp")
        // Keep whatever compiler flags or include paths you already had here:
        .flag_if_supported("-std=c++17")
        .flag_if_supported("-O3") // Ensure optimizations are on for audio!
        .opt_level(3);
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("x86_64") {
        let sdk = std::path::Path::new("../../audio-engine-cpp/third_party/steamaudio");
        native.include(sdk.join("include")).define("DMEX_USE_STEAMAUDIO", None);
        println!("cargo:rustc-link-search=native={}", sdk.join("lib/windows-x64").display());
        println!("cargo:rustc-link-lib=dylib=phonon");
        let output = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
        let binary_dir = output.ancestors().nth(3).expect("Cargo target directory");
        std::fs::copy(sdk.join("lib/windows-x64/phonon.dll"), binary_dir.join("phonon.dll"))
            .expect("Stage Steam Audio runtime");
    }
    native.compile("audioengine");

    let mut fft = cc::Build::new();
    if std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("aarch64") {
        fft.define("PFFFT_ENABLE_NEON", None);
    }
    fft.file("../../audio-engine-cpp/pffft.c")
        .file("../../audio-engine-cpp/pffft_common.c")
        .flag_if_supported("-O3")
        .opt_level(3)
        .compile("pffft");

}
