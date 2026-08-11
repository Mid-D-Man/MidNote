// Shape mirrors mdix_files/schema/*.mdix exactly — a Note/Todo here maps
// 1:1 onto an entries/<id>.mdix file's @DATA fields, and EntryRef maps
// onto a notes_index.mdix / todos_index.mdix row. Keeping the frontend
// type identical to the DixScript schema means storage.ts's eventual swap
// from localStorage to real Tauri invoke calls is a backend-only change,
// not a data-shape rewrite.

export interface EntryRef {
  id: string;
  title: string;
  tags: string[];
  lastModified: string;
  isBookmarked: boolean;
  encrypted: boolean;
}

export interface Note extends EntryRef {
  type: "regular";
  content: string;
}

export interface Step {
  id: string;
  category: string;
  title: string;
  content: string;
}

export interface Annotation {
  id: string;
  category: string;
  title: string;
  content: string;
}

export interface Todo extends EntryRef {
  type: "todo";
  categories: string[];
  steps: Step[];
  annotations: Annotation[];
}

export type Entry = Note | Todo;
