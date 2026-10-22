// Round G — turning what the AI writes into something MidNote can use. Plain TypeScript, no DOM.
//
//   splitTitledNote   "Title\n\nbody..." -> { title, body } (a titled `create` answer)
//   aiTextToHtml      light Markdown -> the HTML a note stores (<div> paragraphs, <ul>/<ol>, <strong>, <em>, <s>)
//   clampNoteText     a note too long for one chat request: its start and end are kept
//   lastTurns         the newest few chat turns (the server trims further to fit)
//
// The editor has no headings, so a Markdown heading becomes a bold line. Everything is escaped first, so text such as
// "<script>" or "a < b" shows literally. Nothing here ever drops a word the AI wrote (marker characters aside).

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** **bold**, *italic*, _italic_, ~~strike~~ and `code` (shown as plain text), on text that is ALREADY escaped. */
export function inlineToHtml(escaped: string): string {
  return escaped
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<![\w_])__(?=\S)([^_\n]+?)(?<=\S)__(?![\w_])/g, "<strong>$1</strong>")
    .replace(/~~(?=\S)([^~\n]+?)(?<=\S)~~/g, "<s>$1</s>")
    .replace(/(?<![*\w])\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?![*\w])/g, "<em>$1</em>")
    .replace(/(?<![\w_])_(?=[^\s_])([^_\n]+?)(?<=[^\s_])_(?![\w_])/g, "<em>$1</em>");
}

type Block = { kind: "p"; html: string } | { kind: "blank" } | { kind: "ul" | "ol"; items: string[]; start: number };

const BULLET = /^\s*[-*•+]\s+(.*)$/;
const ORDERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const FENCE = /^\s*```/;

function itemText(raw: string): string {
  // a checklist line keeps its box as text: "- [ ] tent" -> "☐ tent"
  const t = raw.replace(/^\[( |x|X)\]\s+/, (_, c: string) => (c === " " ? "☐ " : "☑ "));
  return inlineToHtml(escapeHtml(t.trim()));
}

export function aiTextToHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  const nextKind = (from: number): "ul" | "ol" | null => {
    for (let j = from; j < lines.length; j++) {
      if (lines[j].trim() === "") continue;
      return BULLET.test(lines[j]) && !RULE.test(lines[j]) ? "ul" : ORDERED.test(lines[j]) ? "ol" : null;
    }
    return null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE.test(line) || RULE.test(line)) continue;
    if (line.trim() === "") {
      const open = blocks[blocks.length - 1];
      // a blank line inside a loose list ("- a", "", "- b") does not end the list
      if (open && (open.kind === "ul" || open.kind === "ol") && nextKind(i + 1) === open.kind) continue;
      if (blocks.length > 0 && blocks[blocks.length - 1].kind !== "blank") blocks.push({ kind: "blank" });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      blocks.push({ kind: "p", html: `<strong>${inlineToHtml(escapeHtml(h[1]))}</strong>` });
      continue;
    }
    const b = BULLET.exec(line);
    const o = b ? null : ORDERED.exec(line);
    if (b || o) {
      const kind = b ? "ul" : "ol";
      const item = itemText(b ? b[1] : o![2]);
      const last = blocks[blocks.length - 1];
      if (last && last.kind === kind) last.items.push(item);
      else blocks.push({ kind, items: [item], start: o ? Number(o[1]) : 1 });
      continue;
    }
    blocks.push({ kind: "p", html: inlineToHtml(escapeHtml(line.trim())) });
  }
  while (blocks.length > 0 && blocks[blocks.length - 1].kind === "blank") blocks.pop();
  return blocks
    .map((b) => {
      if (b.kind === "blank") return "<div></div>";
      if (b.kind === "p") return `<div>${b.html}</div>`;
      const li = b.items.map((x) => `<li><div>${x}</div></li>`).join("");
      return b.kind === "ol" ? `<ol${b.start !== 1 ? ` start="${b.start}"` : ""}>${li}</ol>` : `<ul>${li}</ul>`;
    })
    .join("");
}

const TITLE_MAX = 80;

function cleanTitle(line: string): string {
  let t = line.trim().replace(/^#{1,6}\s+/, "").replace(/^title\s*[:\-–—]\s*/i, "");
  t = t.replace(/^\*\*(.+)\*\*$/, "$1").replace(/^__(.+)__$/, "$1").replace(/^["“'‘](.+)["”'’]$/, "$1");
  t = t.replace(/[\s:;,.\-–—]+$/, "").replace(/\s+/g, " ").trim();
  if (t.length > TITLE_MAX) {
    const cut = t.slice(0, TITLE_MAX);
    const sp = cut.lastIndexOf(" ");
    t = (sp > 30 ? cut.slice(0, sp) : cut).trim();
  }
  return t;
}

/** A title made from what the person asked for: the first few words, capitalised. */
export function fallbackTitle(prompt: string): string {
  const words = prompt.trim().replace(/\s+/g, " ").split(" ").filter(Boolean).slice(0, 6).join(" ");
  const t = cleanTitle(words);
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "AI note";
}

/**
 * A titled answer is "Title", an empty line, then the body. If the model ignored that shape (no short first line, or
 * nothing after it) the whole answer is the body and the title comes from the prompt, so nothing is lost.
 */
export function splitTitledNote(text: string, prompt: string): { title: string; body: string; shaped: boolean } {
  const all = text.replace(/\r\n?/g, "\n").trim();
  if (!all) return { title: fallbackTitle(prompt), body: "", shaped: false };
  const nl = all.indexOf("\n");
  const first = nl === -1 ? all : all.slice(0, nl);
  const rest = nl === -1 ? "" : all.slice(nl + 1).trim();
  const title = cleanTitle(first);
  if (title && first.trim().length <= 100 && rest) return { title, body: rest, shaped: true };
  return { title: fallbackTitle(prompt), body: all, shaped: false };
}

/** A note too long for one chat request keeps its start (60%) and end; the middle becomes "[…]". Exactly `limit` long at most. */
export function clampNoteText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const mark = "\n[…]\n";
  const head = Math.floor((limit - mark.length) * 0.6);
  const tail = limit - mark.length - head;
  return text.slice(0, head) + mark + text.slice(text.length - tail);
}

/**
 * The newest `max` turns of a conversation, starting with the PERSON's turn (an answer whose question was cut off is
 * dropped with it). The server trims further to fit; this keeps the request small.
 */
export function lastChatTurns<T extends { role: "user" | "assistant" }>(turns: T[], max: number): T[] {
  const kept = turns.length <= max ? turns.slice() : turns.slice(turns.length - max);
  while (kept.length > 1 && kept[0].role === "assistant") kept.shift();
  return kept;
}
