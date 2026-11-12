use tauri::{plugin::{Builder, PluginHandle, TauriPlugin}, Manager, Runtime};

pub struct Feedback<R: Runtime>(pub PluginHandle<R>);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::<R, ()>::new("mobile-feedback").setup(|app, api| {
        app.manage(Feedback(api.register_android_plugin("com.dmex.player", "FeedbackPlugin")?));
        Ok(())
    }).build()
}
