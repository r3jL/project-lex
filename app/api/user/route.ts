import { NextRequest, NextResponse } from "next/server";
import { GUEST_COOKIE, USER_COOKIE, sanitizeUsername } from "@/lib/auth/user";

export const runtime = "nodejs";

const THIRTY_DAYS = 60 * 60 * 24 * 30;
// Readable by the client (a handle is not a secret).
const opts = { httpOnly: false, sameSite: "lax" as const, path: "/", maxAge: THIRTY_DAYS };

// Who am I? Drives the in-app identity gate and the sidebar footer.
//   chosen=false → the user hasn't picked username-or-guest yet (show the gate).
export function GET(req: NextRequest) {
  const username = sanitizeUsername(req.cookies.get(USER_COOKIE)?.value) || null;
  const guest = req.cookies.get(GUEST_COOKIE)?.value === "1";
  return NextResponse.json({ username, chosen: !!username || guest });
}

// Choose a handle, or continue as a guest.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  if (body?.guest === true) {
    const res = NextResponse.json({ ok: true, username: null });
    res.cookies.set(GUEST_COOKIE, "1", opts);
    res.cookies.set(USER_COOKIE, "", { ...opts, maxAge: 0 });
    return res;
  }

  const username = sanitizeUsername(body?.username);
  if (!username) {
    return NextResponse.json(
      { error: "Enter a username (letters, numbers, . _ - )." },
      { status: 400 },
    );
  }
  const res = NextResponse.json({ ok: true, username });
  res.cookies.set(USER_COOKIE, username, opts);
  res.cookies.set(GUEST_COOKIE, "", { ...opts, maxAge: 0 });
  return res;
}

// Switch identity — clear both cookies so the gate shows again.
export function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(USER_COOKIE, "", { ...opts, maxAge: 0 });
  res.cookies.set(GUEST_COOKIE, "", { ...opts, maxAge: 0 });
  return res;
}
