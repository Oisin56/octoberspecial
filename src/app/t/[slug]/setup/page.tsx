"use client";

import { useState } from "react";
import Link from "next/link";
import { useT } from "@/components/Providers";
import { Loading } from "@/components/ui";
import {
  BasicsEditor,
  ContentEditor,
  InviteEditor,
  PlayersEditor,
  RoundsEditor,
  SideGamesEditor,
  useAdmin,
} from "@/components/editors";

const STEPS = [
  { id: "basics", label: "Basics and look" },
  { id: "players", label: "Players and teams" },
  { id: "rounds", label: "Courses, rounds and formats" },
  { id: "sides", label: "Side games" },
  { id: "content", label: "Writing and media" },
  { id: "invite", label: "Invite and go live" },
] as const;

export default function Setup() {
  const { session, href } = useT();
  const { data, err, reload } = useAdmin();
  const [step, setStep] = useState(0);

  if (!session)
    return (
      <p>
        <Link href={href(`/login?next=${encodeURIComponent(href("/setup"))}`)}>Log in</Link> as organiser to set up this tournament.
      </p>
    );
  if (session.role !== "organiser") return <p>Organiser only.</p>;
  if (err) return <p className="error">{err}</p>;
  if (!data) return <Loading />;

  const ready = {
    basics: !!data.state.tournament.name,
    players: data.state.players.length >= 2,
    rounds: data.state.rounds.length >= 1,
    sides: true,
    content: true,
    invite: data.state.tournament.published,
  };

  return (
    <div className="stack">
      <h1>Set up your tournament</h1>
      <ol className="steps" aria-label="Setup steps">
        {STEPS.map((s, i) => (
          <li key={s.id}>
            <button className="chip" aria-current={i === step ? "step" : undefined} aria-pressed={i === step} onClick={() => setStep(i)}>
              {i + 1}. {s.label}
              {ready[s.id] && i !== step ? " ✓" : ""}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && <BasicsEditor data={data} onSaved={reload} />}
      {step === 1 && (
        <>
          <p className="muted" style={{ margin: 0 }}>
            Add everyone playing. For a team event, add the teams first, then put each player on a team.
          </p>
          <PlayersEditor data={data} onSaved={reload} />
        </>
      )}
      {step === 2 && (
        <>
          <p className="muted" style={{ margin: 0 }}>
            Add each round: find the course, pick the tees, then open the round to set the format, points, handicaps and who plays whom.
          </p>
          {data.state.players.length < 2 && <p className="notice">Add players first (step 2), so you can build the matches.</p>}
          <RoundsEditor data={data} onSaved={reload} />
        </>
      )}
      {step === 3 && <SideGamesEditor data={data} onSaved={reload} />}
      {step === 4 && <ContentEditor data={data} onSaved={reload} />}
      {step === 5 && <InviteEditor data={data} onSaved={reload} />}

      <div className="row" style={{ justifyContent: "space-between" }}>
        <button className="btn secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>
          Back
        </button>
        {step < STEPS.length - 1 ? (
          <button className="btn" onClick={() => setStep(step + 1)}>
            Next: {STEPS[step + 1].label}
          </button>
        ) : (
          <Link className="btn" href={href("/")}>
            View the site
          </Link>
        )}
      </div>
    </div>
  );
}
