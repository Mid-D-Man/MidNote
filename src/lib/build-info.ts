// Build identity — injected at build time via Vite env vars set by
// build-android.yml, so the app itself can answer "what code is this,
// actually" without needing to cross-reference GitHub Actions runs by
// hand. Falls back to "dev" values when built locally (vite dev / a
// build not run through the CI workflow), so this never breaks local
// development.
export const BUILD_SHA: string = import.meta.env.VITE_BUILD_SHA || "dev";
export const BUILD_TIME: string = import.meta.env.VITE_BUILD_TIME || "unbuilt";
