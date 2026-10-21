"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useT } from "@/components/Providers";
import { Loading } from "@/components/ui";
import type { SetupJob } from "@/lib/types";

/**
 * Straight after "Create my tournament": a waiting screen while the course guides and the first preview are
 * written, then "You're ready". You can leave at any point; the organiser page carries on where this stopped.
 */
export default function Ready() {
  const { state, session, sessionReady, api, href, refresh } = useT();
  const [jobs, setJobs] = useState<SetupJob[] | null>(null);
  const [skipped, setSkipped] = useState(false);
  const running = useRef(false);

  const todo = (jobs ?? []).filter((j) => j.status === "todo");
  const finished = !!jobs && (todo.length === 0 || skipped);

  useEffect(() => {
    if (!state || jobs) return;
    const t = setTimeout(() => setJobs(state.tournament.setup_jobs ?? []), 0);
    return () => clearTimeout(t);
  }, [state, jobs]);

  // One step at a time until nothing's left
  useEffect(() => {
    if (!jobs || skipped || running.current || !todo.length || session?.role !== "organiser") return;
    running.current = true;
    let stop = false;
    (async () => {
      while (!stop) {
        const r = await api("/api/setup", {});
        if (!r.ok) {
          await new Promise((res) => setTimeout(res, 4000));
          continue;
        }
        const list = (r.j.jobs as SetupJob[]) ?? [];
        if (!stop) setJobs(list);
        if (!list.some((j) => j.status === "todo")) break;
        // Another phone is on this step: wait a moment and look again
        if (r.j.busy) await new Promise((res) => setTimeout(res, 5000));
      }
      running.current = false;
      refresh();
    })();
    return () => {
      stop = true;
      running.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs === null, skipped, session?.role]);

  if (!state || !sessionReady) return <Loading />;
  const t = state.tournament;
  if (session?.role !== "organiser")
    return (
      <div className="panel stack" style={{ maxWidth: 520 }}>
        <h1>{t.name}</h1>
        <Link className="btn block big" href={href("/")}>
          See the tournament
        </Link>
      </div>
    );

  const solo = state.players.length === 1;
  const total = (jobs ?? []).length;
  const done = (jobs ?? []).filter((j) => j.status !== "todo").length;

  if (!finished)
    return (
      <section className="getting-ready" aria-live="polite">
        <div className="gr-icon" aria-hidden>
          <svg viewBox="0 0 64 64">
            <line x1="22" y1="10" x2="22" y2="54" />
            <path d="M22 10 L46 17 L22 24 Z" />
            <ellipse cx="22" cy="55" rx="14" ry="3.5" />
          </svg>
        </div>
        <h1>Getting {t.name} ready</h1>
        <p className="lead">
          Reading up on {state.rounds.length === 1 ? "the course" : "the courses"} hole by hole, so the previews and reports know what they&apos;re talking about. This can take a few minutes.
        </p>
        <ol className="gr-list">
          {(jobs ?? []).map((j) => (
            <li key={j.id} className={`gr-${j.status}`}>
              <span className="gr-mark" aria-hidden>
                {j.status === "done" ? "✓" : j.status === "todo" ? "" : "–"}
              </span>
              <span>
                {j.label}
                {j.note && j.status !== "todo" && <small>{j.note}</small>}
              </span>
            </li>
          ))}
        </ol>
        <p className="gr-progress num">
          {done} of {total} done
        </p>
        <div className="gr-leave">
          <p>
            You don&apos;t have to wait. It carries on when you next open the organiser page, and the tournament is ready to use now.
          </p>
          <button type="button" className="btn secondary block" onClick={() => setSkipped(true)}>
            Carry on without waiting
          </button>
        </div>
      </section>
    );

  return (
    <section className="you-ready">
      <h1>You&apos;re ready</h1>
      <p className="lead">{t.name} is set up. Nobody else can see it until you share it.</p>
      <div className="ready-tiles">
        {!solo && (
          <Link className="ready-tile main" href={href("/admin#players")}>
            <strong>Send everyone their link</strong>
            <span>By WhatsApp, text or email. One tap and they&apos;re in</span>
          </Link>
        )}
        <Link className="ready-tile" href={href("/")}>
          <strong>See your site</strong>
          <span>What everyone will see</span>
        </Link>
        <Link className="ready-tile" href={href("/setup")}>
          <strong>Tournament setup</strong>
          <span>Change any answer: players, rounds, groups, points and more</span>
        </Link>
      </div>
      {(jobs ?? []).some((j) => j.status === "todo") && <p className="small muted">Still reading up on the courses: that carries on when you open Organiser.</p>}
    </section>
  );
}
