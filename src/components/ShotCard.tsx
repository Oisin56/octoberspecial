"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useT } from "./Providers";
import { HoldToTalk } from "./HoldToTalk";
import { useSwipe } from "@/lib/useSwipe";
import { CLUB_GROUPS, DISTANCES, KIND_LABEL, clubWorthAsking, kindsFor, nextKind, outcomesFor, shotLine, type HoleInfo, type Prompt, type ShotKind } from "@/lib/shots";
import { deleteShot, flushShots, mergeShots, saveShot } from "@/lib/shotQueue";
import { flushPosts, queuePost } from "@/lib/postQueue";
import type { PlayerRow, ShotRow } from "@/lib/types";

const LAST_PLAYER = (slug: string) => `mgs_shot_player_${slug}`;

/**
 * The shot log for one hole: pick a player (it stays picked), the kind of shot (the likely next one is chosen),
 * and how it finished. Each outcome tap saves the shot. Questions from the scores come first where they apply.
 */
export function ShotCard({
  roundId,
  roundNumber,
  hole,
  holeInfo,
  players,
  prompts = [],
  headline,
  nextLabel,
  backLabel,
  onContinue,
  onBack,
  onLeave,
}: {
  roundId: string;
  roundNumber: number;
  hole: number;
  holeInfo: HoleInfo;
  players: PlayerRow[];
  prompts?: Prompt[];
  /** A big match moment ("Neil goes dormie") */
  headline?: { text: string; playerId: string } | null;
  nextLabel: string;
  backLabel?: string;
  onContinue: () => void;
  onBack: () => void;
  /** Leaving for the camera */
  onLeave?: () => void;
}) {
  const { state, session, slug, href, refresh } = useT();
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    window.addEventListener("mgs-shots", on);
    return () => window.removeEventListener("mgs-shots", on);
  }, []);
  const all = mergeShots(state?.shots, slug, state?.tournament.id ?? "");
  const onHole = all.filter((s) => s.round_id === roundId && s.hole === hole);

  // Who: a question from the scores picks the player; otherwise whoever was picked last
  const [who, setWho] = useState<string>(() => {
    // a question nobody has answered yet comes first; otherwise stay with the player picked last
    const ask = prompts.find((p) => !onHole.some((x) => x.player_id === p.playerId))?.playerId ?? (headline && !onHole.some((x) => x.player_id === headline.playerId) ? headline.playerId : null);
    if (ask && players.some((p) => p.id === ask)) return ask;
    try {
      const last = localStorage.getItem(LAST_PLAYER(slug));
      if (last && players.some((p) => p.id === last)) return last;
    } catch {}
    return players[0]?.id ?? "";
  });
  useEffect(() => {
    try {
      localStorage.setItem(LAST_PLAYER(slug), who);
    } catch {}
  }, [slug, who]);

  const mine = onHole.filter((s) => s.player_id === who);
  const [kind, setKind] = useState<ShotKind | null>(() => nextKind(mine, holeInfo));
  /** After a shot worth asking about: "What did Neil hit?" */
  const [askClub, setAskClub] = useState<ShotRow | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? state?.players.find((p) => p.id === id)?.name ?? id;
  const [dismissed, setDismissed] = useState<string[]>([]);
  const prompt = prompts.find((p) => p.playerId === who && !mine.length && !dismissed.includes(who)) ?? null;
  const kinds = kindsFor(holeInfo);

  const sendSoon = () => {
    if (sendTimer.current) clearTimeout(sendTimer.current);
    sendTimer.current = setTimeout(() => flushShots(slug).then(() => refresh()), 600);
  };

  function pick(id: string) {
    setWho(id);
    setAskClub(null);
    setSaid(null);
    const theirs = onHole.filter((s) => s.player_id === id);
    setKind(nextKind(theirs, holeInfo));
  }

  function log(k: ShotKind, outcome: string) {
    const clientId = crypto.randomUUID();
    const loggedAt = new Date().toISOString();
    const data = { roundId, hole, playerId: who, kind: k, outcome, club: k === "putt" ? "Putter" : null, distance: null, loggedAt, author: session?.name ?? "" };
    saveShot(slug, clientId, data);
    sendSoon();
    const row: ShotRow = { id: `local-${clientId}`, tournament_id: "", round_id: roundId, hole, player_id: who, kind: k, outcome, club: data.club, distance: null, author_name: data.author, client_id: clientId, logged_at: loggedAt };
    setAskClub(clubWorthAsking(k, outcome) ? row : null);
    setKind(nextKind([...mine, row], holeInfo));
  }

  function addDetail(s: ShotRow, d: { club?: string | null; distance?: string | null }) {
    saveShot(slug, s.client_id, { roundId, hole, playerId: s.player_id, kind: s.kind, outcome: s.outcome, club: d.club !== undefined ? d.club : s.club, distance: d.distance !== undefined ? d.distance : s.distance, loggedAt: s.logged_at, author: s.author_name });
    sendSoon();
    const next = { ...s, ...d };
    // Approaches also take a distance; otherwise one answer is enough
    if (s.kind === "approach" && !next.distance) setAskClub(next as ShotRow);
    else setAskClub(null);
  }

  function undo() {
    const last = mine[mine.length - 1];
    if (!last) return;
    deleteShot(slug, last.client_id, !last.id.startsWith("local-"));
    sendSoon();
    setAskClub(null);
    setKind(nextKind(mine.slice(0, -1), holeInfo));
  }

  function voice(text: string) {
    queuePost(slug, { roundId, hole, kind: "note", body: `${name(who)}: ${text}`, tags: [], playerIds: [who] });
    flushPosts(slug);
    setSaid(text);
  }

  const swipe = useSwipe({ onLeft: onContinue, onRight: onBack });
  const lastMine = mine[mine.length - 1];
  const holedOut = !!lastMine && /^Holed/.test(lastMine.outcome);
  const badge = (id: string) => prompts.find((p) => p.playerId === id)?.badge;
  const count = (id: string) => onHole.filter((s) => s.player_id === id).length;
  const others = onHole.filter((s) => s.player_id !== who);
  const cols = players.length <= 2 ? 2 : players.length === 3 ? 3 : 4;

  return (
    <div className="shotcard" role="dialog" aria-label={`Hole ${hole} shots`} {...swipe}>
      <div className="sc-head">
        <strong>Hole {hole}</strong>
        <span>
          Par {holeInfo.par}
          {holeInfo.yards ? ` · ${holeInfo.yards} yds` : ""}
        </span>
        {headline && <em className="sc-headline">{headline.text}</em>}
      </div>

      <div className="sc-players" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }} role="tablist">
        {players.map((p) => (
          <button key={p.id} role="tab" className="sc-player" aria-selected={who === p.id} onClick={() => pick(p.id)}>
            <span className="nm">{p.name}</span>
            <span className="meta">
              {badge(p.id) && <b>{badge(p.id)}</b>}
              {count(p.id) ? `${count(p.id)} shot${count(p.id) > 1 ? "s" : ""}` : ""}
            </span>
          </button>
        ))}
      </div>

      {prompt ? (
        <div className="sc-main">
          <p className="sc-q">{prompt.question}</p>
          <div className="sc-grid">
            {prompt.answers.map((a) => (
              <button key={a.label} className="sc-tile" onClick={() => log(a.kind, a.outcome)}>
                {a.label}
              </button>
            ))}
          </div>
          <button className="sc-skip" onClick={() => setDismissed((d) => [...d, who])}>
            Log it shot by shot instead
          </button>
        </div>
      ) : askClub ? (
        <div className="sc-main">
          <p className="sc-q">
            {askClub.kind === "approach" && askClub.club ? `From how far?` : `What did ${name(askClub.player_id)} hit?`} <span>(if you know)</span>
          </p>
          {askClub.kind === "approach" && askClub.club ? (
            <div className="sc-grid two-rows">
              {DISTANCES.map((d) => (
                <button key={d} className="sc-tile" onClick={() => addDetail(askClub, { distance: d })}>
                  {d} yds
                </button>
              ))}
            </div>
          ) : (
            <div className="sc-grid">
              {CLUB_GROUPS.map((c) => (
                <button key={c} className="sc-tile" onClick={() => addDetail(askClub, { club: c })}>
                  {c}
                </button>
              ))}
            </div>
          )}
          <button className="sc-skip" onClick={() => setAskClub(null)}>
            Skip
          </button>
        </div>
      ) : (
        <div className="sc-main">
          <div className="sc-kinds" style={{ gridTemplateColumns: `repeat(${Math.ceil(kinds.length / 2)}, 1fr)` }}>
            {kinds.map((k) => (
              <button key={k} className="sc-kind" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          {kind ? (
            <div className="sc-grid">
              {outcomesFor(kind, holeInfo).map((o) => (
                <button key={o} className="sc-tile" onClick={() => log(kind, o)}>
                  {o}
                </button>
              ))}
            </div>
          ) : (
            <p className="sc-done">{holedOut ? `${name(who)} has holed out.` : "Pick a shot above."} Tap a shot to add another.</p>
          )}
        </div>
      )}

      <div className="sc-log" aria-live="polite">
        {mine.length ? (
          <>
            <span className="txt">
              {name(who)}: {mine.map((s) => shotLine(s)).join(" → ")}
              {mine.some((s) => s.author_name && s.author_name !== session?.name) ? ` (also logged by ${[...new Set(mine.filter((s) => s.author_name !== session?.name).map((s) => s.author_name))].join(", ")})` : ""}
            </span>
            <button className="sc-undo" onClick={undo}>
              Undo
            </button>
          </>
        ) : (
          <span className="txt muted">
            {others.length ? `Logged so far: ${[...new Set(others.map((s) => name(s.player_id)))].join(", ")}` : `Nothing logged for ${name(who)} on this hole yet.`}
          </span>
        )}
        {said && <span className="txt said">Saved: &ldquo;{said}&rdquo;</span>}
      </div>

      <div className="sc-foot">
        <Link className="sc-act" aria-label="Record a clip" href={href(`/record?round=${roundNumber}&hole=${hole}&player=${who}${lastMine ? `&shot=${lastMine.client_id}` : ""}`)} onClick={() => onLeave?.()}>
          <span className="dot" aria-hidden="true" />
          Clip
        </Link>
        <HoldToTalk compact onText={voice} />
        <button className="btn sc-next" onClick={onContinue}>
          {nextLabel} ›<small>or swipe{backLabel ? ` · ${backLabel}` : ""}</small>
        </button>
      </div>
    </div>
  );
}
