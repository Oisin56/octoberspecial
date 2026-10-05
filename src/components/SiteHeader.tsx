"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "./Providers";
import { mediaUrl } from "@/lib/supabase";

const TABS = [
  { path: "/", label: "Home" },
  { path: "/live", label: "Live" },
  { path: "/leaderboard", label: "Leaderboard" },
  { path: "/rounds", label: "Rounds" },
  { path: "/feed", label: "Feed" },
  { path: "/highlights", label: "Highlights" },
  { path: "/players", label: "Players" },
  { path: "/rules", label: "Rules" },
];

export function SiteHeader() {
  const path = usePathname();
  const { state, session, href } = useT();
  const live = state?.rounds.some((r) => r.status === "live");
  const canScore = session?.role === "organiser" || session?.role === "player";
  const t = state?.tournament;
  const logo = mediaUrl(t?.logo_path);

  return (
    <header className="site-head">
      <div className="wrap">
        <div className="bar">
          <Link href={href("/")} className="site-title" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" width={40} height={40} style={{ borderRadius: 6, objectFit: "cover" }} />
            )}
            <span>
              {t?.name ?? "…"}
              {t?.subtitle && <small>{t.subtitle}</small>}
            </span>
          </Link>
          <div className="who">
            {session ? (
              <>
                {canScore && <Link href={href("/score")}>Score</Link>}
                {canScore && " · "}
                <Link href={href("/post")}>Post</Link>
                {session.role === "organiser" && (
                  <>
                    {" · "}
                    <Link href={href("/admin")}>Admin</Link>
                  </>
                )}
              </>
            ) : (
              <Link href={href("/login")}>Log in</Link>
            )}
          </div>
        </div>
        <nav className="tabs" aria-label="Sections">
          {TABS.map((tab) => {
            const full = href(tab.path);
            const active = tab.path === "/" ? path === full : path.startsWith(full);
            return (
              <Link key={tab.path} href={full} aria-current={active ? "page" : undefined}>
                {tab.path === "/live" && live && <span className="dot" aria-label="Live now" />}
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
