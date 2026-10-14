import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BRAND } from "@/lib/brand";

/** The card WhatsApp, iMessage and the rest show when someone shares a link to the site. */
export const alt = `${BRAND.name}: ${BRAND.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const dir = join(process.cwd(), "src/assets/fonts");
  const [cond, inter] = await Promise.all([readFile(join(dir, "barlow-condensed-latin-700-normal.woff")), readFile(join(dir, "inter-latin-600-normal.woff"))]);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "linear-gradient(160deg, #24513a 0%, #13291d 100%)",
          color: "#fff",
          fontFamily: "Barlow",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 44 }}>
          <div style={{ width: 54, height: 54, borderRadius: 12, background: "#f2d24b", display: "flex" }} />
          <span>{BRAND.mark[0]}</span>
          <span style={{ color: "#f2d24b", marginLeft: -18 }}>{BRAND.mark[1]}</span>
          <span style={{ marginLeft: -18 }}>{BRAND.mark[2]}</span>
        </div>
        <div style={{ display: "flex", fontSize: 128, lineHeight: 0.95, maxWidth: 980 }}>{BRAND.tagline}</div>
        <div style={{ display: "flex", fontSize: 32, fontFamily: "Inter", color: "rgba(255,255,255,0.85)" }}>Live scores, match reports and a film of it all</div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Barlow", data: cond, weight: 700 },
        { name: "Inter", data: inter, weight: 600 },
      ],
    },
  );
}
