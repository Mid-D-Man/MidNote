//! Local DixScript data layer — reads/writes real .mdix files under the
//! app's data directory (see paths.rs): one file per entry, plus
//! tags.mdix, notes_index.mdix, todos_index.mdix, boards_index.mdix.
//! This is the only place that should touch the `dixscript` crate
//! directly (matches mdix-cybs's convention of depending on dixscript
//! directly rather than shelling out to mdix-cli).
//!
//! Wired up as of round 22 — mdix_json.rs is the shared generic JSON<->
//! .mdix engine entries/index/tags all build on; see its module doc for
//! how the runtime file format relates to mdix_files/schema/'s reference
//! docs, and for the zero-Rust-compiler caveat that applies to this
//! whole module (same as crypto.rs already carried).

pub mod entries;
pub mod index;
pub mod tags;
pub mod crypto;
pub mod mdix_json;
pub mod paths;
