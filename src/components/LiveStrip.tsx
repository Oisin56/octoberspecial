"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "./Providers";
import { liveLine, liveRound, roundBoard } from "@/lib/live";

/** While a round is being played: one line under the header on every page, with today's score. Tap for the live page. */
export function LiveStrip() {
  const { state, summary, href } = useT();
  const path = usePathname();
  if (!state || !summary) return null;
  // The scoring screen, the camera and the card are full-screen tools that show the score themselves
  if (/\/(score|record|card)$/.test(path)) return null;
  const round = liveRound(state);
  if (!round) return null;
  const b = roundBoard(state, summary, round);
  const provisional = b.stage === "finished";
  return (
    <Link href={href("/live")} className="live-strip" aria-label={`Live: round ${round.number}. ${liveLine(b)}. Open the live page`}>
      <span className="wrap live-strip-in">
        <span className={provisional ? "ls-tag prov" : "ls-tag"}>{provisional ? "Finished" : "Live"}</span>
        <span className="ls-round">R{round.number}</span>
        <span className="ls-line">
          {b.session && b.kind === "match" ? (
            b.session.map((t, i) => (
              <span key={t.teamId} className="ls-team">
                {i > 0 && <span className="ls-dash">–</span>}
                <span className="ls-swatch" style={{ background: t.color }} aria-hidden="true" />
                {t.name} <b>{t.pts % 1 ? `${Math.floor(t.pts)}½` : t.pts}</b>
              </span>
            ))
          ) : (
            liveLine(b)
          )}
          {provisional && <span className="ls-prov"> · provisional</span>}
        </span>
        <span className="ls-go" aria-hidden="true">
          ›
        </span>
      </span>
    </Link>
  );
}
