// Round B2 — the rules a NEW password must meet when creating an account in MidNote.
// (Signing in has no rules: accounts made elsewhere, e.g. on the studio portal or with
// Google, keep working whatever their password looks like.) The studio portal requires 8+;
// MidNote asks for a bit more: a capital letter and a number.
export const MIN_PASSWORD_LENGTH = 8;

export interface PasswordCheck {
  length: boolean;
  upper: boolean;
  number: boolean;
  /** All of the above. */
  ok: boolean;
}

export function checkPassword(password: string): PasswordCheck {
  const pw = String(password ?? "");
  const length = pw.length >= MIN_PASSWORD_LENGTH;
  const upper = /\p{Lu}/u.test(pw);
  const number = /[0-9]/.test(pw);
  return { length, upper, number, ok: length && upper && number };
}
