import { after } from "next/server";
import { adminClient } from "@/lib/admin";
import { filmKey, finishFilm, type FilmReel } from "@/lib/filmJob";
import { bad, json, siteOrigin } from "@/lib/server-data";

export const maxDuration = 120;

/** The video service calls this when a film is ready (or has failed); its status is checked with the service itself. */
export async function POST(req: Request) {
  const u = new URL(req.url);
  const reelId = u.searchParams.get("reel") ?? "";
  if (!/^[\w-]{8,64}$/.test(reelId) || u.searchParams.get("k") !== filmKey(reelId)) return bad("Not allowed", 403);
  const origin = siteOrigin(req);
  after(async () => {
    const { data } = await adminClient().from("reels").select("*").eq("id", reelId).maybeSingle();
    if (data) await finishFilm(data as FilmReel, origin).catch((e) => console.error("[film] finishing failed:", e));
  });
  return json({ ok: true });
}
