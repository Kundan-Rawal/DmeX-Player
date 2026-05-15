use walkdir::WalkDir;
use std::ffi::CString;
use std::os::raw::c_char;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::probe::Hint;
use symphonia::core::formats::FormatOptions;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::audio::SampleBuffer;
use std::fs::File;
// use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::ffi::CStr;

mod db; // Import our new database module

use std::sync::Mutex;
use rusqlite::Connection;
use tauri::{State, Manager};

static HEADPHONES_UNPLUGGED: AtomicBool = AtomicBool::new(false);

struct AppState {
    db_conn: Mutex<Connection>,
}

// ------------------------------------------------------------------
// NEW: Drip-Feed Metadata Struct
// ------------------------------------------------------------------
#[derive(Clone, serde::Serialize)]
pub struct TrackMeta {
    pub title: String,
    pub artist: String,
    pub file_path: String,
    pub art_uri: Option<String>,
}

// ------------------------------------------------------------------
// SYMPHONIA FFI BRIDGE (IN-MEMORY DECODE)
// ------------------------------------------------------------------
#[repr(C)]
pub struct RustAudioBuffer {
    pub data: *mut f32,
    pub total_samples: u64,
    pub capacity: u64, // <-- CRITICAL: Track the exact memory size
    pub channels: u32,
    pub sample_rate: u32,
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "C" fn Java_com_dmex_player_MainActivity_onAudioBecomingNoisy(
    _env: *mut std::ffi::c_void,
    _class: *mut std::ffi::c_void,
) {
    HEADPHONES_UNPLUGGED.store(true, Ordering::Relaxed);
    let cmd = std::ffi::CString::new("PAUSE").unwrap();
    unsafe {
        execute_audio_command(cmd.as_ptr());
    }
}

#[no_mangle]
pub extern "C" fn rust_decode_file(path: *const c_char) -> *mut RustAudioBuffer {
    let path_str = unsafe {
        match CStr::from_ptr(path).to_str() {
            Ok(s) => s.trim(),
            Err(_) => return std::ptr::null_mut(),
        }
    };
    
    let file = match File::open(path_str) {
        Ok(f) => f,
        Err(_) => return std::ptr::null_mut(),
    };

    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    
    let mut hint = Hint::new();
    if let Some(ext) = path_str.split('.').last() {
        hint.with_extension(ext);
    }

    let probed = match symphonia::default::get_probe().format(
        &hint, mss, &FormatOptions::default(), &MetadataOptions::default()
    ) {
        Ok(p) => p, Err(_) => return std::ptr::null_mut()
    };

    let mut format = probed.format;
    let track = match format.default_track() {
        Some(t) => t, None => return std::ptr::null_mut()
    };
    let track_id = track.id;
    
    let channels = track.codec_params.channels.map(|c| c.count() as u32).unwrap_or(2);
    let sample_rate = track.codec_params.sample_rate.unwrap_or(44100);

    let mut decoder = match symphonia::default::get_codecs().make(
        &track.codec_params, &DecoderOptions::default()
    ) {
        Ok(d) => d, Err(_) => return std::ptr::null_mut()
    };

    let mut all_samples: Vec<f32> = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(_)) => break,
            Err(_) => continue, 
        };

        if packet.track_id() != track_id { continue; }

        match decoder.decode(&packet) {
            Ok(decoded) => {
                let mut buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
                buf.copy_interleaved_ref(decoded);
                all_samples.extend_from_slice(buf.samples());
            }
            Err(_) => continue,
        }
    }

    if all_samples.is_empty() { return std::ptr::null_mut(); }

    all_samples.shrink_to_fit();
    let total_samples = all_samples.len() as u64;
    let capacity = all_samples.capacity() as u64; // <-- CRITICAL: Capture exact allocator capacity
    let data_ptr = all_samples.as_mut_ptr();
    std::mem::forget(all_samples); 

    let buf = Box::new(RustAudioBuffer {
        data: data_ptr, total_samples, capacity, channels, sample_rate // <-- Pass it here
    });

    Box::into_raw(buf)
}

#[no_mangle]
pub extern "C" fn rust_free_audio_buffer(ptr: *mut RustAudioBuffer) {
    if ptr.is_null() { return; }
    unsafe {
        let buf = Box::from_raw(ptr);
        // CRITICAL: We now pass buf.capacity to perfectly match the memory allocator layout
        let _vec = Vec::from_raw_parts(buf.data, buf.total_samples as usize, buf.capacity as usize);
    } // Memory safely drops here without corrupting the heap
}

// ------------------------------------------------------------------
// CORE APP COMMANDS
// ------------------------------------------------------------------
extern "C" {
    fn init_audio_engine();
    fn execute_audio_command(cmd: *const c_char);
    fn get_audio_metrics(out_data: *mut f32, out_level: *mut f32);
    fn analyze_audio(sc: *mut f32, cf: *mut f32, zcr: *mut f32, rms: *mut f32) -> bool;
}

fn scan_audio_paths(root: &str) -> Vec<String> {
    let mut paths = Vec::new();
    for entry in WalkDir::new(root).max_depth(10).into_iter().filter_map(|e| e.ok()) {
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

#[tauri::command]
fn audio_command(cmd: String) {
    if cmd.starts_with("PLAY") {
        HEADPHONES_UNPLUGGED.store(false, Ordering::Relaxed);
    }
    let c_str = CString::new(cmd).unwrap();
    unsafe {
        init_audio_engine();
        execute_audio_command(c_str.as_ptr());
    }
}

#[tauri::command]
fn fetch_library(state: State<'_, AppState>) -> Result<Vec<db::Track>, String> {
    let conn = state.db_conn.lock().unwrap();
    match db::get_all_tracks(&conn) {
        Ok(tracks) => Ok(tracks),
        Err(e) => Err(format!("Failed to fetch library: {}", e)),
    }
}

#[tauri::command]
fn clear_library(state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db_conn.lock().unwrap();
    // Violently wipe all rows from the database tables
    conn.execute("DELETE FROM tracks", []).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM playlists", []).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM playlist_tracks", []).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn add_to_library(track: db::Track, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db_conn.lock().unwrap();
    match db::upsert_track(&conn, &track) {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Failed to insert track: {}", e)),
    }
}

#[tauri::command]
fn audio_metrics() -> Vec<f32> {
    let mut data = vec![0.0f32; 10]; 
    let mut level: f32 = 0.0;
    
    unsafe {
        get_audio_metrics(data.as_mut_ptr(), &mut level);
    }
    
    let finished = if data[0] > 0.0 && data[1] > 0.0 && data[0] >= (data[1] - 0.5) {
        1.0 
    } else { 
        0.0 
    };

    vec![
        data[0], data[1], data[2], data[3], data[4], data[5], 
        data[6], data[7], data[8], data[9], level, finished
    ]
}

#[tauri::command]
async fn analyze_current_track() -> Result<String, String> {
    let result = tauri::async_runtime::spawn_blocking(|| {
        let mut sc = 0.0_f32; let mut cf = 0.0_f32;
        let mut zcr = 0.0_f32; let mut rms = 0.0_f32;
        let ok = unsafe { analyze_audio(&mut sc, &mut cf, &mut zcr, &mut rms) };
        if ok { format!("FINGERPRINT {} {} {} {}", sc, cf, zcr, rms) }
        else  { "FINGERPRINT_ERROR".to_string() }
    }).await.map_err(|e| format!("Thread error: {}", e))?;
    Ok(result)
}

#[tauri::command]
async fn read_file_head(path: String, max_bytes: usize) -> Result<String, String> {
    use std::io::Read;
    tauri::async_runtime::spawn_blocking(move || {
        let file = std::fs::File::open(&path).map_err(|e| format!("Cannot open {}: {}", path, e))?;
        let mut buf = Vec::with_capacity(max_bytes);
        file.take(max_bytes as u64).read_to_end(&mut buf).map_err(|e| format!("Read error: {}", e))?;
        
        // CRITICAL FIX: Native Base64 encoding to prevent JSON IPC memory exhaustion
        const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::with_capacity(buf.len() * 4 / 3 + 4);
        let mut i = 0;
        while i < buf.len() {
            let b0 = buf[i] as u32;
            let b1 = if i + 1 < buf.len() { buf[i + 1] as u32 } else { 0 };
            let b2 = if i + 2 < buf.len() { buf[i + 2] as u32 } else { 0 };
            let n = (b0 << 16) | (b1 << 8) | b2;
            out.push(ALPHABET[((n >> 18) & 63) as usize] as char);
            out.push(ALPHABET[((n >> 12) & 63) as usize] as char);
            out.push(if i + 1 < buf.len() { ALPHABET[((n >> 6) & 63) as usize] as char } else { '=' });
            out.push(if i + 2 < buf.len() { ALPHABET[(n & 63) as usize] as char } else { '=' });
            i += 3;
        }
        Ok(out) // Returns a pure String, bypassing the 500MB JSON bottleneck
    }).await.map_err(|e| format!("Thread error: {}", e))?
}

// ------------------------------------------------------------------
// YOUR ORIGINAL SCANNER (UNTOUCHED FOR PC)
// ------------------------------------------------------------------
#[tauri::command]
async fn scan_directory(path: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || scan_audio_paths(&path)).await.map_err(|e| format!("Thread error: {}", e))
}

#[tauri::command]
fn toggle_favorite(path: String, is_favorite: bool, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let conn = state.db_conn.lock().unwrap();
    db::toggle_favorite(&conn, &path, is_favorite).map_err(|e| e.to_string())
}


#[tauri::command]
async fn scan_mobile_audio() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut paths = Vec::new();
        let roots = ["/storage/emulated/0/Music", "/storage/emulated/0/Download", "/storage/emulated/0/Downloads", "/storage/emulated/0/DCIM"];
        for root in &roots { paths.extend(scan_audio_paths(root)); }
        paths.sort(); paths.dedup(); paths
    }).await.map_err(|e| format!("Thread error: {}", e))
}

// =======================================================
// FENCED OPTIMIZATION: Drip-Feed Scanner ONLY for Android
// =======================================================
// THE FIX: Removed underscores from app_handle and folder_path
#[tauri::command]
async fn scan_android_music(_app_handle: tauri::AppHandle, _folder_path: String) -> Result<(), String> {
    #[cfg(not(target_os = "android"))]
    {
        Ok(())
    }

    #[cfg(target_os = "android")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let mut chunk = Vec::new();
            let mut all_paths = Vec::new();
            
            if folder_path == "ALL" {
                let roots = [
                    "/storage/emulated/0/Music", 
                    "/storage/emulated/0/Download", 
                    "/storage/emulated/0/Downloads", 
                    "/storage/emulated/0/DCIM",
                    "/storage/emulated/0/Audiobooks",
                    "/storage/emulated/0/Podcasts",
                    "/storage/emulated/0/WhatsApp/Media/WhatsApp Audio"
                ];
                for root in &roots {
                    all_paths.extend(scan_audio_paths(root));
                }
            } else {
                all_paths.extend(scan_audio_paths(&folder_path));
            }
            
            all_paths.sort(); 
            all_paths.dedup();

            for path_str in all_paths {
                let path = std::path::Path::new(&path_str);
                
                let title = path.file_stem().unwrap_or_default().to_string_lossy().into_owned();
                
                chunk.push(TrackMeta {
                    title,
                    artist: "Unknown Artist".to_string(),
                    file_path: path_str,
                    art_uri: None, 
                });

                if chunk.len() >= 50 {
                    use tauri::Emitter;
                    let _ = app_handle.emit("metadata_chunk", chunk.clone());
                    chunk.clear();
                }
            }

            if !chunk.is_empty() {
                use tauri::Emitter;
                let _ = app_handle.emit("metadata_chunk", chunk);
            }
            use tauri::Emitter;
            let _ = app_handle.emit("scan_complete", ());
        });
        Ok(())
    }
}


// ... (scan_android_music is right above this) ...

// ==============================================================
// 1. THE NEW ANDROID WORKER (Extracts art directly in native C++)
// ==============================================================
#[tauri::command]
async fn extract_and_cache_art(app: tauri::AppHandle, path: String, safe_album: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use symphonia::default::get_probe;
        use symphonia::core::meta::MetadataOptions;
        use symphonia::core::formats::FormatOptions;
        use symphonia::core::io::MediaSourceStream;

        let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());
        let mut hint = symphonia::core::probe::Hint::new();
        if let Some(ext) = std::path::Path::new(&path).extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }

        let mut probed = get_probe().format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
            .map_err(|e| e.to_string())?;

        // 1. Removed "mut" to fix the unused_mut warning
        let metadata = probed.format.metadata();
        
        // 2. THE FIX: Bind the temporary value to a local variable so it survives the borrow checker
        let binding = probed.metadata.get(); 
        
        let meta = match metadata.current() {
            Some(m) => m,
            None => match binding.as_ref().and_then(|m| m.current()) {
                Some(m) => m,
                None => return Ok("".to_string()),
            }
        };

        let visuals = meta.visuals();
        if visuals.is_empty() { return Ok("".to_string()); }
        let vis = &visuals[0];

        let ext = if vis.media_type.contains("png") { "png" } else { "jpg" };
        let file_name = format!("art_{}.{}", safe_album, ext);

        use tauri::Manager;
        let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let art_dir = app_dir.join("art_cache");
        if !art_dir.exists() {
            std::fs::create_dir_all(&art_dir).map_err(|e| e.to_string())?;
        }
        
        let file_path = art_dir.join(&file_name);
        if !file_path.exists() {
            std::fs::write(&file_path, &vis.data).map_err(|e| e.to_string())?;
        }

        Ok(file_path.to_string_lossy().to_string())
    }).await.map_err(|e| format!("Thread error: {}", e))?
}

// ==============================================================
// 2. THE EXISTING WINDOWS WORKER (Leave this exactly as it is!)
// ==============================================================
#[tauri::command]
fn save_art_to_cache(app: tauri::AppHandle, file_name: String, data: Vec<u8>) -> Result<String, String> {
    use tauri::Manager;
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let art_dir = app_dir.join("art_cache");
    
    if !art_dir.exists() {
        std::fs::create_dir_all(&art_dir).map_err(|e| e.to_string())?;
    }
    
    let file_path = art_dir.join(&file_name);
    // Overwrite any corrupted/truncated files from previous scans
    std::fs::write(&file_path, data).map_err(|e| e.to_string())?;
    
    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
fn update_play_stats(path: String, seconds: i32, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db_conn.lock().unwrap();
    db::update_play_stats(&conn, &path, seconds).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_profile(path: String, profile: String, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db_conn.lock().unwrap();
    db::update_profile(&conn, &path, &profile).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_playlists(state: State<'_, AppState>) -> Result<Vec<db::CustomPlaylist>, String> {
    let conn = state.db_conn.lock().unwrap();
    db::get_playlists(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_playlist(playlist: db::CustomPlaylist, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db_conn.lock().unwrap();
    db::save_playlist(&conn, &playlist).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            let app_dir = app.path().app_data_dir().expect("Failed to get app data dir");
            std::fs::create_dir_all(&app_dir).expect("Failed to create app data directory");
            let db_path = app_dir.join("dmex_library.db");
            let conn = rusqlite::Connection::open(&db_path).unwrap();

            conn.execute(
                "CREATE TABLE IF NOT EXISTS tracks (
                    path TEXT PRIMARY KEY,
                    name TEXT,
                    artist TEXT,
                    album TEXT,
                    year TEXT,
                    quality TEXT,
                    duration REAL,
                    profile TEXT,
                    metadataLoaded BOOLEAN,
                    genre TEXT,
                    isFavorite BOOLEAN,
                    playCount INTEGER,
                    totalSecondsListened INTEGER,
                    thumb TEXT
                )",
                [],
            ).expect("Failed to create tracks table");

            conn.execute(
                "CREATE TABLE IF NOT EXISTS playlists (
                    id TEXT PRIMARY KEY,
                    name TEXT
                )",
                [],
            ).expect("Failed to create playlists table");

            conn.execute(
                "CREATE TABLE IF NOT EXISTS playlist_tracks (
                    playlist_id TEXT,
                    track_path TEXT,
                    position INTEGER,
                    PRIMARY KEY (playlist_id, track_path)
                )",
                [],
            ).expect("Failed to create playlist_tracks table");

            app.manage(AppState {
                db_conn: std::sync::Mutex::new(conn),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fetch_library, add_to_library, clear_library, save_art_to_cache, extract_and_cache_art,/* <-- ADDED HERE */
            toggle_favorite, update_play_stats, update_profile, get_playlists, save_playlist,
            audio_command, audio_metrics, analyze_current_track, read_file_head, scan_directory, scan_mobile_audio,
            scan_android_music
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}