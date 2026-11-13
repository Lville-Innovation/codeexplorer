import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, accessToken, safeEqual } from "@/lib/gate";

/** Everything except the unlock page needs the shared password, including the API routes. */
export async function proxy(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  const isApi = req.nextUrl.pathname.startsWith("/api/");
  if (!password) {
    // Fail closed: a missing password must not leave the site open.
    return isApi
      ? NextResponse.json({ error: "The site password is not configured." }, { status: 503 })
      : new NextResponse("The site password is not configured.", { status: 503 });
  }

  const cookie = req.cookies.get(GATE_COOKIE)?.value ?? "";
  if (cookie && safeEqual(cookie, await accessToken(password))) return NextResponse.next();

  if (isApi) return NextResponse.json({ error: "Please enter the site password first." }, { status: 401 });
  const url = req.nextUrl.clone();
  const next = req.nextUrl.pathname + req.nextUrl.search;
  url.pathname = "/unlock";
  url.search = next && next !== "/" ? `?next=${encodeURIComponent(next)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!unlock|api/unlock|_next/static|_next/image|favicon.ico|avatar.png).*)"],
};
