//! Tauri IPC commands exposed to the SvelteKit frontend via `invoke()`.
//! Thin — real logic belongs in `data::`, these just adapt it to Tauri.

pub mod entries;
pub mod notes;
pub mod todos;
pub mod boards;
pub mod tags;
pub mod crypto;
