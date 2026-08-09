// Svelte store for the tag/category registry — backed by tags.mdix.
// TODO: wire to Tauri invoke("get_tags").
import { writable } from "svelte/store";

export const noteTags = writable<string[]>([]);
export const todoTags = writable<string[]>([]);
export const todoCategories = writable<string[]>([]);
