"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "./Providers";

const TABS = [
  { href: "/", label: "Home" },
  { href: "/live", label: "Live" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/rounds", label: "Rounds" },
  { href: "/feed", label: "Feed" },
  { href: "/highlights", label: "Highlights" },
  { href: "/players", label: "Players" },
  { href: "/rules", label: "Rules" },
];

export function SiteHeader() {
  const path = usePathname();
  const { state, session } = useT();
  const live = state?.rounds.some((r) => r.status === "live");
  const canScore = session?.role === "organiser" || session?.role === "player";

  return (
    <header className="site-head">
      <div className="wrap">
        <div className="bar">
          <Link href="/" className="site-title">
            {state?.tournament.name ?? "The October Special"}
            <small>{state?.tournament.subtitle ?? "Seven rounds. Two men. 360 points."}</small>
          </Link>
          <div className="who">
            {session ? (
              <>
                {canScore && <Link href="/score">Score</Link>}
                {canScore && " · "}
                <Link href="/post">Post</Link>
                {session.role === "organiser" && (
                  <>
                    {" · "}
                    <Link href="/admin">Admin</Link>
                  </>
                )}
              </>
            ) : (
              <Link href="/login">Log in</Link>
            )}
          </div>
        </div>
        <nav className="tabs" aria-label="Sections">
          {TABS.map((t) => {
            const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
            return (
              <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined}>
                {t.href === "/live" && live && <span className="dot" aria-label="Live now" />}
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
