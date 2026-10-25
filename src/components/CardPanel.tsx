"use client";

import { useState } from "react";
import { useT } from "./Providers";
import { Sheet } from "./Sheet";
import { Scorecard, gameLine } from "./ui";
import { cardInfo, cardLabel } from "@/lib/scorecards";
import { sideLabel, toRoundCfg } from "@/lib/types";

/**
 * The end of a match: check the card, submit it, and (when the tournament asks for it) every player signs it.
 * Used on the scorer's phone (pass it round to sign), on a player's own phone, and by the organiser.
 */
export function CardPanel({
  roundId,
  gameId,
  onBack,
  backLabel = "Back to the holes",
  onDone,
}: {
  roundId: string;
  gameId: string;
  /** Back to entering scores (scorer only) */
  onBack?: () => void;
  backLabel?: string;
  onDone?: () => void;
}) {
  const { state, summary, session, api, refresh, names } = useT();
  const [confirming, setConfirming] = useState(false);
  const [signer, setSigner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!state || !summary) return null;
  const round = state.rounds.find((r) => r.id === roundId);
  if (!round) return null;
  const cfg = toRoundCfg(round, state.players);
  const gi = cfg.games.findIndex((g) => g.id === gameId);
  const game = cfg.games[gi];
  if (!game) return null;
  const ri = state.rounds.indexOf(round);
  const info = cardInfo(state, roundId, gameId);
  const org = session?.role === "organiser";
  const scorer = org || (!!session?.playerId && session.playerId === game.scorerId);
  const result = gameLine(round, game, summary.rounds[ri].games[gi], state.players);
  const title = `${cfg.games.length > 1 ? `${game.name ?? `Match ${gi + 1}`}: ` : ""}${game.sides.map((s) => sideLabel(s.id, game, state.players)).join(" v ")}`;

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setErr(null);
    let r: Awaited<ReturnType<typeof api>>;
    try {
      r = await api("/api/cards", { action, roundId, game: gameId, ...extra });
    } catch {
      setBusy(false);
      setErr("No signal. Try again in a moment.");
      return false;
    }
    setBusy(false);
    if (!r.ok) {
      setErr(String(r.j.error ?? "That didn't work. Try again."));
      return false;
    }
    await refresh();
    return true;
  }

  return (
    <div className="cp" role="region" aria-label="The card">
      <div className="cp-head">
        <p className="cp-where">
          Round {round.number}, {round.course_name}
        </p>
        <h2 className="cp-title">{title}</h2>
        <p className="cp-result">{result}</p>
        <p className={`cp-stage ${info.stage}`}>{cardLabel(info, names)}</p>
      </div>

      <div className="cp-card">
        <Scorecard round={round} gameIndex={gi} badge={false} compact />
      </div>

      {info.flag && info.stage === "submitted" && (
        <div className="cp-flag" role="alert">
          <strong>{info.flag.by} says something&apos;s not right</strong>
          {info.flag.note && <span>&ldquo;{info.flag.note}&rdquo;</span>}
        </div>
      )}

      {info.stage === "submitted" && (
        <div className="cp-signers">
          {info.players.map((pid) => {
            const done = info.signed.includes(pid);
            return (
              <div className={`cp-signer${done ? " done" : ""}`} key={pid}>
                <span className="cp-signer-name">{names[pid] ?? pid}</span>
                {done ? (
                  <span className="cp-signed">✓ Signed</span>
                ) : (
                  <button className="btn" onClick={() => setSigner(pid)}>
                    Sign
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {err && <p className="error cp-err">{err}</p>}

      <div className="cp-foot">
        {info.stage === "finished" && scorer && (
          <button className="btn block cp-main" disabled={busy} onClick={() => setConfirming(true)}>
            Submit the card
          </button>
        )}
        {info.stage === "submitted" && org && (
          <button className="btn secondary block" disabled={busy} onClick={() => act("finalise")}>
            Make it final without every signature
          </button>
        )}
        {info.stage === "submitted" && scorer && (
          <button
            className="btn secondary block"
            disabled={busy}
            onClick={async () => {
              if (await act("reopen")) onBack?.();
            }}
          >
            {info.flag ? "Fix the card" : "Take the card back to change it"}
          </button>
        )}
        {info.stage === "final" && org && (
          <button
            className="btn secondary block"
            disabled={busy}
            onClick={async () => {
              if (confirm("Reopen this card? It stops being final until it's submitted again. The change is logged.")) await act("reopen");
            }}
          >
            Reopen the card
          </button>
        )}
        {onBack && info.stage === "finished" && (
          <button className="btn secondary block" onClick={onBack}>
            {backLabel}
          </button>
        )}
        {onDone && (info.stage === "final" || !scorer) && (
          <button className={`btn block${info.stage === "final" ? " cp-main" : " secondary"}`} onClick={onDone}>
            Done
          </button>
        )}
      </div>

      {confirming && (
        <Sheet label="Submit the card?" onClose={() => setConfirming(false)}>
          <div className="sf-menu">
            <p>
              {info.needsSignatures
                ? "Every player then signs it. Once they have, the scores are final and only the organiser can change them."
                : "The scores become final. After this, only the organiser can change them."}
            </p>
            <button
              className="btn block"
              disabled={busy}
              onClick={async () => {
                if (await act("submit")) setConfirming(false);
              }}
            >
              {busy ? "Submitting…" : "Submit the card"}
            </button>
            <button className="btn secondary block" onClick={() => setConfirming(false)}>
              Not yet
            </button>
          </div>
        </Sheet>
      )}

      {signer && (
        <SignSheet
          playerId={signer}
          name={names[signer] ?? signer}
          own={session?.playerId === signer}
          onClose={() => setSigner(null)}
          onSign={async () => {
            const ok = await act("sign", { playerId: signer });
            if (ok) setSigner(null);
            return ok;
          }}
          onFlag={async (note) => {
            const ok = await act("flag", { playerId: signer, note });
            if (ok) setSigner(null);
            return ok;
          }}
          busy={busy}
          err={err}
        />
      )}
    </div>
  );
}

/** One player signs: on their own phone, or on the scorer's, with a tap. Or says something's wrong. */
function SignSheet({
  name,
  own,
  onClose,
  onSign,
  onFlag,
  busy,
  err,
}: {
  playerId: string;
  name: string;
  own: boolean;
  onClose: () => void;
  onSign: () => Promise<boolean>;
  onFlag: (note: string) => Promise<boolean>;
  busy: boolean;
  err: string | null;
}) {
  const [wrong, setWrong] = useState(false);
  const [note, setNote] = useState("");
  const first = name.split(" ")[0];
  return (
    <Sheet label={wrong ? "Something's not right" : own ? "Sign your card" : `${first} signs the card`} onClose={onClose}>
      <div className="sf-menu cp-sign">
        {wrong ? (
          <>
            <label className="sf-field">
              <span>What&apos;s wrong? The scorer will see this</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={3} placeholder="e.g. I had a 5 on the 7th" />
            </label>
            {err && <p className="error">{err}</p>}
            <button className="btn block" disabled={busy} onClick={() => onFlag(note)}>
              Tell the scorer
            </button>
            <button className="btn secondary block" onClick={() => setWrong(false)}>
              Back
            </button>
          </>
        ) : (
          <>
            <p>{own ? "Signing says your card is right. Once everyone has signed, it's final." : `${first} agrees this card is right. Once everyone has signed, it's final.`}</p>
            {err && <p className="error">{err}</p>}
            <button className="btn block cp-main" disabled={busy} onClick={() => onSign()}>
              {busy ? "Signing…" : own ? "I agree with this card" : `Sign for ${first}`}
            </button>
            <button className="btn secondary block" onClick={() => setWrong(true)}>
              Something&apos;s not right
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}
