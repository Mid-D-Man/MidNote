// The user's order for the Actions sheet rows (note, todo, board), kept on this phone. The rules (default order, repairing a
// saved order, moving a row) are in utils/actionOrder.ts. Nothing is saved while the order is the default.
import { DEFAULT_ACTION_ORDER, isDefaultOrder, moveAction, normalizeOrder, type ActionId } from "$lib/utils/actionOrder";

const KEY = "midnote:action-order";

function read(): ActionId[] {
  if (typeof localStorage === "undefined") return [...DEFAULT_ACTION_ORDER];
  try {
    const raw = localStorage.getItem(KEY);
    return normalizeOrder(raw === null ? null : JSON.parse(raw));
  } catch {
    return [...DEFAULT_ACTION_ORDER]; // unreadable: the default
  }
}

export const actionOrder = $state<{ value: ActionId[] }>({ value: read() });

function save(next: ActionId[]): void {
  actionOrder.value = next;
  if (typeof localStorage === "undefined") return;
  try {
    if (isDefaultOrder(next)) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: the order lasts until the page closes */
  }
}

/** Move one row up or down a place. */
export function moveActionRow(id: ActionId, delta: -1 | 1): void {
  save(moveAction(actionOrder.value, id, delta));
}

/** Back to the default order. */
export function resetActionOrder(): void {
  save([...DEFAULT_ACTION_ORDER]);
}
