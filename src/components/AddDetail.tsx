"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useT } from "./Providers";
import { HoldToTalk } from "./HoldToTalk";
import { useSwipe } from "@/lib/useSwipe";
import type { ShotKind } from "@/lib/shots";
import {
  ALL_KINDS,
  BAG,
  CLUB_SHORT,
  CONTACT,
  FLIGHT,
  KIND_WORD,
  PENALTY_OUTCOMES,
  PUTT_LENGTHS,
  SHAPE,
  WIND,
  clubOrder,
  extrasWords,
  kindOrder,
  outcomeOrder,
  shotWords,
  waterIn,
  type ClubUse,
} from "@/lib/detail";
import { deleteShot, flushShots, mergeShots, saveShot } from "@/lib/shotQueue";
import { flushGps, mergeGps, placeReading } from "@/lib/gpsQueue";
import { flushPosts, queuePost } from "@/lib/postQueue";
import { strokeRows, type StrokeRow } from "@/lib/strokes";
import { inUnits, unitWord } from "@/lib/gps";
import { mayTellShots } from "@/lib/scoring-access";
import { useWind } from "@/lib/useWind";
import { toRoundCfg, type PlayerRow, type ShotRow } from "@/lib/types";

const LAST_PLAYER = (slug: string) => `mgs_shot_player_${slug}`;

/** "1st", "7th", "12th" */
export const nth = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

export interface AddDetailProps {
  roundId: string;
  roundNumber: number;
  hole: number;
  /** The group (its wind note is kept for it) */
  gameId?: string | null;
  players: PlayerRow[];
  /** Open on this player (from "Add detail · Neil birdie") */
  startPlayer?: string | null;
  nextLabel: string;
  onNext: () => void;
  onBack: () => void;
  backLabel?: string;
  /** Leaving for the camera */
  onLeave?: () => void;
}

/**
 * Add detail: the hole's shots, numbered to the score, with what's already known on them. Tap a shot and the same
 * four rows open every time: shot, club, outcome, more, likeliest answer first. Only one thing is open at a time,
 * nothing is filled in for anyone, and every row can be skipped. The same two ways out at the bottom, always.
 */
/** What a hole's strokes need, for Add detail and for a clip: the rows, the saves, and the suggestions' inputs. */
export function useHoleTelling(roundId: string, hole: number) {
  const { state, session, slug, refresh, sample } = useT();
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
  const round = state?.rounds.find((r) => r.id === roundId) ?? null;
  const cfg = useMemo(() => (round && state ? toRoundCfg(round, state.players) : null), [round, state]);
  const all = mergeShots(state?.shots, slug, state?.tournament.id ?? "");
  const readingsAll = mergeGps(state?.gps, slug).filter((r) => r.round_id === roundId);
  const clipsAll = (state?.posts ?? []).filter((p) => p.kind === "video" && p.round_id === roundId);
  const hh = round?.holes.find((x) => x.number === hole);
  const par = hh?.par ?? 4;
  const yards = hh?.yards ?? null;
  const water = waterIn(round?.course_guide?.holes?.[String(hole)]);

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
  const dist = (y: number) => `${inUnits(y, units)} ${unitWord(units, true)}`;

  /** The player's score on the hole (his ball, or his side's in a one-ball format), and whether he picked up */
  const scoreOf = (pid: string): { gross: number | null; pickedUp: boolean; at: string | null } => {
    if (!cfg || !state) return { gross: null, pickedUp: false, at: null };
    for (const e of state.entries.filter((x) => x.round_id === roundId && x.hole === hole)) {
      const g = cfg.games.find((x) => x.id === (e.game ?? "main"));
      const side = g?.sides.find((s) => s.playerIds.includes(pid));
      const b = e.scores[pid] ?? (side ? e.scores[side.id] : undefined);
      const gaveUp = !!side && e.conceded === side.id;
      if (b?.pickedUp || gaveUp) return { gross: null, pickedUp: true, at: e.updated_at };
      if (b?.gross != null) return { gross: b.gross, pickedUp: false, at: e.updated_at };
    }
    return { gross: null, pickedUp: false, at: null };
  };

  const rowsOn = (pid: string, h: number, sc: { gross: number | null; pickedUp: boolean }, more = 0): StrokeRow[] => {
    const rows = strokeRows({
      shots: all.filter((s) => s.round_id === roundId && s.hole === h && s.player_id === pid),
      readings: readingsAll.filter((r) => r.hole === h && r.player_id === pid),
      gross: sc.gross,
      holeYards: round?.holes.find((x) => x.number === h)?.yards ?? null,
      clips: clipsAll.filter((c) => c.hole === h),
      pickedUp: sc.pickedUp,
      playerId: pid,
    });
    // Picked up: "Add a shot" puts another card before the pick-up
    for (let i = 0; i < more; i++) rows.push({ seq: rows.length + 1, shot: null, from: null, reading: null, drive: null, clip: null, auto: rows.length === 0 ? { kind: "tee" } : null });
    return rows;
  };
  const rowsFor = (pid: string, more = 0) => rowsOn(pid, hole, scoreOf(pid), more);
  const told = (pid: string) => all.some((s) => s.round_id === roundId && s.hole === hole && s.player_id === pid);
  const canTell = (pid: string) => !!cfg && mayTellShots(cfg.games, session ? { playerId: session.playerId, role: session.role } : null, pid);

  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendSoon = () => {
    if (sendTimer.current) clearTimeout(sendTimer.current);
    sendTimer.current = setTimeout(() => Promise.all([flushShots(slug), flushGps(slug)]).then(() => refresh()), 600);
  };

  /** A player's own clubs from about each distance, from this round so far (their choice moves to the front) */
  const historyFor = (pid: string): ClubUse[] => {
    if (!round) return [];
    const out: ClubUse[] = [];
    for (const h of round.holes) {
      if (!all.some((s) => s.round_id === roundId && s.hole === h.number && s.player_id === pid && s.club)) continue;
      for (const r of rowsOn(pid, h.number, { gross: null, pickedUp: false })) if (r.shot?.club && r.from != null) out.push({ club: r.shot.club, from: r.from });
    }
    return out;
  };

  /** Save one stroke: what's there already, with this change laid over it */
  function save(pid: string, rows: StrokeRow[], r: StrokeRow, change: Partial<Pick<ShotRow, "kind" | "outcome" | "club" | "distance" | "contact" | "shape" | "flight">>) {
    const sc = scoreOf(pid);
    const ex = r.shot;
    const last = sc.gross != null && r.seq === rows.length;
    const kind = (change.kind ?? ex?.kind ?? (r.seq === 1 ? "tee" : null)) as ShotKind | null;
    if (!kind) return;
    const kindChanged = !!ex && change.kind != null && change.kind !== ex.kind;
    const clientId = ex?.client_id ?? crypto.randomUUID();
    const data = {
      roundId,
      hole,
      playerId: pid,
      kind,
      outcome: last ? "Holed" : kind === "penalty" ? "Penalty" : (change.outcome ?? (kindChanged ? "" : (ex?.outcome ?? ""))),
      club: kind === "putt" ? "Putter" : kind === "penalty" ? null : (change.club ?? (kindChanged ? null : (ex?.club ?? null))),
      distance: kind !== "putt" ? null : (change.distance ?? (kindChanged ? null : (ex?.distance ?? null))),
      contact: change.contact !== undefined ? change.contact : (ex?.contact ?? null),
      shape: change.shape !== undefined ? change.shape : (ex?.shape ?? null),
      flight: change.flight !== undefined ? change.flight : (ex?.flight ?? null),
      seq: r.seq,
      loggedAt: ex?.logged_at ?? new Date().toISOString(),
      author: ex?.author_name ?? session?.name ?? "",
      authorPlayerId: ex ? (ex.author_player_id ?? null) : (session?.playerId ?? null),
    };
    saveShot(slug, clientId, data);
    // Water or out of bounds: the next stroke is the penalty, without asking
    if (change.outcome && PENALTY_OUTCOMES.includes(change.outcome)) {
      const nx = rows.find((x) => x.seq === r.seq + 1);
      if (nx && !nx.shot && !(sc.gross != null && nx.seq === rows.length)) {
        saveShot(slug, crypto.randomUUID(), { ...data, kind: "penalty", outcome: "Penalty", club: null, distance: null, contact: null, shape: null, flight: null, seq: nx.seq, loggedAt: new Date().toISOString(), author: session?.name ?? "", authorPlayerId: session?.playerId ?? null });
      }
    }
    sendSoon();
    return clientId;
  }

  function clear(r: StrokeRow) {
    if (!r.shot) return;
    deleteShot(slug, r.shot.client_id, !r.shot.id.startsWith("local-"));
    sendSoon();
  }

  function moveReading(clientId: string, seq: number | null) {
    placeReading(slug, clientId, seq == null ? { seq: null, ignored: true } : { seq, ignored: false });
    sendSoon();
  }

  return { round, cfg, par, yards, water, dist, scoreOf, rowsFor, told, canTell, historyFor, save, clear, moveReading, sample };
}

export function AddDetail({ roundId, roundNumber, hole, gameId, players, startPlayer, nextLabel, onNext, onBack, backLabel = "Back to the scorecard", onLeave }: AddDetailProps) {
  const { state, session, slug, href, sample, api, patch } = useT();
  const T = useHoleTelling(roundId, hole);
  const { cfg, par, yards, water, dist, scoreOf } = T;
  const wind = useWind(slug, roundId, !sample);
  const [extra, setExtra] = useState<Record<string, number>>({});
  const rowsFor = (pid: string) => T.rowsFor(pid, extra[pid] ?? 0);
  const told = T.told;

  // Who: the player named on the button, else the first not told yet, else whoever was picked last
  const [who, setWho] = useState<string>(() => {
    if (startPlayer && players.some((p) => p.id === startPlayer)) return startPlayer;
    const untold = players.find((p) => !told(p.id));
    if (untold) return untold.id;
    try {
      const last = localStorage.getItem(LAST_PLAYER(slug));
      if (last && players.some((p) => p.id === last)) return last;
    } catch {}
    return players[0]?.id ?? "";
  });

  const name = (id: string) => players.find((p) => p.id === id)?.name ?? state?.players.find((p) => p.id === id)?.name ?? id;
  const sc = scoreOf(who);
  const rows = rowsFor(who);
  const canTell = T.canTell(who);
  const [openSeq, setOpenSeq] = useState<number | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [windOpen, setWindOpen] = useState(false);

  function pick(id: string) {
    setWho(id);
    // The player picked last on this phone: a clip filmed next guesses them
    try {
      localStorage.setItem(LAST_PLAYER(slug), id);
    } catch {}
    setOpenSeq(null);
    setSaid(null);
  }

  const history = T.historyFor(who);
  const save = (r: StrokeRow, change: Parameters<typeof T.save>[3]) => T.save(who, rows, r, change);
  const clear = (r: StrokeRow) => (T.clear(r), setOpenSeq(null));
  const moveReading = T.moveReading;

  /** The card closes; the next shot not yet told opens, ready */
  function closeAndNext(seq: number) {
    const fresh = rowsFor(who);
    const nx = fresh.find((x) => x.seq > seq && !x.shot);
    setOpenSeq(nx?.seq ?? null);
  }

  function voice(text: string) {
    queuePost(slug, { roundId, hole, kind: "note", body: `${name(who)}: ${text}`, tags: ["voice"], playerIds: [who], visibility: "report" });
    flushPosts(slug);
    setSaid(text);
  }

  // ---- the wind on this hole
  const gid = gameId ?? cfg?.games.find((g) => g.sides.some((s) => s.playerIds.includes(who)))?.id ?? "main";
  const note = (state?.holeNotes ?? []).find((n) => n.round_id === roundId && n.game === gid && n.hole === hole);
  const fromWeather = sample ? (sample.wind ?? null) : wind(hole, sc.at);
  const windNow = note?.wind ?? fromWeather;
  async function setWind(w: string | null) {
    setWindOpen(false);
    patch((st) => ({
      ...st,
      holeNotes: [
        ...(st.holeNotes ?? []).filter((n) => !(n.round_id === roundId && n.game === gid && n.hole === hole)),
        ...(w ? [{ round_id: roundId, game: gid, hole, wind: w, by_name: session?.name ?? null, updated_at: new Date().toISOString() }] : []),
      ],
    }));
    if (!sample) await api("/api/wind", { roundId, game: gid, hole, wind: w }).catch(() => null);
  }

  const swipe = useSwipe({
    onLeft: () => {
      const i = players.findIndex((p) => p.id === who);
      if (i >= 0 && i < players.length - 1) pick(players[i + 1].id);
    },
    onRight: () => {
      const i = players.findIndex((p) => p.id === who);
      if (i > 0) pick(players[i - 1].id);
    },
  });

  const cols = Math.max(1, Math.min(4, players.length));
  const head = sc.pickedUp
    ? `${name(who)} · picked up on the par ${par} ${nth(hole)}`
    : `${name(who)} · ${sc.gross != null ? `${sc.gross} on the ` : "the "}par ${par} ${nth(hole)}${yards ? ` · ${dist(yards)}` : ""}`;

  return (
    <div className="dtl" role="dialog" aria-label={`Hole ${hole}: add detail`}>
      <div className="dtl-tabs" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }} role="tablist">
        {players.map((p) => (
          <button key={p.id} role="tab" className="dtl-tab" aria-selected={who === p.id} onClick={() => pick(p.id)}>
            <span className="nm">{p.name}</span>
            {told(p.id) && (
              <span className="tick" aria-label="told">
                ✓
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="dtl-body" {...swipe}>
        <p className="dtl-head">{head}</p>
        {windOpen ? (
          <div className="dtl-wind-pick">
            <span className="dtl-row-name">Wind on the {nth(hole)}</span>
            <div className="dtl-tiles two">
              {WIND.map((w) => (
                <button key={w} className="dtl-tile" aria-pressed={windNow === w} onClick={() => setWind(w)}>
                  {w}
                </button>
              ))}
            </div>
            {note?.wind && fromWeather && (
              <button className="dtl-small" onClick={() => setWind(null)}>
                Use the weather&apos;s: {fromWeather.toLowerCase()}
              </button>
            )}
          </div>
        ) : (
          <button className="dtl-wind" onClick={() => setWindOpen(true)} disabled={!canTell}>
            {windNow ? (
              <>
                Wind: {windNow.toLowerCase()} <span className="dtl-change">Change</span>
              </>
            ) : (
              <>
                Wind <span className="dtl-change">Add</span>
              </>
            )}
          </button>
        )}

        <ol className="dtl-shots">
          {rows.map((r) => (
            <ShotRowCard
              key={`${who}-${r.seq}`}
              r={r}
              open={openSeq === r.seq}
              last={sc.gross != null && r.seq === rows.length}
              par={par}
              yards={yards}
              water={water}
              history={history}
              rows={rows}
              editable={canTell}
              me={session?.name ?? ""}
              dist={dist}
              onOpen={() => setOpenSeq(openSeq === r.seq ? null : r.seq)}
              onSave={(c) => save(r, c)}
              onDone={() => closeAndNext(r.seq)}
              onClear={() => clear(r)}
              onMove={moveReading}
              filmHref={href(`/record?round=${roundNumber}&hole=${hole}&player=${who}&seq=${r.seq}`)}
              onLeave={onLeave}
            />
          ))}
          {sc.pickedUp && (
            <li className="dtl-shot picked">
              <div className="dtl-card-main static">
                <span className="dtl-seq">P</span>
                <span className="dtl-what">Picked up</span>
              </div>
              {canTell && (
                <button
                  className="dtl-small"
                  onClick={() => {
                    setExtra((x) => ({ ...x, [who]: (x[who] ?? 0) + 1 }));
                    setOpenSeq(rows.length + 1);
                  }}
                >
                  Add a shot
                </button>
              )}
            </li>
          )}
        </ol>

        {canTell && (
          <div className="dtl-voice">
            <HoldToTalk onText={voice} label="Hold to tell the commentators" />
            <p className="dtl-voice-note">{said ? <>Saved for the commentators: &ldquo;{said}&rdquo;</> : "Only the commentators hear this."}</p>
          </div>
        )}
      </div>

      <div className="dtl-foot">
        <button className="btn secondary dtl-back" onClick={onBack}>
          {backLabel}
        </button>
        <button className="btn dtl-next" onClick={onNext}>
          {nextLabel} ›
        </button>
      </div>
    </div>
  );
}

/** One stroke's card, open: the same four rows as Add detail (used by a clip's Add detail). */
export function StrokeTeller({ roundId, hole, playerId, seq, onDone }: { roundId: string; hole: number; playerId: string; seq: number; onDone: () => void }) {
  const { session, href } = useT();
  const T = useHoleTelling(roundId, hole);
  const rows = T.rowsFor(playerId);
  const r = rows.find((x) => x.seq === seq) ?? { seq, shot: null, from: null, reading: null, drive: null, clip: null, auto: seq === 1 ? { kind: "tee" } : null };
  const sc = T.scoreOf(playerId);
  return (
    <ol className="dtl-shots">
      <ShotRowCard
        r={r}
        open
        last={sc.gross != null && seq === rows.length}
        par={T.par}
        yards={T.yards}
        water={T.water}
        history={T.historyFor(playerId)}
        rows={rows.some((x) => x.seq === seq) ? rows : [...rows, r]}
        editable={T.canTell(playerId)}
        me={session?.name ?? ""}
        dist={T.dist}
        onOpen={() => {}}
        onSave={(c) => T.save(playerId, rows.some((x) => x.seq === seq) ? rows : [...rows, r], r, c)}
        onDone={onDone}
        onClear={() => T.clear(r)}
        onMove={T.moveReading}
        filmHref={href("/score")}
        noFilm
      />
    </ol>
  );
}

type Row = "shot" | "club" | "outcome" | "more";

/** One stroke's card: a line when closed; open, the same four rows every time, one open at a time. */
function ShotRowCard({
  r,
  open,
  last,
  par,
  yards,
  water,
  history,
  rows,
  editable,
  me,
  dist,
  onOpen,
  onSave,
  onDone,
  onClear,
  onMove,
  filmHref,
  onLeave,
  noFilm = false,
}: {
  r: StrokeRow;
  open: boolean;
  /** The stroke that went in (the score is in) */
  last: boolean;
  par: number;
  yards: number | null;
  water: boolean;
  history: ClubUse[];
  rows: StrokeRow[];
  editable: boolean;
  me: string;
  dist: (y: number) => string;
  onOpen: () => void;
  onSave: (c: Partial<Pick<ShotRow, "kind" | "outcome" | "club" | "distance" | "contact" | "shape" | "flight">>) => void;
  onDone: () => void;
  onClear: () => void;
  onMove: (clientId: string, seq: number | null) => void;
  filmHref: string;
  onLeave?: () => void;
  /** Already filming it (a clip's Add detail) */
  noFilm?: boolean;
}) {
  const s = r.shot;
  const kind = (s?.kind ?? (r.seq === 1 ? "tee" : null)) as ShotKind | null;
  const putt = kind === "putt";
  const penalty = kind === "penalty";
  const club = putt ? (s?.distance ?? null) : (s?.club ?? null);
  const outcome = s?.outcome || null;
  const hasOutcome = !last && !penalty;
  const hasMore = !putt && !penalty;
  const firstOpen = (): Row | null => (!kind ? "shot" : penalty ? null : !club ? "club" : hasOutcome && !outcome ? "outcome" : null);
  const [row, setRow] = useState<Row | null>(firstOpen);
  const [otherKinds, setOtherKinds] = useState(false);
  const [bag, setBag] = useState(false);
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => (setRow(firstOpen()), setOtherKinds(false), setBag(false), setMoving(false)), 0);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Where it was played from: the tee shot is the hole's length; others when measured
  const from = r.seq === 1 ? (r.from ?? yards) : r.from;
  const before = (rows.find((x) => x.seq === r.seq - 1)?.shot?.kind ?? (r.seq === 2 ? "tee" : null)) as ShotKind | null;
  const kinds = kindOrder(r.from, par, before, last && r.from == null);
  const clubs = clubOrder(kind ?? "approach", par, from, history);
  const outs = kind ? outcomeOrder(kind, { par, water }) : [];

  const told = !!s;
  const auto = r.auto;
  const line = s ? shotWords(s) : auto?.outcome ? "Holed" : auto ? KIND_WORD[auto.kind as ShotKind] : "";
  const sub = [r.seq === 1 && yards && !s ? `from ${dist(yards)}` : r.from != null ? `from ${dist(r.from)}` : null, r.drive != null ? `went about ${dist(r.drive)}` : null].filter(Boolean).join(" · ");
  const extras = s ? extrasWords(s) : "";

  function chooseKind(k: ShotKind) {
    setOtherKinds(false);
    onSave({ kind: k });
    if (k === "penalty") return onDone();
    setRow("club");
  }
  function chooseClub(c: string) {
    setBag(false);
    onSave(putt ? { distance: c } : { club: c });
    if (hasOutcome && !outcome) return setRow("outcome");
    if (!hasOutcome) return onDone();
    setRow(null);
  }
  function chooseOutcome(o: string) {
    onSave({ outcome: o });
    setRow(null);
    onDone();
  }

  return (
    <li className={`dtl-shot${told ? " told" : ""}${open ? " open" : ""}`}>
      <button className="dtl-card-main" onClick={onOpen} aria-expanded={open} disabled={!editable && !open}>
        <span className="dtl-seq">{r.seq}</span>
        <span className="dtl-what">
          {line || <span className="dtl-quiet">Shot {r.seq}</span>}
          {(sub || extras) && <small className="dtl-sub">{[extras, sub].filter(Boolean).join(" · ")}</small>}
          {s && s.author_name && s.author_name !== me && <small className="dtl-by">by {s.author_name}</small>}
        </span>
        {r.clip && (
          <span className="dtl-cam" aria-label="Filmed" title="Filmed">
            🎥
          </span>
        )}
      </button>

      {open && editable && (
        <div className="dtl-edit">
          {/* 1. Shot */}
          {row === "shot" ? (
            <div className="dtl-row">
              <span className="dtl-row-name">Shot</span>
              {otherKinds ? (
                <div className="dtl-tiles two">
                  {ALL_KINDS.map((k) => (
                    <button key={k} className="dtl-tile" aria-pressed={kind === k} onClick={() => chooseKind(k)}>
                      {KIND_WORD[k]}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="dtl-tiles two">
                  {kinds.map((k) => (
                    <button key={k} className="dtl-tile" onClick={() => chooseKind(k)}>
                      {KIND_WORD[k]}
                    </button>
                  ))}
                  <button className="dtl-tile soft" onClick={() => setOtherKinds(true)}>
                    Other
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button className="dtl-folded" onClick={() => setRow("shot")}>
              Shot: {kind ? KIND_WORD[kind].toLowerCase() : "not told"}
              {kind && <span className="dtl-change">Change</span>}
            </button>
          )}

          {/* 2. Club (a putt: its length) */}
          {kind && !penalty &&
            (row === "club" ? (
              <div className="dtl-row">
                <span className="dtl-row-name">{putt ? "Length" : "Club"}</span>
                {putt ? (
                  <div className="dtl-tiles two">
                    {PUTT_LENGTHS.map((l) => (
                      <button key={l} className="dtl-tile" aria-pressed={club === l} onClick={() => chooseClub(l)}>
                        {l}
                      </button>
                    ))}
                  </div>
                ) : bag ? (
                  <div className="dtl-tiles three">
                    {BAG.filter((c) => c !== "Putter").map((c) => (
                      <button key={c} className="dtl-tile small" aria-pressed={club === c} onClick={() => chooseClub(c)}>
                        {CLUB_SHORT[c] ?? c}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="dtl-tiles two">
                    {clubs.map((c) => (
                      <button key={c} className="dtl-tile" aria-pressed={club === c} onClick={() => chooseClub(c)}>
                        {c}
                      </button>
                    ))}
                    <button className="dtl-tile soft" onClick={() => setBag(true)}>
                      Other
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button className={`dtl-folded${club ? "" : " quiet"}`} onClick={() => setRow("club")}>
                {putt ? "Length" : "Club"}
                {club ? `: ${club} ✓` : ""}
              </button>
            ))}

          {/* 3. Outcome */}
          {kind && hasOutcome &&
            (row === "outcome" ? (
              <div className="dtl-row">
                <span className="dtl-row-name">Outcome</span>
                <div className="dtl-tiles two">
                  {outs.map((o) => (
                    <button key={o} className="dtl-tile" aria-pressed={outcome === o} onClick={() => chooseOutcome(o)}>
                      {o}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <button className={`dtl-folded${outcome ? "" : " quiet"}`} onClick={() => setRow("outcome")}>
                Outcome{outcome ? `: ${outcome.toLowerCase()} ✓` : ""}
              </button>
            ))}

          {/* 4. More: closed unless tapped */}
          {kind && hasMore &&
            (row === "more" ? (
              <div className="dtl-row">
                <span className="dtl-row-name">More</span>
                <MoreRow label="Contact" value={s?.contact ?? null} options={CONTACT} onPick={(v) => onSave({ contact: v })} />
                <MoreRow label="Shape" value={s?.shape ?? null} options={SHAPE} onPick={(v) => onSave({ shape: v })} />
                <MoreRow label="Flight" value={s?.flight ?? null} options={FLIGHT} onPick={(v) => onSave({ flight: v })} />
              </div>
            ) : (
              <button className={`dtl-folded${extras ? "" : " quiet"}`} onClick={() => setRow("more")}>
                More{extras ? `: ${extras} ✓` : ""}
              </button>
            ))}

          {moving && r.reading && (
            <div className="dtl-row">
              <span className="dtl-row-name">Measured for which shot?</span>
              <div className="dtl-tiles four">
                {rows.map((x) => (
                  <button key={x.seq} className="dtl-tile small" aria-pressed={x.seq === r.seq} onClick={() => (onMove(r.reading!.client_id, x.seq), setMoving(false))}>
                    {x.seq}
                  </button>
                ))}
                <button className="dtl-tile small soft" onClick={() => (onMove(r.reading!.client_id, null), setMoving(false))}>
                  Take it off
                </button>
              </div>
            </div>
          )}

          <div className="dtl-smalls">
            {!noFilm && (
              <Link className="dtl-small" href={filmHref} onClick={() => onLeave?.()}>
                Film this shot
              </Link>
            )}
            {r.reading && !moving && (
              <button className="dtl-small" onClick={() => setMoving(true)}>
                Measured for a different shot?
              </button>
            )}
            {s && (
              <button className="dtl-small" onClick={onClear}>
                Clear this shot
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/** One of More's three short rows: its tiles until one is picked, then one line */
function MoreRow({ label, value, options, onPick }: { label: string; value: string | null; options: readonly string[]; onPick: (v: string | null) => void }) {
  const [editing, setEditing] = useState(!value);
  if (value && !editing)
    return (
      <button className="dtl-folded" onClick={() => setEditing(true)}>
        {label}: {value.toLowerCase()} ✓
      </button>
    );
  return (
    <div className="dtl-more">
      <span className="dtl-more-name">{label}</span>
      <div className="dtl-tiles three">
        {options.map((o) => (
          <button
            key={o}
            className="dtl-tile small"
            aria-pressed={value === o}
            onClick={() => {
              onPick(value === o ? null : o);
              setEditing(false);
            }}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
