use crate::data;

#[tauri::command]
pub fn get_todos_index() -> Result<(), String> {
    data::index::load_todos_index()
}

#[tauri::command]
pub fn get_todo(id: String) -> Result<(), String> {
    data::entries::load_entry(&id)
}

#[tauri::command]
pub fn save_todo(id: String) -> Result<(), String> {
    data::entries::save_entry(&id)
}
