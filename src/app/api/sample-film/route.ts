import { mediaUrl } from "@/lib/supabase";
import { musicTracks, sampleFilm } from "@/lib/site";

/**
 * The front page's sample round: its commentary (recorded once by the site owner) and the music under it (the
 * first of the site's film tracks). Either can be missing: the sample plays with what there is.
 */
export async function GET() {
  const [sample, tracks] = await Promise.all([sampleFilm().catch(() => null), musicTracks().catch(() => [])]);
  const body = {
    lines: (sample?.lines ?? []).map((l) => ({ src: mediaUrl(l.path), sec: l.sec })),
    music: tracks[0] ? mediaUrl(tracks[0].path) : null,
  };
  return Response.json(body, { headers: { "cache-control": "public, max-age=30, s-maxage=60" } });
}
