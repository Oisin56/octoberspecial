"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useT, type ClientSession } from "./Providers";
import { currentHole } from "@/lib/scorePos";
import { landingPath, liveRound, scoresToday } from "@/lib/landing";

/**
 * The bar at the foot of every tournament page on a phone: five big buttons, set by who you are.
 *   during a live round, players and the organiser   Score (Card if someone else keeps it) · Record · Note · Live · More
 *   the organiser                                     Home · Live · Feed · Admin · More
 *   everyone else                                     Home · Live · Feed · Leaderboard · More
 * More has every other page and who you're logged in as. On a computer the top tabs do this job
 * (the bar only shows there during a live round, for the people playing it). The screen is kept awake on the course.
 */
export function TabBar() {
  const { state, session, crew, href, slug } = useT();
  const path = usePathname() ?? "";
  const [, bump] = useState(0);
  const [more, setMore] = useState(false);

  const live = useMemo(() => liveRound(state), [state]);
  const onCourse = !!(live && crew);

  // Follow the scorer's hole (it's saved as they move)
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    window.addEventListener("mgs-score-pos", on);
    return () => window.removeEventListener("mgs-score-pos", on);
  }, []);

  // Room at the bottom of the page for the bar (always on a phone; on a computer only during a round)
  useEffect(() => {
    document.documentElement.classList.add("has-tabbar");
    document.documentElement.classList.toggle("has-oncourse", onCourse);
    return () => {
      document.documentElement.classList.remove("has-tabbar");
      document.documentElement.classList.remove("has-oncourse");
    };
  }, [onCourse]);

  // Keep the screen on during a live round (re-asked when the phone comes back to this page)
  useEffect(() => {
    if (!onCourse || !("wakeLock" in navigator)) return;
    let lock: { release: () => Promise<void> } | null = null;
    let gone = false;
    const ask = async () => {
      if (document.visibilityState !== "visible" || gone) return;
      try {
        lock = await (navigator as Navigator & { wakeLock: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock.request("screen");
      } catch {
        /* low battery or not allowed: the phone sleeps as normal */
      }
    };
    ask();
    document.addEventListener("visibilitychange", ask);
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", ask);
      lock?.release().catch(() => {});
    };
  }, [onCourse]);

  // The camera and the highlights reel are full screen: no bar over them
  if (!state || path.endsWith("/record") || path.endsWith("/highlights")) return null;
  const here = (p: string) => (p === "/" ? path === href("/") : path.startsWith(href(p)));

  let items: { k: Glyph; label: string; to: string; cls?: string }[];
  if (onCourse) {
    const hole = currentHole(slug, live!.id);
    const where = `round=${live!.number}${hole ? `&hole=${hole}` : ""}`;
    const video = state.tournament.video_enabled;
    items = [
      { k: "score", label: scoresToday(state, session) ? "Score" : "Card", to: "/score" },
      { k: "record", label: video ? "Record" : "Photo", to: video ? `/record?${where}` : `/post?${where}&from=course`, cls: "oc-record" },
      { k: "note", label: "Note", to: `/shots?${where}` },
      { k: "live", label: "Live", to: "/live" },
    ];
  } else if (session?.role === "organiser") {
    items = [
      { k: "home", label: "Home", to: "/" },
      { k: "live", label: "Live", to: "/live" },
      { k: "feed", label: "Feed", to: "/feed" },
      { k: "admin", label: "Admin", to: "/admin" },
    ];
  } else {
    items = [
      { k: "home", label: "Home", to: "/" },
      { k: "live", label: "Live", to: "/live" },
      { k: "feed", label: "Feed", to: "/feed" },
      { k: "board", label: "Leaderboard", to: "/leaderboard" },
    ];
  }

  return (
    <>
      {onCourse && !path.endsWith("/score") && <InstallHint />}
      <nav className={`oncourse tabbar${onCourse ? " live" : ""}`} aria-label={onCourse ? "On the course" : "Sections"}>
        {items.map((it) => {
          const at = here(it.to.split("?")[0]);
          return (
            <Link key={it.k} className={`oc-btn${it.cls ? ` ${it.cls}` : ""}${at ? " here" : ""}`} href={href(it.to)} aria-current={at ? "page" : undefined}>
              <GlyphIcon k={it.k} />
              <span>{it.label}</span>
            </Link>
          );
        })}
        <button className={`oc-btn${more ? " here" : ""}`} onClick={() => setMore(true)} aria-haspopup="dialog">
          <GlyphIcon k="more" />
          <span>More</span>
        </button>
      </nav>
      {more && <MoreSheet onClose={() => setMore(false)} />}
    </>
  );
}

const PAGES: [string, string][] = [
  ["/", "Home"],
  ["/live", "Live"],
  ["/leaderboard", "Leaderboard"],
  ["/rounds", "Rounds"],
  ["/feed", "Feed"],
  ["/highlights", "Highlights"],
  ["/players", "Players"],
  ["/rules", "Rules"],
];

/** Every page, and who you are */
function MoreSheet({ onClose }: { onClose: () => void }) {
  const { session, href } = useT();
  return (
    <div className="who-back" role="dialog" aria-label="More" onClick={onClose}>
      <div className="who-sheet" onClick={(e) => e.stopPropagation()}>
        <WhoCard onDone={onClose} />
        <nav className="more-list" aria-label="All pages">
          {session?.role === "organiser" && (
            <Link className="more-link strong" href={href("/admin")} onClick={onClose}>
              Admin: organiser home
            </Link>
          )}
          {PAGES.map(([p, label]) => (
            <Link key={p} className="more-link" href={href(p)} onClick={onClose}>
              {label}
            </Link>
          ))}
        </nav>
        <button className="btn secondary block" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ who am I

export type RoleKind = "organiser" | "player" | "fan" | "none";

export function roleOf(s: ClientSession | null): RoleKind {
  return s?.role === "organiser" ? "organiser" : s?.role === "player" ? "player" : s?.role === "fan" ? "fan" : "none";
}

/** "Organiser & Player", "Player · Scoring today", "Fan" */
export function roleLabel(s: ClientSession | null, scoring: boolean): string {
  if (!s) return "Not logged in";
  if (s.role === "organiser") return s.playerId ? "Organiser & Player" : "Organiser";
  if (s.role === "player") return scoring ? "Player · Scoring today" : "Player";
  return "Fan";
}

function canDo(s: ClientSession | null, scoring: boolean): string[] {
  if (!s) return ["Follow every score live", "Watch the clips and highlights", "Log in to play, or join to share photos and comment"];
  if (s.role === "organiser")
    return [
      "Run the tournament from Admin",
      "Correct any score (every correction is logged)",
      ...(s.playerId ? ["Play: film and note what happened, sign your card"] : []),
      ...(scoring ? ["Enter the scores for your match"] : []),
    ];
  if (s.role === "player")
    return [...(scoring ? ["Enter the scores for your match"] : []), "Film and note what happened", "Comment and like", "Sign your card"];
  return ["Share photos", "Comment and like", "Follow every score live"];
}

/** The badge at the top of every page: your name and role. Tap it for what you can do, and to log out. */
export function RoleBadge() {
  const { state, session, href } = useT();
  const [open, setOpen] = useState(false);
  const scoring = scoresToday(state, session);
  if (!session)
    return (
      <Link className="role-badge none" href={href("/login")}>
        Log in
      </Link>
    );
  return (
    <>
      <button className={`role-badge ${roleOf(session)}`} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className="rb-name">{session.name}</span>
        <span className="rb-role">{roleLabel(session, scoring).replace(" · Scoring today", "")}</span>
      </button>
      {open && (
        <div className="who-back" role="dialog" aria-label="Who you are" onClick={() => setOpen(false)}>
          <div className="who-sheet" onClick={(e) => e.stopPropagation()}>
            <WhoCard onDone={() => setOpen(false)} />
            <button className="btn secondary block" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function WhoCard({ onDone }: { onDone: () => void }) {
  const { state, session, slug, href, reloadSession } = useT();
  const router = useRouter();
  const scoring = scoresToday(state, session);
  async function logout() {
    await fetch(`/api/login?t=${encodeURIComponent(slug)}`, { method: "DELETE" });
    await reloadSession();
    onDone();
    router.push(href(landingPath(state, null)));
  }
  return (
    <div className={`who-card ${roleOf(session)}`}>
      <p className="who-name">{session?.name ?? "You're not logged in"}</p>
      <p className="who-role">{roleLabel(session, scoring)}</p>
      <ul className="who-can">
        {canDo(session, scoring).map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
      <div className="who-acts">
        {session?.role === "organiser" && (
          <Link className="btn block" href="/account" onClick={onDone}>
            My tournaments
          </Link>
        )}
        {session ? (
          <button className="btn secondary block" onClick={logout}>
            {session.role === "fan" ? "Sign out" : `Not ${session.name}? Log out`}
          </button>
        ) : (
          <Link className="btn block" href={href("/login")} onClick={onDone}>
            Log in
          </Link>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ add to home screen

type InstallEvent = Event & { prompt: () => Promise<void> };
const HINT_KEY = "mgs_install_hint";

/** Once, until dismissed: how to put the tournament on the home screen (full screen, opens into the round). */
function InstallHint() {
  const [show, setShow] = useState(false);
  const [android, setAndroid] = useState<InstallEvent | null>(null);
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    let snoozed = false;
    try {
      snoozed = Number(localStorage.getItem(HINT_KEY) ?? 0) > Date.now();
    } catch {}
    if (standalone || snoozed) return;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    if (ios) setTimeout(() => setShow(true), 0);
    const on = (e: Event) => {
      e.preventDefault();
      setAndroid(e as InstallEvent);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", on);
    return () => window.removeEventListener("beforeinstallprompt", on);
  }, []);
  if (!show) return null;
  const snooze = () => {
    try {
      localStorage.setItem(HINT_KEY, String(Date.now() + 30 * 24 * 3600 * 1000));
    } catch {}
    setShow(false);
  };
  return (
    <div className="install-hint" role="note">
      <p>
        <strong>Put this on your home screen</strong>
        {android ? " for one-tap scoring, full screen." : <> for one-tap scoring: tap <b>Share</b>, then <b>Add to Home Screen</b>.</>}
      </p>
      <div className="row">
        {android && (
          <button className="btn" onClick={() => android.prompt().then(snooze)}>
            Add it
          </button>
        )}
        <button className="btn secondary" onClick={snooze}>
          {android ? "Not now" : "Got it"}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ icons

type Glyph = "score" | "record" | "note" | "live" | "home" | "feed" | "admin" | "board" | "more";

function GlyphIcon({ k }: { k: Glyph }) {
  const p = { viewBox: "0 0 24 24", "aria-hidden": true as const, fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (k) {
    case "record":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="7" fill="currentColor" />
        </svg>
      );
    case "note":
      return (
        <svg {...p}>
          <path d="M5 4h14v12H9l-4 4z" />
        </svg>
      );
    case "score":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 3v18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M9 4l10 4-10 4z" fill="currentColor" />
        </svg>
      );
    case "live":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="2.5" fill="currentColor" />
          <path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9" />
        </svg>
      );
    case "home":
      return (
        <svg {...p}>
          <path d="M4 11l8-7 8 7v9H4z" />
          <path d="M10 20v-5h4v5" />
        </svg>
      );
    case "feed":
      return (
        <svg {...p}>
          <rect x="4" y="4" width="16" height="16" rx="3" />
          <path d="M8 9h8M8 13h8M8 17h5" />
        </svg>
      );
    case "admin":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
        </svg>
      );
    case "board":
      return (
        <svg {...p}>
          <path d="M5 20V10M12 20V4M19 20v-7" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
          <circle cx="5" cy="12" r="2.2" />
          <circle cx="12" cy="12" r="2.2" />
          <circle cx="19" cy="12" r="2.2" />
        </svg>
      );
  }
}
