// Thin wrapper around the Tauri commands in src-tauri/src/commands/.
// On desktop/mobile this calls into the Rust `dixscript` crate directly
// (see src-tauri/src/data/). A browser build would swap this file's
// internals for @midmanstudio/mdix (wasm) instead — same call shape,
// different backend, per the sync-architecture note that the fork is in
// where the bytes live, not in the data model.
// TODO: implement once commands/notes.rs and commands/todos.rs are real.
import { invoke } from "@tauri-apps/api/core";

export async function getNotesIndex() {
  return invoke("get_notes_index");
}

export async function getTodosIndex() {
  return invoke("get_todos_index");
}
