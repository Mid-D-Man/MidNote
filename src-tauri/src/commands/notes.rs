use crate::data;

#[tauri::command]
pub fn get_notes_index(app: tauri::AppHandle) -> Result<String, String> {
    data::index::load_notes_index(&app)
}
