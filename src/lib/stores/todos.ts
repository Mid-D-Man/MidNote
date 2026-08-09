// Svelte store for the todos list — backed by todos_index.mdix.
// TODO: wire to Tauri invoke("get_todos_index").
import { writable } from "svelte/store";

export interface TodoRef {
  id: string;
  title: string;
  tags: string[];
  lastModified: string;
  isBookmarked: boolean;
  encrypted: boolean;
}

export const todos = writable<TodoRef[]>([]);
