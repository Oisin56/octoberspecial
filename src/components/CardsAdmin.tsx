"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "./Providers";
import { timeAgo } from "./ui";
import { cardInfo, cardLabel } from "@/lib/scorecards";
import { sideLabel, toRoundCfg } from "@/lib/types";
import type { AdminData } from "./editors";

interface Change {
  id: string;
  round_id: string;
  game: string;
  hole: number | null;
  action: string;
  before: unknown;
  after: unknown;
  by_name: string | null;
  at: string;
}

/** The organiser's view of every card: the signing rule, where each card stands, and every change made to a final card. */
export function CardsAdmin({ data, onSaved }: { data: AdminData; onSaved: () => void }) {
  const { api, names, href } = useT();
  const st = data.state;
  const [need, setNeed] = useState(!!st.tournament.require_attestation);
  const [one, setOne] = useState(!!st.tournament.one_scorer);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [changes, setChanges] = useState<Change[] | null>(null);

  useEffect(() => {
    api("/api/admin", { action: "scoreChanges" }).then((r) => setChanges((r.j.changes as Change[]) ?? []));
  }, [api, data]);

  async function setRule(v: boolean) {
    setNeed(v);
    const r = await api("/api/admin", { action: "updateTournament", patch: { require_attestation: v } });
    setMsg(r.ok ? (v ? "Saved: players sign before a card is final" : "Saved: a card is final when it's submitted") : String(r.j.error ?? "Didn't save"));
    onSaved();
  }
  async function setOneScorer(v: boolean) {
    setOne(v);
    const r = await api("/api/admin", { action: "updateTournament", patch: { one_scorer: v } });
    setMsg(r.ok ? (v ? "Saved: only each group's scorer enters its scores. Choose them in Rounds" : "Saved: anyone in a group can enter its scores") : String(r.j.error ?? "Didn't save"));
    onSaved();
  }
  async function act(action: string, roundId: string, game: string, label: string) {
    if (action === "reopen" && !confirm("Reopen this card? It stops being final until it's submitted again. This is logged.")) return;
    setBusy(`${roundId}:${game}`);
    const r = await api("/api/cards", { action, roundId, game });
    setBusy(null);
    setMsg(r.ok ? label : String(r.j.error ?? "That didn't work"));
    onSaved();
  }

  const rounds = [...st.rounds].sort((a, b) => a.number - b.number).filter((r) => r.status !== "upcoming");
  const roundNo = (id: string) => st.rounds.find((r) => r.id === id)?.number ?? "?";

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Scoring and the cards</h2>
        <button type="button" className="cd-film-only" role="switch" aria-checked={one} onClick={() => setOneScorer(!one)}>
          <span className="box" aria-hidden="true">
            {one ? "✓" : ""}
          </span>
          <span>
            <strong>One scorer per group</strong>
            <small>{one ? "Only the scorer you choose for each group (in Rounds) can enter its scores. Good for a competitive trip." : "Off: anyone in a group can enter its scores, so a flat battery on the 9th never stops the card."}</small>
          </span>
        </button>
        <button type="button" className="cd-film-only" role="switch" aria-checked={need} onClick={() => setRule(!need)}>
          <span className="box" aria-hidden="true">
            {need ? "✓" : ""}
          </span>
          <span>
            <strong>Every player signs the card before it&apos;s final</strong>
            <small>{need ? "The card is handed in, then each player in the match signs it (with a tap on a phone in the group, or on their own)." : "Off: a card is final as soon as it's handed in. Each player still gets a quick check of their own card."}</small>
          </span>
        </button>
        <p className="small muted" style={{ margin: 0 }}>
          You can change this at any time. It only affects cards that aren&apos;t final yet.
        </p>
        {msg && <p className="notice">{msg}</p>}
      </section>

      {rounds.length === 0 && <p className="muted">No rounds have started yet.</p>}
      {rounds.map((round) => {
        const cfg = toRoundCfg(round, st.players);
        return (
          <section key={round.id} className="panel stack">
            <h2 style={{ margin: 0 }}>
              Round {round.number}, {round.course_name}
            </h2>
            {cfg.games.map((g, gi) => {
              const info = cardInfo(st, round.id, g.id);
              const k = `${round.id}:${g.id}`;
              return (
                <div key={g.id} className="ca-card">
                  <div className="ca-what">
                    <strong>{cfg.games.length > 1 ? `${g.name ?? `Match ${gi + 1}`}: ` : ""}{g.sides.map((s) => sideLabel(s.id, g, st.players)).join(" v ")}</strong>
                    <span className={`card-stage ${info.stage}`}>{cardLabel(info, names)}</span>
                    {info.flag && <span className="error">&ldquo;{info.flag.note || "No details given"}&rdquo;</span>}
                  </div>
                  <div className="row">
                    <Link className="chip" href={href(`/card?round=${round.number}&game=${encodeURIComponent(g.id)}`)}>
                      See the card
                    </Link>
                    <Link className="chip" href={href(`/score?round=${round.number}&game=${encodeURIComponent(g.id)}&correct=1`)}>
                      Correct a score
                    </Link>
                    {(info.stage === "finished" || info.stage === "submitted") && (
                      <button className="chip" disabled={busy === k} onClick={() => act("finalise", round.id, g.id, "Card made final")}>
                        Make it final now
                      </button>
                    )}
                    {info.stage === "final" && (
                      <button className="chip" disabled={busy === k} onClick={() => act("reopen", round.id, g.id, "Card reopened")}>
                        Reopen
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Score corrections</h2>
        {changes == null ? (
          <p className="muted">Loading…</p>
        ) : changes.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            None. Every score you correct, and every change to a final card, is listed here.
          </p>
        ) : (
          changes.map((c) => (
            <div key={c.id} className="ca-change">
              <strong>
                Round {roundNo(c.round_id)}
                {c.hole ? `, hole ${c.hole}` : ""}: {c.action}
              </strong>
              <span className="small muted">
                {c.by_name ?? "Someone"}, {timeAgo(c.at)}
              </span>
              {c.hole != null && <span className="small">{describe(c.before, names)} → {describe(c.after, names)}</span>}
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function describe(v: unknown, names: Record<string, string>): string {
  const x = v as { scores?: Record<string, { gross: number | null; pickedUp?: boolean }>; conceded?: string | null } | null;
  if (!x?.scores) return "nothing";
  const parts = Object.entries(x.scores).map(([id, sc]) => `${names[id] ?? id} ${sc.pickedUp ? "P" : (sc.gross ?? "–")}`);
  if (x.conceded) parts.push(`${names[x.conceded] ?? x.conceded} conceded`);
  return parts.join(", ");
}
