//! Read/write a single entries/<id>.mdix file (note or todo).
//!
//! TODO: `cargo add dixscript`, then implement using
//! `dixscript::Runtime::DixLoader` (see DixScript-Rust's README "Getting
//! Started" section) against the shape in mdix_files/schema/entry-note.mdix
//! and entry-todo.mdix. Encrypted entries load via the same loader's
//! password/keyfile path per @SECURITY on that specific file.

pub struct EntryRef {
    pub id: String,
}

pub fn load_entry(_id: &str) -> Result<(), String> {
    Err("not implemented".into())
}

pub fn save_entry(_id: &str) -> Result<(), String> {
    Err("not implemented".into())
}
