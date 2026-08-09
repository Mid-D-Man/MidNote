//! Local DixScript data layer — reads/writes the .mdix files described in
//! mdix_files/schema/: one file per entry, plus tags.mdix, notes_index.mdix,
//! todos_index.mdix. This is the only place that should touch the
//! `dixscript` crate directly (matches mdix-cybs's convention of depending
//! on dixscript directly rather than shelling out to mdix-cli).
//!
//! Not wired up yet — see mdix_files/schema/ for the validated shape each
//! function here needs to read and write.

pub mod entries;
pub mod index;
pub mod tags;
