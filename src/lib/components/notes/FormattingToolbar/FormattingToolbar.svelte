<script lang="ts">
  // REVISION: B/I/U/S/size/color/background move back out of the
  // header's Actions sheet and into this toolbar — direct request,
  // pointing at FlyNote's own editor as the reference: one persistent
  // bottom toolbar, small popups anchored right above it rather than a
  // full-screen sheet underneath everything else.
  //
  // SECOND REVISION: font size, text color, and background color were
  // one combined popup at first — direct request to split them into
  // three separate ones instead (also matching FlyNote, which has a
  // separate trigger per control), each with its own explicit close
  // button. One combined popup was also suspected of sometimes
  // swallowing taps ("maybe cause the popup too big") — three smaller,
  // single-purpose ones are a smaller surface for that either way.
  //
  // No more onCaptureRange/capturedFormatRange, no more pendingFormats,
  // no more hasSelection-gated "which code path applies this" branching
  // in the caller — all commands below just call
  // editor.chain().focus()....run() unconditionally. Whether there's a
  // selection or a collapsed cursor is Tiptap/ProseMirror's own concern
  // now (stored marks handle the collapsed case natively) — see
  // NoteContent.svelte's header comment for why that's the actual fix,
  // not just a different way to write the same workaround.
  import type { Editor } from "@tiptap/core";
  import FontSizePicker from "$lib/components/notes/FontSizePicker/FontSizePicker.svelte";
  import ColorSwatchPicker from "$lib/components/notes/ColorSwatchPicker/ColorSwatchPicker.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import { getKeyboardInset } from "$lib/utils/keyboardInset.svelte";

  const TEXT_COLORS: { label: string; value: string | null }[] = [
    { label: "Default", value: null },
    { label: "Red", value: "#ef4444" },
    { label: "Orange", value: "#f97316" },
    { label: "Yellow", value: "#eab308" },
    { label: "Green", value: "#22c55e" },
    { label: "Teal", value: "#14b8a6" },
    { label: "Blue", value: "#3b82f6" },
    { label: "Purple", value: "#a855f7" },
  ];
  const BG_COLORS: { label: string; value: string | null }[] = [
    { label: "None", value: null },
    { label: "Red", value: "#fecaca" },
    { label: "Orange", value: "#fed7aa" },
    { label: "Yellow", value: "#fef08a" },
    { label: "Green", value: "#bbf7d0" },
    { label: "Teal", value: "#99f6e4" },
    { label: "Blue", value: "#bfdbfe" },
    { label: "Purple", value: "#e9d5ff" },
  ];

  let {
    editor,
    tick = 0,
    hasSelection = false,
  }: {
    editor: Editor | null;
    // Bumped by NoteContent on every Tiptap transaction — read (not
    // written) here purely to give this component's $derived values a
    // reason to re-run when editor.isActive(...)/editor.state changes,
    // since `editor` itself doesn't change identity when its internal
    // state does.
    tick?: number;
    hasSelection?: boolean;
  } = $props();

  // Re-derive on every tick. Cheap: isActive/getAttributes just read
  // ProseMirror's current state, no DOM queries.
  const active = $derived.by(() => {
    tick;
    if (!editor) return { bold: false, italic: false, underline: false, strikethrough: false, list: null as "bullet" | "decimal" | "roman" | null, color: null as string | null, backgroundColor: null as string | null };
    const listType = editor.isActive("bulletList")
      ? "bullet"
      : editor.isActive("orderedList", { type: "i" })
        ? "roman"
        : editor.isActive("orderedList")
          ? "decimal"
          : null;
    return {
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strikethrough: editor.isActive("strike"),
      list: listType as "bullet" | "decimal" | "roman" | null,
      color: (editor.getAttributes("textStyle").color as string | undefined) ?? null,
      backgroundColor: (editor.getAttributes("textStyle").backgroundColor as string | undefined) ?? null,
    };
  });
  const currentFontSize = $derived.by(() => {
    tick;
    const raw = editor?.getAttributes("textStyle").fontSize as string | undefined;
    return raw ? Math.round(parseFloat(raw)) : 15;
  });
  const canUndo = $derived.by(() => {
    tick;
    return editor?.can().undo() ?? false;
  });
  const canRedo = $derived.by(() => {
    tick;
    return editor?.can().redo() ?? false;
  });

  type PopupName = "format" | "size" | "color" | "background" | null;
  let openPopup = $state<PopupName>(null);

  function togglePopup(name: PopupName) {
    openPopup = openPopup === name ? null : name;
  }

  function tap(label: string, run: () => void) {
    breadcrumb(`toolbar: ${label} tapped`);
    if (!editor) return;
    run();
  }

  function toggleRomanList() {
    if (!editor) return;
    if (editor.isActive("orderedList", { type: "i" })) {
      editor.chain().focus().toggleOrderedList().run();
    } else {
      if (!editor.isActive("orderedList")) editor.chain().focus().toggleOrderedList().run();
      editor.chain().focus().updateAttributes("orderedList", { type: "i" }).run();
    }
  }

  function toggleDecimalList() {
    if (!editor) return;
    if (editor.isActive("orderedList") && !editor.isActive("orderedList", { type: "i" })) {
      editor.chain().focus().toggleOrderedList().run();
    } else {
      if (!editor.isActive("orderedList")) editor.chain().focus().toggleOrderedList().run();
      editor.chain().focus().updateAttributes("orderedList", { type: null }).run();
    }
  }
</script>

<div class="toolbar-wrap" style="bottom: calc(max(var(--space-4), env(safe-area-inset-bottom)) + {getKeyboardInset()}px)">
  {#if openPopup === "format"}
    <div class="popup format-popup" role="toolbar" aria-label="Bold, italic, underline, strikethrough" tabindex="-1">
      <button type="button" class:active={active.bold} onclick={() => tap("bold", () => editor?.chain().focus().toggleBold().run())} aria-label="Bold"><strong>B</strong></button>
      <button type="button" class:active={active.italic} onclick={() => tap("italic", () => editor?.chain().focus().toggleItalic().run())} aria-label="Italic"><em>I</em></button>
      <button type="button" class:active={active.underline} onclick={() => tap("underline", () => editor?.chain().focus().toggleUnderline().run())} aria-label="Underline"><span class="underline">U</span></button>
      <button type="button" class:active={active.strikethrough} onclick={() => tap("strikethrough", () => editor?.chain().focus().toggleStrike().run())} aria-label="Strikethrough"><span class="strike">S</span></button>
    </div>
  {:else if openPopup === "size"}
    <div class="popup">
      <FontSizePicker
        fontSize={currentFontSize}
        onFontSizeChange={(size) => tap("font size", () => editor?.chain().focus().setFontSize(`${size}px`).run())}
        onClose={() => (openPopup = null)}
      />
    </div>
  {:else if openPopup === "color"}
    <div class="popup">
      <ColorSwatchPicker
        title="Text color"
        colors={TEXT_COLORS}
        value={active.color}
        onChange={(c) => tap("text color", () => (c ? editor?.chain().focus().setColor(c).run() : editor?.chain().focus().unsetColor().run()))}
        onClose={() => (openPopup = null)}
      />
    </div>
  {:else if openPopup === "background"}
    <div class="popup">
      <ColorSwatchPicker
        title="Background color"
        colors={BG_COLORS}
        value={active.backgroundColor}
        onChange={(c) => tap("background color", () => (c ? editor?.chain().focus().setBackgroundColor(c).run() : editor?.chain().focus().unsetBackgroundColor().run()))}
        onClose={() => (openPopup = null)}
      />
    </div>
  {/if}

  <div class="toolbar" role="toolbar" aria-label="Note formatting" tabindex="-1">
    <button type="button" class="icon-btn" class:active={openPopup === "format" || active.bold || active.italic || active.underline || active.strikethrough} onclick={() => togglePopup("format")} aria-label="Bold, italic, underline, strikethrough">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 21l3-8 10-10 5 5-10 10-8 3z" />
        <path d="M14 5l5 5" />
      </svg>
    </button>
    <button type="button" class="icon-btn" class:active={openPopup === "size"} onclick={() => togglePopup("size")} aria-label="Text size">
      <span class="size-icon">{currentFontSize}</span>
    </button>
    <button type="button" class="icon-btn" class:active={openPopup === "color" || !!active.color} onclick={() => togglePopup("color")} aria-label="Text color">
      <span class="a-icon" style="color:{active.color ?? 'inherit'}">A</span>
    </button>
    <button type="button" class="icon-btn" class:active={openPopup === "background" || !!active.backgroundColor} onclick={() => togglePopup("background")} aria-label="Background color">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 11l-6-6-9 9 6 6z" />
        <path d="M11 3l6 6" />
        <path d="M3 21h18" style={active.backgroundColor ? `stroke:${active.backgroundColor}; stroke-width:4` : undefined} />
      </svg>
    </button>

    {#if !hasSelection}
      <div class="sep"></div>

      <button type="button" class="icon-btn" class:active={active.list === "bullet"} onclick={() => tap("bulletList", () => editor?.chain().focus().toggleBulletList().run())} aria-label="Bullet list" title="Bullet list">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="3.5" cy="6" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="3.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="3.5" cy="18" r="1.2" fill="currentColor" stroke="none" />
          <line x1="8" y1="6" x2="20" y2="6" />
          <line x1="8" y1="12" x2="20" y2="12" />
          <line x1="8" y1="18" x2="20" y2="18" />
        </svg>
      </button>
      <button type="button" class="icon-btn" class:active={active.list === "decimal"} onclick={() => tap("orderedList", toggleDecimalList)} aria-label="Numbered list" title="Numbered list">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="9" y1="6" x2="20" y2="6" />
          <line x1="9" y1="12" x2="20" y2="12" />
          <line x1="9" y1="18" x2="20" y2="18" />
          <text x="1" y="8" font-size="7" fill="currentColor" stroke="none">1</text>
          <text x="1" y="14" font-size="7" fill="currentColor" stroke="none">2</text>
          <text x="1" y="20" font-size="7" fill="currentColor" stroke="none">3</text>
        </svg>
      </button>
      <button type="button" class="icon-btn" class:active={active.list === "roman"} onclick={() => tap("romanList", toggleRomanList)} aria-label="Roman numeral list" title="Roman numeral list">
        <span class="roman-icon">iv.</span>
      </button>

      <div class="sep"></div>

      <button type="button" class="icon-btn" onclick={() => tap("Undo", () => editor?.chain().focus().undo().run())} disabled={!canUndo} aria-label="Undo">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 7v6h6" /><path d="M3 13a9 9 0 1 0 3-7" />
        </svg>
      </button>
      <button type="button" class="icon-btn" onclick={() => tap("Redo", () => editor?.chain().focus().redo().run())} disabled={!canRedo} aria-label="Redo">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 7v6h-6" /><path d="M21 13a9 9 0 1 1-3-7" />
        </svg>
      </button>
    {/if}
  </div>
</div>

<style>
  .toolbar-wrap {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    z-index: 30;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
  }
  .toolbar {
    height: 52px;
    border-radius: 999px;
    border: 1px solid var(--hairline);
    background: var(--surface-raised);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
    padding: 0 var(--space-2);
    display: flex;
    align-items: center;
    gap: var(--space-1);
    max-width: calc(100vw - var(--space-6));
    overflow-x: auto;
  }
  .icon-btn {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-hi);
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: 14px;
  }
  .icon-btn:hover {
    background: var(--surface);
  }
  .icon-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .icon-btn.active {
    background: var(--accent);
    color: var(--bg);
  }
  .size-icon {
    font-family: var(--font-sans);
    font-weight: 700;
    font-size: 13px;
  }
  .a-icon {
    font-family: var(--font-sans);
    font-weight: 700;
    font-size: 16px;
  }
  .roman-icon {
    font-family: var(--font-display);
    font-size: 11px;
    font-weight: 600;
  }
  .underline {
    text-decoration: underline;
  }
  .strike {
    text-decoration: line-through;
  }
  .sep {
    width: 1px;
    height: 24px;
    background: var(--hairline);
    margin: 0 var(--space-1);
    flex-shrink: 0;
  }

  /* Anchored popups: sit directly above the toolbar (which itself sits
     above the keyboard, via toolbar-wrap's inline style above) rather
     than a full-screen sheet — the FlyNote reference pattern. */
  .popup {
    border-radius: var(--radius-md);
    border: 1px solid var(--hairline);
    background: var(--surface-raised);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
    padding: var(--space-3);
    width: min(300px, calc(100vw - var(--space-6)));
  }
  .format-popup {
    display: flex;
    gap: var(--space-2);
    width: auto;
  }
  .format-popup button {
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    color: var(--text-hi);
    cursor: pointer;
    font-size: 16px;
  }
  .format-popup button.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
</style>
