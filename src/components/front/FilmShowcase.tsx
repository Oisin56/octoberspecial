"use client";

import Image from "next/image";
import { useRef } from "react";
import { InView } from "./Broadcast";
import { Phone } from "./Phone";
import screens from "@/lib/screens.json";

/**
 * The film, shown as a frame from it: a photo with the film's own graphics on top (the score panel and the name
 * bar, drawn to the film's design and positions for a wide frame; see api/director/card and broadcastLayout).
 * The story is the front page's: the 12th at The Atlantic Cup, Declan's birdie.
 */
const ROWS = [
  { pos: "1", name: "Declan", pts: "−3", cam: true },
  { pos: "T2", name: "Marcus", pts: "−2" },
  { pos: "T2", name: "Shane", pts: "−2" },
  { pos: "4", name: "Ronan", pts: "+3" },
];

export function FilmStill() {
  return (
    <InView className="fs-still">
      <Image src="/home/photos/broadcast.jpg" alt="A frame from a highlights film: a putt on the 12th, with the leaderboard and the player's name on screen" fill sizes="(min-width: 1200px) 1160px, 100vw" className="fs-photo" />
      <div className="fs-gfx" aria-hidden>
        <div className="fb-bug">
          <div className="fb-head">
            <span className="fb-hole">Hole 12</span>
            <span className="fb-par">Par 3 · 175 yds</span>
            <span className="fb-kind">LEADERBOARD</span>
          </div>
          <div className="fb-rows">
            {ROWS.map((r) => (
              <div key={r.name} className={`fb-row${r.cam ? " is-cam" : ""}`}>
                <span className="fb-pos">{r.pos}</span>
                <span className="fb-name">{r.name}</span>
                <span className="fb-val">{r.pts}</span>
                <span className="fb-thru">12</span>
              </div>
            ))}
          </div>
        </div>
        <div className="fb-strap">
          <span className="fb-strap-card">
            <span className="fb-strap-rule" />
            <span className="fb-strap-body">
              <span className="fb-strap-hole">
                <small>HOLE</small>
                <b>12</b>
              </span>
              <span className="fb-strap-text">
                <b>Declan</b>
                <small>Birdie to lead</small>
              </span>
            </span>
          </span>
        </div>
      </div>
    </InView>
  );
}

/** The film's graphics on a highlight in the app (the TV version of a clip): the same panel and name bar, small. */
export function HighlightGraphics() {
  return (
    <div className="hl-gfx" aria-hidden>
      <div className="fb-bug is-in">
        <div className="fb-head">
          <span className="fb-hole">Hole 11</span>
          <span className="fb-par">Par 4</span>
          <span className="fb-kind">LEADERBOARD</span>
        </div>
        <div className="fb-rows">
          {[
            ["T1", "Declan", "−2", true],
            ["T1", "Marcus", "−2", false],
            ["T1", "Shane", "−2", false],
          ].map(([pos, name, v, cam]) => (
            <div key={String(name)} className={`fb-row${cam ? " is-cam" : ""}`}>
              <span className="fb-pos">{pos}</span>
              <span className="fb-name">{name}</span>
              <span className="fb-val">{v}</span>
              <span className="fb-thru">10</span>
            </div>
          ))}
        </div>
      </div>
      <div className="fb-strap">
        <span className="fb-strap-card">
          <span className="fb-strap-rule" />
          <span className="fb-strap-body">
            <span className="fb-strap-hole">
              <small>HOLE</small>
              <b>11</b>
            </span>
            <span className="fb-strap-text">
              <b>Declan</b>
              <small>From thirty feet</small>
            </span>
          </span>
        </span>
      </div>
    </div>
  );
}

type Theme = { id: string; name: string; note: string };
const dims = screens as unknown as Record<string, { dark?: boolean; w?: number; h?: number }>;

/** The looks, side by side: each one's leaderboard, and the tournament's home on a phone. */
export function ThemeScroller({ themes }: { themes: readonly Theme[] }) {
  const track = useRef<HTMLDivElement>(null);
  const move = (dir: 1 | -1) => {
    const t = track.current;
    if (!t) return;
    const card = t.querySelector<HTMLElement>(".bx-theme");
    t.scrollBy({ left: dir * ((card?.offsetWidth ?? 600) + 24), behavior: "smooth" });
  };
  return (
    <div className="bx-theme-wrap">
      <div className="bx-theme-track" ref={track}>
        {themes.map((t) => {
          const b = dims[`theme-${t.id}-board`] ?? { w: 1200, h: 700 };
          return (
            <figure className="bx-theme" key={t.id}>
              <div className="bx-theme-stage">
                <div className="bx-theme-board">
                  <Image src={`/home/theme-${t.id}-board.png`} width={b.w ?? 1200} height={b.h ?? 700} alt={`The leaderboard in ${t.name}`} sizes="(min-width: 960px) 620px, 80vw" />
                </div>
                <Phone src={`/home/theme-${t.id}.jpg`} alt={`The tournament's home page in ${t.name}`} sizes="(min-width: 960px) 190px, 30vw" className="bx-theme-phone" />
              </div>
              <figcaption>
                <b>{t.name}</b>
                <span>{t.note}</span>
              </figcaption>
            </figure>
          );
        })}
      </div>
      <div className="bx-wrap bx-theme-nav">
        <button type="button" onClick={() => move(-1)} aria-label="Previous look">
          ‹
        </button>
        <button type="button" onClick={() => move(1)} aria-label="Next look">
          ›
        </button>
      </div>
    </div>
  );
}
