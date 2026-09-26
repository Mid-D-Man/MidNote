//! Real tags.rs — tags.mdix's notes::/todos::/boards:: arrays (see
//! mdix_files/schema/tags.mdix). `todo_categories::` from that schema
//! isn't included here — storage.ts's own KnownTags interface has never
//! tracked a global categories registry (categories are a per-todo field
//! only, see entry.ts's Todo.categories) — a pre-existing gap between
//! the schema doc and the real frontend, not something introduced or
//! fixed here.

use super::mdix_json::{read_mdix_file, write_mdix_file};
use super::paths;
use serde_json::{json, Map, Value};
use tauri::AppHandle;

pub fn load_tags(app: &AppHandle) -> Result<String, String> {
    let path = paths::tags_path(app)?;
    if !path.exists() {
        let empty = json!({ "notes": [], "todos": [], "boards": [] });
        return serde_json::to_string(&empty).map_err(|e| e.to_string());
    }
    let value = read_mdix_file(&path)?;
    serde_json::to_string(&value).map_err(|e| format!("Failed to serialize tags: {}", e))
}

pub fn save_tags(app: &AppHandle, tags_json: &str) -> Result<(), String> {
    let value: Value =
        serde_json::from_str(tags_json).map_err(|e| format!("Invalid tags JSON: {}", e))?;
    let obj: &Map<String, Value> = value
        .as_object()
        .ok_or_else(|| "Tags JSON is not an object".to_string())?;
    write_mdix_file(&paths::tags_path(app)?, obj)
}
