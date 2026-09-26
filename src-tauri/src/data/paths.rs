//! Where MidNote's real .mdix data files actually live on disk — the
//! app's own private data directory (Tauri's `app_data_dir()`), NOT
//! `mdix_files/schema/` (that folder is version-controlled reference
//! documentation bundled into the app, read-only once packaged — see
//! mdix_json.rs's module doc for the relationship between the two).
//!
//! CAVEAT: `app.path().app_data_dir()` is Tauri v2's standard, documented
//! `Manager` trait API for this, used here exactly as documented — but
//! like every other file this module supports, unverified by an actual
//! compile (see crypto.rs's header comment for why).

use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn ensure_data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Couldn't resolve app data directory: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create {}: {}", dir.display(), e))?;
    Ok(dir)
}

/// `entries/<id>.mdix` lives here — one file per note/todo/board,
/// created on first use.
pub fn entries_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = ensure_data_root(app)?.join("entries");
    fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create {}: {}", dir.display(), e))?;
    Ok(dir)
}

pub fn entry_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(entries_dir(app)?.join(format!("{}.mdix", id)))
}

pub fn notes_index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_data_root(app)?.join("notes_index.mdix"))
}

pub fn todos_index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_data_root(app)?.join("todos_index.mdix"))
}

pub fn boards_index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_data_root(app)?.join("boards_index.mdix"))
}

pub fn tags_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_data_root(app)?.join("tags.mdix"))
}
