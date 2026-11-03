// The home-screen widget's buttons. A tap opens MidNote with a link (see src-tauri/android-widgets/kotlin/
// MidNoteWidget.kt): midnote://new/note, midnote://new/todo or midnote://new/board. This turns such a link into the
// route that starts a BLANK editor: /note/new, /todo/new, /board/new. Those editors save nothing until something is
// typed, so an opened-by-mistake link, a link replayed by Android when the app comes back from recents, or one
// followed from a web page just leaves an empty editor behind.
//
// Only these three exact links are accepted and the result is always one of three fixed paths: a link can never steer
// the app anywhere else. Plain TypeScript, no DOM.

export type WidgetKind = "note" | "todo" | "board";

/** midnote://new/<kind>, with an optional trailing slash and an optional ?query or #fragment (ignored). */
const WIDGET_LINK = /^midnote:\/\/new\/(note|todo|board)\/?(?:[?#].*)?$/i;

/** Which new entry a widget link asks for, or null when the link is not one of the widget's three. */
export function widgetKind(url: string): WidgetKind | null {
  const m = WIDGET_LINK.exec(url.trim());
  return m ? (m[1].toLowerCase() as WidgetKind) : null;
}

/** The blank-editor route for a widget link, or null. */
export function widgetPath(url: string): string | null {
  const kind = widgetKind(url);
  return kind ? `/${kind}/new` : null;
}

/** The link a widget button carries (the Kotlin side writes the same three strings). */
export function widgetLink(kind: WidgetKind): string {
  return `midnote://new/${kind}`;
}
