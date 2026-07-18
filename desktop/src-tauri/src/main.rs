// Prevent an extra console window on Windows release builds. No-op on macOS.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    vaest_desktop_lib::run()
}
