//! Password-based lock/unlock for a single entry's sensitive payload,
//! using the real `dixscript` crate's DLM (@SECURITY) encryption
//! pipeline — the same mechanism DixScript's own CLI (`mdix compile`)
//! uses for its "encrypted secrets bundle" use case (AES-256-GCM,
//! Argon2id-derived key from a password), not a hand-rolled cipher call.
//!
//! Confirmed against dixscript 1.0.0's actual source (DixScript-Rust
//! repo, dixscript/src/Runtime/loader.rs and Compiler/DLM/), not just
//! its README — the README's own documented round-trip pair
//! (compile_with_dlm_from_str / decompile_with_dlm_from_bytes) turns out
//! to be keyfile-mode-only for the reverse direction in practice. See
//! unlock_payload's doc comment below for why this goes one level lower
//! for that half.
//!
//! IMPORTANT CAVEAT, stated plainly rather than buried: this file could
//! not be compiled in the environment it was written in (dixscript
//! needs Rust 1.80+; no Rust toolchain at all was available there — see
//! this project's own standing "DixScript-Rust Exemption" rule). Every
//! API call here was checked against dixscript's actual source
//! line-by-line rather than assumed from docs, and the exact .mdix
//! source template below was independently parse-tested against the
//! real engine via its Python binding (which wraps the same underlying
//! build) — including with embedded quotes/HTML/newlines, confirming
//! the base64-wrapping approach sidesteps DixScript string-literal
//! escaping entirely rather than needing to get its escape grammar
//! right by guesswork. What that Python testing could NOT cover: the
//! DLM encrypt/decrypt pipeline itself (the Python binding only exposes
//! reading already-encrypted files, not producing them), and — the
//! biggest gap — whether this actually compiles at all for
//! armv7-linux-androideabi. Needs `cargo check`, then a real on-device
//! lock+unlock round trip, before this is trusted.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use dixscript::Compiler::Core::BinarySerialization::BinaryUnpacker;
use dixscript::Compiler::Core::Config::DebugMode;
use dixscript::Compiler::DLM::DLMReverseExecutor;
use dixscript::Runtime::{DixData, DixLoader};
use std::sync::Mutex;

/// The bytes + recovery metadata produced by locking a payload.
/// `key_file_content` is dixscript's own term for this (see
/// `DLMPipelineResult::key_file_content` upstream) — despite the name,
/// for password mode it's just a salt + KDF parameters, never the
/// password or a raw key (confirmed in key_resolver.rs: password-mode
/// key material is derived fresh from salt + the caller-supplied
/// password every time via Argon2id, nothing secret is stored in it).
/// Safe to keep as plain text alongside the ciphertext; the actual
/// password is never persisted anywhere by this file or its caller.
pub struct LockedPayload {
    pub encrypted_data_b64: String,
    pub key_file_content: String,
}

/// `DLMPipelineExecutor::new` (the forward/compile direction, used
/// inside `lock_payload` via `DixLoader::compile_with_dlm_from_str`)
/// reads its password from the `MDIX_DLM_PASSWORD` process environment
/// variable — not a constructor argument. Confirmed directly in
/// dixscript/src/Compiler/DLM/dlm_pipeline_executor.rs
/// (`let password = std::env::var("MDIX_DLM_PASSWORD").ok();`); this is
/// nowhere in dixscript's own docs, only in its source. Fine for
/// dixscript's own CLI (one password per process invocation) but a real
/// hazard here: env vars are process-global, and Tauri can run
/// `#[tauri::command]` handlers concurrently. This mutex serializes
/// every lock operation so two concurrent locks can never see each
/// other's password through the env var, and the var is always cleared
/// again before the mutex is released — including on an error path, via
/// the Drop guard below rather than a cleanup line a `?` early-return
/// could skip over.
static DLM_ENV_LOCK: Mutex<()> = Mutex::new(());

struct EnvPasswordGuard;
impl Drop for EnvPasswordGuard {
    fn drop(&mut self) {
        // SAFETY: only ever constructed while DLM_ENV_LOCK's guard is
        // still held in the same scope (see lock_payload), so no other
        // thread can be reading/writing this same process-global var
        // concurrently with this removal.
        unsafe { std::env::remove_var("MDIX_DLM_PASSWORD") };
    }
}

/// Encrypts `plaintext_json` with `password`, returning the ciphertext
/// and its recovery metadata. Deliberately knows nothing about
/// MidNote's Note/Todo shape — the frontend decides what JSON goes in
/// (e.g. `{"content": "...", "tags": [...]}` for a note), this just
/// locks a string. Keeping it generic means this file never needs to
/// change if the app's data model does.
pub fn lock_payload(plaintext_json: &str, password: &str) -> Result<LockedPayload, String> {
    if password.is_empty() {
        return Err("Password cannot be empty.".into());
    }

    // Base64-wrapped before embedding as a DixScript string literal —
    // not because DixScript can't handle quotes/newlines in principle,
    // but because getting its exact escaping grammar wrong would risk
    // silently corrupting or failing to compile arbitrary note content,
    // and that specific risk is avoidable entirely: base64 output is
    // guaranteed ASCII with no quotes/backslashes, so it needs zero
    // escaping in any string-literal syntax. Verified directly (not
    // just reasoned about) against the real parser via its Python
    // binding, including HTML content containing quotes and newlines.
    let b64 = BASE64.encode(plaintext_json.as_bytes());
    let source = format!(
        "@DLM(DEncryptor.aes256)\n@DATA(content = \"{b64}\")\n@SECURITY(encryption -> {{ mode = \"password\", algorithm = \"aes256-gcm\" }})\n",
    );

    let _dlm_env_guard = DLM_ENV_LOCK.lock().map_err(|_| "Internal lock state was poisoned by an earlier panic.".to_string())?;
    // SAFETY: DLM_ENV_LOCK is held for this entire scope (guard above
    // isn't dropped until this function returns), and EnvPasswordGuard
    // clears the var before that lock is released.
    unsafe { std::env::set_var("MDIX_DLM_PASSWORD", password) };
    let _clear_on_drop = EnvPasswordGuard;

    let loader = DixLoader::new();
    let result = loader
        .compile_with_dlm_from_str(&source, "midnote-entry")
        .map_err(|e| format!("Lock failed: {e}"))?;

    if !result.is_success {
        return Err(format!("Lock failed: {:?}", result.errors));
    }
    let key_file_content = result
        .key_file_content
        .ok_or_else(|| "Lock failed: no key material was generated.".to_string())?;

    Ok(LockedPayload {
        encrypted_data_b64: BASE64.encode(&result.processed_data),
        key_file_content,
    })
}

/// Reverses `lock_payload`, returning the original `plaintext_json`.
///
/// Deliberately does NOT use dixscript's own
/// `DixLoader::decompile_with_dlm_from_bytes`, even though it looks like
/// the obvious symmetric counterpart to `compile_with_dlm_from_str`
/// above. Read closely (dixscript/src/Runtime/loader.rs), that
/// convenience method hardcodes `None` for
/// `DLMReverseExecutor::new`'s password argument — it can only ever
/// reverse KEYFILE-mode data, where the key file alone fully resolves
/// the key with no separate secret needed. This app uses PASSWORD mode
/// throughout (nothing is ever written to a real `.mdix.key` file on
/// disk), so this goes one level lower and constructs
/// `DLMReverseExecutor` directly — its constructor does take a real
/// `password: Option<String>` parameter, confirmed by reading the
/// constructor's own signature, not assumed from the higher-level
/// wrapper that doesn't expose it.
pub fn unlock_payload(encrypted_data_b64: &str, key_file_content: &str, password: &str) -> Result<String, String> {
    if password.is_empty() {
        return Err("Password cannot be empty.".into());
    }

    let encrypted_data = BASE64
        .decode(encrypted_data_b64)
        .map_err(|e| format!("Locked data is corrupted: {e}"))?;

    // Neither path is ever actually read from disk here — real files
    // are never involved for in-memory password-mode round-tripping —
    // but the constructor still wants something `impl AsRef<Path>`, so
    // a descriptive placeholder is all that's needed. Mirrors
    // dixscript's own decompile_with_dlm_from_bytes, which does the
    // exact same thing for its (keyfile-only) case.
    let reverse_executor = DLMReverseExecutor::new(
        "midnote-entry",
        "midnote-entry.key",
        Some(password.to_string()),
        DebugMode::Off,
    );
    let reverse_result = reverse_executor.execute_from_bytes(encrypted_data, key_file_content);
    if !reverse_result.is_success {
        // dixscript doesn't distinguish "wrong password" from other
        // failure modes in these error strings. In practice that's the
        // only realistic cause once the stored ciphertext/key content
        // themselves are known-good (this app never edits them after
        // lock_payload originally wrote them) — the frontend surfaces
        // any failure here as "wrong password, try again."
        return Err(format!("Unlock failed: {:?}", reverse_result.errors));
    }

    let mut unpacker = BinaryUnpacker::new();
    let deser_result = unpacker.unpack(&reverse_result.restored_data);
    if !deser_result.is_success {
        return Err(format!("Unlock failed: {:?}", deser_result.errors));
    }
    let ast = deser_result
        .ast
        .ok_or_else(|| "Unlock failed: no data was recovered.".to_string())?;

    // Same DixData::from_ast call shape as dixscript's own
    // decompile_with_dlm_from_bytes uses for its return value — version/
    // compile_time/is_compressed/applied_modules are just descriptive
    // metadata on the resulting DixData, not inputs that affect which
    // fields come back or their values.
    let data = DixData::from_ast(ast, "1.0.0".to_string(), chrono::Utc::now(), true, false, vec![]);
    let b64: String = data.get("content").map_err(|e| format!("Unlock failed: {e}"))?;
    let plaintext_bytes = BASE64.decode(&b64).map_err(|e| format!("Locked data is corrupted: {e}"))?;
    String::from_utf8(plaintext_bytes).map_err(|e| format!("Locked data is corrupted: {e}"))
}
