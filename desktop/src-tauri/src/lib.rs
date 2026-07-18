// VÆST desktop shell. The window loads the live web app (see shell/index.html), so there is
// no app logic here. On launch we check the release feed and, if a newer *signed* build
// exists, download and install it silently (applies on next restart) — the native shell
// self-updates. The feed + signing are set in tauri.conf.json (plugins.updater); the private
// key stays out of the repo (see README).
use tauri_plugin_updater::UpdaterExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // best-effort: any failure (offline, no newer build) just leaves the app running
                if let Ok(updater) = handle.updater() {
                    if let Ok(Some(update)) = updater.check().await {
                        let _ = update.download_and_install(|_, _| {}, || {}).await;
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running VÆST");
}
