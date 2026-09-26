//! Real entries.rs — one plain .mdix file per note/todo/board under the
//! app's data directory (see paths.rs), read/written via mdix_json.rs's
//! generic engine. See mdix_json.rs's module doc for the important
//! caveats (dialect simplification vs the reference schema docs, zero-
//! compiler verification) that apply to this whole file too.

use super::index;
use super::mdix_json::{read_mdix_file, write_mdix_file};
use super::paths;
use serde_json::Value;
use std::fs;
use tauri::AppHandle;

/// Reads one entry's full .mdix file back into a JSON string — exactly
/// the shape storage.ts's own Entry objects already have (id/type/title/
/// content-or-steps-or-nodes/...), since save_entry (below) is what
/// produced the file in the first place from that same shape.
pub fn load_entry(app: &AppHandle, id: &str) -> Result<String, String> {
    let path = paths::entry_path(app, id)?;
    let value = read_mdix_file(&path)?;
    serde_json::to_string(&value).map_err(|e| format!("Failed to serialize entry {}: {}", id, e))
}

/// Writes one entry's full .mdix file, then rebuilds whichever index
/// (notes_index.mdix / todos_index.mdix / boards_index.mdix) matches its
/// `type` field — see index.rs's rebuild_index for why a full rebuild
/// rather than a targeted upsert (simpler, self-healing, and at this
/// app's realistic personal-use scale — dozens to low hundreds of
/// entries, not thousands — an O(n) directory re-scan on every save
/// costs nothing a user would ever notice).
pub fn save_entry(app: &AppHandle, id: &str, entry_json: &str) -> Result<(), String> {
    let value: Value = serde_json::from_str(entry_json)
        .map_err(|e| format!("Invalid entry JSON for {}: {}", id, e))?;
    let obj = value
        .as_object()
        .ok_or_else(|| format!("Entry {} JSON is not an object", id))?;
    let entry_type = obj
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Entry {} has no \"type\" field", id))?
        .to_string();

    let path = paths::entry_path(app, id)?;
    write_mdix_file(&path, obj)?;

    index::rebuild_index(app, &entry_type)
}

/// Deleting an entry that was never actually saved isn't an error — same
/// already-gone-is-fine treatment storage.ts's own deleteEntry gives
/// localStorage today. Rebuilds all three indexes rather than figuring
/// out which one this id belonged to from a file that may no longer
/// exist to read.
pub fn delete_entry(app: &AppHandle, id: &str) -> Result<(), String> {
    let path = paths::entry_path(app, id)?;
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete {}: {}", path.display(), e))?;
    }
    index::rebuild_index(app, "regular")?;
    index::rebuild_index(app, "todo")?;
    index::rebuild_index(app, "board")
}

/// Lists every entry on disk regardless of type, for the app's one-time
/// startup hydration (see storage.ts's initStorage). This app's
/// `entries` reactive store holds full Entry objects for everything up
/// front (matching its current localStorage-era behavior exactly), so
/// startup reads every file once rather than lazily loading content
/// per-entry on open — see this project's data-layer notes for the
/// deliberate scope trade-off this implies. notes_index.mdix/
/// todos_index.mdix/boards_index.mdix are still written on every save
/// (see save_entry above), for architectural completeness and any
/// future lazy-loading feature, but nothing on this read path depends on
/// them yet.
pub fn load_all_entries(app: &AppHandle) -> Result<String, String> {
    let dir = paths::entries_dir(app)?;
    let mut entries = Vec::new();
    let read_dir =
        fs::read_dir(&dir).map_err(|e| format!("Failed to list {}: {}", dir.display(), e))?;
    for entry in read_dir {
        let entry = entry.map_err(|e| format!("Failed to read a directory entry: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("mdix") {
            continue;
        }
        match read_mdix_file(&path) {
            Ok(value) => entries.push(value),
            // One corrupt/unreadable file shouldn't take the whole list
            // down — same defensive-skip philosophy storage.ts's own
            // loadEntries() already applies per-entry for a malformed
            // localStorage record.
            Err(e) => eprintln!("load_all_entries: skipping unreadable {}: {}", path.display(), e),
        }
    }
    serde_json::to_string(&Value::Array(entries))
        .map_err(|e| format!("Failed to serialize entries: {}", e))
}
