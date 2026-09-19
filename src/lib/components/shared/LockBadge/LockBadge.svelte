<!--
  Lock indicator for a locked entry's list card.

  Deliberately NOT part of the IconRef/custom-icon system (entry.ts's
  IconRef, themePalette.ts's resolveIcon): that slot is the user's own
  choice, one per entry, and a board/note/todo can have a custom icon
  AND be locked at the same time. Overloading the icon slot to also mean
  "locked" would either hide the user's chosen icon whenever they locked
  something, or leave locked entries with no lock indicator at all
  whenever they'd picked an icon — which is exactly the gap this fills.
  So it renders as its own separate badge next to the icon slot, and is
  a fixed inline SVG rather than anything user-selectable.
-->
<script lang="ts">
  let { size = 14 }: { size?: number } = $props();
</script>

<span class="lock-badge" aria-label="Locked" title="Locked">
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" stroke-width="2.2">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
</span>

<style>
  .lock-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    /* Falls back to the plain token when no image theme is active —
       same var(--theme-*, var(--*)) pattern the rest of the card's text
       uses, so the badge stays legible over a photo theme too. */
    color: var(--theme-text-mid, var(--text-lo));
  }
</style>
