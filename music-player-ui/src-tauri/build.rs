fn main() {
    // FIX: Restore the core Tauri build script! (This generates the missing Gradle files)
    tauri_build::build();

    // Compile the custom C++ DSP engine
    println!("cargo:rerun-if-changed=../../audio-engine-cpp/main.cpp");
    
    cc::Build::new()
        .cpp(true)
        .file("../../audio-engine-cpp/main.cpp")
        .compile("audioengine");
}