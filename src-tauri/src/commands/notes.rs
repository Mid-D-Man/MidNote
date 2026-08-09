use crate::data;

#[tauri::command]
pub fn get_notes_index() -> Result<(), String> {
    data::index::load_notes_index()
}

#[tauri::command]
pub fn get_note(id: String) -> Result<(), String> {
    data::entries::load_entry(&id)
}

#[tauri::command]
pub fn save_note(id: String) -> Result<(), String> {
    data::entries::save_entry(&id)
}
