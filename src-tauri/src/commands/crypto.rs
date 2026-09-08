//! Tauri IPC commands for the Lock feature — thin wrappers over
//! `data::crypto`, matching this project's existing convention
//! (commands/ adapts, data:: does the actual work). Deliberately generic
//! (takes/returns plain JSON strings, not Note/Todo types) — see
//! data/crypto.rs's doc comment on lock_payload for why.

use crate::data;

#[derive(serde::Serialize)]
pub struct LockedPayload {
    #[serde(rename = "encryptedDataB64")]
    pub encrypted_data_b64: String,
    #[serde(rename = "keyFileContent")]
    pub key_file_content: String,
}

#[tauri::command]
pub fn lock_payload(plaintext_json: String, password: String) -> Result<LockedPayload, String> {
    let locked = data::crypto::lock_payload(&plaintext_json, &password)?;
    Ok(LockedPayload {
        encrypted_data_b64: locked.encrypted_data_b64,
        key_file_content: locked.key_file_content,
    })
}

#[tauri::command]
pub fn unlock_payload(encrypted_data_b64: String, key_file_content: String, password: String) -> Result<String, String> {
    data::crypto::unlock_payload(&encrypted_data_b64, &key_file_content, &password)
}
