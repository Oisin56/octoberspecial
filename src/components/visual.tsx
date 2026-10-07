"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { COURSE_PHOTOS } from "@/data/course-photos";
import { mediaUrl } from "@/lib/supabase";
import type { RoundRow } from "@/lib/types";

/** The photo for a round: the organiser's upload, else a credited free-licence photo. */
export function roundPhoto(round: Pick<RoundRow, "course_slug" | "course_name"> & { photo_path?: string | null }) {
  if (round.photo_path) return { src: mediaUrl(round.photo_path)!, alt: round.course_name, credit: null as null | { author: string; licence: string; page: string }, uploaded: true };
  const p = COURSE_PHOTOS[round.course_slug.replace(/^local:/, "")];
  if (!p) return null;
  return { src: p.src, alt: p.alt, credit: { author: p.author, licence: p.licence, page: p.page }, uploaded: false };
}

/** Course initials on a theme gradient, for courses with no photo (or while one fails to load). */
function Placeholder({ name }: { name: string }) {
  const initials = name
    .replace(/golf club|golf course|estate/gi, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <div className="ph" aria-hidden>
      <svg viewBox="0 0 200 112" preserveAspectRatio="xMidYMid slice">
        <path d="M0 80 C 40 62, 80 92, 120 74 S 180 60, 200 70 L200 112 L0 112Z" fill="rgba(255,255,255,0.07)" />
        <path d="M0 92 C 50 80, 100 104, 150 88 S 190 84, 200 86 L200 112 L0 112Z" fill="rgba(255,255,255,0.06)" />
        <line x1="150" y1="40" x2="150" y2="78" stroke="rgba(255,255,255,0.35)" strokeWidth="1.4" />
        <path d="M150 40 L166 45 L150 50Z" fill="var(--bracken)" opacity="0.8" />
      </svg>
      <span>{initials}</span>
    </div>
  );
}

/** Course photo filling its (relatively positioned) parent, with a graceful fallback. */
export function CourseImage({ round, sizes, priority }: { round: Pick<RoundRow, "course_slug" | "course_name"> & { photo_path?: string | null }; sizes: string; priority?: boolean }) {
  const photo = roundPhoto(round);
  const [failed, setFailed] = useState(false);
  if (!photo || failed) return <Placeholder name={round.course_name} />;
  return (
    <Image
      src={photo.src}
      alt={photo.alt}
      fill
      sizes={sizes}
      priority={priority}
      unoptimized={photo.uploaded}
      style={{ objectFit: "cover" }}
      onError={() => setFailed(true)}
    />
  );
}

export function PhotoCredit({ round }: { round: Pick<RoundRow, "course_slug" | "course_name"> & { photo_path?: string | null } }) {
  const photo = roundPhoto(round);
  if (!photo?.credit) return null;
  return (
    <a className="credit" href={photo.credit.page} target="_blank" rel="noreferrer">
      Photo © {photo.credit.author}, {photo.credit.licence}
    </a>
  );
}

/** Numbers that count up when they change (static for reduced-motion users). */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 900);
      const eased = 1 - Math.pow(1 - k, 3);
      const v = start + (value - start) * eased;
      setShown(k < 1 ? Math.round(v * 2) / 2 : value);
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(shown)}</>;
}

/** "tees off in 3 days" / "in 5h 20m" / "today", updated every minute. */
export function useCountdown(date: string | null, time: string | null) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  if (!date || now == null) return null;
  const target = new Date(`${date}T${time && /^\d{1,2}:\d{2}/.test(time) ? time.slice(0, 5).padStart(5, "0") : "09:00"}:00`).getTime();
  const mins = Math.round((target - now) / 60000);
  if (mins <= 0) return time ? "teeing off now" : "today";
  if (mins < 60) return `tees off in ${mins} min`;
  if (mins < 24 * 60) return `tees off in ${Math.floor(mins / 60)}h ${mins % 60}m`;
  const days = Math.round(mins / (24 * 60));
  return `tees off in ${days} day${days === 1 ? "" : "s"}`;
}

export function Icon({ kind }: { kind: "ctp" | "ld" | "gir" | "birdies" | "eagles" }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (kind === "ctp")
    return (
      <svg {...common}>
        <path d="M7 21V3l10 4-10 4" />
        <ellipse cx="12" cy="21" rx="8" ry="1.6" />
      </svg>
    );
  if (kind === "ld")
    return (
      <svg {...common}>
        <path d="M3 17h13" />
        <path d="M12 13l4 4-4 4" />
        <circle cx="20" cy="17" r="1.6" fill="currentColor" />
        <path d="M3 9c4-5 10-5 14 0" strokeDasharray="2 2.5" />
      </svg>
    );
  if (kind === "gir")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M4 14c3-1 5-4 6-8 2 3 3 6 9 7-4 2-6 3-8 7-1-3-3-5-7-6z" />
    </svg>
  );
}

/** Course photo banner with the title over it (round and live pages). */
export function RoundBanner({
  round,
  kicker,
  title,
  meta,
  compact,
  children,
}: {
  round: Pick<RoundRow, "course_slug" | "course_name"> & { photo_path?: string | null };
  kicker?: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  compact?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section className={`round-hero${compact ? " compact" : ""}`}>
      <div className="hero-img">
        <CourseImage round={round} sizes="(min-width: 1040px) 1040px, 100vw" priority />
      </div>
      <div className="hero-shade" />
      <div className="hero-content">
        {kicker && <div className="hero-kicker">{kicker}</div>}
        <h1>{title}</h1>
        {meta && <div className="hero-meta">{meta}</div>}
        {children && <div className="hero-actions">{children}</div>}
      </div>
      <div className="hero-credit">
        <PhotoCredit round={round} />
      </div>
    </section>
  );
}
