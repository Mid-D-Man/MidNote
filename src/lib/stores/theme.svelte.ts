// Dark/light toggle — sets data-theme on <html>, matched by tokens.css.
// Dark is the default (tokens.css :root), so this only needs to act when
// switching to light.
export const theme = $state<{ mode: "dark" | "light" }>({ mode: "dark" });

export function setTheme(mode: "dark" | "light") {
  theme.mode = mode;
  if (typeof document !== "undefined") {
    if (mode === "light") document.documentElement.setAttribute("data-theme", "light");
    else document.documentElement.removeAttribute("data-theme");
  }
}
