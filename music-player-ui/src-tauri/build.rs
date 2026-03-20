fn main() {
    println!("cargo:rerun-if-changed=../audio-engine-cpp/main.cpp");
    
    cc::Build::new()
        .cpp(true)
        .file("../audio-engine-cpp/main.cpp")
        .compile("audioengine");
}
