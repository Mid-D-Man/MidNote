mod commands;
mod data;
// mod ai;   // scaffolded (src-tauri/src/ai/), deferred until UI + sync land
// mod sync; // scaffolded (src-tauri/src/sync/), deferred until UI lands

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_sharekit::init());

    // Round 37: read aloud — text-to-speech through Android's engine. Mobile only
    // (see the note on the dependency in Cargo.toml).
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_tts::init());

    builder
        .invoke_handler(tauri::generate_handler![
            commands::entries::get_all_entries,
            commands::entries::save_entry,
            commands::entries::delete_entry,
            commands::notes::get_notes_index,
            commands::todos::get_todos_index,
            commands::boards::get_boards_index,
            commands::tags::get_tags,
            commands::tags::save_tags,
            commands::crypto::lock_payload,
            commands::crypto::unlock_payload,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
