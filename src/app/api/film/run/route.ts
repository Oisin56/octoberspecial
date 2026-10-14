import { after } from "next/server";
import { filmKey, kick, runStage } from "@/lib/filmJob";
import { bad, json, siteOrigin } from "@/lib/server-data";

export const maxDuration = 300;

/** One step of making a film (started by the previous step, or by a status check). Answers at once; works on. */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const reelId = String(b.reelId ?? "");
  if (!/^[\w-]{8,64}$/.test(reelId) || b.k !== filmKey(reelId)) return bad("Not allowed", 403);
  const origin = siteOrigin(req);
  after(async () => {
    try {
      if (await runStage(reelId, origin)) await kick(origin, reelId);
    } catch (e) {
      console.error("[film] step failed:", e);
    }
  });
  return json({ ok: true }, 202);
}
