"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/components/Providers";
import { Loading, Scorecard, gameLine } from "@/components/ui";
import { enqueue, flush, pendingHole, queued } from "@/lib/offlineQueue";
import { readScorePos, writeScorePos } from "@/lib/scorePos";
import { ShotCard } from "@/components/ShotCard";
import { matchMoment, scorePrompt, type HoleInfo, type Prompt } from "@/lib/shots";
import { groupPlayers } from "@/lib/courseCards";
import { useSwipe } from "@/lib/useSwipe";
import { ballsOfGame, ballsOfSide, gameHole, gameShots, holeShots, ONE_BALL, type BallHole, type Game } from "@/lib/engine";
import { CardPanel } from "@/components/CardPanel";
import { cardInfo, gameComplete } from "@/lib/scorecards";
import { fieldPosition, roundBoard } from "@/lib/live";
import { ballName, sideLabel, toRoundCfg } from "@/lib/types";
import { scoreWord } from "@/lib/scoreEntry";

type Draft = Record<string, BallHole>;

/**
 * The scorecard on the course.
 *   The match's scorer enters the scores: every hole starts blank, one tap per player on a number.
 *   A hole you leave is locked; going back shows it with an Edit score button.
 *   Everyone else sees the live card ("Neil is keeping score"); Record and Note stay in the bar below.
 *   The organiser corrects other matches' scores from Admin (?correct=1), and every correction is logged.
 */
function ScoreInner() {
  const { state, summary, cfg: tcfg, session, patch, href, slug } = useT();
  const sp = useSearchParams();
  const router = useRouter();
  const correcting = sp.get("correct") === "1" && session?.role === "organiser";
  const [gameId, setGameId] = useState<string | null>(sp.get("game"));
  const [hole, setHole] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [ctp, setCtp] = useState<string | null>(null);
  const [ld, setLd] = useState<string | null>(null);
  /** Match play: the side that conceded this hole */
  const [conceded, setConceded] = useState<string | null>(null);
  /** A finished hole is locked until "Edit score" */
  const [locked, setLocked] = useState(false);
  /** The player whose "More" numbers are open */
  const [more, setMore] = useState<string | null>(null);
  /** Checking the card at the end (submit, sign) */
  const [review, setReview] = useState(false);
  const [waiting, setWaiting] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  /** Next was tapped with someone's score not in: whose, so we can ask before moving on */
  const [missingAsk, setMissingAsk] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Every tap is saved at once; the hole is "finished" (and news of it goes out) when the scorer moves on,
  // or after two quiet minutes
  const latest = useRef<{ draft: Draft; ctp: string | null; ld: string | null; conceded: string | null }>({ draft: {}, ctp: null, ld: null, conceded: null });
  const unfinished = useRef<number | null>(null);
  /** The hole you were on when the page opened stays open (you're playing it); holes you go back to are locked */
  const openedHole = useRef(true);
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saved, setSaved] = useState<"saving" | "saved" | "phone" | null>(null);
  const [picking, setPicking] = useState(false);
  /** The hole just finished, while the "anything the card won't show?" card is up */
  const [moments, setMoments] = useState<number | null>(null);
  /** Which way the last move went, for the slide-in */
  const [slide, setSlide] = useState<"fwd" | "back" | null>(null);

  const round = useMemo(() => {
    if (!state) return null;
    const n = sp.get("round");
    if (n) return state.rounds.find((r) => r.number === Number(n)) ?? null;
    return state.rounds.find((r) => r.status === "live") ?? state.rounds.find((r) => r.status === "upcoming") ?? null;
  }, [state, sp]);
  const rcfg = useMemo(() => (round && state ? toRoundCfg(round, state.players) : null), [round, state]);
  /** The holes of this round in order (1 to 18, 1 to 9, or 10 to 18) */
  const holeNums = useMemo(() => (round ? round.holes.map((x) => x.number).sort((a, b) => a - b) : []), [round]);
  const last = holeNums.at(-1) ?? 18;
  const after = (n: number) => holeNums.find((x) => x > n) ?? null;
  const before = (n: number) => [...holeNums].reverse().find((x) => x < n) ?? null;

  /** Matches this person enters the scores for */
  const myGames = useMemo(() => {
    if (!rcfg || !session) return [];
    if (correcting) return rcfg.games;
    return rcfg.games.filter((g) => (session.playerId && g.scorerId === session.playerId) || (session.role === "organiser" && !g.scorerId));
  }, [rcfg, session, correcting]);
  const game = myGames.find((g) => g.id === gameId) ?? (myGames.length === 1 && !gameId ? myGames[0] : null);
  const balls = useMemo(() => (game && rcfg ? ballsOfGame(game, rcfg.play) : []), [game, rcfg]);
  const entries = useMemo(
    () => (state && round && game ? state.entries.filter((e) => e.round_id === round.id && (e.game ?? "main") === game.id) : []),
    [state, round, game],
  );
  const shots = useMemo(() => (rcfg && game && tcfg ? gameShots(rcfg, game, tcfg.players) : {}), [rcfg, game, tcfg]);
  /** Every score of the hole is in (or the hole was conceded) */
  const holeDone = useCallback(
    (n: number) => {
      if (!rcfg || !game) return false;
      const e = entries.find((x) => x.hole === n);
      return !!e && gameHole(rcfg, game, shots, { game: game.id, hole: n, scores: e.scores, conceded: e.conceded }).complete;
    },
    [rcfg, game, entries, shots],
  );

  // Swipe left = Next, right = the previous hole
  const swipe = useSwipe({
    onLeft: () => moments == null && more == null && hole != null && next(),
    onRight: () => moments == null && more == null && hole != null && before(hole) != null && (setSlide("back"), goTo(before(hole)!)),
  });

  // Back from the camera: say the clip is saved
  useEffect(() => {
    try {
      const f = sessionStorage.getItem("mgs_flash");
      if (f) {
        sessionStorage.removeItem("mgs_flash");
        setTimeout(() => setMsg(f), 0);
        setTimeout(() => setMsg(null), 4000);
      }
    } catch {}
  }, []);

  // The scorecard is a full-screen view on the course (the bar below has the way out)
  useEffect(() => {
    document.documentElement.classList.add("on-score");
    return () => document.documentElement.classList.remove("on-score");
  }, []);

  // Back from the camera or another page: the same match and hole as before
  useEffect(() => {
    if (!round || gameId || !myGames.length) return;
    const pos = readScorePos(slug, round.id);
    if (pos?.game && myGames.some((g) => g.id === pos.game)) setTimeout(() => setGameId(pos.game), 0);
  }, [round, gameId, myGames, slug]);

  useEffect(() => {
    if (!round || !game || hole != null) return;
    const pos = readScorePos(slug, round.id);
    const start = pos?.game === game.id && holeNums.includes(pos.hole) ? pos.hole : (holeNums.find((n) => !holeDone(n)) ?? last);
    setTimeout(() => setHole(start), 0);
  }, [round, game, hole, slug, holeNums, holeDone, last]);

  useEffect(() => {
    if (round && game && hole != null) writeScorePos(slug, round.id, { game: game.id, hole });
  }, [slug, round, game, hole]);

  // Arriving on a hole: its scores (blank if none yet), locked if it's already finished
  useEffect(() => {
    if (!round || hole == null || !game) return;
    // A save still waiting on this phone beats what the server last told us
    const pend = pendingHole(slug, round.id, game.id, hole)?.payload as { scores?: Draft; ctpWinner?: string | null; ldWinner?: string | null; conceded?: string | null } | undefined;
    const e = entries.find((x) => x.hole === hole);
    const d: Draft = {};
    for (const b of balls) d[b] = pend?.scores?.[b] ?? e?.scores[b] ?? { gross: null, gir: false, pickedUp: false };
    const c = pend ? (pend.ctpWinner ?? null) : (e?.ctp_winner ?? null);
    const l = pend ? (pend.ldWinner ?? null) : (e?.ld_winner ?? null);
    const k = pend ? (pend.conceded ?? null) : (e?.conceded ?? null);
    latest.current = { draft: d, ctp: c, ld: l, conceded: k };
    const done = !openedHole.current && (rcfg ? gameHole(rcfg, game, shots, { game: game.id, hole, scores: d, conceded: k }).complete : false);
    openedHole.current = false;
    setTimeout(() => {
      setDraft(d);
      setCtp(c);
      setLd(l);
      setConceded(k);
      setLocked(done);
      setMore(null);
      setErr(null);
    }, 0);
    // a hole that already has scores is finished again when the scorer leaves it (news is only sent once)
    unfinished.current = pend || e ? hole : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.id, game?.id, hole]);

  const syncQueue = useCallback(async () => {
    const r = await flush();
    setWaiting(r.left);
    if (r.error) setErr(r.error);
  }, []);

  useEffect(() => {
    setTimeout(() => setWaiting(queued().length), 0);
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
        <Link href={href(`/login?next=${encodeURIComponent(href("/score"))}`)}>Log in</Link> to see the scorecard.
      </p>
    );
  if (!round || !rcfg) return <p>No round to score.</p>;
  const ri = state.rounds.indexOf(round);

  // Not the scorer (or not yet chosen): the live card
  if (!game) {
    if (myGames.length > 1)
      return (
        <div className="scorer stack">
          <h1>
            R{round.number} {round.course_name}
          </h1>
          <p className="muted display">{correcting ? "Which match's score needs correcting?" : "Which match are you scoring?"}</p>
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
    return <LiveCard roundNumber={round.number} />;
  }
  if (hole == null) return <Loading />;

  const gi = rcfg.games.indexOf(game);
  const h = round.holes.find((x) => x.number === hole)!;
  const preview = gameHole(rcfg, game, shots, { game: game.id, hole, scores: draft, conceded });
  const card = cardInfo(state, round.id, game.id);
  const isOrg = session.role === "organiser";
  // Match play, one ball per side: a side concedes the hole instead of "picking up"
  const concedes = rcfg.scoring === "match" && game.sides.length === 2 && rcfg.play !== "fourball";
  const sideOfBall = (b: string) => game.sides.find((sd) => ballsOfSide(sd, rcfg.play).includes(b))?.id ?? null;
  const canPickUp = rcfg.scoring !== "stroke" || rcfg.play === "fourball";
  const oneBall = ONE_BALL.includes(rcfg.play);
  const nextNo = after(hole);

  /** Save a hole: on this phone straight away, to everyone as soon as there's signal. */
  function commit(holeNo: number, final: boolean) {
    if (!round || !game) return;
    const hh = round.holes.find((x) => x.number === holeNo)!;
    const { draft: d, ctp: c, ld: l, conceded: k } = latest.current;
    const payload = { scores: d, ctpWinner: hh.par === 3 ? c : null, ldWinner: hh.par === 5 ? l : null, conceded: k, final, ...(correcting ? { correct: true } : {}) };
    patch((st) => ({
      ...st,
      entries: [
        ...st.entries.filter((e) => !(e.round_id === round.id && (e.game ?? "main") === game.id && e.hole === holeNo)),
        {
          id: `local-${game.id}-${holeNo}`,
          round_id: round.id,
          game: game.id,
          hole: holeNo,
          scores: d,
          ctp_winner: payload.ctpWinner,
          ld_winner: payload.ldWinner,
          conceded: k,
          updated_by: session?.name ?? null,
          updated_at: new Date().toISOString(),
        },
      ],
    }));
    enqueue({ slug, roundId: round.id, game: game.id, hole: holeNo, payload });
    if (final && unfinished.current === holeNo) unfinished.current = null;
  }

  async function send() {
    setSaved("saving");
    const r = await flush();
    setWaiting(r.left);
    if (r.error) setErr(r.error);
    setSaved(r.left ? "phone" : "saved");
  }

  /** A change on this hole: saved now, sent a moment later, finished after two quiet minutes. */
  function changed() {
    const holeNo = hole!;
    setTimeout(() => {
      commit(holeNo, false);
      unfinished.current = holeNo;
      if (sendTimer.current) clearTimeout(sendTimer.current);
      sendTimer.current = setTimeout(send, 800);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => {
        if (unfinished.current === holeNo) {
          commit(holeNo, true);
          send();
        }
      }, 120_000);
    }, 0);
    setSaved("saving");
  }

  /** Leaving a hole (any way): if it was changed, it's finished. */
  function goTo(n: number) {
    if (unfinished.current != null) {
      commit(unfinished.current, true);
      send();
    }
    setHole(n);
  }

  function setB(b: string, p: Partial<BallHole>) {
    const n = { ...latest.current.draft, [b]: { ...latest.current.draft[b], ...p } };
    latest.current = { ...latest.current, draft: n };
    setDraft(n);
    changed();
  }
  function pickCtp(v: string | null) {
    setCtp(v);
    latest.current = { ...latest.current, ctp: v };
    changed();
  }
  function pickLd(v: string | null) {
    setLd(v);
    latest.current = { ...latest.current, ld: v };
    changed();
  }
  /** One side concedes the hole (tap again to undo): their ball is marked as not holed out. */
  function concede(sideId: string) {
    const next = latest.current.conceded === sideId ? null : sideId;
    const d = { ...latest.current.draft };
    for (const sd of game!.sides) {
      for (const b of ballsOfSide(sd, rcfg!.play)) {
        if (sd.id === next) d[b] = { ...d[b], gross: null, pickedUp: true };
        else if (d[b]?.pickedUp) d[b] = { ...d[b], gross: null, pickedUp: false };
      }
    }
    latest.current = { ...latest.current, draft: d, conceded: next };
    setDraft(d);
    setConceded(next);
    changed();
  }

  /** "Next": if a score is missing, ask first (enter it, or skip and come back). Nothing is ever filled in for anyone. */
  function next() {
    if (!round || !game) return;
    const d = latest.current.draft;
    const touched = Object.values(d).some((x) => x.gross != null || x.pickedUp) || !!latest.current.conceded;
    if (touched && !preview.complete) {
      const missing = balls.filter((b) => {
        const sc = d[b];
        const gaveUp = !!latest.current.conceded && sideOfBall(b) === latest.current.conceded;
        return !gaveUp && !sc?.pickedUp && sc?.gross == null;
      });
      if (missing.length) return setMissingAsk(missing.map((b) => ballName(b, game, state!.players)));
    }
    moveOn();
  }

  /** Save the hole as it stands and move on. A missing score is allowed; the hole stays unfinished. */
  function moveOn() {
    if (!round || !game) return;
    setMissingAsk(null);
    const touched = Object.values(latest.current.draft).some((x) => x.gross != null || x.pickedUp) || !!latest.current.conceded;
    if (touched) {
      commit(hole!, true);
      send();
    }
    if (idleTimer.current) clearTimeout(idleTimer.current);
    unfinished.current = null;
    if (preview.complete) return setMoments(hole!);
    if (touched) flash(`Hole ${hole} isn't finished: a score is missing. Come back to it.`);
    onward(hole!);
  }

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(null), 4000);
  }

  /** The hole as the shot card needs it, and the questions its scores raise. */
  function holeQuestions(n: number): { info: HoleInfo; prompts: Prompt[]; headline: { text: string; playerId: string } | null } {
    const hh = round!.holes.find((x) => x.number === n)!;
    const info: HoleInfo = { par: hh.par, yards: hh.yards, note: round!.course_guide?.holes?.[String(n)] ?? "" };
    const e = entries.find((x) => x.hole === n);
    const prompts: Prompt[] = [];
    for (const b of balls) {
      const p = state!.players.find((x) => x.id === b);
      if (!p) continue; // team balls: no single player to ask about
      const pr = scorePrompt(p.name, p.id, e?.scores[b]?.pickedUp ? null : e?.scores[b]?.gross, info);
      if (pr) prompts.push(pr);
    }
    // birdies first, then the disasters
    prompts.sort((a, b) => Number(/went wrong/.test(a.question)) - Number(/went wrong/.test(b.question)));
    let headline: { text: string; playerId: string } | null = null;
    if (rcfg!.scoring === "match" && game!.sides.length === 2) {
      const [A, B] = game!.sides;
      const played = entries.filter((x) => x.hole <= n).sort((a, b) => a.hole - b.hole);
      let d = 0;
      const diffs: number[] = [];
      let lastWinner: string | null = null;
      for (const x of played) {
        const gh = gameHole(rcfg!, game!, shots, { game: game!.id, hole: x.hole, scores: x.scores, conceded: x.conceded });
        if (gh.winner === A.id) d++;
        else if (gh.winner === B.id) d--;
        if (x.hole === n) lastWinner = gh.winner === A.id || gh.winner === B.id ? gh.winner : null;
        diffs.push(d);
      }
      const nameOf = (sideId: string) => sideLabel(sideId, game!, state!.players);
      const text = matchMoment(diffs, holeNums.indexOf(n) + 1, round!.holes.length, lastWinner ? nameOf(lastWinner) : null, nameOf(A.id), nameOf(B.id));
      const side = game!.sides.find((x) => x.id === lastWinner);
      if (text && side?.playerIds[0]) headline = { text, playerId: side.playerIds[0] };
    }
    return { info, prompts, headline };
  }

  /** On to the next hole (or check the card when the match is over or the last hole is done). */
  function onward(was: number) {
    setMoments(null);
    setSlide("fwd");
    // The match is over (all in, or decided early): check and submit the card
    if (state && round && game && gameComplete(state, round.id, game) && cardInfo(state, round.id, game.id).stage !== "final") return setReview(true);
    const n = after(was);
    if (n != null) return setHole(n);
    const missing = holeNums.find((x) => !holeDone(x) && x !== was);
    if (missing != null) {
      flash(`Hole ${missing} isn't finished yet.`);
      return setHole(missing);
    }
    router.push(href("/live"));
  }

  const sideChoices = [...balls.map((b) => ({ id: b as string | null, label: ballName(b, game, state.players) })), { id: null, label: "Nobody" }];
  const winnerText =
    preview.complete && rcfg.scoring === "match" && preview.winner
      ? preview.winner === "halved"
        ? "Hole halved"
        : `${conceded ? `${sideLabel(conceded, game, state.players)} ${game.sides.find((s) => s.id === conceded)!.playerIds.length > 1 ? "concede" : "concedes"}. ` : ""}${sideLabel(preview.winner, game, state.players)} win${game.sides.find((s) => s.id === preview.winner)!.playerIds.length > 1 ? "" : "s"} the hole`
      : null;

  // The card: checking and submitting at the end, signing, or a final card (read-only unless correcting)
  if (review || card.stage === "submitted" || (card.stage === "final" && !correcting)) {
    const early = card.stage === "finished" && entries.length < round.holes.length;
    return (
      <div className="scorer">
        <CardPanel
          roundId={round.id}
          gameId={game.id}
          onBack={card.stage === "final" ? undefined : () => setReview(false)}
          backLabel={early ? "Keep scoring for the side games" : "Back to the holes"}
          onDone={() => router.push(href("/live"))}
        />
      </div>
    );
  }

  const holeState = (n: number) => (holeDone(n) ? "done" : entries.some((e) => e.hole === n) ? "part" : "");

  return (
    <div className={`scorer scorecard${slide ? ` slide-${slide}` : ""}`} key={hole} {...swipe}>
      {correcting && (
        <p className="correcting">
          Correcting {game.name ?? `Match ${gi + 1}`}: every change is logged{isOrg && card.stage === "final" ? " and the card is marked as amended" : ""}.{" "}
          <Link href={href("/admin#cards")}>Done</Link>
        </p>
      )}
      <div className="score-top">
        <span className="where">
          R{round.number} · {round.course_name}
          {holeNums.length <= 9 ? ` · ${holeNums.length} holes` : ""}
        </span>
        <span className="status">
          {(session.playerId && fieldPosition(roundBoard(state, summary, round), session.playerId)) || gameLine(round, game, summary.rounds[ri].games[gi], state.players)}
        </span>
        {card.stage !== "open" && (
          <button className="chip" onClick={() => setReview(true)}>
            The card
          </button>
        )}
        {myGames.length > 1 && (
          <button
            className="chip"
            onClick={() => {
              setGameId(null);
              setHole(null);
            }}
          >
            {game.name ?? `Match ${gi + 1}`} ▾
          </button>
        )}
      </div>

      <div className="hole-head">
        <button className="navbtn" aria-label="Previous hole" disabled={before(hole) == null} onClick={() => before(hole) != null && goTo(before(hole)!)}>
          ‹
        </button>
        <button className="hole-pick" aria-label={`Hole ${hole}. Tap to choose another hole`} onClick={() => setPicking(true)}>
          <span className="n">{hole}</span>
          <span className="info">
            Par {h.par} · SI {h.si}
            {h.yards ? <br /> : null}
            {h.yards ? `${h.yards} yds` : null}
          </span>
        </button>
        <button className="navbtn" aria-label="Next hole" disabled={nextNo == null} onClick={() => nextNo != null && goTo(nextNo)}>
          ›
        </button>
      </div>

      {moments != null &&
        (() => {
          const q = holeQuestions(moments);
          const nx = after(moments);
          return (
            <ShotCard
              key={moments}
              roundId={round.id}
              roundNumber={round.number}
              hole={moments}
              holeInfo={q.info}
              players={groupPlayers(state, round.id, game.id)}
              prompts={q.prompts}
              headline={q.headline}
              nextLabel={card.stage === "finished" ? (entries.length < round.holes.length ? "The match is over: check the card" : "Check the card") : nx != null ? `On to hole ${nx}` : "Finish the round"}
              backLabel={`back to hole ${moments}`}
              onContinue={() => onward(moments)}
              onBack={() => (setMoments(null), setSlide("back"))}
              onLeave={() => nx != null && writeScorePos(slug, round.id, { game: game.id, hole: nx })}
            />
          );
        })()}

      {picking && (
        <div className="hole-sheet" role="dialog" aria-label="Choose a hole">
          <div className="grid">
            {round.holes.map((x) => (
              <button
                key={x.number}
                className={x.number === hole ? "current" : holeState(x.number)}
                onClick={() => {
                  setPicking(false);
                  goTo(x.number);
                }}
              >
                {x.number}
                <small>{holeState(x.number) === "part" ? "Not finished" : `Par ${x.par}`}</small>
              </button>
            ))}
          </div>
          <button className="btn secondary block" onClick={() => setPicking(false)}>
            Back to hole {hole}
          </button>
        </div>
      )}

      {locked ? (
        <FrozenHole
          balls={balls}
          game={game}
          draft={draft}
          par={h.par}
          shotsOn={(b) => holeShots(rcfg, shots[b] ?? 0, h.number)}
          stableford={rcfg.scoring === "stableford"}
          conceded={conceded}
          sideOfBall={sideOfBall}
          names={(b) => ballName(b, game, state.players)}
          result={winnerText}
          onEdit={() => setLocked(false)}
        />
      ) : (
        <>
          {balls.map((b) => {
            const sc = draft[b] ?? { gross: null };
            const st = holeShots(rcfg, shots[b] ?? 0, h.number);
            const gaveUp = !!conceded && sideOfBall(b) === conceded;
            const label = ballName(b, game, state.players);
            const ptsHere = rcfg.scoring === "stableford" && !sc.pickedUp && sc.gross != null ? Math.max(0, 2 + h.par - (sc.gross - st)) : null;
            return (
              <section className="pscore entry" key={b} aria-label={`${label} score`}>
                <div className="ptop">
                  <span className="pwho">
                    <span className="pname" style={{ fontSize: label.length > 12 ? 19 : undefined }}>
                      {label}
                    </span>
                    <span className="shots">
                      {st > 0 ? `${st} shot${st > 1 ? "s" : ""} here` : ""}
                      {ptsHere != null ? `${st > 0 ? " · " : ""}${ptsHere} pt${ptsHere === 1 ? "" : "s"}` : ""}
                    </span>
                  </span>
                  <button className="chip big" aria-pressed={!!sc.gir} onClick={() => setB(b, { gir: !sc.gir })}>
                    Green in reg
                  </button>
                  {concedes ? (
                    <button className="chip big" aria-pressed={gaveUp} onClick={() => sideOfBall(b) && concede(sideOfBall(b)!)}>
                      Concedes
                    </button>
                  ) : (
                    canPickUp && (
                      <button className="chip big" aria-pressed={!!sc.pickedUp} onClick={() => setB(b, sc.pickedUp ? { pickedUp: false, gross: null } : { pickedUp: true, gross: null })}>
                        Picked up
                      </button>
                    )
                  )}
                </div>
                {gaveUp || sc.pickedUp ? (
                  <p className="gave-up">{gaveUp ? "Conceded the hole" : "Picked up"}</p>
                ) : (
                  <Stepper label={label} par={h.par} value={sc.gross ?? null} onSet={(n) => setB(b, { gross: n, pickedUp: false })} onOpen={() => setMore(b)} />
                )}
              </section>
            );
          })}

          {h.par === 3 && (
            <section className="pscore side-game">
              <div className="pname">Closest to the pin</div>
              <div className="side-pick" style={{ gridTemplateColumns: `repeat(${Math.min(3, sideChoices.length)}, 1fr)` }}>
                {sideChoices.map((c) => (
                  <button key={String(c.id)} className="toggle" aria-pressed={ctp === c.id} onClick={() => pickCtp(c.id)}>
                    {c.label}
                  </button>
                ))}
              </div>
            </section>
          )}
          {h.par === 5 && (
            <section className="pscore side-game">
              <div className="pname">Long drive</div>
              <div className="side-pick" style={{ gridTemplateColumns: `repeat(${Math.min(3, sideChoices.length)}, 1fr)` }}>
                {sideChoices.map((c) => (
                  <button key={String(c.id)} className="toggle" aria-pressed={ld === c.id} onClick={() => pickLd(c.id)}>
                    {c.label}
                  </button>
                ))}
              </div>
            </section>
          )}

          {winnerText && <p className="hole-result">{winnerText}</p>}
          {oneBall && <p className="small muted" style={{ textAlign: "center" }}>One score per side: enter the team&apos;s score on the hole.</p>}
        </>
      )}

      {missingAsk && (
        <div className="hole-sheet" role="dialog" aria-label="A score is missing">
          <p className="display" style={{ fontSize: 22, margin: 0 }}>
            {missingAsk.length === 1 ? `${missingAsk[0]}'s score isn't in.` : `${missingAsk.slice(0, -1).join(", ")} and ${missingAsk[missingAsk.length - 1]}'s scores aren't in.`}
          </p>
          <button className="btn block" onClick={() => setMissingAsk(null)}>
            Enter {missingAsk.length === 1 ? "it" : "them"}
          </button>
          <button className="btn secondary block" onClick={moveOn}>
            Skip for now and come back
          </button>
        </div>
      )}

      {more && (
        <div className="hole-sheet" role="dialog" aria-label={`${ballName(more, game, state.players)}: choose the score`}>
          <p className="display" style={{ fontSize: 22, margin: 0 }}>
            {ballName(more, game, state.players)} on hole {hole}
          </p>
          <div className="grid numbers">
            {Array.from({ length: 15 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                className={draft[more]?.gross === n ? "current" : ""}
                onClick={() => {
                  setB(more, { gross: n, pickedUp: false });
                  setMore(null);
                }}
              >
                {n}
                <small>{scoreWord(n, h.par)}</small>
              </button>
            ))}
          </div>
          {draft[more]?.gross != null && (
            <button
              className="btn secondary block"
              onClick={() => {
                setB(more, { gross: null, pickedUp: false });
                setMore(null);
              }}
            >
              Clear the score
            </button>
          )}
          <button className="btn secondary block" onClick={() => setMore(null)}>
            Back
          </button>
        </div>
      )}

      <div className="sticky-save">
        <button className="btn block next-hole" onClick={next}>
          {nextNo != null ? `Next: hole ${nextNo}` : "Finish: check the card"}
          <small className={`saved-line${saved === "phone" ? " phone" : ""}`} aria-live="polite">
            {msg ?? (saved === "saving" ? "Saving…" : saved === "saved" ? "✓ Saved for everyone" : saved === "phone" ? "Saved on this phone. Sends when there's signal" : "Every tap is saved as you go")}
          </small>
        </button>

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
    </div>
  );
}

/** A finished hole, locked: the scores and the result, and Edit score to change them. */
function FrozenHole(p: {
  balls: string[];
  game: Game;
  draft: Draft;
  par: number;
  shotsOn: (b: string) => number;
  stableford: boolean;
  conceded: string | null;
  sideOfBall: (b: string) => string | null;
  names: (b: string) => string;
  result: string | null;
  onEdit: () => void;
}) {
  return (
    <div className="frozen">
      {p.balls.map((b) => {
        const sc = p.draft[b] ?? { gross: null };
        const gaveUp = !!p.conceded && p.sideOfBall(b) === p.conceded;
        const st = p.shotsOn(b);
        const pts = p.stableford && !sc.pickedUp && sc.gross != null ? Math.max(0, 2 + p.par - (sc.gross - st)) : null;
        return (
          <div className="frow" key={b}>
            <span className="pname">{p.names(b)}</span>
            <span className="fval">
              {gaveUp ? "Conceded" : sc.pickedUp ? "Picked up" : sc.gross}
              {!gaveUp && !sc.pickedUp && sc.gross != null && <small>{scoreWord(sc.gross, p.par)}{pts != null ? ` · ${pts} pt${pts === 1 ? "" : "s"}` : ""}</small>}
            </span>
          </div>
        );
      })}
      {p.result && <p className="hole-result">{p.result}</p>}
      <button className="btn secondary block edit-score" onClick={p.onEdit}>
        Edit score
      </button>
    </div>
  );
}

/** Everyone but the scorer: the match's card, live, and who's keeping it. Record and Note are in the bar below. */
function LiveCard({ roundNumber }: { roundNumber: number }) {
  const { state, session, summary, href } = useT();
  const [pick, setPick] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  if (!state || !summary) return <Loading />;
  const round = state.rounds.find((r) => r.number === roundNumber)!;
  const cfg = toRoundCfg(round, state.players);
  const ri = state.rounds.indexOf(round);
  const mine = cfg.games.find((g) => g.sides.some((s) => s.playerIds.includes(session?.playerId ?? "")));
  const game = choosing ? null : (cfg.games.find((g) => g.id === pick) ?? mine ?? (cfg.games.length === 1 ? cfg.games[0] : null));

  if (!game)
    return (
      <div className="scorer stack">
        <h1>
          R{round.number} {round.course_name}
        </h1>
        <p className="muted display">Which match do you want to follow?</p>
        {cfg.games.map((g, gi) => (
          <button key={g.id} className="round-item" style={{ gridTemplateColumns: "1fr auto", textAlign: "left", font: "inherit", cursor: "pointer" }} onClick={() => (setPick(g.id), setChoosing(false))}>
            <span>
              <span className="display" style={{ fontWeight: 700, fontSize: 19, display: "block" }}>
                {g.name ?? `Match ${gi + 1}`}
              </span>
              <span className="meta">{g.sides.map((s) => sideLabel(s.id, g, state.players)).join(" v ")}</span>
            </span>
            <span className="res">{gameLine(round, g, summary.rounds[ri].games[gi], state.players)}</span>
          </button>
        ))}
      </div>
    );

  const gi = cfg.games.indexOf(game);
  const scorer = state.players.find((p) => p.id === game.scorerId);
  return (
    <div className="scorer stack live-card">
      <div className="keeper">
        <span className="who">{scorer ? `${scorer.name} is keeping score` : "No scorer set for this match yet"}</span>
        <span className="small">
          {scorer ? "Scores appear here as they go in. Use Record and Note below for the moments." : "Ask the organiser to choose who keeps the score."}
        </span>
      </div>
      <p className="display live-line">{gameLine(round, game, summary.rounds[ri].games[gi], state.players)}</p>
      <Scorecard round={round} gameIndex={gi} compact />
      {cfg.games.length > 1 && (
        <button className="btn secondary block" onClick={() => setChoosing(true)}>
          Follow another match
        </button>
      )}
      {session?.role === "organiser" && (
        <Link className="btn secondary block" href={href(`/score?round=${round.number}&game=${encodeURIComponent(game.id)}&correct=1`)}>
          Correct a score (logged)
        </Link>
      )}
    </div>
  );
}

export default function ScorePage() {
  return (
    <Suspense fallback={<Loading />}>
      <ScoreInner />
    </Suspense>
  );
}

/**
 * One player's score: minus, the number, plus. It starts on par, faded, meaning "not entered": nothing is saved until
 * someone taps. Plus or minus records par plus or minus one; tapping the faded number records par. Tapping an entered
 * number opens the full list (any score, or clear it).
 */
function Stepper({ label, par, value, onSet, onOpen }: { label: string; par: number; value: number | null; onSet: (n: number) => void; onOpen: () => void }) {
  return (
    <div className={`score-step${value == null ? " is-empty" : ""}`} data-par={par} data-value={value ?? ""} role="group" aria-label={`${label}'s score`}>
      <button className="ss-btn ss-minus" aria-label={`${label}: one fewer`} disabled={value != null && value <= 1} onClick={() => onSet(value == null ? Math.max(1, par - 1) : Math.max(1, value - 1))}>
        <span aria-hidden>&minus;</span>
      </button>
      <button
        className="ss-val"
        aria-label={value == null ? `${label}: not entered. Tap for par ${par}` : `${label}: ${value}, ${scoreWord(value, par).toLowerCase()}. Tap to choose another score`}
        onClick={() => (value == null ? onSet(par) : onOpen())}
      >
        <span className="v">{value ?? par}</span>
        <small>{value == null ? "Tap for par" : scoreWord(value, par)}</small>
      </button>
      <button className="ss-btn ss-plus" aria-label={`${label}: one more`} disabled={value != null && value >= 15} onClick={() => onSet(value == null ? par + 1 : Math.min(15, value + 1))}>
        <span aria-hidden>+</span>
      </button>
    </div>
  );
}
