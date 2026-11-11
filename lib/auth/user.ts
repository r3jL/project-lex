import type { NextRequest } from "next/server";

// Lightweight identity. This is NOT authentication — the app is open (portfolio
// demo). A username is just a claimable handle so
// a person's sessions, review-queue answers, and notifications can be tied to
// them across logins. Guests use the app with no handle and get no history.
//
// Cookies (both readable by the client — a username is not a secret):
//   lex_user   the chosen handle
//   lex_guest  "1" once the user explicitly chose to continue without a handle
export const USER_COOKIE = "lex_user";
export const GUEST_COOKIE = "lex_guest";

// Normalise to a safe, comparable handle: lowercased, trimmed, only
// [a-z0-9._-], collapsed, capped at 32 chars. Returns "" if nothing usable.
export function sanitizeUsername(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 32);
}

// The current username from the request cookies, or null for guests/unset.
export function usernameFrom(req: NextRequest): string | null {
  const raw = req.cookies.get(USER_COOKIE)?.value;
  const clean = sanitizeUsername(raw);
  return clean || null;
}
