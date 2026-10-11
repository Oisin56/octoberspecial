"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "./Providers";
import { cardInfo } from "@/lib/scorecards";
import { toRoundCfg } from "@/lib/types";

/** A player whose card is waiting for their signature sees it on every page until they sign. */
export function SignPrompt() {
  const { state, session, href } = useT();
  const path = usePathname();
  if (!state || !session?.playerId || /\/(card|score|record)$/.test(path)) return null;
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
