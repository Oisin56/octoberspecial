import { adminClient } from "@/lib/admin";
import { readTap } from "@/lib/mail/tokens";
import { siteOrigin } from "@/lib/server-data";

export const dynamic = "force-dynamic";

/** A tap on a button in a series or campaign email: counted once, then on to where it goes. Signed, so it can't be
 *  used to send people anywhere else. */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const s = p.get("s");
  const u = p.get("u");
  if (!readTap(s, u, p.get("k")) || !/^https?:\/\//i.test(u ?? "")) return Response.redirect(siteOrigin(req), 302);
  await adminClient().from("email_sends").update({ clicked_at: new Date().toISOString() }).eq("id", s!).is("clicked_at", null).then(
    () => null,
    () => null,
  );
  return Response.redirect(u!, 302);
}
