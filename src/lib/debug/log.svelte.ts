// In-app error/log capture — built specifically so bugs are diagnosable
// on-device with no computer, no USB debugging, no console. Installed
// once from +layout.svelte, catches everything global (uncaught errors,
// unhandled promise rejections, console.error/warn calls anywhere in the
// app) into a capped, reactive, on-device log the DebugPanel renders.
export interface LogEntry {
  id: number;
  time: string;
  level: "log" | "warn" | "error";
  message: string;
}

const MAX_ENTRIES = 300;
let nextId = 0;

export const logs = $state<LogEntry[]>([]);
export const hasUnread = $state({ value: false });

export function addLog(level: LogEntry["level"], ...args: unknown[]) {
  const message = args
    .map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ""}`;
      if (typeof a === "object") {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(" ");

  logs.push({ id: nextId++, time: new Date().toLocaleTimeString(), level, message });
  if (logs.length > MAX_ENTRIES) logs.splice(0, logs.length - MAX_ENTRIES);
  if (level !== "log") hasUnread.value = true;
}

export function clearLogs() {
  logs.splice(0, logs.length);
  hasUnread.value = false;
}

let installed = false;

export function installGlobalCapture() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);
  console.error = (...args: unknown[]) => {
    addLog("error", ...args);
    origError(...args);
  };
  console.warn = (...args: unknown[]) => {
    addLog("warn", ...args);
    origWarn(...args);
  };

  window.addEventListener("error", (e) => {
    addLog("error", `Uncaught: ${e.message}`, `at ${e.filename}:${e.lineno}:${e.colno}`, e.error);
  });

  window.addEventListener("unhandledrejection", (e) => {
    addLog("error", "Unhandled promise rejection:", e.reason);
  });

  addLog("log", "Debug capture installed");
}

export function breadcrumb(message: string) {
  addLog("log", message);
}
