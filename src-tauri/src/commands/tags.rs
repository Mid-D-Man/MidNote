use crate::data;

#[tauri::command]
pub fn get_tags(app: tauri::AppHandle) -> Result<String, String> {
    data::tags::load_tags(&app)
}

#[tauri::command]
pub fn save_tags(app: tauri::AppHandle, tags_json: String) -> Result<(), String> {
    data::tags::save_tags(&app, &tags_json)
}
