import { createHash } from "node:crypto";
import { adminClient } from "@/lib/admin";
import { bad, context, crossSite, CROSS_SITE, json } from "@/lib/server-data";
import { clientIp, tooFast } from "@/lib/social";

/** A phone opened the tournament without giving a name: counted once for "and 23 others watching". */
export async function POST(req: Request) {
  if (crossSite(req)) return bad(CROSS_SITE, 403);
  const b = await req.json().catch(() => ({}));
  const { t, session } = await context(req, b);
  if (!t || session) return json({ ok: true });
  const device = String(b.device ?? "");
  if (!/^[\w-]{8,64}$/.test(device) || tooFast(`viewed:${clientIp(req)}`, 30, 3600e3)) return json({ ok: true });
  const key = createHash("sha256").update(`mgs-viewer:${device}`).digest("hex").slice(0, 32);
  await adminClient()
    .from("viewers")
    .upsert({ tournament_id: t.id, device: key, last_seen: new Date().toISOString() }, { onConflict: "tournament_id,device" })
    .then(() => null, () => null);
  return json({ ok: true });
}
