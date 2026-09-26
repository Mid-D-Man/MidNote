//! Real index.rs — notes_index.mdix / todos_index.mdix / boards_index.mdix,
//! rebuilt from entries.rs's own files rather than maintained as separate
//! mutable state (no long-lived Tauri-managed state needed, and it's
//! self-healing: an index that somehow drifted gets corrected on the very
//! next save/delete rather than needing a manual repair path).
//!
//! `type` values match entry.ts's Entry.type discriminant exactly:
//! "regular" (notes), "todo", "board" — NOT the schema docs' @ENUMS names
//! (REGULAR/TODO/BOARD) — see mdix_json.rs's module doc for why this
//! dialect uses plain strings instead of enums.

use super::mdix_json::{read_mdix_file, write_mdix_file};
use super::paths;
use serde_json::{Map, Value};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

/// Heavy/sensitive fields left OUT of every index row — mirrors
/// notes_index.mdix's own schema comment ("the list only ever needs
/// `encrypted` to know whether to show a lock icon, never these three")
/// widened to cover every entry type's heavy per-type content field.
/// Implemented as a denylist rather than an allowlist of what TO keep so
/// a new lightweight field added to entry.ts later (something the list
/// would plausibly want to show) flows into the index automatically,
/// with nothing here needing to change — only a new HEAVY field needs
/// adding to this list. Everything an index row currently keeps: id,
/// type, title, tags, lastModified, isBookmarked, encrypted, struck,
/// isPinned, headerTheme, bodyTheme, icon — exactly what +page.svelte's
/// card rendering actually reads.
fn is_index_excluded(key: &str) -> bool {
    matches!(
        key,
        "content"
            | "pages"
            | "page1Name"
            | "categories"
            | "steps"
            | "annotations"
            | "nodes"
            | "edges"
            | "viewport"
            | "lockKeyMode"
            | "lockedPayload"
            | "lockedKeyFile"
    )
}

fn to_ref_row(entry: &Map<String, Value>) -> Map<String, Value> {
    let mut row = Map::new();
    for (k, v) in entry {
        if !is_index_excluded(k) {
            row.insert(k.clone(), v.clone());
        }
    }
    row
}

fn index_path_for(app: &AppHandle, entry_type: &str) -> Result<PathBuf, String> {
    match entry_type {
        "regular" => paths::notes_index_path(app),
        "todo" => paths::todos_index_path(app),
        "board" => paths::boards_index_path(app),
        other => Err(format!("Unknown entry type for index: {}", other)),
    }
}

fn array_key_for(entry_type: &str) -> &'static str {
    match entry_type {
        "regular" => "notes",
        "todo" => "todos",
        "board" => "boards",
        _ => "entries",
    }
}

/// Rebuilds one index file from scratch by reading every entry of that
/// type currently on disk. entries.rs's save_entry/delete_entry both
/// call this rather than trying to patch the existing index in place.
pub fn rebuild_index(app: &AppHandle, entry_type: &str) -> Result<(), String> {
    let dir = paths::entries_dir(app)?;
    let mut rows = Vec::new();
    if let Ok(read_dir) = fs::read_dir(&dir) {
        for entry in read_dir.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("mdix") {
                continue;
            }
            let value = match read_mdix_file(&path) {
                Ok(v) => v,
                Err(e) => {
                    eprintln!("rebuild_index: skipping unreadable {}: {}", path.display(), e);
                    continue;
                }
            };
            let Some(obj) = value.as_object() else {
                continue;
            };
            if obj.get("type").and_then(Value::as_str) != Some(entry_type) {
                continue;
            }
            rows.push(Value::Object(to_ref_row(obj)));
        }
    }

    let mut data = Map::new();
    data.insert(array_key_for(entry_type).to_string(), Value::Array(rows));
    write_mdix_file(&index_path_for(app, entry_type)?, &data)
}

fn load_index(app: &AppHandle, entry_type: &str) -> Result<String, String> {
    let path = index_path_for(app, entry_type)?;
    if !path.exists() {
        // Never opened/saved anything of this type yet — an empty index
        // is the correct answer, not an error (mirrors storage.ts's own
        // "nothing in localStorage yet" -> [] treatment).
        let mut data = Map::new();
        data.insert(array_key_for(entry_type).to_string(), Value::Array(vec![]));
        return serde_json::to_string(&Value::Object(data)).map_err(|e| e.to_string());
    }
    let value = read_mdix_file(&path)?;
    serde_json::to_string(&value).map_err(|e| format!("Failed to serialize index: {}", e))
}

pub fn load_notes_index(app: &AppHandle) -> Result<String, String> {
    load_index(app, "regular")
}

pub fn load_todos_index(app: &AppHandle) -> Result<String, String> {
    load_index(app, "todo")
}

pub fn load_boards_index(app: &AppHandle) -> Result<String, String> {
    load_index(app, "board")
}
