// VÆST desktop shell. The window loads the live web app (see shell/index.html), so there is
// no app logic here — just the native window. When the auto-updater is wired (see README),
// add `.plugin(tauri_plugin_updater::Builder::new().build())` here.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running VÆST");
}
