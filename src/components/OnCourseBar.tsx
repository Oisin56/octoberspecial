"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "./Providers";
import { currentHole } from "@/lib/scorePos";

/**
 * While a round is live, anyone logged in gets three big buttons at the foot of every page:
 * Score, Record and Note. Record opens the camera in one tap. The screen is kept awake.
 */
export function OnCourseBar() {
  const { state, session, href, slug } = useT();
  const path = usePathname();
  const [, bump] = useState(0);

  const live = useMemo(() => state?.rounds.find((r) => r.status === "live") ?? null, [state]);
  const show = !!(live && session);

  // Follow the scorer's hole (it's saved as they move)
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    window.addEventListener("mgs-score-pos", on);
    return () => window.removeEventListener("mgs-score-pos", on);
  }, []);

  // Room at the bottom of every page for the bar
  useEffect(() => {
    document.documentElement.classList.toggle("has-oncourse", show);
    return () => document.documentElement.classList.remove("has-oncourse");
  }, [show]);

  // Keep the screen on during a live round (re-asked when the phone comes back to this page)
  useEffect(() => {
    if (!show || !("wakeLock" in navigator)) return;
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
  }, [show]);

  // The camera is full screen: no bar over it
  if (!show || !live || !state || path?.endsWith("/record")) return null;
  const hole = currentHole(slug, live.id);
  const where = `round=${live.number}${hole ? `&hole=${hole}` : ""}`;
  const onScore = path?.endsWith("/score");
  const video = state.tournament.video_enabled;

  return (
    <>
    {!onScore && <InstallHint />}
    <nav className="oncourse" aria-label="On the course">
      <Link className={`oc-btn${onScore ? " here" : ""}`} href={href("/score")} aria-current={onScore ? "page" : undefined}>
        <Glyph k="score" />
        <span>Score</span>
      </Link>
      <Link className="oc-btn oc-record" href={href(video ? `/record?${where}` : `/post?${where}&from=course`)}>
        <Glyph k="record" />
        <span>{video ? "Record" : "Photo"}</span>
      </Link>
      <Link className="oc-btn" href={href(`/post?${where}&from=course`)}>
        <Glyph k="note" />
        <span>Note</span>
      </Link>
    </nav>
    </>
  );
}

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
    if (ios) setShow(true);
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

function Glyph({ k }: { k: "score" | "record" | "note" }) {
  if (k === "record")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="7" fill="currentColor" />
      </svg>
    );
  if (k === "note")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 4h14v12H9l-4 4z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 3v18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M9 4l10 4-10 4z" fill="currentColor" />
    </svg>
  );
}
