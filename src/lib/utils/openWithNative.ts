// Round K — the two native things "Open with MidNote" needs, behind one small interface so the jsdom smoke test can
// stand in for them (same idea as online/deepLink.ts).
//
//   getCurrent()   the link that OPENED the app, if it was opened by a file.
//   onUrl(cb)      links that arrive while the app is running.
//                  Both come from tauri-plugin-deep-link 2.6.1 (source read): its Kotlin plugin hands over any VIEW
//                  intent whose address matches a scheme in tauri.conf.json's plugins.deep-link.mobile. We list the
//                  scheme "content" there, so a file opened from Files / Downloads / Drive arrives as content://...
//                  (the plugin only matches the SCHEME, not the file type; the intent-filter that makes Android offer
//                  MidNote for any file type is added to the manifest by the build workflow).
//   read(url, max) the file's bytes, at most max + 1 of them (so the caller can tell "too big").
//                  tauri-plugin-fs 2.7.1 (source read): open() accepts content:// addresses on Android (the Kotlin
//                  side resolves them with ContentResolver.openAssetFileDescriptor) and, for such an address, does NOT
//                  consult the path scope; the permissions are fs:allow-open and fs:allow-read
//                  (capabilities/android-open-with.json). A plain file PATH still needs a scope, and none is granted,
//                  so the app cannot read ordinary paths through this.
//
// Plain invoke()/listen() and the already-installed @tauri-apps/plugin-fs: no new npm package.
import { isTauri } from "@tauri-apps/api/core";
import { realDeepLinkBackend } from "$lib/online/deepLink";
import { isContentUrl } from "$lib/utils/openWith";

export interface OpenWithBackend {
  getCurrent(): Promise<string[]>;
  onUrl(cb: (url: string) => void): Promise<() => void>;
  read(url: string, maxBytes: number): Promise<Uint8Array>;
}

declare global {
  // Test seam only (the jsdom smoke test has no Android).
  // eslint-disable-next-line no-var
  var __midnoteOpenWith: OpenWithBackend | undefined;
}

async function readContentUrl(url: string, maxBytes: number): Promise<Uint8Array> {
  // belt and braces: only ever content:// (never a file path or file:// address) goes to the file reader
  if (!isContentUrl(url)) throw new Error("not a content address");
  const { open } = await import("@tauri-apps/plugin-fs");
  const handle = await open(url, { read: true });
  try {
    const buf = new Uint8Array(maxBytes + 1);
    let off = 0;
    while (off < buf.length) {
      const n = await handle.read(buf.subarray(off));
      if (n === null || n === 0) break; // end of file
      off += n;
    }
    return buf.slice(0, off);
  } finally {
    await handle.close().catch(() => {});
  }
}

export function realOpenWithBackend(): OpenWithBackend | null {
  if (globalThis.__midnoteOpenWith) return globalThis.__midnoteOpenWith;
  if (!isTauri()) return null;
  const links = realDeepLinkBackend();
  if (!links) return null;
  return { getCurrent: links.getCurrent, onUrl: links.onUrl, read: readContentUrl };
}
