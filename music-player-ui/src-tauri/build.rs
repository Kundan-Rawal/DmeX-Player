fn main() {
    // FIX: Restore the core Tauri build script! (This generates the missing Gradle files)
    tauri_build::build();

    // Compile the custom C++ DSP engine
    println!("cargo:rerun-if-changed=../../audio-engine-cpp/main.cpp");
    
    cc::Build::new()
        .cpp(true)
        .file("../../audio-engine-cpp/EngineCore.cpp")
        .file("../../audio-engine-cpp/DSP_Nodes.cpp")
        .file("../../audio-engine-cpp/Telemetry.cpp")
        .file("../../audio-engine-cpp/CommandParser.cpp")
        // Keep whatever compiler flags or include paths you already had here:
        .flag_if_supported("-std=c++17")
        .flag_if_supported("-O3") // Ensure optimizations are on for audio!
        .compile("audioengine");
}