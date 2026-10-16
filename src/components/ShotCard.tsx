"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useT } from "./Providers";
import { HoldToTalk } from "./HoldToTalk";
import { useSwipe } from "@/lib/useSwipe";
import {
  CLOSE_THEN_TAP,
  CLUB_GROUPS,
  KIND_LABEL,
  MORE_WORDS,
  clubWorthAsking,
  kindFromDistance,
  kindsFor,
  nextKind,
  outcomesFor,
  type HoleInfo,
  type Prompt,
  type ShotKind,
} from "@/lib/shots";
import { deleteShot, flushShots, mergeShots, saveShot } from "@/lib/shotQueue";
import { flushGps, mergeGps, placeReading } from "@/lib/gpsQueue";
import { flushPosts, queuePost } from "@/lib/postQueue";
import { strokeRows, type StrokeRow } from "@/lib/strokes";
import { inUnits, unitWord } from "@/lib/gps";
import { toRoundCfg, type PlayerRow, type ShotRow } from "@/lib/types";

const LAST_PLAYER = (slug: string) => `mgs_shot_player_${slug}`;

/**
 * What happened on a hole: each player's strokes in order. The app fills in what it knows (the tee shot, distances
 * from GPS readings, the holed last stroke, clips) and everything is saved as it is; tap any stroke to say what
 * happened, or leave it. While the hole is being played, the next stroke is open, ready to log.
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
  const { state, session, slug, href, refresh, sample } = useT();
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    window.addEventListener("mgs-shots", on);
    window.addEventListener("mgs-gps", on);
    return () => {
      window.removeEventListener("mgs-shots", on);
      window.removeEventListener("mgs-gps", on);
    };
  }, []);
  const all = mergeShots(state?.shots, slug, state?.tournament.id ?? "");
  const onHole = all.filter((s) => s.round_id === roundId && s.hole === hole);
  const readings = mergeGps(state?.gps, slug).filter((r) => r.round_id === roundId && r.hole === hole);
  const round = state?.rounds.find((r) => r.id === roundId) ?? null;
  const cfg = useMemo(() => (round && state ? toRoundCfg(round, state.players) : null), [round, state]);

  const [units, setUnits] = useState<"yards" | "metres">("yards");
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const u = localStorage.getItem("mgs-units");
        setUnits(u === "metres" || u === "yards" ? u : state?.tournament.units === "metres" ? "metres" : "yards");
      } catch {}
    }, 0);
    return () => clearTimeout(t);
  }, [state?.tournament.units]);

  // Who: a question from the scores picks the player; otherwise whoever was picked last
  const [who, setWho] = useState<string>(() => {
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

  const name = (id: string) => players.find((p) => p.id === id)?.name ?? state?.players.find((p) => p.id === id)?.name ?? id;

  /** The player's score on the hole (his own ball, or his side's in a one-ball format) */
  const grossOf = (pid: string): number | null => {
    if (!cfg || !state) return null;
    for (const e of state.entries.filter((x) => x.round_id === roundId && x.hole === hole)) {
      const g = cfg.games.find((x) => x.id === (e.game ?? "main"));
      const side = g?.sides.find((s) => s.playerIds.includes(pid));
      const b = e.scores[pid] ?? (side ? e.scores[side.id] : undefined);
      if (b?.gross != null && !b.pickedUp) return b.gross;
    }
    return null;
  };
  const rowsFor = (pid: string) =>
    strokeRows({
      shots: onHole.filter((s) => s.player_id === pid),
      readings: readings.filter((r) => r.player_id === pid),
      gross: grossOf(pid),
      holeYards: holeInfo.yards ?? null,
      clips: (state?.posts ?? []).filter((p) => p.kind === "video" && p.round_id === roundId && p.hole === hole),
    });
  const rows = rowsFor(who);
  const gross = grossOf(who);

  /** Whoever logged a shot owns it; the player and his scorer can change any of his; the organiser can change anything */
  const scorerOf = (pid: string) => cfg?.games.find((g) => g.sides.some((s) => s.playerIds.includes(pid)))?.scorerId ?? round?.scorer_id ?? null;
  const mayEdit = (s: ShotRow | null, pid = who) => {
    if (!session) return false;
    if (session.role === "organiser" || session.playerId === pid || (session.playerId && scorerOf(pid) === session.playerId)) return true;
    if (!s) return true; // anyone in the group can add
    return (!!session.playerId && s.author_player_id === session.playerId) || (!s.author_player_id && s.author_name === session.name);
  };

  // The stroke being told about: while the hole's being played, the next one; afterwards, none until tapped
  const firstOpen = gross == null ? (rows[rows.length - 1]?.shot ? null : rows[rows.length - 1]?.seq ?? null) : null;
  const [openSeq, setOpenSeq] = useState<number | null>(firstOpen);
  const [kind, setKind] = useState<ShotKind | null>(null);
  const [more, setMore] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const [askClub, setAskClub] = useState<ShotRow | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prompt = prompts.find((p) => p.playerId === who && !onHole.some((s) => s.player_id === who) && !dismissed.includes(who)) ?? null;

  const sendSoon = () => {
    if (sendTimer.current) clearTimeout(sendTimer.current);
    sendTimer.current = setTimeout(() => Promise.all([flushShots(slug), flushGps(slug)]).then(() => refresh()), 600);
  };

  const guessKind = (r: StrokeRow | undefined): ShotKind | null => {
    if (!r) return null;
    if (r.shot) return r.shot.kind as ShotKind;
    if (r.auto && !r.auto.outcome) return r.auto.kind as ShotKind;
    const byDistance = kindFromDistance(r.from, r.seq, holeInfo.par);
    if (byDistance) return byDistance;
    // What usually follows the shot before it, when that one was logged
    const prev = rows.find((x) => x.seq === r.seq - 1)?.shot;
    if (prev) return nextKind(rows.filter((x) => x.seq < r.seq && x.shot).map((x) => x.shot!), holeInfo) ?? "approach";
    if (r.seq === 2) return holeInfo.par >= 5 ? "second" : holeInfo.par === 3 ? "chip" : "approach";
    return "approach";
  };

  function openRow(seq: number | null) {
    setOpenSeq(seq);
    setMore(false);
    setMoving(null);
    setAskClub(null);
    setKind(seq == null ? null : guessKind(rows.find((r) => r.seq === seq)));
  }
  // First open on mount
  useEffect(() => {
    if (firstOpen != null) setKind(guessKind(rows.find((r) => r.seq === firstOpen)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pick(id: string) {
    setWho(id);
    setSaid(null);
    const rs = rowsFor(id);
    const open = grossOf(id) == null && !rs[rs.length - 1]?.shot ? rs[rs.length - 1]?.seq ?? null : null;
    setOpenSeq(open);
    setMore(false);
    setMoving(null);
    setAskClub(null);
    setKind(open == null ? null : (rs[rs.length - 1]?.auto?.kind as ShotKind) ?? (open === 1 ? "tee" : null));
  }

  /** Save what happened on a stroke (a new shot, or a change to the one there) */
  function log(seq: number, k: ShotKind, outcome: string, pid = who) {
    const row = rowsFor(pid).find((r) => r.seq === seq);
    const existing = row?.shot ?? null;
    if (existing && !mayEdit(existing, pid)) return;
    const clientId = existing?.client_id ?? crypto.randomUUID();
    const loggedAt = existing?.logged_at ?? new Date().toISOString();
    const club = k === "putt" ? "Putter" : existing && existing.kind === k ? existing.club : null;
    const data = { roundId, hole, playerId: pid, kind: k, outcome, club, distance: null, seq, loggedAt, author: existing?.author_name ?? session?.name ?? "", authorPlayerId: existing ? existing.author_player_id : (session?.playerId ?? null) };
    saveShot(slug, clientId, data);
    sendSoon();
    const shot: ShotRow = { id: existing?.id ?? `local-${clientId}`, tournament_id: "", round_id: roundId, hole, player_id: pid, kind: k, outcome, club, distance: null, seq, author_name: data.author, author_player_id: data.authorPlayerId, client_id: clientId, logged_at: loggedAt };
    setMore(false);
    // Worth knowing the club? Ask once (skippable); otherwise on to the next stroke while the hole's being played
    if (clubWorthAsking(k, outcome) && !club) {
      setAskClub(shot);
      return;
    }
    advance(seq, pid, outcome, k);
  }

  /** On to the next stroke that's still to tell (while the hole's being played, the next one to log) */
  function advance(seq: number, pid = who, outcome = "", loggedKind?: string) {
    setAskClub(null);
    const g = grossOf(pid);
    const holedNow = /^Holed/.test(outcome);
    const nextRow = rowsFor(pid).find((r) => r.seq === seq + 1);
    const more = g == null ? !holedNow : !!nextRow && !nextRow.shot && !nextRow.auto?.outcome;
    if (!more) return openRow(null);
    setOpenSeq(seq + 1);
    setMore(false);
    setMoving(null);
    setKind(null);
    // the next kind follows from what's been logged (and where it was played from)
    const rs = rowsFor(pid);
    const before = rs
      .filter((r) => r.seq < seq && r.shot)
      .map((r) => r.shot!)
      .concat(loggedKind ? [{ kind: loggedKind, outcome } as ShotRow] : rs.filter((r) => r.seq === seq && r.shot).map((r) => r.shot!));
    setKind(kindFromDistance(nextRow?.from ?? null, seq + 1, holeInfo.par) ?? nextKind(before, holeInfo) ?? "approach");
  }

  function closeThenTap(seq: number) {
    log(seq, "putt", "Close");
    log(seq + 1, "putt", "Holed, tap-in");
    openRow(null);
  }

  function clear(r: StrokeRow) {
    if (!r.shot || !mayEdit(r.shot)) return;
    deleteShot(slug, r.shot.client_id, !r.shot.id.startsWith("local-"));
    sendSoon();
    openRow(null);
  }

  function addClub(s: ShotRow, club: string) {
    saveShot(slug, s.client_id, { roundId, hole, playerId: s.player_id, kind: s.kind, outcome: s.outcome, club, distance: s.distance, seq: s.seq ?? null, loggedAt: s.logged_at, author: s.author_name, authorPlayerId: s.author_player_id ?? null });
    sendSoon();
    advance(s.seq ?? 0, s.player_id, s.outcome, s.kind);
  }

  function moveReading(clientId: string, seq: number | null) {
    placeReading(slug, clientId, seq == null ? { seq: null, ignored: true } : { seq, ignored: false });
    sendSoon();
    setMoving(null);
  }

  /** A question from the scores: the answer goes on the stroke it describes */
  function answer(a: Prompt["answers"][number]) {
    const n = gross ?? rows.length;
    const empty = rows.filter((r) => !r.shot && r.seq > 1 && r.seq < n).map((r) => r.seq);
    const seq = /^Holed/.test(a.outcome) ? n : a.kind === "tee" ? 1 : a.kind === "approach" && a.outcome === "Stiff" ? Math.max(1, n - 1) : (empty[0] ?? Math.max(1, n - 1));
    log(seq, a.kind, a.outcome);
    if (a.kind === "approach" && a.outcome === "Stiff" && n >= 2) log(n, "putt", "Holed, tap-in");
    openRow(null);
  }

  function voice(text: string) {
    queuePost(slug, { roundId, hole, kind: "note", body: `${name(who)}: ${text}`, tags: [], playerIds: [who] });
    flushPosts(slug);
    setSaid(text);
  }

  const swipe = useSwipe({ onLeft: onContinue, onRight: onBack });
  const badge = (id: string) => prompts.find((p) => p.playerId === id)?.badge;
  const count = (id: string) => onHole.filter((s) => s.player_id === id).length;
  const cols = players.length <= 2 ? 2 : players.length === 3 ? 3 : 4;
  const lastShot = [...rows].reverse().find((r) => r.shot)?.shot ?? null;
  const dist = (y: number) => `${inUnits(y, units)} ${unitWord(units, true)}`;
  const kinds: ShotKind[] = [...kindsFor(holeInfo), "penalty"];

  const label = (r: StrokeRow) => {
    if (r.shot) return `${KIND_LABEL[r.shot.kind as ShotKind] ?? r.shot.kind}: ${r.shot.outcome.toLowerCase()}${r.shot.club && r.shot.kind !== "putt" ? ` (${r.shot.club.toLowerCase()})` : ""}`;
    if (r.auto) return r.auto.outcome ?? KIND_LABEL[r.auto.kind as ShotKind];
    return "";
  };

  return (
    <div className="shotcard" role="dialog" aria-label={`Hole ${hole}: what happened`} {...swipe}>
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
              {grossOf(p.id) != null ? `${grossOf(p.id)} strokes` : count(p.id) ? `${count(p.id)} logged` : ""}
            </span>
          </button>
        ))}
      </div>

      <div className="sc-strokes">
        {prompt && (
          <div className="sc-prompt">
            <p className="sc-q">{prompt.question}</p>
            <div className="sc-grid">
              {prompt.answers.map((a) => (
                <button key={a.label} className="sc-tile" onClick={() => answer(a)}>
                  {a.label}
                </button>
              ))}
            </div>
            <button className="sc-skip" onClick={() => setDismissed((d) => [...d, who])}>
              Not now
            </button>
          </div>
        )}
        {!prompt && gross != null && <p className="sc-hint">Tap any shot to say what happened. {sample ? "In the sample, nothing is saved." : "Everything here is saved as it is."}</p>}

        <ol className="sc-rows">
          {rows.map((r) => {
            const open = openSeq === r.seq;
            const editable = mayEdit(r.shot);
            return (
              <li key={r.seq} className={`sc-row${open ? " open" : ""}${r.shot ? " logged" : ""}`}>
                <button className="sc-row-main" onClick={() => (open ? openRow(null) : editable ? openRow(r.seq) : undefined)} aria-expanded={open} disabled={!editable && !open}>
                  <span className="sc-seq">{r.seq}</span>
                  <span className="sc-what">
                    {label(r) || <span className="muted">{open ? "What happened?" : ""}</span>}
                    {r.shot && r.shot.author_name && r.shot.author_name !== session?.name && <small className="sc-by">by {r.shot.author_name}</small>}
                  </span>
                  {r.clip && <span className="sc-cam" aria-label="Filmed" title="Filmed">🎥</span>}
                  {!editable && <span className="sc-lock" aria-label="Logged by someone else">🔒</span>}
                </button>
                {(r.from != null || r.drive != null) && (
                  <button className="sc-dist" onClick={() => r.reading && setMoving(moving === r.reading.client_id ? null : r.reading.client_id)} disabled={!r.reading || !editable}>
                    {r.drive != null ? `about ${dist(r.drive)}` : `from ${dist(r.from!)}`}
                  </button>
                )}
                {moving && r.reading && moving === r.reading.client_id && (
                  <div className="sc-move">
                    <span>Measured for which shot?</span>
                    <div className="sc-move-tiles">
                      {rows.map((x) => (
                        <button key={x.seq} className="pick-tile" aria-pressed={x.seq === r.seq} onClick={() => moveReading(r.reading!.client_id, x.seq)}>
                          {x.seq}
                        </button>
                      ))}
                      <button className="pick-tile wide" onClick={() => moveReading(r.reading!.client_id, null)}>
                        Take it off
                      </button>
                    </div>
                  </div>
                )}
                {open && (
                  <div className="sc-edit">
                    {askClub && askClub.seq === r.seq ? (
                      <>
                        <p className="sc-q">
                          What did {name(askClub.player_id)} hit? <span>(if you know)</span>
                        </p>
                        <div className="sc-grid">
                          {CLUB_GROUPS.map((c) => (
                            <button key={c} className="sc-tile" onClick={() => addClub(askClub, c)}>
                              {c}
                            </button>
                          ))}
                        </div>
                        <button className="sc-skip" onClick={() => advance(askClub.seq ?? r.seq, askClub.player_id, askClub.outcome, askClub.kind)}>
                          Skip
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="sc-kinds" style={{ gridTemplateColumns: `repeat(${Math.ceil(kinds.length / 2)}, 1fr)` }}>
                          {kinds.map((k) => (
                            <button key={k} className="sc-kind" aria-pressed={kind === k} onClick={() => (setKind(k), setMore(false))}>
                              {KIND_LABEL[k]}
                            </button>
                          ))}
                        </div>
                        {kind === "penalty" ? (
                          <div className="sc-grid">
                            <button className="sc-tile" onClick={() => log(r.seq, "penalty", "Penalty stroke")}>
                              Penalty stroke
                            </button>
                          </div>
                        ) : more && kind ? (
                          <div className="sc-more">
                            {MORE_WORDS.map((g) => (
                              <div key={g.group} className="sc-more-g">
                                <span>{g.group}</span>
                                <div className="sc-more-w">
                                  {g.words.map((w) => (
                                    <button key={w} className="sc-tile small" onClick={() => log(r.seq, kind, w)}>
                                      {w}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                            <button className="sc-skip" onClick={() => setMore(false)}>
                              Back
                            </button>
                          </div>
                        ) : kind ? (
                          <div className="sc-grid">
                            {outcomesFor(kind, holeInfo).map((o) => (
                              <button key={o} className="sc-tile" onClick={() => log(r.seq, kind, o)}>
                                {o}
                              </button>
                            ))}
                            {kind === "putt" && (
                              <button className="sc-tile" onClick={() => closeThenTap(r.seq)}>
                                {CLOSE_THEN_TAP}
                              </button>
                            )}
                            <button className="sc-tile more" onClick={() => setMore(true)}>
                              More…
                            </button>
                          </div>
                        ) : (
                          <p className="sc-done">Pick the kind of shot.</p>
                        )}
                        {r.shot && (
                          <button className="sc-skip" onClick={() => clear(r)}>
                            Clear this shot
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {said && <p className="sc-said">Saved: &ldquo;{said}&rdquo;</p>}
      </div>

      <div className="sc-foot">
        <Link
          className="sc-act"
          aria-label="Record a clip"
          href={href(`/record?round=${roundNumber}&hole=${hole}&player=${who}${lastShot ? `&shot=${lastShot.client_id}` : ""}`)}
          onClick={() => onLeave?.()}
        >
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
