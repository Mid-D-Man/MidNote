// The one-time notice before AI is first used: what is sent to the AI server (which doesn't keep it) and who may answer it (Cloudflare, or a named backup provider).
// ONE acknowledgement covers every AI screen that sends note text (the selection sheet, the note chat), so a person
// is asked once, not once per screen. Reading/writing localStorage can throw (private mode): then it just asks again.
const KEY = "midnote:ai-notice";

export function aiNoticeSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function markAiNoticeSeen(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* it shows again next time */
  }
}
