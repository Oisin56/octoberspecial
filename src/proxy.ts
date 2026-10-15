import { NextResponse, type NextRequest } from "next/server";

/**
 * The site moved to its own domain. Pages opened at the old address (old links, home-screen icons, emails already
 * sent) go to the same page at the new one. The API is left alone so anything still talking to the old address
 * (a film's "finished" callback, say) keeps working.
 */
const OLD_HOSTS = (process.env.OLD_HOSTS || "octoberspecial.vercel.app").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);

export function proxy(request: NextRequest) {
  const site = process.env.SITE_URL;
  if (!site) return NextResponse.next();
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0].toLowerCase();
  if (!OLD_HOSTS.includes(host)) return NextResponse.next();
  if (request.method !== "GET" && request.method !== "HEAD") return NextResponse.next();
  const to = new URL(request.nextUrl.pathname + request.nextUrl.search, site);
  return NextResponse.redirect(to, 308);
}

export const config = {
  // Pages only: not the API, the app's own files, or images
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)"],
};
