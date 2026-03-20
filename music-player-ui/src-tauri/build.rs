fn main() {
    // FIX: Added an extra ../ to go up two folder levels to the Root directory
    println!("cargo:rerun-if-changed=../../audio-engine-cpp/main.cpp");
    
    cc::Build::new()
        .cpp(true)
        .file("../../audio-engine-cpp/main.cpp")
        .compile("audioengine");
}