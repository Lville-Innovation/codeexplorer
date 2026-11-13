import { NextResponse } from "next/server";
import { GATE_COOKIE, accessToken, safeEqual } from "@/lib/gate";
import { allow, clientIp } from "@/lib/ratelimit";

export async function POST(req: Request) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.json({ error: "The site password is not configured." }, { status: 503 });
  if (!allow("unlock", clientIp(req), 10, 10 * 60_000)) {
    return NextResponse.json({ error: "Too many tries. Wait a few minutes and try again." }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as { password?: unknown };
  const given = typeof body.password === "string" ? body.password.trim() : "";
  if (!given || !safeEqual(await accessToken(given), await accessToken(password))) {
    return NextResponse.json({ error: "That's not the right password. Check with your teacher." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(GATE_COOKIE, await accessToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
