mod commands;
mod data;
// mod ai;   // scaffolded (src-tauri/src/ai/), deferred until UI + sync land
// mod sync; // scaffolded (src-tauri/src/sync/), deferred until UI lands

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::notes::get_notes_index,
            commands::notes::get_note,
            commands::notes::save_note,
            commands::todos::get_todos_index,
            commands::todos::get_todo,
            commands::todos::save_todo,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
