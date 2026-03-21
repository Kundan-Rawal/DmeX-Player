use std::ffi::CString;
use std::os::raw::c_char;
use walkdir::WalkDir;

extern "C" {
    fn init_audio_engine();
    fn execute_audio_command(cmd: *const c_char);
    fn get_audio_metrics(curTime: *mut f32, length: *mut f32, level: *mut f32);
    fn analyze_audio(sc: *mut f32, cf: *mut f32, zcr: *mut f32, rms: *mut f32) -> bool;
}

#[tauri::command]
fn audio_command(cmd: String) {
    let c_str = CString::new(cmd).unwrap();
    unsafe { execute_audio_command(c_str.as_ptr()); }
}

#[tauri::command]
fn audio_metrics() -> (f32, f32, f32) {
    let mut cur_time = 0.0; let mut length = 0.0; let mut level = 0.0;
    unsafe { get_audio_metrics(&mut cur_time, &mut length, &mut level); }
    (cur_time, length, level)
}

#[tauri::command]
fn analyze_current_track() -> String {
    let mut sc = 0.0; let mut cf = 0.0; let mut zcr = 0.0; let mut rms = 0.0;
    let success = unsafe { analyze_audio(&mut sc, &mut cf, &mut zcr, &mut rms) };
    if success { format!("FINGERPRINT {} {} {} {}", sc, cf, zcr, rms) } 
    else { "FINGERPRINT_ERROR".to_string() }
}

#[tauri::command]
fn scan_mobile_audio() -> Vec<String> {
    let mut paths = Vec::new();
    // Native Android music and download paths
    let roots = ["/storage/emulated/0/Music", "/storage/emulated/0/Download"];
    
    for root in roots {
        for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    let ext = ext.to_lowercase();
                    if ["mp3", "wav", "flac", "m4a", "aac", "ogg"].contains(&ext.as_str()) {
                        if let Some(path_str) = path.to_str() {
                            paths.push(path_str.to_string());
                        }
                    }
                }
            }
        }
    }
    paths
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    unsafe { init_audio_engine(); }

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![audio_command, audio_metrics, analyze_current_track, scan_mobile_audio])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}