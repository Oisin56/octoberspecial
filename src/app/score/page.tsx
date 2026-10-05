"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/components/Providers";
import { Loading, SegmentBoxes, pts } from "@/components/ui";
import { enqueue, flush, queued } from "@/lib/offlineQueue";
import { holeResult, shotsOnHole, type PlayerHole } from "@/lib/scoring";
import { FORMAT_LABEL, toRoundConfig } from "@/lib/types";

type Draft = Record<string, PlayerHole>;

function ScoreInner() {
  const { state, summary, session, patch, names } = useT();
  const sp = useSearchParams();
  const router = useRouter();
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

  const players = useMemo(() => state?.players.map((p) => p.id) ?? [], [state]);
  const entries = useMemo(() => (state && round ? state.entries.filter((e) => e.round_id === round.id) : []), [state, round]);

  // Start on the first hole without a score
  useEffect(() => {
    if (!round || hole != null) return;
    const done = new Set(entries.map((e) => e.hole));
    const first = round.holes.find((h) => !done.has(h.number))?.number ?? 18;
    setHole(first);
  }, [round, entries, hole]);

  // Load the draft for this hole from saved data (or default to par)
  useEffect(() => {
    if (!round || hole == null) return;
    const h = round.holes.find((x) => x.number === hole)!;
    const e = entries.find((x) => x.hole === hole);
    const d: Draft = {};
    for (const p of players) d[p] = e?.scores[p] ?? { gross: h.par, gir: false, pickedUp: false };
    setDraft(d);
    setCtp(e?.ctp_winner ?? null);
    setLd(e?.ld_winner ?? null);
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.id, hole]);

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

  if (!state || !summary) return <Loading />;
  if (!session)
    return (
      <p>
        <Link href="/login?next=/score">Log in</Link> to enter scores.
      </p>
    );
  if (!round) return <p>No round to score.</p>;
  const isScorer = session.role === "organiser" || session.playerId === round.scorer_id;
  if (!isScorer)
    return (
      <div className="notice">
        {names[round.scorer_id ?? ""] ?? "The organiser"} is scoring Round {round.number}. You can still{" "}
        <Link href={`/post?round=${round.number}`}>add posts</Link>, or <Link href="/admin">ask the organiser</Link> to hand
        scoring to you.
      </div>
    );
  if (hole == null) return <Loading />;

  const h = round.holes.find((x) => x.number === hole)!;
  const cfg = toRoundConfig(round);
  const preview = holeResult(cfg, players, { hole, scores: draft });
  const rIdx = state.rounds.indexOf(round);
  const done = new Set(entries.map((e) => e.hole));
  const canPickUp = round.format !== "stroke";

  function setP(p: string, patchP: Partial<PlayerHole>) {
    setDraft((d) => ({ ...d, [p]: { ...d[p], ...patchP } }));
  }

  async function save(goNext: boolean) {
    if (!round) return;
    setErr(null);
    const payload = { scores: draft, ctpWinner: h.par === 3 ? ctp : null, ldWinner: h.par === 5 ? ld : null };
    // Show it immediately on this phone
    patch((s) => {
      const others = s.entries.filter((e) => !(e.round_id === round.id && e.hole === hole));
      return {
        ...s,
        entries: [
          ...others,
          {
            id: `local-${hole}`,
            round_id: round.id,
            hole: hole!,
            scores: draft,
            ctp_winner: payload.ctpWinner,
            ld_winner: payload.ldWinner,
            updated_by: session?.name ?? null,
            updated_at: new Date().toISOString(),
          },
        ],
      };
    });
    enqueue({ roundId: round.id, hole: hole!, payload, at: Date.now() });
    const r = await flush();
    setWaiting(r.left);
    if (r.error) setErr(r.error);
    setMsg(r.left ? `Hole ${hole} saved on this phone. It'll send when there's signal.` : `Hole ${hole} saved.`);
    setTimeout(() => setMsg(null), 2500);
    if (goNext && hole! < 18) setHole(hole! + 1);
    if (goNext && hole === 18) router.push("/live");
  }

  const sideChoices = [...players.map((p) => ({ id: p, label: names[p] })), { id: null, label: "Nobody" }];

  return (
    <div className="scorer">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <div className="display" style={{ fontSize: 17 }}>
          R{round.number} {round.course_name} · {FORMAT_LABEL[round.format]}
        </div>
        <Link className="display small" href={`/post?round=${round.number}&hole=${hole}`}>
          Add note for this hole
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

      {players.map((p) => {
        const ph = draft[p] ?? { gross: h.par };
        const shots = shotsOnHole(round.shots?.[p] ?? 0, h.si);
        const toPar = ph.gross != null ? ph.gross - h.par : 0;
        const word =
          ph.pickedUp ? "Picked up" : toPar <= -2 ? "Eagle" : toPar === -1 ? "Birdie" : toPar === 0 ? "Par" : toPar === 1 ? "Bogey" : toPar === 2 ? "Double" : `+${toPar}`;
        return (
          <section className="pscore" key={p} aria-label={`${names[p]} score`}>
            <div className="top">
              <span className="pname">{names[p]}</span>
              <span className="shots">{shots > 0 ? `${shots} shot${shots > 1 ? "s" : ""} here` : ""}</span>
            </div>
            <div className="stepper">
              <button
                aria-label={`${names[p]} one less`}
                onClick={() => setP(p, { gross: Math.max(1, (ph.gross ?? h.par) - 1), pickedUp: false })}
              >
                −
              </button>
              <div className="val" aria-live="polite">
                {ph.pickedUp ? "–" : ph.gross}
                <small>
                  {word}
                  {round.format === "stableford" && !ph.pickedUp ? ` · ${preview.stableford[p]} pts` : ""}
                </small>
              </div>
              <button
                aria-label={`${names[p]} one more`}
                onClick={() => setP(p, { gross: Math.min(15, (ph.gross ?? h.par) + 1), pickedUp: false })}
              >
                +
              </button>
            </div>
            <div className="toggles">
              <button className="toggle" aria-pressed={!!ph.gir} onClick={() => setP(p, { gir: !ph.gir })}>
                Green in reg
              </button>
              {canPickUp && (
                <button
                  className="toggle"
                  aria-pressed={!!ph.pickedUp}
                  onClick={() => setP(p, ph.pickedUp ? { pickedUp: false, gross: h.par } : { pickedUp: true, gross: null })}
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
          <div className="side-pick">
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
          <div className="side-pick">
            {sideChoices.map((c) => (
              <button key={String(c.id)} className="toggle" aria-pressed={ld === c.id} onClick={() => setLd(c.id)}>
                {c.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {round.format === "match" && preview.matchWinner && (
        <p className="display" style={{ textAlign: "center", fontSize: 18, margin: "10px 0 0" }}>
          {preview.matchWinner === "halved" ? "Hole halved" : `${names[preview.matchWinner]} wins the hole`}
        </p>
      )}

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
          <button
            key={x.number}
            className={x.number === hole ? "current" : done.has(x.number) ? "done" : ""}
            onClick={() => setHole(x.number)}
          >
            {x.number}
          </button>
        ))}
      </div>

      <div className="section">
        <SegmentBoxes rs={summary.rounds[rIdx]} round={round} />
        <p className="display small muted" style={{ marginTop: 8 }}>
          Round points so far: {players.map((p) => `${names[p]} ${pts(summary.rounds[rIdx].points[p])}`).join(" · ")}
        </p>
      </div>

      <Attest roundId={round.id} />
    </div>
  );
}

function Attest({ roundId }: { roundId: string }) {
  const { state, session, summary, refresh, names } = useT();
  const [busy, setBusy] = useState(false);
  if (!state || !summary || !session?.playerId) return null;
  const idx = state.rounds.findIndex((r) => r.id === roundId);
  const rs = summary.rounds[idx];
  const segs = (["front", "back"] as const).filter((s) => rs[s].complete);
  if (!segs.length) return null;
  const att = state.attestations.filter((a) => a.round_id === roundId);

  async function attest(segment: "front" | "back") {
    setBusy(true);
    await fetch("/api/attest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roundId, segment }),
    });
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
