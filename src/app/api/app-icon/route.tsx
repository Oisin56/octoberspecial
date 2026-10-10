import { ImageResponse } from "next/og";

/** The app icon (flag on a green tile) at any size, for home screens. ?m=1 adds the safe margin Android crops to. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const s = Math.max(48, Math.min(1024, Number(u.searchParams.get("s")) || 192));
  const maskable = u.searchParams.get("m") === "1";
  const inset = maskable ? 0.18 : 0;
  return new ImageResponse(
    (
      <div style={{ width: s, height: s, display: "flex", background: "#1f3d2b", alignItems: "center", justifyContent: "center" }}>
        <svg width={s * (1 - inset * 2)} height={s * (1 - inset * 2)} viewBox="0 0 32 32">
          <path d="M12 6v20" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M13 7l10 4-10 4z" fill="#d4a83a" />
          <ellipse cx="16" cy="25.5" rx="7" ry="1.6" fill="#fff" fillOpacity=".35" />
        </svg>
      </div>
    ),
    { width: s, height: s, headers: { "cache-control": "public, max-age=604800, immutable" } },
  );
}
