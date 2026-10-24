use tauri::{plugin::{Builder, PluginHandle, TauriPlugin}, Manager, Runtime};

pub struct Library<R: Runtime>(pub PluginHandle<R>);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::<R, ()>::new("music-library").setup(|app, api| {
        app.manage(Library(api.register_android_plugin("com.dmex.player", "MusicLibraryPlugin")?));
        Ok(())
    }).build()
}
