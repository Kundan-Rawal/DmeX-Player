use std::sync::{mpsc, OnceLock};
use tauri::{plugin::{Builder, PluginHandle, TauriPlugin}, Emitter, Runtime};

pub struct Media<R: Runtime>(pub PluginHandle<R>);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::<R, ()>::new("mobile-media").setup(|app, api| {
        use tauri::Manager;
        app.manage(Media(api.register_android_plugin("com.dmex.player", "MediaPlugin")?));
        Ok(())
    }).build()
}

fn dispatch(action: i32, position: i64) {
    static COMMANDS: OnceLock<mpsc::Sender<(i32, i64)>> = OnceLock::new();
    let sender = COMMANDS.get_or_init(|| {
        let (sender, receiver) = mpsc::channel::<(i32, i64)>();
        std::thread::Builder::new().name("dmex-media-controls".into()).spawn(move || {
            while let Ok((action, position)) = receiver.recv() {
                let flags = unsafe { super::audio_transport_flags() };
                let command = match action {
                    0 if flags & 1 != 0 => Some(if flags & 2 != 0 { "PAUSE".into() } else { "PLAY_USER".into() }),
                    1 if flags & 1 != 0 => Some("PLAY_USER".into()),
                    2 => Some("PAUSE".into()),
                    5 => Some(format!("SEEK {}", position.max(0) as f64 / 1000.0)),
                    6 => Some("PAUSE".into()),
                    7 => {
                        super::HEADPHONES_UNPLUGGED.store(true, std::sync::atomic::Ordering::Relaxed);
                        unsafe { super::audio_request_device_pause(); }
                        Some("PAUSE_DEVICE".into())
                    }
                    _ => None,
                };
                let result = command.map(|mut command| super::execute_resolved_audio_command(&mut command)).transpose();
                if let Some(app) = super::APP_HANDLE.get() {
                    let _ = app.emit("mobile-transport", serde_json::json!({
                        "action": action, "position": position.max(0),
                        "playing": unsafe { super::audio_transport_flags() } & 2 != 0,
                        "ok": result.is_ok()
                    }));
                }
            }
        }).expect("Could not start media-control worker");
        sender
    });
    let _ = sender.send((action, position));
}

#[no_mangle]
pub extern "C" fn Java_com_dmex_player_NativeMediaBridge_transport(
    _env: *mut std::ffi::c_void, _object: *mut std::ffi::c_void, action: i32, position: i64,
) { if (0..=7).contains(&action) { dispatch(action, position); } }

#[no_mangle]
pub extern "C" fn Java_com_dmex_player_NativeMediaBridge_flags(
    _env: *mut std::ffi::c_void, _object: *mut std::ffi::c_void,
) -> i32 { unsafe { super::audio_transport_flags() } }
