//! Generic JSON <-> plain-text DixScript (.mdix) conversion — the engine
//! entries.rs, index.rs and tags.rs all share.
//!
//! DELIBERATE SIMPLIFICATION vs mdix_files/schema/*.mdix: those reference
//! schema files exercise @ENUMS/@IMPORTS/@QUICKFUNCS (e.g. `type<enum> =
//! EntryType.REGULAR`, `headerTheme = Themes.theme_preset("sunset")`) as
//! rich documentation of the intended shape. The files this module
//! actually reads/writes at runtime use a flatter dialect of the exact
//! same data model instead — plain strings (`type = "regular"`) and
//! inline object literals (`headerTheme = { kind = "preset", name =
//! "sunset", customThemeId = null }`) rather than enums/cross-file
//! imports/QuickFunc calls. Every field name and value is identical
//! either way; only how the *shape* of `type`/`headerTheme` is spelled
//! changes. This was a deliberate call, not an oversight: cross-file
//! @IMPORTS resolution and @ENUMS add real moving parts this module
//! would depend on with zero ability to compile or run it against a real
//! Rust toolchain in the environment this was written in (see this
//! repo's delivery-pipeline notes — same "DixScript-Rust Exemption"
//! constraint crypto.rs was written under). The flatter dialect below
//! was verified end-to-end against the real parser instead (via its
//! Python binding, `pip install midmanstudio-mdix`), covering: inline
//! nested objects, arrays of inline objects, negative/float numbers,
//! `null`, and a deliberately hostile string (embedded quotes, backslash,
//! newline) round-tripping through escape_mdix_string below. The
//! reference schema docs are left exactly as they are — they're a
//! human-facing spec, not something this code parses.
//!
//! CAVEAT (same as crypto.rs's own header comment): every `dixscript`
//! crate API used below (`DixLoader::load_text`, `DixData::get`,
//! `to_structural_hashmap`, the `TryFrom<DixValue>` impls) was checked
//! line-by-line against dixscript 1.0.0's actual Rust source
//! (github.com/Mid-D-Man/DixScript-Rust), not just its README — there is
//! no Rust toolchain in the environment this was written in, so none of
//! it has actually been compiled. Needs a real `cargo check` + an
//! on-device round trip (write an entry, kill the app, reopen it) before
//! this is trusted.

use dixscript::Runtime::{DixData, DixLoadOptions, DixLoader, DixValue};
use serde_json::{Map, Number, Value};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

/// Mirrors `selectionActions.ts`'s `mdixString()` exactly (same escaping
/// rules, already validated against the real parser there with a
/// deliberately hostile title — embedded quotes/backslash/newline) so a
/// title/content string that round-trips safely through the frontend's
/// own encrypted-backup export round-trips safely here too.
fn escape_mdix_string(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace("\r\n", "\\n")
        .replace('\n', "\\n");
    format!("\"{}\"", escaped)
}

/// Renders one JSON value as a DixScript literal. Arrays are handled by
/// the caller (json_to_data_block) — in this dialect they only ever
/// appear as a top-level `field::` block, matching every real schema
/// file (nowhere does an array sit nested inside an object or another
/// array), never inline here.
fn value_to_mdix(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => escape_mdix_string(s),
        Value::Object(obj) => {
            let fields: Vec<String> = obj
                .iter()
                .map(|(k, v)| format!("{} = {}", k, value_to_mdix(v)))
                .collect();
            format!("{{ {} }}", fields.join(", "))
        }
        // Not reachable today (see module doc) — nothing in this app's
        // data model nests an array inside an object/array. Render
        // *something* parseable rather than panic if that ever changes.
        Value::Array(items) => {
            let rendered: Vec<String> = items.iter().map(value_to_mdix).collect();
            format!("[{}]", rendered.join(", "))
        }
    }
}

/// Builds the full `@DATA( ... )` block body for `obj` — scalar/object
/// fields first, `field::` array blocks last. DixScript's group arrays
/// (`::`) MUST be the trailing content of a @DATA block: confirmed
/// against the real parser (a scalar field placed after one is a hard
/// parse error, "Expected array item, ',', or ')' in group array" — see
/// mdix_files/schema/entry-board.mdix's own comment documenting this
/// exact error from an earlier draft). An empty array is omitted
/// entirely rather than writing an empty `::` block — storage.ts's
/// normalizeEntry() already defaults any missing array field to `[]`
/// (its existing migration-compat logic), so omitting one here needs no
/// new frontend handling.
pub fn json_to_data_block(obj: &Map<String, Value>) -> String {
    let mut scalars = Vec::new();
    let mut arrays = Vec::new();

    for (key, value) in obj {
        match value {
            Value::Array(items) => {
                if items.is_empty() {
                    continue;
                }
                let rendered: Vec<String> = items.iter().map(value_to_mdix).collect();
                arrays.push(format!("  {}::\n    {}", key, rendered.join(",\n    ")));
            }
            other => scalars.push(format!("  {} = {}", key, value_to_mdix(other))),
        }
    }

    let mut lines = scalars;
    lines.extend(arrays);
    format!("@DATA(\n{}\n)\n", lines.join("\n"))
}

/// Writes `obj` as a complete, plain (unencrypted) .mdix file — the same
/// `@CONFIG` header every hand-authored file in mdix_files/schema/ uses.
/// Written to a `.tmp` sibling first and renamed into place, so a crash
/// or kill mid-write can never leave a half-written file where a real
/// one used to be — `fs::rename` on the same filesystem is atomic on
/// both Android's filesystem and desktop targets.
pub fn write_mdix_file(path: &Path, obj: &Map<String, Value>) -> Result<(), String> {
    let source = format!(
        "// Brought to u by MidManStudio\n\n@CONFIG(\n  version    -> \"1.0.0\"\n  features   -> \"data\"\n  debug_mode -> \"off\"\n)\n\n{}",
        json_to_data_block(obj)
    );
    let tmp_path = path.with_extension("mdix.tmp");
    fs::write(&tmp_path, source)
        .map_err(|e| format!("Failed to write {}: {}", tmp_path.display(), e))?;
    fs::rename(&tmp_path, path)
        .map_err(|e| format!("Failed to finalize {}: {}", path.display(), e))
}

/// Converts one `DixValue` into the equivalent `serde_json::Value` —
/// covers every variant `dixscript`'s `DixValue` enum actually has (see
/// Runtime/dix_value.rs), not just the ones this app's own data happens
/// to use today, so a value of a kind this app hasn't produced yet
/// doesn't silently vanish on read.
fn dix_value_to_json(value: &DixValue) -> Value {
    match value {
        DixValue::Null => Value::Null,
        DixValue::Bool(b) => Value::Bool(*b),
        DixValue::Int(i) => Value::Number((*i).into()),
        DixValue::Long(l) => Value::Number((*l).into()),
        DixValue::Float(f) => Number::from_f64(*f as f64)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        DixValue::Double(d) => Number::from_f64(*d)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        DixValue::String(s)
        | DixValue::Date(s)
        | DixValue::Timestamp(s)
        | DixValue::HexColor(s)
        | DixValue::Blob(s)
        | DixValue::Regex(s) => Value::String(s.clone()),
        DixValue::Array(items) | DixValue::Tuple(items) => {
            Value::Array(items.iter().map(dix_value_to_json).collect())
        }
        DixValue::Object(map) => {
            let mut out = Map::new();
            for (k, v) in map {
                out.insert(k.clone(), dix_value_to_json(v));
            }
            Value::Object(out)
        }
        DixValue::Enum { field_name, .. } => Value::String(field_name.clone()),
    }
}

/// Reads a plain .mdix file back into a JSON object — the reverse of
/// write_mdix_file. Uses `to_structural_hashmap()` deliberately, not
/// `to_hashmap()`: the latter also carries synthetic flattened child
/// paths (`"headerTheme.name"`, `"tags[0]"`) alongside the real root
/// entries (`"headerTheme"`, `"tags"`) — confirmed empirically against
/// the real parser, not assumed — and feeding those synthetic paths back
/// out as JSON keys would produce a broken shape.
/// `to_structural_hashmap()` filters them, leaving exactly the root
/// fields this file's writer produced.
pub fn read_mdix_file(path: &Path) -> Result<Value, String> {
    let path_str = path
        .to_str()
        .ok_or_else(|| format!("Non-UTF8 path: {}", path.display()))?;
    let loader = DixLoader::new();
    let data: DixData = loader.load_text(path_str, &DixLoadOptions::new())?;
    let structural: HashMap<String, DixValue> = data.to_structural_hashmap();
    let mut out = Map::new();
    for (k, v) in structural {
        out.insert(k, dix_value_to_json(&v));
    }
    Ok(Value::Object(out))
}
