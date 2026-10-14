import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { paletteFor } from "@/lib/themes";
import { signCard, type CardSpec } from "@/lib/cards";
import { zones, type ZoneName } from "@/lib/broadcastLayout";

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
  const p: P = { ...base, gold: base.gold ?? mix(base.bracken, "#ffd76a", 0.45), glass: "#0a100d" };
  const [b600, b700, i500, i600, i800] = await fonts;
  const W = spec.w;
  const H = spec.ht;
  const portrait = H > W;
  // scale unit (a swipe layer is wider than the frame: size it by the frame it crosses)
  const u = Math.min(spec.k === "sting" ? W / 1.6 : W, H) / 1080;

  let body: React.ReactElement;
  if (spec.k === "bug" && spec.b) body = <Bug spec={spec} p={p} W={W} H={H} u={u} portrait={portrait} />;
  else if (spec.k === "caption") body = <Caption spec={spec} p={p} W={W} H={H} u={u} portrait={portrait} />;
  else if (spec.k === "strap") body = <Strap spec={spec} p={p} W={W} H={H} u={u} portrait={portrait} />;
  else if (spec.k === "replay") body = <ReplayTag spec={spec} p={p} W={W} H={H} u={u} portrait={portrait} />;
  else if (spec.k === "sting") body = <StingLayer spec={spec} p={p} W={W} H={H} u={u} portrait={portrait} />;
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

/** A graphic placed in its own zone of the frame (see broadcastLayout): nothing else is ever drawn there. */
function InZone({ W, H, name, v, h, children }: { W: number; H: number; name: ZoneName; v: "start" | "end" | "center"; h: "start" | "end" | "center"; children: React.ReactNode }) {
  const z = zones(W, H)[name];
  const flex = (x: "start" | "end" | "center") => (x === "start" ? "flex-start" : x === "end" ? "flex-end" : "center");
  return (
    <div style={{ width: W, height: H, display: "flex", position: "relative" }}>
      <div style={{ position: "absolute", left: z.x, top: z.y, width: z.w, height: z.h, display: "flex", flexDirection: "column", justifyContent: flex(v), alignItems: flex(h) }}>{children}</div>
    </div>
  );
}

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
          {k === "chapter" && (
            <div style={{ display: "flex", justifyContent: "center", ...S, fontWeight: 600, fontSize: 24 * u, letterSpacing: 4 * u, color: p.gold, padding: `${14 * u}px 0 ${4 * u}px` }}>OVERALL GOING IN</div>
          )}
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
    <InZone W={W} H={H} name="caption" v="end" h={portrait ? "center" : "start"}>
      <div style={{ display: "flex", maxWidth: zones(W, H).caption.w, borderRadius: 20 * u, overflow: "hidden", boxShadow: `0 ${14 * u}px ${40 * u}px rgba(0,0,0,0.4)` }}>
        <div style={{ display: "flex", width: 12 * u, backgroundImage: `linear-gradient(180deg, ${p.gold}, ${p.red})` }} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            padding: `${18 * u}px ${32 * u}px ${20 * u}px`,
            backgroundImage: `linear-gradient(90deg, ${rgba(p.glass, 0.9)}, ${rgba(p.glass, 0.68)})`,
          }}
        >
          <div style={{ display: "flex", maxWidth: zones(W, H).caption.w - 80 * u, ...D, fontSize: (spec.h.length > 60 ? 50 : 64) * u, lineHeight: 1.02, color: "#ffffff" }}>{spec.h}</div>
          {spec.s && <div style={{ display: "flex", ...S, fontSize: 34 * u, marginTop: 6 * u, color: "rgba(255,255,255,0.84)" }}>{spec.s}</div>}
        </div>
      </div>
    </InZone>
  );
}

/** Player and hole, sliding in when the film moves to a new hole: hole number block, name, then the detail. */
function Strap({ spec, p, W, H, u, portrait }: CardProps) {
  return (
    <InZone W={W} H={H} name="strap" v="end" h={portrait ? "center" : "start"}>
      <div style={{ display: "flex", flexDirection: "column", maxWidth: zones(W, H).strap.w, boxShadow: `0 ${16 * u}px ${44 * u}px rgba(0,0,0,0.45)`, borderRadius: 18 * u, overflow: "hidden" }}>
        <div style={{ display: "flex", height: 7 * u, backgroundImage: `linear-gradient(90deg, ${p.red}, ${p.gold})` }} />
        <div style={{ display: "flex", alignItems: "stretch" }}>
          {spec.e && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                minWidth: 150 * u,
                padding: `${10 * u}px ${24 * u}px`,
                backgroundImage: `linear-gradient(160deg, ${mix(p.red, "#ffffff", 0.12)}, ${mix(p.red, "#000000", 0.35)})`,
              }}
            >
              <div style={{ display: "flex", ...S, fontWeight: 600, fontSize: 22 * u, letterSpacing: 3 * u, color: "rgba(255,255,255,0.85)" }}>HOLE</div>
              <div style={{ display: "flex", ...D, fontSize: 96 * u, lineHeight: 0.95, color: "#ffffff" }}>{spec.e}</div>
            </div>
          )}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              padding: `${18 * u}px ${36 * u}px ${20 * u}px`,
              backgroundImage: `linear-gradient(90deg, ${rgba(p.glass, 0.92)}, ${rgba(p.glass, 0.72)})`,
            }}
          >
            <div style={{ display: "flex", ...D, fontSize: 76 * u, lineHeight: 1, color: "#ffffff", letterSpacing: 0.5 * u }}>{spec.h}</div>
            {spec.s && <div style={{ display: "flex", ...S, fontWeight: 600, fontSize: 32 * u, marginTop: 8 * u, color: p.gold }}>{spec.s}</div>}
          </div>
        </div>
      </div>
    </InZone>
  );
}

/** The REPLAY tag over a slow-motion replay. */
function ReplayTag({ p, W, H, u }: CardProps) {
  return (
    <InZone W={W} H={H} name="replay" v="start" h="start">
      <div style={{ display: "flex", alignItems: "center", borderRadius: 999, overflow: "hidden", boxShadow: `0 ${10 * u}px ${30 * u}px rgba(0,0,0,0.45)` }}>
        <div style={{ display: "flex", width: 10 * u, alignSelf: "stretch", background: p.gold }} />
        <div
          style={{
            display: "flex",
            ...D,
            fontSize: 46 * u,
            letterSpacing: 6 * u,
            color: "#ffffff",
            padding: `${10 * u}px ${36 * u}px ${12 * u}px ${30 * u}px`,
            backgroundImage: `linear-gradient(90deg, ${mix(p.red, "#ffffff", 0.08)}, ${mix(p.red, "#000000", 0.4)})`,
          }}
        >
          REPLAY
        </div>
      </div>
    </InZone>
  );
}

/**
 * One layer of the branded swipe between scenes. The image is 1.6× the frame's width; the film slides it
 * across. Layer "a" is the main band with the event's name, "b" a lighter band that leads and trails it,
 * "c" a thin gold edge. Slanted ends come from a skewed band inside a transparent image.
 */
function StingLayer({ spec, p, W, H, u }: CardProps) {
  const layer = spec.layer ?? "a";
  const frameW = W / 1.6;
  const slant = Math.min(H * 0.12, frameW * 0.1);
  const skew = (Math.atan2(slant * 2, H) * 180) / Math.PI;
  // band spans the frame with room for its slanted ends; the gold layer is two edges hugging the main band
  const main = { left: W * 0.5 - frameW * 0.58, width: frameW * 1.16 };
  const edge = frameW * 0.035;
  const gap = frameW * 0.012;
  const bands =
    layer === "c"
      ? [
          { left: main.left - gap - edge, width: edge },
          { left: main.left + main.width + gap, width: edge },
        ]
      : layer === "b"
        ? [{ left: W * 0.5 - frameW * 0.64, width: frameW * 1.28 }]
        : [main];
  const fill =
    layer === "a"
      ? `linear-gradient(90deg, ${mix(p.board, "#000000", 0.35)}, ${p.board} 30%, ${mix(p.board, "#ffffff", 0.08)} 50%, ${p.board} 70%, ${mix(p.board, "#000000", 0.35)})`
      : layer === "b"
        ? `linear-gradient(90deg, ${rgba(mix(p.board, "#ffffff", 0.45), 0.85)}, ${rgba(mix(p.board, "#ffffff", 0.25), 0.85)})`
        : `linear-gradient(180deg, ${mix(p.gold, "#ffffff", 0.25)}, ${p.gold} 50%, ${mix(p.gold, "#000000", 0.2)})`;
  return (
    <div style={{ width: W, height: H, display: "flex", position: "relative" }}>
      {bands.map((band, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: -H * 0.05,
            left: band.left,
            width: band.width,
            height: H * 1.1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundImage: fill,
            transform: `skewX(-${skew.toFixed(2)}deg)`,
          }}
        >
          {layer === "a" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", transform: `skewX(${skew.toFixed(2)}deg)` }}>
              <div style={{ display: "flex", width: 90 * u, height: 6 * u, background: p.gold, marginBottom: 22 * u }} />
              <div style={{ display: "flex", ...D, fontSize: 84 * u, letterSpacing: 8 * u, color: "#ffffff", textAlign: "center", maxWidth: frameW * 0.86, justifyContent: "center" }}>
                {(spec.h || "").toUpperCase()}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** TV-style score panel: top-left (landscape) or top-centre (portrait), transparent elsewhere. */
function Bug({ spec, p, W, H, u, portrait }: CardProps) {
  const b = spec.b!;
  const z = zones(W, H);
  const glass = {
    display: "flex",
    flexDirection: "column" as const,
    width: z.score.w,
    borderRadius: 22 * u,
    overflow: "hidden",
    background: rgba(p.glass, 0.84),
    border: `${1.5 * u}px solid rgba(255,255,255,0.14)`,
    boxShadow: `0 ${16 * u}px ${44 * u}px rgba(0,0,0,0.42)`,
    color: "#ffffff",
  };
  const head = (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: `${10 * u}px ${22 * u}px ${10 * u}px`, backgroundImage: `linear-gradient(90deg, ${rgba(p.board, 0.95)}, ${rgba(p.board, 0.55)})` }}>
      <div style={{ display: "flex", alignItems: "baseline" }}>
        <div style={{ display: "flex", ...D, fontSize: 44 * u, lineHeight: 1 }}>{`Hole ${b.hole}`}</div>
        <div style={{ display: "flex", ...S, fontWeight: 600, fontSize: 22 * u, color: "rgba(255,255,255,0.8)", marginLeft: 14 * u }}>{`Par ${b.par}${b.yards ? ` · ${b.yards} yds` : ""}`}</div>
      </div>
      <div style={{ display: "flex", ...S, fontWeight: 600, fontSize: 20 * u, letterSpacing: 2 * u, color: p.gold }}>{spec.wt ? `ROUND ${b.round}` : b.mode === "field" ? "LEADERBOARD" : ""}</div>
    </div>
  );
  const dotsOf = (n: number) =>
    Array.from({ length: Math.min(n, 3) }, (_, k) => <div key={k} style={{ display: "flex", width: 11 * u, height: 11 * u, borderRadius: 99, background: p.gold, marginLeft: (k ? 5 : 10) * u }} />);

  let panel: React.ReactElement;
  if (b.mode === "match" && b.match) {
    const m = b.match;
    const side = (x: (typeof m.sides)[number], right: boolean) => (
      <div style={{ display: "flex", flex: 1, flexDirection: right ? "row-reverse" : "row", alignItems: "center", minWidth: 0 }}>
        <div style={{ display: "flex", width: 8 * u, height: 54 * u, borderRadius: 4 * u, background: x.color ?? (x.lead ? p.red : "rgba(255,255,255,0.25)") }} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: right ? "flex-end" : "flex-start", margin: `0 ${12 * u}px` }}>
          <div style={{ display: "flex", ...D, fontSize: (x.name.length > 12 ? 30 : 38) * u, lineHeight: 1.05, color: x.lead ? "#ffffff" : "rgba(255,255,255,0.68)" }}>{x.name}</div>
          {x.dots > 0 && <div style={{ display: "flex", marginTop: 4 * u }}>{dotsOf(x.dots)}</div>}
        </div>
      </div>
    );
    const up = m.sides.some((x) => x.lead);
    const leadColor = m.sides.find((x) => x.lead)?.color;
    panel = (
      <div style={glass}>
        {head}
        <div style={{ display: "flex", alignItems: "center", padding: `${14 * u}px ${14 * u}px` }}>
          {side(m.sides[0], false)}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              minWidth: 150 * u,
              padding: `${8 * u}px ${14 * u}px`,
              borderRadius: 14 * u,
              ...(up ? { backgroundImage: `linear-gradient(135deg, ${leadColor ?? p.red}, ${mix(leadColor ?? p.red, "#000000", 0.35)})` } : { background: "rgba(255,255,255,0.14)" }),
            }}
          >
            <div style={{ display: "flex", ...D, fontSize: 48 * u, lineHeight: 1 }}>{m.big}</div>
            <div style={{ display: "flex", ...S, fontWeight: 600, fontSize: 19 * u, marginTop: 2 * u, color: "rgba(255,255,255,0.86)" }}>{m.small}</div>
          </div>
          {side(m.sides[1], true)}
        </div>
        {b.status && b.status !== "ALL SQUARE" && (
          <div style={{ display: "flex", justifyContent: "center", ...S, fontWeight: 800, fontSize: 20 * u, letterSpacing: 3 * u, color: p.onGold ?? "#1b1408", padding: `${6 * u}px`, backgroundImage: p.onGold ? `linear-gradient(90deg, ${p.gold}, ${p.gold})` : `linear-gradient(90deg, ${p.gold}, ${p.bracken})` }}>{b.status}</div>
        )}
      </div>
    );
  } else if (b.mode === "field") {
    panel = (
      <div style={glass}>
        {head}
        <div style={{ display: "flex", flexDirection: "column", padding: `${6 * u}px 0 ${8 * u}px` }}>
          {b.rows.map((r, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column" }}>
              {r.gap && <div style={{ display: "flex", justifyContent: "center", ...S, fontSize: 20 * u, lineHeight: 1, color: "rgba(255,255,255,0.45)", padding: `${2 * u}px 0` }}>• • •</div>}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  height: 54 * u,
                  margin: `${2 * u}px ${10 * u}px`,
                  padding: `0 ${12 * u}px`,
                  borderRadius: 12 * u,
                  ...(r.onCamera ? { backgroundImage: `linear-gradient(90deg, ${p.red}, ${mix(p.red, "#000000", 0.35)})` } : {}),
                }}
              >
                <div style={{ display: "flex", width: 58 * u, ...D, fontSize: 30 * u, color: r.onCamera ? "#ffffff" : p.gold }}>{r.pos}</div>
                <div style={{ display: "flex", flex: 1, alignItems: "center", ...D, fontSize: 34 * u, color: "#ffffff" }}>
                  {r.name}
                  {r.onCamera && r.dots > 0 ? dotsOf(r.dots) : null}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", minWidth: 120 * u, ...D, fontSize: 36 * u, color: r.lead && !r.onCamera ? mix(p.red, "#ffffff", 0.45) : "#ffffff" }}>{r.value}</div>
                <div style={{ display: "flex", justifyContent: "flex-end", width: 62 * u, ...S, fontWeight: 600, fontSize: 21 * u, color: "rgba(255,255,255,0.7)" }}>{r.finished || r.thru >= 18 ? "F" : String(r.thru)}</div>
              </div>
            </div>
          ))}
        </div>
        {b.status && <div style={{ display: "flex", justifyContent: "center", ...S, fontWeight: 800, fontSize: 20 * u, letterSpacing: 3 * u, color: p.onGold ?? "#1b1408", padding: `${6 * u}px`, backgroundImage: p.onGold ? `linear-gradient(90deg, ${p.gold}, ${p.gold})` : `linear-gradient(90deg, ${p.gold}, ${p.bracken})` }}>{b.status}</div>}
      </div>
    );
  } else {
    panel = <div style={glass}>{head}</div>;
  }

  const fz = z.flash;
  return (
    <div style={{ width: W, height: H, display: "flex", position: "relative" }}>
      <div style={{ position: "absolute", left: z.score.x, top: z.score.y, width: z.score.w, height: z.score.h, display: "flex", flexDirection: "column", justifyContent: portrait ? "flex-start" : "flex-end", alignItems: "flex-end" }}>{panel}</div>
      {b.flash && (
        <div style={{ position: "absolute", left: fz.x, top: fz.y, width: fz.w, height: fz.h, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div
            style={{
              display: "flex",
              ...D,
              fontSize: (b.flash.length > 14 ? 50 : 66) * u,
              letterSpacing: 3 * u,
              color: "#ffffff",
              padding: `${10 * u}px ${38 * u}px`,
              borderRadius: 999,
              backgroundImage: `linear-gradient(90deg, ${p.red}, ${mix(p.red, "#ff7a45", 0.4)})`,
              boxShadow: `0 ${10 * u}px ${30 * u}px ${rgba(p.red, 0.45)}`,
            }}
          >
            {b.flash}
          </div>
        </div>
      )}
    </div>
  );
}
