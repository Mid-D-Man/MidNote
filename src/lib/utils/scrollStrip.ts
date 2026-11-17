// A Svelte action for a row that scrolls sideways inside itself (the tags in a note / todo / board header):
//   - tells the caller whether there is more to see on the left / right (for the fade at that edge),
//   - scrolls to the end when a child is ADDED, so the new one is in view,
//   - lets a mouse drag the row (a finger already scrolls it by itself), and swallows the click a drag would otherwise end with.
export type StripHints = (canScrollLeft: boolean, canScrollRight: boolean) => void;

export function scrollStrip(node: HTMLElement, onHints: StripHints) {
  let report = onHints;
  let count = node.children.length;

  const hints = () => {
    report(node.scrollLeft > 1, node.scrollLeft < node.scrollWidth - node.clientWidth - 1);
  };

  const mutations = new MutationObserver(() => {
    // Only a tag added to a row that already had some scrolls to the end. The row filling up when the page opens
    // (count 0 -> all of them) must stay at the start, with the first tag in view.
    if (count > 0 && node.children.length > count) node.scrollLeft = node.scrollWidth;
    count = node.children.length;
    hints();
  });
  mutations.observe(node, { childList: true });
  const sizes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(hints);
  sizes?.observe(node);
  node.addEventListener("scroll", hints, { passive: true });

  let drag: { x: number; left: number; moved: boolean } | null = null;
  let swallowClick = false;
  const down = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    drag = { x: e.clientX, left: node.scrollLeft, moved: false };
  };
  const move = (e: PointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) > 4) {
      drag.moved = true;
      node.setPointerCapture?.(e.pointerId);
    }
    if (drag.moved) node.scrollLeft = drag.left - dx;
  };
  const up = () => {
    if (drag?.moved) {
      swallowClick = true;
      setTimeout(() => (swallowClick = false), 0);
    }
    drag = null;
  };
  const click = (e: MouseEvent) => {
    if (!swallowClick) return;
    e.stopPropagation();
    e.preventDefault();
    swallowClick = false;
  };
  node.addEventListener("pointerdown", down);
  node.addEventListener("pointermove", move);
  node.addEventListener("pointerup", up);
  node.addEventListener("pointercancel", up);
  node.addEventListener("click", click, true);
  hints();

  return {
    update(next: StripHints) {
      report = next;
    },
    destroy() {
      mutations.disconnect();
      sizes?.disconnect();
      node.removeEventListener("scroll", hints);
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", up);
      node.removeEventListener("click", click, true);
    },
  };
}
