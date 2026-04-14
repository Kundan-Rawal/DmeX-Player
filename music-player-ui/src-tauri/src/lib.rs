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
use std::sync::atomic::{AtomicBool, Ordering};

use std::ffi::CStr;
static HEADPHONES_UNPLUGGED: AtomicBool = AtomicBool::new(false);

// ------------------------------------------------------------------
// SYMPHONIA FFI BRIDGE (IN-MEMORY DECODE)
// ------------------------------------------------------------------
#[repr(C)]
pub struct RustAudioBuffer {
    pub data: *mut f32,
    pub total_samples: u64,
    pub channels: u32,
    pub sample_rate: u32,
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "C" fn Java_com_dmex_player_MainActivity_onAudioBecomingNoisy(
    _env: *mut std::ffi::c_void,
    _class: *mut std::ffi::c_void,
) {
    // 1. Flag the UI to catch up on the next poll
    HEADPHONES_UNPLUGGED.store(true, Ordering::Relaxed);
    
    // 2. Instantly kill the C++ audio engine to prevent public blasting
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
            Err(_) => break, 
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
    let data_ptr = all_samples.as_mut_ptr();
    std::mem::forget(all_samples); 

    let buf = Box::new(RustAudioBuffer {
        data: data_ptr, total_samples, channels, sample_rate
    });

    Box::into_raw(buf)
}

#[no_mangle]
pub extern "C" fn rust_free_audio_buffer(ptr: *mut RustAudioBuffer) {
    if ptr.is_null() { return; }
    unsafe {
        let buf = Box::from_raw(ptr);
        let _vec = Vec::from_raw_parts(buf.data, buf.total_samples as usize, buf.total_samples as usize);
    }
}

// ------------------------------------------------------------------
// CORE APP COMMANDS
// ------------------------------------------------------------------
extern "C" {
    fn init_audio_engine();
    fn execute_audio_command(cmd: *const c_char);
    fn get_audio_metrics(curTime: *mut f32, length: *mut f32, level: *mut f32);
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
    // Clear the flag if the user explicitly presses PLAY again
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
fn audio_metrics() -> (f32, f32, f32, bool) {
    let mut cur = 0.0_f32; let mut len = 0.0_f32; let mut lvl = 0.0_f32;
    unsafe { get_audio_metrics(&mut cur, &mut len, &mut lvl); }
    
    // Pass the flag to React, then instantly reset it
    let unplugged = HEADPHONES_UNPLUGGED.swap(false, Ordering::Relaxed);
    
    (cur, len, lvl, unplugged) // Now returns 4 values instead of 3
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
async fn read_file_head(path: String, max_bytes: usize) -> Result<Vec<u8>, String> {
    use std::io::Read;
    tauri::async_runtime::spawn_blocking(move || {
        let file = std::fs::File::open(&path).map_err(|e| format!("Cannot open {}: {}", path, e))?;
        let mut buf = Vec::with_capacity(max_bytes.min(131072));
        file.take(max_bytes as u64).read_to_end(&mut buf).map_err(|e| format!("Read error: {}", e))?;
        Ok(buf)
    }).await.map_err(|e| format!("Thread error: {}", e))?
}

#[tauri::command]
async fn scan_directory(path: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || scan_audio_paths(&path)).await.map_err(|e| format!("Thread error: {}", e))
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            audio_command, audio_metrics, analyze_current_track, read_file_head, scan_directory, scan_mobile_audio,
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}