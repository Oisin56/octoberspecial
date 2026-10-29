"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "./Providers";
import { cardInfo } from "@/lib/scorecards";
import { toRoundCfg } from "@/lib/types";

/**
 * A player whose card is waiting for their signature sees it on every page until they sign. Once a card is handed in
 * (and final), each player on it gets a quick check of their own card for a day or two: "Your card for round 1 is
 * in. Is it right?", until they've checked it.
 */
export function SignPrompt() {
  const { state, session, href, demo } = useT();
  const path = usePathname();
  // When the page opened (a card handed in more than two days before that isn't asked about)
  const [openedAt] = useState(() => Date.now());
  if (demo || !state || !session?.playerId || /\/(card|record)$/.test(path)) return null;
  // On the scorecard during a round, the card itself asks
  const scoring = /\/score$/.test(path);
  if (scoring && state.rounds.some((r) => r.status === "live")) return null;
  // A day or two after it was handed in (not for whoever handed it in, who has just seen it)
  if (!state.tournament.finished_at && !state.tournament.require_attestation) {
    for (const round of state.rounds) {
      for (const g of toRoundCfg(round, state.players).games) {
        const info = cardInfo(state, round.id, g.id);
        const at = info.card?.final_at ? Date.parse(info.card.final_at) : 0;
        if (info.stage !== "final" || !info.players.includes(session.playerId) || info.signed.includes(session.playerId)) continue;
        if (!at || at < openedAt - 2 * 864e5 || info.card?.submitted_by === session.name || info.flag) continue;
        return (
          <div className="sign-prompt wrap" role="status">
            <span>Your card for round {round.number} is in. Is it right?</span>
            <Link className="btn" href={href(`/card?round=${round.number}&game=${encodeURIComponent(g.id)}`)}>
              Check it
            </Link>
          </div>
        );
      }
    }
  }
  if (scoring) return null;
  for (const round of state.rounds) {
    if (round.status === "complete") continue;
    for (const g of toRoundCfg(round, state.players).games) {
      const info = cardInfo(state, round.id, g.id);
      if (info.stage !== "submitted" || !info.players.includes(session.playerId) || info.signed.includes(session.playerId)) continue;
      return (
        <div className="sign-prompt wrap" role="status">
          <span>Your card for round {round.number} is ready for you to sign.</span>
          <Link className="btn" href={href(`/card?round=${round.number}&game=${encodeURIComponent(g.id)}`)}>
            Check and sign
          </Link>
        </div>
      );
    }
  }
  return null;
}
