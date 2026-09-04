// Tracks how much of the layout viewport's bottom edge is currently
// covered by the on-screen keyboard (or any other UI that shrinks the
// visual viewport without shrinking the layout viewport — same
// mechanism either way). Direct request: "when the keyboard shows up on
// mobile the panel doesn't move to be visible above it."
//
// window.visualViewport is the standard, broadly-supported mechanism
// for this — distinguishes the LAYOUT viewport (stays the page's full
// height when a keyboard opens) from the VISUAL viewport (shrinks to
// just the visible region above the keyboard). The gap between them is
// exactly the keyboard's height. Supported in Chromium since 2017
// (predates every Android WebView Tauri v2 could plausibly be running
// on for this app), so this isn't expected to need a fallback path —
// flagged as worth an on-device check regardless, same honesty bar as
// everything else touching this WebView: nothing in this sandbox can
// open a real on-screen keyboard to confirm the resize event actually
// fires with the values assumed here.
let inset = $state(0);

if (typeof window !== "undefined" && window.visualViewport) {
  const vv = window.visualViewport;
  const update = () => {
    const covered = window.innerHeight - (vv.height + vv.offsetTop);
    inset = Math.max(0, Math.round(covered));
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
}

export function getKeyboardInset(): number {
  return inset;
}
