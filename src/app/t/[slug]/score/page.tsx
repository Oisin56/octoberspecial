"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/components/Providers";
import { GameStatus, Loading, gameLine } from "@/components/ui";
import { enqueue, flush, queued } from "@/lib/offlineQueue";
import { ballsOfGame, gameHole, gameShots, ONE_BALL, type BallHole } from "@/lib/engine";
import { shotsOnHole } from "@/lib/scoring";
import { ballName, formatLabel, sideLabel, toRoundCfg } from "@/lib/types";

type Draft = Record<string, BallHole>;

function ScoreInner() {
  const { state, summary, cfg: tcfg, session, patch, href, slug } = useT();
  const sp = useSearchParams();
  const router = useRouter();
  const [gameId, setGameId] = useState<string | null>(sp.get("game"));
  const [hole, setHole] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [ctp, setCtp] = useState<string | null>(null);
  const [ld, setLd] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const round = useMemo(() => {
    if (!state) return null;
    const n = sp.get("round");
    if (n) return state.rounds.find((r) => r.number === Number(n)) ?? null;
    return state.rounds.find((r) => r.status === "live") ?? state.rounds.find((r) => r.status === "upcoming") ?? null;
  }, [state, sp]);
  const rcfg = useMemo(() => (round && state ? toRoundCfg(round, state.players) : null), [round, state]);

  const myGames = useMemo(() => {
    if (!rcfg || !session) return [];
    return rcfg.games.filter((g) => session.role === "organiser" || (session.playerId && g.scorerId === session.playerId));
  }, [rcfg, session]);
  const game = rcfg?.games.find((g) => g.id === gameId) ?? (myGames.length === 1 ? myGames[0] : null);
  const balls = useMemo(() => (game && rcfg ? ballsOfGame(game, rcfg.play) : []), [game, rcfg]);
  const entries = useMemo(
    () => (state && round && game ? state.entries.filter((e) => e.round_id === round.id && (e.game ?? "main") === game.id) : []),
    [state, round, game],
  );

  useEffect(() => {
    if (!round || !game || hole != null) return;
    const done = new Set(entries.map((e) => e.hole));
    setHole(round.holes.find((h) => !done.has(h.number))?.number ?? 18);
  }, [round, game, entries, hole]);

  useEffect(() => {
    if (!round || hole == null || !game) return;
    const h = round.holes.find((x) => x.number === hole)!;
    const e = entries.find((x) => x.hole === hole);
    const d: Draft = {};
    for (const b of balls) d[b] = e?.scores[b] ?? { gross: h.par, gir: false, pickedUp: false };
    setDraft(d);
    setCtp(e?.ctp_winner ?? null);
    setLd(e?.ld_winner ?? null);
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.id, game?.id, hole]);

  const syncQueue = useCallback(async () => {
    const r = await flush();
    setWaiting(r.left);
    if (r.error) setErr(r.error);
  }, []);

  useEffect(() => {
    setWaiting(queued().length);
    syncQueue();
    const on = () => syncQueue();
    const q = () => setWaiting(queued().length);
    window.addEventListener("online", on);
    window.addEventListener("os-queue", q);
    const t = setInterval(syncQueue, 10000);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("os-queue", q);
      clearInterval(t);
    };
  }, [syncQueue]);

  if (!state || !summary || !tcfg) return <Loading />;
  if (!session)
    return (
      <p>
        <Link href={href(`/login?next=${encodeURIComponent(href("/score"))}`)}>Log in</Link> to enter scores.
      </p>
    );
  if (!round || !rcfg) return <p>No round to score.</p>;
  const ri = state.rounds.indexOf(round);

  // Choose a match
  if (!game) {
    if (!myGames.length)
      return (
        <div className="notice">
          You aren&apos;t the scorer for a match in Round {round.number}. You can still{" "}
          <Link href={href(`/post?round=${round.number}`)}>add posts</Link>, or ask the organiser to make you the scorer.
        </div>
      );
    return (
      <div className="scorer stack">
        <h1>
          R{round.number} {round.course_name}
        </h1>
        <p className="muted display">Which match are you scoring?</p>
        {myGames.map((g) => {
          const gi = rcfg.games.indexOf(g);
          return (
            <button key={g.id} className="round-item" style={{ gridTemplateColumns: "1fr auto", textAlign: "left", font: "inherit", cursor: "pointer" }} onClick={() => setGameId(g.id)}>
              <span>
                <span className="display" style={{ fontWeight: 700, fontSize: 19, display: "block" }}>
                  {g.name ?? `Match ${gi + 1}`}
                </span>
                <span className="meta">{g.sides.map((s) => sideLabel(s.id, g, state.players)).join(" v ")}</span>
              </span>
              <span className="res">{gameLine(round, g, summary.rounds[ri].games[gi], state.players)}</span>
            </button>
          );
        })}
      </div>
    );
  }
  if (hole == null) return <Loading />;

  const gi = rcfg.games.indexOf(game);
  const h = round.holes.find((x) => x.number === hole)!;
  const shots = gameShots(rcfg, game, tcfg.players);
  const preview = gameHole(rcfg, game, shots, { game: game.id, hole, scores: draft });
  const done = new Set(entries.map((e) => e.hole));
  const canPickUp = rcfg.scoring !== "stroke" || rcfg.play === "fourball";
  const oneBall = ONE_BALL.includes(rcfg.play);

  function setB(b: string, p: Partial<BallHole>) {
    setDraft((d) => ({ ...d, [b]: { ...d[b], ...p } }));
  }

  async function save(goNext: boolean) {
    if (!round || !game) return;
    setErr(null);
    const payload = { scores: draft, ctpWinner: h.par === 3 ? ctp : null, ldWinner: h.par === 5 ? ld : null };
    patch((s) => ({
      ...s,
      entries: [
        ...s.entries.filter((e) => !(e.round_id === round.id && (e.game ?? "main") === game.id && e.hole === hole)),
        {
          id: `local-${game.id}-${hole}`,
          round_id: round.id,
          game: game.id,
          hole: hole!,
          scores: draft,
          ctp_winner: payload.ctpWinner,
          ld_winner: payload.ldWinner,
          updated_by: session?.name ?? null,
          updated_at: new Date().toISOString(),
        },
      ],
    }));
    enqueue({ slug, roundId: round.id, game: game.id, hole: hole!, payload, at: Date.now() });
    const r = await flush();
    setWaiting(r.left);
    if (r.error) setErr(r.error);
    setMsg(r.left ? `Hole ${hole} saved on this phone. It'll send when there's signal.` : `Hole ${hole} saved.`);
    setTimeout(() => setMsg(null), 2500);
    if (goNext && hole! < 18) setHole(hole! + 1);
    if (goNext && hole === 18) router.push(href("/live"));
  }

  const sideChoices = [...balls.map((b) => ({ id: b as string | null, label: ballName(b, game, state.players) })), { id: null, label: "Nobody" }];
  const winnerText =
    preview.complete && rcfg.scoring === "match" && preview.winner
      ? preview.winner === "halved"
        ? "Hole halved"
        : `${sideLabel(preview.winner, game, state.players)} win${game.sides.find((s) => s.id === preview.winner)!.playerIds.length > 1 ? "" : "s"} the hole`
      : null;

  return (
    <div className="scorer">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <div className="display" style={{ fontSize: 17 }}>
          R{round.number} {round.course_name} · {formatLabel(round)}
          {rcfg.games.length > 1 && (
            <>
              {" · "}
              <button className="chip" onClick={() => { setGameId(null); setHole(null); }}>
                {game.name ?? `Match ${gi + 1}`} (change)
              </button>
            </>
          )}
        </div>
        <Link className="display small" href={href(`/post?round=${round.number}&hole=${hole}`)}>
          Add clip or note for this hole
        </Link>
      </div>

      <div className="hole-head">
        <button className="navbtn" aria-label="Previous hole" onClick={() => setHole(Math.max(1, hole - 1))}>
          ‹
        </button>
        <div className="row" style={{ gap: 14 }}>
          <span className="n">{hole}</span>
          <span className="info">
            Par {h.par} · SI {h.si}
            {h.yards ? (
              <>
                <br />
                {h.yards} yds
              </>
            ) : null}
          </span>
        </div>
        <button className="navbtn" aria-label="Next hole" onClick={() => setHole(Math.min(18, hole + 1))}>
          ›
        </button>
      </div>

      {balls.map((b) => {
        const sc = draft[b] ?? { gross: h.par };
        const st = shotsOnHole(shots[b] ?? 0, h.si);
        const toPar = sc.gross != null ? sc.gross - h.par : 0;
        const word = sc.pickedUp
          ? "Picked up"
          : toPar <= -3 ? "Albatross" : toPar === -2 ? "Eagle" : toPar === -1 ? "Birdie" : toPar === 0 ? "Par" : toPar === 1 ? "Bogey" : toPar === 2 ? "Double" : `+${toPar}`;
        const ptsHere = rcfg.scoring === "stableford" && !sc.pickedUp && sc.gross != null ? Math.max(0, 2 + h.par - (sc.gross - st)) : null;
        const label = ballName(b, game, state.players);
        return (
          <section className="pscore" key={b} aria-label={`${label} score`}>
            <div className="top">
              <span className="pname" style={{ fontSize: label.length > 16 ? 19 : undefined }}>
                {label}
              </span>
              <span className="shots">{st > 0 ? `${st} shot${st > 1 ? "s" : ""} here` : ""}</span>
            </div>
            <div className="stepper">
              <button aria-label={`${label} one less`} onClick={() => setB(b, { gross: Math.max(1, (sc.gross ?? h.par) - 1), pickedUp: false })}>
                −
              </button>
              <div className="val" aria-live="polite">
                {sc.pickedUp ? "–" : sc.gross}
                <small>
                  {word}
                  {ptsHere != null ? ` · ${ptsHere} pts` : ""}
                </small>
              </div>
              <button aria-label={`${label} one more`} onClick={() => setB(b, { gross: Math.min(15, (sc.gross ?? h.par) + 1), pickedUp: false })}>
                +
              </button>
            </div>
            <div className="toggles">
              <button className="toggle" aria-pressed={!!sc.gir} onClick={() => setB(b, { gir: !sc.gir })}>
                Green in reg
              </button>
              {canPickUp && (
                <button
                  className="toggle"
                  aria-pressed={!!sc.pickedUp}
                  onClick={() => setB(b, sc.pickedUp ? { pickedUp: false, gross: h.par } : { pickedUp: true, gross: null })}
                >
                  Picked up
                </button>
              )}
            </div>
          </section>
        );
      })}

      {h.par === 3 && (
        <section className="pscore">
          <div className="pname" style={{ fontSize: 20 }}>
            Closest to the pin <span className="muted small">(on the green)</span>
          </div>
          <div className="side-pick" style={{ gridTemplateColumns: `repeat(${Math.min(3, sideChoices.length)}, 1fr)` }}>
            {sideChoices.map((c) => (
              <button key={String(c.id)} className="toggle" aria-pressed={ctp === c.id} onClick={() => setCtp(c.id)}>
                {c.label}
              </button>
            ))}
          </div>
        </section>
      )}
      {h.par === 5 && (
        <section className="pscore">
          <div className="pname" style={{ fontSize: 20 }}>
            Long drive <span className="muted small">(on the fairway)</span>
          </div>
          <div className="side-pick" style={{ gridTemplateColumns: `repeat(${Math.min(3, sideChoices.length)}, 1fr)` }}>
            {sideChoices.map((c) => (
              <button key={String(c.id)} className="toggle" aria-pressed={ld === c.id} onClick={() => setLd(c.id)}>
                {c.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {winnerText && (
        <p className="display" style={{ textAlign: "center", fontSize: 18, margin: "10px 0 0" }}>
          {winnerText}
        </p>
      )}
      {oneBall && <p className="small muted" style={{ textAlign: "center" }}>One score per side: enter the team&apos;s score on the hole.</p>}

      <div className="sticky-save">
        <button className="btn block" style={{ fontSize: 22, padding: "14px" }} onClick={() => save(true)}>
          {hole < 18 ? `Save hole ${hole}, go to ${hole + 1}` : "Save hole 18, finish"}
        </button>
        {msg && <p className="queue">{msg}</p>}
        {err && <p className="queue error">{err}</p>}
        {waiting > 0 && (
          <p className="queue" style={{ color: "var(--bracken)" }}>
            {waiting} hole{waiting > 1 ? "s" : ""} waiting for signal.{" "}
            <button className="chip" onClick={syncQueue}>
              Send now
            </button>
          </p>
        )}
      </div>

      <div className="hole-strip" aria-label="Jump to hole">
        {round.holes.map((x) => (
          <button key={x.number} className={x.number === hole ? "current" : done.has(x.number) ? "done" : ""} onClick={() => setHole(x.number)}>
            {x.number}
          </button>
        ))}
      </div>

      <div className="section">
        <GameStatus round={round} gameIndex={gi} compact />
      </div>

      <Attest roundId={round.id} />
    </div>
  );
}

function Attest({ roundId }: { roundId: string }) {
  const { state, session, summary, refresh, names, api } = useT();
  const [busy, setBusy] = useState(false);
  if (!state || !summary || !session?.playerId) return null;
  const ri = state.rounds.findIndex((r) => r.id === roundId);
  const rs = summary.rounds[ri];
  const round = state.rounds[ri];
  const cfg = toRoundCfg(round, state.players);
  const myGame = cfg.games.findIndex((g) => g.sides.some((s) => s.playerIds.includes(session.playerId!)));
  if (myGame < 0) return null;
  const gs = rs.games[myGame];
  const segs = (["front", "back"] as const).filter((s) => gs[s].complete);
  if (!segs.length) return null;
  const inGame = new Set(cfg.games[myGame].sides.flatMap((s) => s.playerIds));
  const att = state.attestations.filter((a) => a.round_id === roundId && inGame.has(a.player_id));

  async function attest(segment: "front" | "back") {
    setBusy(true);
    await api("/api/attest", { roundId, segment });
    setBusy(false);
    refresh();
  }

  return (
    <section className="section panel">
      <h3>Sign the card</h3>
      {segs.map((s) => {
        const signed = att.filter((a) => a.segment === s).map((a) => names[a.player_id]);
        const mine = att.some((a) => a.segment === s && a.player_id === session.playerId);
        return (
          <div key={s} className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
            <span className="display">
              {s === "front" ? "Front nine" : "Back nine"}: {signed.length ? `signed by ${signed.join(" & ")}` : "not signed"}
            </span>
            {!mine && (
              <button className="btn secondary" disabled={busy} onClick={() => attest(s)}>
                I agree with this card
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}

export default function ScorePage() {
  return (
    <Suspense fallback={<Loading />}>
      <ScoreInner />
    </Suspense>
  );
}
