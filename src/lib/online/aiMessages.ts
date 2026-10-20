// Round D2 — plain-language text for AI failures. Nothing here reveals more than the proxy already told
// the person; it never includes the prompt, the answer or a token.
import type { AiError } from "./aiClient";

/** "about 3 hours", "about 25 minutes", "less than a minute" */
export function formatWait(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 60) return "less than a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(seconds / 3600);
  return `about ${hours} hour${hours === 1 ? "" : "s"}`;
}

/** Seconds from `nowMs` to the next 00:00 UTC (the AI's daily numbers reset then). */
export function secondsUntilUtcMidnight(nowMs: number): number {
  const d = new Date(nowMs);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - nowMs) / 1000));
}

export function friendlyAiMessage(e: AiError, nowMs: number = Date.now()): string {
  switch (e.kind) {
    case "not-configured":
      return "AI isn't set up in this build.";
    case "signed-out":
      return "Sign in to use AI.";
    case "network":
      return "Can't reach the AI server. Check your connection and try again.";
    case "timeout":
      return "The AI took too long. You weren't charged.";
    case "no-credits":
      return "You're out of AI credits.";
    case "daily-cap":
      return `You've used today's AI allowance. It resets in ${formatWait(e.retryAfter ?? secondsUntilUtcMidnight(nowMs))}.`;
    case "busy":
      return "Another AI request is still running. Wait for it to finish.";
    case "rate-limited":
      return "That was a lot of requests. Try again in a minute.";
    case "pool-exhausted":
      return `AI is resting: today's free capacity is used up. It's back in ${formatWait(e.retryAfter ?? secondsUntilUtcMidnight(nowMs))}.`;
    case "too-long":
      return "That's too long for AI. Try a shorter text.";
    case "disabled":
    case "ai-unavailable":
      return "AI is switched off or unavailable right now.";
    case "ai-failed":
      return "The AI didn't answer. You weren't charged.";
    case "empty-response":
      return "The AI returned nothing.";
    case "bad-request":
      return "That request wasn't understood.";
    case "server":
      return "Something went wrong on the AI server.";
  }
}
