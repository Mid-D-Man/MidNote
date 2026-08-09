//! Read/write notes_index.mdix and todos_index.mdix — metadata only, no
//! entry content. Encrypted entries keep their real title but empty tags
//! here (see mdix_files/schema/notes_index.mdix for the exact shape).
//!
//! TODO: implement against dixscript once data/entries.rs exists.

pub fn load_notes_index() -> Result<(), String> {
    Err("not implemented".into())
}

pub fn load_todos_index() -> Result<(), String> {
    Err("not implemented".into())
}
