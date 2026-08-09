// Dark/light theme toggle — sets data-theme on <html>, matched by tokens.css.
// Dark is the default (see tokens.css :root); this store only needs to act
// when the user explicitly switches to light.
import { writable } from "svelte/store";

export const theme = writable<"dark" | "light">("dark");
