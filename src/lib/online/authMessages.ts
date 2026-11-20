// Round B — what the person SEES when an auth call fails. Plain words, no server jargon,
// and nothing that confirms whether an email has an account (the sign-up and
// forgot-password screens stay neutral on purpose).
import { AuthError, MIN_PASSWORD_LENGTH } from "./authClient";
import type { ConfigProblem } from "./config";

export function friendlyAuthMessage(err: unknown): string {
  if (!(err instanceof AuthError)) return "Something went wrong. Try again.";
  switch (err.kind) {
    case "not-configured":
      return "Online features aren't set up in this build.";
    case "signed-out":
      return "You're signed out. Sign in again.";
    case "network":
      return "Can't reach the server. Check your connection and try again.";
    case "invalid-credentials":
      return "That email and password don't match.";
    case "email-not-confirmed":
      return "Confirm your email first. We sent you a link when you signed up.";
    case "weak-password":
      return `That password is too weak. Use at least ${MIN_PASSWORD_LENGTH} characters, with a capital letter and a number.`;
    case "same-password":
      return "That's already your password. Choose a different one.";
    case "reauth-needed":
      return "For safety, sign out and sign in again, then try once more.";
    case "oauth-cancelled":
      return "Google sign-in was cancelled.";
    case "oauth-failed":
      return "Google sign-in didn't finish. Try again.";
    case "invalid-email":
      return "That email address doesn't look right.";
    case "invalid-name":
      return "Add your name.";
    case "user-exists":
      return "That email already has an account. Try signing in instead.";
    case "signups-disabled":
      return "New accounts are turned off right now.";
    case "rate-limited":
      return "Too many tries, or too many emails sent. Wait a few minutes and try again.";
    case "server":
      return "The server had a problem. Try again in a moment.";
    default:
      return "Couldn't complete that. Try again.";
  }
}

// One short line for every problem: the specific reason is written to the debug log (stores/account.svelte.ts), not shown here.
export function configProblemMessage(_problem: ConfigProblem): string {
  return "This build isn't set up for online features.";
}
