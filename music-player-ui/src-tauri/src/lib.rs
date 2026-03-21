use walkdir::WalkDir;
use std::ffi::CString;
use std::os::raw::c_char;

extern "C" {
    fn init_audio_engine();
    fn execute_audio_command(cmd: *const c_char);
    fn get_audio_metrics(curTime: *mut f32, length: *mut f32, level: *mut f32);
    fn analyze_audio(sc: *mut f32, cf: *mut f32, zcr: *mut f32, rms: *mut f32) -> bool;
}

// Shared audio scan logic — used by both scan_directory and scan_mobile_audio
fn scan_audio_paths(root: &str) -> Vec<String> {
    let mut paths = Vec::new();
    for entry in WalkDir::new(root)
        .max_depth(10)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                let ext = ext.to_lowercase();
                if ["mp3", "wav", "flac", "m4a", "aac", "ogg"].contains(&ext.as_str()) {
                    if let Some(s) = path.to_str() {
                        paths.push(s.to_string());
                    }
                }
            }
        }
    }
    paths
}

// ── audio_command: lazy-init the C++ engine on first call ──────────────────
#[tauri::command]
fn audio_command(cmd: String) {
    let c_str = CString::new(cmd).unwrap();
    unsafe {
        // init_audio_engine() is idempotent — safe to call every time
        init_audio_engine();
        execute_audio_command(c_str.as_ptr());
    }
}

#[tauri::command]
fn audio_metrics() -> (f32, f32, f32) {
    let mut cur = 0.0_f32;
    let mut len = 0.0_f32;
    let mut lvl = 0.0_f32;
    unsafe { get_audio_metrics(&mut cur, &mut len, &mut lvl); }
    (cur, len, lvl)
}

// ── analyze_current_track: runs DSP fingerprint on background thread ────────
#[tauri::command]
async fn analyze_current_track() -> Result<String, String> {
    let result = tauri::async_runtime::spawn_blocking(|| {
        let mut sc = 0.0_f32; let mut cf = 0.0_f32;
        let mut zcr = 0.0_f32; let mut rms = 0.0_f32;
        let ok = unsafe { analyze_audio(&mut sc, &mut cf, &mut zcr, &mut rms) };
        if ok { format!("FINGERPRINT {} {} {} {}", sc, cf, zcr, rms) }
        else  { "FINGERPRINT_ERROR".to_string() }
    })
    .await
    .map_err(|e| format!("Thread error: {}", e))?;
    Ok(result)
}

// ── read_file_head: read only the first N bytes of a file ───────────────────
// ID3v2 tags (title, artist, album, year, duration) sit at the very start of
// an MP3/M4A/FLAC file. Reading only the first 128KB is enough to get all
// text metadata while skipping the 8-10MB of audio data that follows.
// This is ~80x faster than readFile() for a typical 8MB MP3.
// music-metadata handles partial buffers gracefully — it reads what it has.
#[tauri::command]
async fn read_file_head(path: String, max_bytes: usize) -> Result<Vec<u8>, String> {
    use std::io::Read;
    tauri::async_runtime::spawn_blocking(move || {
        let file = std::fs::File::open(&path)
            .map_err(|e| format!("Cannot open {}: {}", path, e))?;
        let mut buf = Vec::with_capacity(max_bytes.min(131072));
        file.take(max_bytes as u64)
            .read_to_end(&mut buf)
            .map_err(|e| format!("Read error: {}", e))?;
        Ok(buf)
    })
    .await
    .map_err(|e| format!("Thread error: {}", e))?
}
// Called with the path returned by Tauri's dialog::open({ directory: true }).
// On Android the dialog returns a real file-system path that walkdir can use.
#[tauri::command]
async fn scan_directory(path: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        scan_audio_paths(&path)
    })
    .await
    .map_err(|e| format!("Thread error: {}", e))
}

// ── scan_mobile_audio: fallback that scans common Android music folders ──────
// Used when the user hasn't selected a folder yet (first launch / empty library).
#[tauri::command]
async fn scan_mobile_audio() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut paths = Vec::new();
        let roots = [
            "/storage/emulated/0/Music",
            "/storage/emulated/0/Download",
            "/storage/emulated/0/Downloads",
            "/storage/emulated/0/DCIM",  // some phones store ringtones here
        ];
        for root in &roots {
            paths.extend(scan_audio_paths(root));
        }
        // Deduplicate
        paths.sort();
        paths.dedup();
        paths
    })
    .await
    .map_err(|e| format!("Thread error: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            audio_command,
            audio_metrics,
            analyze_current_track,
            read_file_head,
            scan_directory,
            scan_mobile_audio,
        ])
        // DO NOT call init_audio_engine() here — it must be lazy
        // (Android audio stack not ready during JNI setup)
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}