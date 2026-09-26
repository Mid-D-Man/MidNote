use crate::data;

#[tauri::command]
pub fn get_boards_index(app: tauri::AppHandle) -> Result<String, String> {
    data::index::load_boards_index(&app)
}
