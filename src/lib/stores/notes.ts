// Svelte store for the notes list — backed by notes_index.mdix via
// src-tauri/src/data/index.rs, not by direct file access from the frontend.
// TODO: wire to Tauri invoke("get_notes_index") once commands/notes.rs is real.
import { writable } from "svelte/store";

export interface NoteRef {
  id: string;
  title: string;
  tags: string[];
  lastModified: string;
  isBookmarked: boolean;
  encrypted: boolean;
}

export const notes = writable<NoteRef[]>([]);
