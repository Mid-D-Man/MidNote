//! Tauri IPC commands for the generic entry CRUD path — matching this
//! project's existing convention (commands/ adapts, data:: does the
//! actual work). Deliberately generic, like commands/crypto.rs already
//! is (plain JSON strings, not typed Note/Todo/Board params) — this file
//! doesn't need to know the difference between a note/todo/board at all,
//! only entries.rs's `type` field does.

use crate::data;

#[tauri::command]
pub fn get_all_entries(app: tauri::AppHandle) -> Result<String, String> {
    data::entries::load_all_entries(&app)
}

#[tauri::command]
pub fn save_entry(app: tauri::AppHandle, id: String, entry_json: String) -> Result<(), String> {
    data::entries::save_entry(&app, &id, &entry_json)
}

#[tauri::command]
pub fn delete_entry(app: tauri::AppHandle, id: String) -> Result<(), String> {
    data::entries::delete_entry(&app, &id)
}
