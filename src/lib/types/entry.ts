// Shape mirrors mdix_files/schema/*.mdix exactly — a Note/Todo here maps
// 1:1 onto an entries/<id>.mdix file's @DATA fields, and EntryRef maps
// onto a notes_index.mdix / todos_index.mdix row. Keeping the frontend
// type identical to the DixScript schema means storage.ts's eventual swap
// from localStorage to real Tauri invoke calls is a backend-only change,
// not a data-shape rewrite.

// Mirrors themes.mdix's theme_preset()/theme_custom() QuickFuncs exactly
// — a pointer, never the actual image. Exactly one of name/customThemeId
// is non-null depending on kind. "preset" resolves against
// themePalette.ts's bundled solid-color palette (nothing about a
// preset's color lives in DixScript, same as the schema comment says);
// "custom" looks up an uploaded image by id in the CustomTheme registry
// (see custom-themes.mdix / stores/customThemes.svelte.ts) so one upload
// can be reused across many notes without duplicating the blob.
export interface ThemeRef {
  kind: "preset" | "custom";
  name: string | null;
  customThemeId: string | null;
}

// No-theme sentinel — matches the schema seed data's Themes.theme_preset("none")
// convention (a real preset name, not a null theme field).
export const NO_THEME: ThemeRef = { kind: "preset", name: "none", customThemeId: null };

// Mirrors custom-themes.mdix's custom_theme() shape exactly. `data` is a
// base64 data URL (already downscaled — see storage.ts's
// storeCustomThemeImage) so it can go straight into a CSS
// background-image without another decode step.
export interface CustomTheme {
  id: string;
  data: string;
  width: number;
  height: number;
  createdAt: string;
  // Precomputed once at upload time (storage.ts's storeCustomThemeImage,
  // via colorthief's real pixel-sampling — not guessed) — "#ffffff" or
  // "#000000", whichever reads legibly over this image's actual sampled
  // color. Computed once and stored rather than recomputed on every
  // render because getting it requires decoding the image into a canvas,
  // which is inherently async in a browser — not something any of this
  // app's synchronous $derived theme-resolution code (resolveTheme,
  // called from plain reactive expressions all over the app) could ever
  // do on the fly. Optional because it doesn't exist on any CustomTheme
  // uploaded before this field existed — see resolveTheme's fallback for
  // exactly what happens then (nothing regresses; old uploads keep their
  // pre-existing look).
  textColor?: string;
}

export type LockKeyMode = "app" | "custom";

export interface EntryRef {
  id: string;
  title: string;
  tags: string[];
  lastModified: string;
  isBookmarked: boolean;
  encrypted: boolean;
  // Quick per-card strikethrough toggle from the ⋮ overflow menu — shared
  // between notes and todos deliberately (confirmed explicitly, not
  // assumed): same field, same toggle function, same visual treatment
  // for both card types. Not the same concept as a todo "step" being
  // checked off (steps/annotations already have their own completion
  // state inside Todo) — this is a whole-entry-level flag, e.g. "this
  // note/todo is done with, keep it around but visually mark it so."
  struck: boolean;
  // ⋮ overflow menu — pinned entries float to the top of the list, but
  // only while the search box is empty (see +page.svelte's sortedItems):
  // pinning is a browsing convenience, not something that should ever
  // hide or reorder an actual search result you went looking for.
  isPinned: boolean;
  // Per-entry visual theme, selected from the same Actions sheet as
  // Share/Duplicate. Distinct from settings.svelte.ts's appHeaderTheme/
  // appBodyTheme, which are the landing-page-wide defaults — these
  // override them for one specific note/todo.
  //
  // Split into two independent slots (was a single flat `theme` field):
  // headerTheme is what NoteCard/the todo row paint themselves with in
  // the list, AND what the editor's own header bar (NoteEditorHeader/
  // TodoHeader) tints — i.e. exactly the old `theme` field's behavior,
  // just renamed and re-scoped now that there's a second slot next to
  // it. bodyTheme is new: it paints the editor's actual writing surface
  // (see routes/note/[id]/+page.svelte's .scroll-area / the todo
  // equivalent). Deliberately restricted to solid-color presets only
  // for now (ThemePicker's `allowCustom={false}` for this slot) — an
  // uploaded image sitting directly behind live Tiptap caret/selection
  // rendering hasn't been verified safe yet, so custom images stay
  // header-only until that gets its own tested pass. See themePalette.ts's
  // resolveTheme, which both slots resolve through identically.
  headerTheme: ThemeRef;
  bodyTheme: ThemeRef;
  // Small glyph badge shown next to the entry's title (list card only,
  // for now) — a preset name from themePalette.ts's ICON_PRESETS, or
  // null for no icon. Entry-only: there's no landing-page equivalent
  // (settings.svelte.ts's app-wide theme has just header+body, no icon
  // slot — an icon only makes sense pinned to one specific note/todo).
  icon: string | null;
  // Lock — real DixScript-Rust AES-256-GCM/Argon2id encryption via
  // src-tauri/src/data/crypto.rs, not a client-side shim. `encrypted`
  // above is the existing is-this-entry-locked flag (already had a
  // schema home before this feature); the three fields below are new.
  // While locked: `content` (notes) / `steps`+`annotations` (todos) AND
  // `tags` are cleared on the visible entry (matches notes_index.mdix's
  // existing "encrypted entries keep their real title but empty tags"
  // convention) and moved into the encrypted payload instead, so
  // nothing is lost — unlocking restores them from there, not from
  // anywhere else. `lockKeyMode` records which password this specific
  // entry needs, purely so the unlock prompt can ask for the right
  // thing ("your app password" vs "this note's password") — see
  // stores/lockSession.svelte.ts and utils/lockFlow.ts.
  lockKeyMode: LockKeyMode | null;
  lockedPayload: string | null;
  lockedKeyFile: string | null;
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
