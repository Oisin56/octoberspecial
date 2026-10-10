import { tournamentBySlug } from "@/lib/server-data";
import { paletteFor } from "@/lib/themes";
import { BRAND } from "@/lib/brand";

/** Home-screen app for one tournament: opens full screen, straight into the live round. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = await tournamentBySlug(slug);
  if (!t) return new Response("Not found", { status: 404 });
  const p = paletteFor(t.theme, t.custom_colors);
  const icon = (s: number, purpose?: string) => ({ src: `/api/app-icon?s=${s}${purpose ? "&m=1" : ""}`, sizes: `${s}x${s}`, type: "image/png", ...(purpose ? { purpose } : {}) });
  const manifest = {
    name: t.name,
    short_name: t.name.length > 14 ? BRAND.short : t.name,
    description: `${t.name}: scores, clips and highlights`,
    id: `/t/${slug}/`,
    start_url: `/t/${slug}/go`,
    scope: `/t/${slug}/`,
    display: "standalone",
    orientation: "portrait",
    background_color: p.board,
    theme_color: p.board,
    icons: [icon(192), icon(512), icon(512, "maskable")],
  };
  return new Response(JSON.stringify(manifest), { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" } });
}
