import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { paletteFor } from "@/lib/themes";
import { signCard, type CardSpec } from "@/lib/cards";

/**
 * Renders the film's on-screen graphics as PNGs, styled like a TV golf broadcast:
 * dark glass panels (the film puts blurred footage behind full-screen cards), gradient
 * accents, a condensed headline face with a clean sans. Shotstack fetches these by URL.
 * Every number here comes from the scoring engine (via the plan), never from the AI.
 *
 * Query: d = base64url JSON {k, h, s, l, theme, colors, w, ht}, sig = HMAC.
 */

const fontDir = join(process.cwd(), "src/assets/fonts");
const fonts = Promise.all([
  readFile(join(fontDir, "barlow-condensed-latin-600-normal.woff")),
  readFile(join(fontDir, "barlow-condensed-latin-700-normal.woff")),
  readFile(join(fontDir, "inter-latin-500-normal.woff")),
  readFile(join(fontDir, "inter-latin-600-normal.woff")),
  readFile(join(fontDir, "inter-latin-800-normal.woff")),
]);

/** #rrggbb → rgba(r,g,b,a) */
function rgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
/** Mix a hex colour towards another (0..1) */
function mix(a: string, b: string, t: number) {
  const p = (h: string) => parseInt(h.replace("#", "").slice(0, 6), 16);
  const x = p(a),
    y = p(b);
  const c = (s: number) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t);
  return `#${[c(16), c(8), c(0)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

type P = ReturnType<typeof paletteFor> & { gold: string; glass: string };

const D = { fontFamily: "Barlow", fontWeight: 700 } as const; // headline face
const S = { fontFamily: "Inter", fontWeight: 500 } as const; // body face

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
  const base = paletteFor(spec.theme, spec.colors);
  const p: P = { ...base, gold: mix(base.bracken, "#ffd76a", 0.45), glass: "#0a100d" };
  const [b600, b700, i500, i600, i800] = await fonts;
  const W = spec.w;
  const H = spec.ht;
  const portrait = H > W;
  const u = Math.min(W, H) / 1080; // scale unit

  let body: React.ReactElement;
  if (spec.k === "bug" && spec.b) body = <Bug spec={spec} p={p} W={W} H={H} u={u} portrait={portrait} />;
  else if (spec.k === "caption") body = <Caption spec={spec} p={p} W={W} H={H} u={u} portrait={portrait} />;
  else body = <FullCard spec={spec} p={p} W={W} H={H} u={u} portrait={portrait} />;

  return new ImageResponse(body, {
    width: W,
    height: H,
    fonts: [
      { name: "Barlow", data: b600, weight: 600, style: "normal" },
      { name: "Barlow", data: b700, weight: 700, style: "normal" },
      { name: "Inter", data: i500, weight: 500, style: "normal" },
      { name: "Inter", data: i600, weight: 600, style: "normal" },
      { name: "Inter", data: i800, weight: 800, style: "normal" },
    ],
    headers: { "cache-control": "public, max-age=86400, immutable" },
  });
}

type CardProps = { spec: CardSpec; p: P; W: number; H: number; u: number; portrait: boolean };

/** Title, chapter, result and standings: centred on a glass wash over blurred footage. */
function FullCard({ spec, p, W, H, u, portrait }: CardProps) {
  const rows = spec.l ?? [];
  const k = spec.k;
  const headSize = (k === "title" ? (portrait ? 150 : 172) : k === "chapter" ? (portrait ? 150 : 160) : portrait ? 96 : 104) * u;
  const panelW = portrait ? W * 0.86 : Math.min(W * 0.58, 1100 * u);
  return (
    <div
      style={{
        width: W,
        height: H,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        color: "#ffffff",
        // Over blurred footage: a glass wash. With nothing behind (bg): the tournament's colours, deepening to the edges
        backgroundImage: spec.bg
          ? `radial-gradient(ellipse at 50% 38%, ${mix(p.board, "#ffffff", 0.1)} 0%, ${p.board} 45%, ${mix(p.board, "#000000", 0.7)} 100%)`
          : `radial-gradient(ellipse at 50% 42%, ${rgba(p.glass, 0.28)} 0%, ${rgba(p.glass, 0.5)} 55%, ${rgba(p.glass, 0.78)} 100%)`,
        padding: `${80 * u}px ${portrait ? 70 * u : 120 * u}px`,
      }}
    >
      {spec.e && (
        <div
          style={{
            display: "flex",
            ...S,
            fontWeight: 600,
            fontSize: 34 * u,
            letterSpacing: 1.5 * u,
            color: p.gold,
            padding: `${10 * u}px ${28 * u}px`,
            borderRadius: 999,
            background: "rgba(10,16,13,0.45)",
            border: `${1.5 * u}px solid rgba(255,255,255,0.25)`,
            marginBottom: 34 * u,
            textAlign: "center",
          }}
        >
          {spec.e}
        </div>
      )}
      <div style={{ display: "flex", ...D, fontSize: headSize, lineHeight: 0.98, textAlign: "center", justifyContent: "center", textShadow: `0 ${6 * u}px ${30 * u}px rgba(0,0,0,0.45)`, maxWidth: W * 0.9 }}>
        {spec.h}
      </div>
      <div style={{ display: "flex", width: 170 * u, height: 8 * u, borderRadius: 8 * u, marginTop: 30 * u, backgroundImage: `linear-gradient(90deg, ${p.red}, ${p.gold})` }} />
      {spec.s && (
        <div style={{ display: "flex", ...S, fontSize: 44 * u, lineHeight: 1.3, marginTop: 28 * u, color: "rgba(255,255,255,0.86)", textAlign: "center", justifyContent: "center", maxWidth: W * 0.8 }}>
          {spec.s}
        </div>
      )}
      {rows.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: panelW,
            marginTop: 50 * u,
            borderRadius: 30 * u,
            overflow: "hidden",
            background: "rgba(10,16,13,0.55)",
            border: `${1.5 * u}px solid rgba(255,255,255,0.18)`,
            boxShadow: `0 ${24 * u}px ${60 * u}px rgba(0,0,0,0.35)`,
          }}
        >
          {rows.slice(0, 8).map(([label, value], i) => {
            const lead = i === 0;
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: `${20 * u}px ${30 * u}px`,
                  ...(i ? { borderTop: `${1.5 * u}px solid rgba(255,255,255,0.1)` } : {}),
                  ...(lead ? { backgroundImage: `linear-gradient(90deg, ${rgba(p.red, 0.9)}, ${rgba(p.red, 0.3)})` } : {}),
                }}
              >
                <div style={{ display: "flex", ...D, fontSize: 62 * u, lineHeight: 1 }}>{label}</div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    minWidth: 150 * u,
                    ...D,
                    fontSize: 64 * u,
                    lineHeight: 1,
                    padding: `${12 * u}px ${22 * u}px`,
                    borderRadius: 16 * u,
                    background: lead ? "#ffffff" : "rgba(255,255,255,0.14)",
                    color: lead ? p.red : "#ffffff",
                  }}
                >
                  {value}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Lower third over a clip: name and shot, on glass with an accent stripe. */
function Caption({ spec, p, W, H, u, portrait }: CardProps) {
  return (
    <div
      style={{
        width: W,
        height: H,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        alignItems: portrait ? "center" : "flex-start",
        // portrait: above where phone apps put their own buttons and text
        padding: portrait ? `0 ${60 * u}px ${420 * u}px` : `0 ${80 * u}px ${80 * u}px`,
      }}
    >
      <div style={{ display: "flex", maxWidth: portrait ? W * 0.9 : W * 0.62, borderRadius: 20 * u, overflow: "hidden", boxShadow: `0 ${14 * u}px ${40 * u}px rgba(0,0,0,0.4)` }}>
        <div style={{ display: "flex", width: 12 * u, backgroundImage: `linear-gradient(180deg, ${p.gold}, ${p.red})` }} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            padding: `${18 * u}px ${32 * u}px ${20 * u}px`,
            backgroundImage: `linear-gradient(90deg, ${rgba(p.glass, 0.9)}, ${rgba(p.glass, 0.68)})`,
          }}
        >
          <div style={{ display: "flex", ...D, fontSize: 64 * u, lineHeight: 1.02, color: "#ffffff" }}>{spec.h}</div>
          {spec.s && <div style={{ display: "flex", ...S, fontSize: 34 * u, marginTop: 6 * u, color: "rgba(255,255,255,0.84)" }}>{spec.s}</div>}
        </div>
      </div>
    </div>
  );
}

/** TV-style score panel: top-left (landscape) or top-centre (portrait), transparent elsewhere. */
function Bug({ spec, p, W, H, u, portrait }: CardProps) {
  const b = spec.b!;
  const PW = (portrait ? 660 : 580) * u;
  return (
    <div style={{ width: W, height: H, display: "flex", flexDirection: "column", alignItems: portrait ? "center" : "flex-start", padding: portrait ? `${170 * u}px 0 0` : `${50 * u}px ${56 * u}px` }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: PW,
          borderRadius: 22 * u,
          overflow: "hidden",
          background: rgba(p.glass, 0.82),
          border: `${1.5 * u}px solid rgba(255,255,255,0.14)`,
          boxShadow: `0 ${16 * u}px ${44 * u}px rgba(0,0,0,0.4)`,
          color: "#ffffff",
        }}
      >
        {spec.wt && (
          <div style={{ display: "flex", ...S, fontWeight: 600, fontSize: 24 * u, color: p.gold, padding: `${10 * u}px ${22 * u}px 0` }}>{`Round ${b.round} · ${b.course}`}</div>
        )}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: `${10 * u}px ${22 * u}px ${12 * u}px`, ...(spec.wt ? {} : { backgroundImage: `linear-gradient(90deg, ${rgba(p.board, 0.9)}, ${rgba(p.board, 0.4)})` }) }}>
          <div style={{ display: "flex", ...D, fontSize: 54 * u, lineHeight: 1 }}>{`Hole ${b.hole}`}</div>
          <div style={{ display: "flex", ...S, fontWeight: 600, fontSize: 26 * u, color: "rgba(255,255,255,0.8)" }}>{`Par ${b.par}${b.yards ? ` · ${b.yards} yds` : ""}`}</div>
        </div>
        {b.rows.map((r, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", padding: `${8 * u}px ${14 * u}px ${8 * u}px ${22 * u}px`, borderTop: `${1.5 * u}px solid rgba(255,255,255,0.08)` }}>
            <div style={{ display: "flex", flex: 1, alignItems: "center", ...D, fontSize: 42 * u }}>
              {r.name}
              {Array.from({ length: Math.min(r.dots, 3) }, (_, k) => (
                <div key={k} style={{ display: "flex", width: 12 * u, height: 12 * u, borderRadius: 99, background: p.gold, marginLeft: (k ? 6 : 14) * u }} />
              ))}
            </div>
            {r.value ? (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  minWidth: 120 * u,
                  ...D,
                  fontSize: 40 * u,
                  padding: `${6 * u}px ${14 * u}px`,
                  borderRadius: 12 * u,
                  ...(r.lead ? { backgroundImage: `linear-gradient(90deg, ${p.red}, ${mix(p.red, "#ff7a45", 0.35)})` } : { background: "rgba(255,255,255,0.12)" }),
                }}
              >
                {r.value}
              </div>
            ) : null}
          </div>
        ))}
        {b.mode !== "none" && (
          <div style={{ display: "flex", justifyContent: "space-between", ...S, fontWeight: 600, fontSize: 24 * u, color: "rgba(255,255,255,0.78)", padding: `${8 * u}px ${22 * u}px`, borderTop: `${1.5 * u}px solid rgba(255,255,255,0.08)` }}>
            <div style={{ display: "flex" }}>{b.status ?? ""}</div>
            <div style={{ display: "flex" }}>{b.thru > 0 ? `Thru ${b.thru}` : "Starting"}</div>
          </div>
        )}
        {b.footer && (
          <div style={{ display: "flex", ...S, fontWeight: 600, fontSize: 22 * u, color: p.gold, padding: `${7 * u}px ${22 * u}px`, background: "rgba(0,0,0,0.35)" }}>{`Overall  ${b.footer}`}</div>
        )}
      </div>
      {b.flash && (
        <div
          style={{
            display: "flex",
            marginTop: 16 * u,
            ...D,
            fontSize: 58 * u,
            letterSpacing: 3 * u,
            color: "#ffffff",
            padding: `${8 * u}px ${34 * u}px`,
            borderRadius: 999,
            backgroundImage: `linear-gradient(90deg, ${p.red}, ${mix(p.red, "#ff7a45", 0.4)})`,
            boxShadow: `0 ${10 * u}px ${30 * u}px ${rgba(p.red, 0.45)}`,
          }}
        >
          {b.flash}
        </div>
      )}
    </div>
  );
}
