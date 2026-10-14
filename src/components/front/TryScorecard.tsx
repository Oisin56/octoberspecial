"use client";

import Link from "next/link";
import { useState } from "react";
import { scoreTiles, scoreWord } from "@/lib/scoreEntry";

/** Three holes of a match to tap through, exactly as on the course. Nothing is saved anywhere. */
const HOLES = [
  { n: 1, par: 4, si: 7, yards: 382 },
  { n: 2, par: 3, si: 15, yards: 164 },
  { n: 3, par: 5, si: 3, yards: 511 },
];
const PLAYERS = ["You", "Sam"] as const;

export function TryScorecard() {
  const [hole, setHole] = useState(0);
  const [scores, setScores] = useState<Record<number, Partial<Record<(typeof PLAYERS)[number], number>>>>({});
  const [more, setMore] = useState<(typeof PLAYERS)[number] | null>(null);
  const h = HOLES[Math.min(hole, HOLES.length - 1)];
  const here = scores[h.n] ?? {};
  const set = (p: (typeof PLAYERS)[number], n: number) => setScores((s) => ({ ...s, [h.n]: { ...(s[h.n] ?? {}), [p]: n } }));
  const both = PLAYERS.every((p) => here[p] != null);
  const result = (n: number) => {
    const s = scores[n] ?? {};
    if (s.You == null || s.Sam == null) return null;
    return s.You < s.Sam ? "You win the hole" : s.Sam < s.You ? "Sam wins the hole" : "Hole halved";
  };
  const done = HOLES.filter((x) => result(x.n));
  const lead = done.reduce((t, x) => t + (result(x.n) === "You win the hole" ? 1 : result(x.n) === "Sam wins the hole" ? -1 : 0), 0);
  const standing = lead === 0 ? "All square" : `${lead > 0 ? "You" : "Sam"} ${Math.abs(lead)} up`;
  const finished = done.length === HOLES.length && hole === HOLES.length;

  return (
    <div className="theme-root try" data-theme="spring" data-board="light">
      <div className="try-bar">
        <span>Try the scorecard. Nothing you tap is saved.</span>
        <Link href="/">Close</Link>
      </div>
      <main className="wrap try-main">
        {finished ? (
          <div className="panel stack try-end">
            <h1>{standing === "All square" ? "All square after three" : `${standing} after three`}</h1>
            <p>That&apos;s the scorecard. On the course it&apos;s the same, with distances to the green a tap away, a camera for the good shots, and everyone at home watching the leaderboard move.</p>
            <Link className="btn block big" href="/invite">
              Request an invite
            </Link>
            <button className="btn secondary block" onClick={() => (setScores({}), setHole(0))}>
              Play them again
            </button>
          </div>
        ) : (
          <>
            <div className="hole-head">
              <button className="navbtn" aria-label="Previous hole" disabled={hole === 0} onClick={() => setHole(hole - 1)}>
                ‹
              </button>
              <div className="hole-pick" aria-label={`Hole ${h.n}`}>
                <span className="n">{h.n}</span>
                <span className="info">
                  Par {h.par} · SI {h.si}
                  <br />
                  {h.yards} yds
                </span>
              </div>
              <button className="navbtn" aria-label="Next hole" disabled={!both} onClick={() => setHole(hole + 1)}>
                ›
              </button>
            </div>
            <p className="try-standing">{done.length ? `${standing}, thru ${done.length}` : "Tap a number for each player"}</p>
            {PLAYERS.map((p) => {
              const tiles = scoreTiles(h.par);
              const g = here[p];
              const outside = g != null && !tiles.includes(g);
              return (
                <section className="pscore entry" key={p} aria-label={`${p} score`}>
                  <div className="ptop">
                    <span className="pwho">
                      <span className="pname">{p}</span>
                    </span>
                  </div>
                  <div className="num-tiles" role="group" aria-label={`${p}'s score`}>
                    {tiles.map((n) => (
                      <button key={n} className="num-tile" aria-pressed={g === n} onClick={() => set(p, n)}>
                        {n}
                        {g === n && <small>{scoreWord(n, h.par)}</small>}
                      </button>
                    ))}
                    <button className="num-tile more" aria-pressed={outside} onClick={() => setMore(p)}>
                      {outside ? g : "More"}
                      {outside && <small>{scoreWord(g!, h.par)}</small>}
                    </button>
                  </div>
                </section>
              );
            })}
            {result(h.n) && <p className="hole-result">{result(h.n)}</p>}
            <button className="btn block big try-next" disabled={!both} onClick={() => setHole(hole + 1)}>
              {hole === HOLES.length - 1 ? "Finish" : `Next: hole ${h.n + 1}`}
            </button>
          </>
        )}
      </main>
      {more && (
        <div className="hole-sheet" role="dialog" aria-label={`${more}: choose the score`}>
          <p className="display" style={{ fontSize: 22, margin: 0 }}>
            {more} on hole {h.n}
          </p>
          <div className="grid">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
              <button key={n} onClick={() => (set(more, n), setMore(null))}>
                {n}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
