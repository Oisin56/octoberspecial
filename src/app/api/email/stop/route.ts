import { readKey } from "@/lib/mail/tokens";
import { stopScope } from "@/lib/mail/prefs";
import { siteOrigin } from "@/lib/server-data";

export const dynamic = "force-dynamic";

/**
 * The mail apps' one-tap unsubscribe (Gmail's and Apple Mail's button posts here, as the List-Unsubscribe-Post header
 * says): what the link stops is stopped at once. Opened in a browser instead, it shows the preferences page, which asks
 * first (link checkers open links in emails, and mustn't unsubscribe anyone by doing so).
 */
export async function POST(req: Request) {
  const k = readKey(new URL(req.url).searchParams.get("k"));
  if (k && k.scope !== "p") await stopScope(k.email, k.scope, k.send);
  return new Response(null, { status: k ? 200 : 400 });
}

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("k") ?? "";
  return Response.redirect(`${siteOrigin(req)}/email?k=${encodeURIComponent(key)}`, 303);
}
