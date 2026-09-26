use crate::data;

#[tauri::command]
pub fn get_todos_index(app: tauri::AppHandle) -> Result<String, String> {
    data::index::load_todos_index(&app)
}
