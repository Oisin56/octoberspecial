import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { paletteFor } from "@/lib/themes";
import { signCard, type CardSpec } from "@/lib/cards";

/**
 * Renders the reel's title cards, chapter cards, score graphics and captions as
 * PNGs in the tournament's theme. Shotstack fetches these by URL. Every number on
 * these cards comes from the scoring engine (via the plan), never from the AI.
 *
 * Query: d = base64url JSON {k, h, s, l, theme, colors, w, ht}, sig = HMAC.
 */

const fontDir = join(process.cwd(), "src/assets/fonts");
const fonts = Promise.all([
  readFile(join(fontDir, "barlow-condensed-latin-600-normal.woff")),
  readFile(join(fontDir, "barlow-condensed-latin-700-normal.woff")),
  readFile(join(fontDir, "newsreader-latin-400-normal.woff")),
  readFile(join(fontDir, "newsreader-latin-400-italic.woff")),
]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const d = url.searchParams.get("d") ?? "";
  if (url.searchParams.get("sig") !== signCard(d)) return new Response("Bad signature", { status: 403 });
  let spec: CardSpec;
  try {
    spec = JSON.parse(Buffer.from(d, "base64url").toString());
  } catch {
    return new Response("Bad card", { status: 400 });
  }
  const p = paletteFor(spec.theme, spec.colors);
  const [b600, b700, nr, ni] = await fonts;
  const W = spec.w;
  const H = spec.ht;
  const portrait = H > W;
  const u = Math.min(W, H) / 1080; // scale unit

  let body: React.ReactElement;
  if (spec.k === "caption") {
    // Transparent lower third: sits over a clip
    body = (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: `${60 * u}px ${70 * u}px ${portrait ? 260 * u : 70 * u}px` }}>
        <div style={{ display: "flex", flexDirection: "column", alignSelf: "flex-start", maxWidth: W * 0.85 }}>
          <div style={{ display: "flex", background: p.board, color: p.tile, fontFamily: "Barlow", fontWeight: 700, fontSize: 64 * u, padding: `${10 * u}px ${28 * u}px ${12 * u}px`, borderLeft: `${14 * u}px solid ${p.red}` }}>
            {spec.h}
          </div>
          {spec.s && (
            <div style={{ display: "flex", background: p.tile, color: p.ink, fontFamily: "Barlow", fontWeight: 600, fontSize: 40 * u, padding: `${6 * u}px ${28 * u}px ${8 * u}px`, alignSelf: "flex-start" }}>
              {spec.s}
            </div>
          )}
        </div>
      </div>
    );
  } else {
    const rows = spec.l ?? [];
    body = (
      <div
        style={{
          width: W,
          height: H,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: p.board,
          color: p.tile,
          padding: `${90 * u}px ${110 * u}px`,
          border: `${18 * u}px solid ${p.boardDeep}`,
        }}
      >
        {spec.e && (
          <div style={{ display: "flex", fontFamily: "Barlow", fontWeight: 600, fontSize: 40 * u, color: "#c9d6cd", marginBottom: 18 * u }}>{spec.e}</div>
        )}
        <div style={{ display: "flex", fontFamily: "Barlow", fontWeight: 700, fontSize: (spec.k === "title" ? 150 : spec.k === "chapter" ? 120 : 92) * u, lineHeight: 1.0 }}>
          {spec.h}
        </div>
        {spec.s && (
          <div style={{ display: "flex", fontFamily: "Newsreader", fontStyle: "italic", fontSize: 48 * u, marginTop: 24 * u, color: "#e7ece9" }}>{spec.s}</div>
        )}
        {rows.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 50 * u, gap: 16 * u, width: portrait ? "100%" : W * 0.6 }}>
            {rows.slice(0, 8).map(([label, value], i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 30 * u }}>
                <div style={{ display: "flex", fontFamily: "Barlow", fontWeight: 700, fontSize: 64 * u }}>
                  {i === 0 && spec.k === "standings" && <div style={{ width: 22 * u, height: 22 * u, borderRadius: 99, background: p.red, marginRight: 18 * u, marginTop: 8 * u }} />}
                  {label}
                </div>
                <div style={{ display: "flex", gap: 8 * u }}>
                  {value.split("").map((ch, j) => (
                    <div
                      key={j}
                      style={{
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        minWidth: 64 * u,
                        height: 92 * u,
                        background: p.tile,
                        color: i === 0 && spec.k === "standings" ? p.red : p.ink,
                        fontFamily: "Barlow",
                        fontWeight: 700,
                        fontSize: 76 * u,
                        borderRadius: 6 * u,
                        padding: `0 ${8 * u}px`,
                      }}
                    >
                      {ch}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return new ImageResponse(body, {
    width: W,
    height: H,
    fonts: [
      { name: "Barlow", data: b600, weight: 600, style: "normal" },
      { name: "Barlow", data: b700, weight: 700, style: "normal" },
      { name: "Newsreader", data: nr, weight: 400, style: "normal" },
      { name: "Newsreader", data: ni, weight: 400, style: "italic" },
    ],
    headers: { "cache-control": "public, max-age=86400, immutable" },
  });
}
