"use client";

/**
 * The set-up screens: one question each, big tiles, saved as you tap. The wizard runs them in order; Tournament
 * setup opens any one of them to change an answer. Each screen calls `done` when it's answered.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { CardTable } from "@/components/editors";
import { LIGHT_BOARD, THEMES, TONE_LABEL, type HoleSet, type Tone } from "@/lib/types";
import { bracketSize, type BonusKind, type Prize, type PrizeKind } from "@/lib/engine";
import { CAN_POINTS, CAN_PRIZE, SIDE_KINDS, SIDE_NAME, and, onTopLine, ordinal, parHoles, sideLine, type SideKind, type SideRound, type SideSetup } from "@/lib/sidegames";
import {
  FORMAT_NAMES,
  MAX_PLAYERS,
  MAX_ROUNDS,
  MAX_TEAMS,
  defaultPoints,
  defaultWin,
  formatName,
  inSentence,
  handicapFor,
  isMatch,
  isPairs,
  knockoutEntrants,
  roundFormats,
  shotsByHand,
  winsFor,
  type DayFormat,
  type RoundPoints,
  type WinChoice,
} from "@/lib/wizard";
import {
  TEAM_COLOURS,
  badIndex,
  blankPlayer,
  draftProblems,
  emptyRound,
  holesOf,
  indexOf,
  koRounds,
  named,
  settle,
  stepsFor,
  type DPlayer,
  type DRound,
  type Draft,
  type Tee,
} from "./model";

export interface StepProps {
  d: Draft;
  /** Change answers without moving on */
  set: (fn: (d: Draft) => Draft) => void;
  /** Answered: move on (wizard) or save and go back (Tournament setup) */
  done: (patch?: Partial<Draft>) => void;
  /** "Next" in the wizard, "Save" when changing one answer */
  nextLabel?: string;
  /** Tournament setup: changing a tournament that already exists */
  editing?: boolean;
}

// ------------------------------------------------------------------ pieces

export function Screen({ q, label, hint, children }: { q: string; label?: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="wz-screen">
      {label && <p className="wz-label">{label}</p>}
      <h1 className="wz-q">{q}</h1>
      {hint && <p className="wz-hint">{hint}</p>}
      <div className="wz-body">{children}</div>
    </section>
  );
}

export function Tiles({ children }: { children: React.ReactNode }) {
  return <div className="wz-tiles">{children}</div>;
}

export function Tile({ on, title, note, onClick, disabled }: { on?: boolean; title: React.ReactNode; note?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="wz-tile" aria-pressed={!!on} onClick={onClick} disabled={disabled}>
      <span className="wz-t">{title}</span>
      {note && <span className="wz-n">{note}</span>}
    </button>
  );
}

export function Next({ onClick, disabled, label = "Next" }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" className="btn block wz-next" disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
}

export function Stepper({ value, onChange, label, step = 1, min = 0, max = 50, fmt }: { value: number; onChange: (n: number) => void; label: string; step?: number; min?: number; max?: number; fmt?: (n: number) => string }) {
  const show = fmt ?? ((n: number) => (Number.isInteger(n) ? String(n) : `${Math.floor(n) || ""}½`));
  return (
    <div className="wz-stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`Less: ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}>
        −
      </button>
      <span className="num">{show(value)}</span>
      <button type="button" aria-label={`More: ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}>
        +
      </button>
    </div>
  );
}

function Pair<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="wz-yn-b" role="group" aria-label={label} style={options.length > 2 ? { gridTemplateColumns: `repeat(${options.length}, 1fr)` } : undefined}>
      {options.map(([v, l]) => (
        <button key={v} type="button" className="pick-tile" aria-pressed={value === v} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** A "More options" link that opens the rarely needed controls in place. */
function More({ children, label = "More options" }: { children: React.ReactNode; label?: string }) {
  return (
    <details className="wz-more">
      <summary>{label}</summary>
      <div className="wz-more-body">{children}</div>
    </details>
  );
}

export const roundLabel = (d: Draft, i: number) =>
  (d.count ?? d.rounds.length) > 1 || d.win === "knockout" ? `Round ${i + 1}${d.rounds[i]?.courseName ? `: ${d.rounds[i].courseName}` : ""}` : d.rounds[i]?.courseName || undefined;

function teeColour(name: string): string | null {
  const n = name.toLowerCase();
  const map: [RegExp, string][] = [
    [/white/, "#f4f4f0"],
    [/yellow/, "#f2c230"],
    [/red/, "#c8102e"],
    [/blue/, "#1d4f91"],
    [/black/, "#1b1b1b"],
    [/green/, "#2e7d4f"],
    [/gold/, "#c9a227"],
    [/silver/, "#b8bec6"],
    [/orange/, "#e8742a"],
  ];
  return map.find(([re]) => re.test(n))?.[1] ?? null;
}

function TeeName({ t }: { t: Tee }) {
  const c = teeColour(t.name);
  return (
    <>
      {c && <span className="wz-tee" style={{ background: c }} aria-hidden />}
      {t.name}
    </>
  );
}

const setRound = (d: Draft, i: number, patch: Partial<DRound>): Draft => ({ ...d, rounds: d.rounds.map((r, k) => (k === i ? { ...r, ...patch } : r)) });

// ------------------------------------------------------------------ who, name

export function WhoScreen({ d, done }: StepProps) {
  return (
    <Screen q="Who's playing?">
      <Tiles>
        <Tile on={d.who === "solo"} title="Just me" note="A round or a trip on your own: film it, keep score, make the vlog" onClick={() => done({ who: "solo", organiserPlays: true, win: null })} />
        <Tile on={d.who === "individuals"} title="A group of us" note="Everyone for themselves" onClick={() => done({ who: "individuals", win: d.who === "individuals" ? d.win : null })} />
        <Tile on={d.who === "teams"} title="Teams" note="Two teams playing matches, or more teams" onClick={() => done({ who: "teams", win: d.who === "teams" ? d.win : null })} />
      </Tiles>
    </Screen>
  );
}

export function NameScreen({ d, set, done, nextLabel }: StepProps) {
  return (
    <Screen q={d.who === "solo" ? "What shall we call it?" : "What's it called?"}>
      <div className="field">
        <label htmlFor="wz-name">Name</label>
        <input id="wz-name" className="wz-input" value={d.name} onChange={(e) => set((x) => ({ ...x, name: e.target.value }))} placeholder={d.who === "solo" ? "e.g. My Algarve golf trip" : "e.g. The Lads' Cup 2027"} autoFocus maxLength={80} />
      </div>
      <div className="field">
        <label htmlFor="wz-sub">A line underneath (optional)</label>
        <input id="wz-sub" className="wz-input" value={d.subtitle} onChange={(e) => set((x) => ({ ...x, subtitle: e.target.value }))} placeholder="e.g. Three days, two teams, one trophy" maxLength={120} />
      </div>
      <Next disabled={!d.name.trim()} onClick={() => done()} label={nextLabel} />
    </Screen>
  );
}

// ------------------------------------------------------------------ players

export function PlayersScreen({ d, set, done, nextLabel }: StepProps) {
  const solo = d.who === "solo";
  const players = d.players.length ? d.players : [blankPlayer()];
  const lastRef = useRef<HTMLInputElement>(null);
  const [added, setAdded] = useState(0);
  useEffect(() => {
    if (added) lastRef.current?.focus();
  }, [added]);
  const put = (list: DPlayer[]) => set((x) => ({ ...x, players: list }));
  const edit = (i: number, p: Partial<DPlayer>) => put(players.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const n = players.filter((p) => p.name.trim()).length;
  const bad = players.some(badIndex);

  if (!solo && d.organiserPlays == null)
    return (
      <Screen q="Are you playing?">
        <Tiles>
          <Tile title="Yes, I'm playing" note="You'll be first on the list" onClick={() => set((x) => ({ ...x, organiserPlays: true }))} />
          <Tile title="No, I'm just organising" onClick={() => set((x) => ({ ...x, organiserPlays: false }))} />
        </Tiles>
      </Screen>
    );

  return (
    <Screen q={solo ? "Your name and handicap" : "Who's playing?"} hint="First names are fine. Handicap index from your club app; tap + for a plus handicap.">
      {!solo && (
        <p className="small">
          {d.organiserPlays ? "You're playing: you're first on the list." : "You're organising, not playing."}{" "}
          <button type="button" className="linklike" onClick={() => set((x) => ({ ...x, organiserPlays: null }))}>
            Change
          </button>
        </p>
      )}
      <div className="wz-players">
        <div className="wz-player-h" aria-hidden>
          <span>Name</span>
          <span>Handicap</span>
          <span />
        </div>
        {players.map((p, i) => (
          <div className="wz-player" key={p.key}>
            <input
              ref={i === players.length - 1 ? lastRef : undefined}
              className="wz-input"
              aria-label={`Player ${i + 1} name`}
              placeholder={i === 0 && (solo || d.organiserPlays) ? "Your first name" : `Player ${i + 1}`}
              value={p.name}
              onChange={(e) => edit(i, { name: e.target.value })}
              maxLength={40}
            />
            <div className="wz-hcpbox">
              <button type="button" className="wz-plus" aria-pressed={p.plus} aria-label={`${p.name || `Player ${i + 1}`}: plus handicap`} onClick={() => edit(i, { plus: !p.plus })}>
                +
              </button>
              <input
                className="wz-input wz-hcp"
                aria-label={`${p.name || `Player ${i + 1}`}: handicap index`}
                placeholder="–"
                inputMode="decimal"
                value={p.index}
                onChange={(e) => {
                  const v = e.target.value;
                  edit(i, v.trim().startsWith("+") ? { index: v.replace("+", ""), plus: true } : { index: v });
                }}
              />
            </div>
            {!solo && players.length > 1 ? (
              <button type="button" className="wz-x" aria-label={`Remove ${p.name || `player ${i + 1}`}`} onClick={() => put(players.filter((_, k) => k !== i))}>
                ×
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
      </div>
      {!solo && players.length < MAX_PLAYERS && (
        <button
          type="button"
          className="btn secondary block wz-add"
          onClick={() => {
            put([...players, blankPlayer()]);
            setAdded((k) => k + 1);
          }}
        >
          + Add another player
        </button>
      )}
      {bad && <p className="error">A handicap index is a number from 0 to 54, like 12.4. Leave it blank if someone has none.</p>}
      <Next
        disabled={bad || (solo ? n < 1 : n < 2)}
        onClick={() => done({ players: players.filter((p) => p.name.trim()) })}
        label={!solo && n < 2 ? "Add at least two players" : nextLabel}
      />
    </Screen>
  );
}

// ------------------------------------------------------------------ teams

export function TeamsScreen({ d, set, done, nextLabel }: StepProps) {
  const teams = d.teams;
  const ps = named(d);
  const label = (i: number) => teams[i]?.name.trim() || `Team ${i + 1}`;
  const setTeams = (list: Draft["teams"]) => set((x) => ({ ...x, teams: list, players: x.players.map((p) => (p.team != null && p.team >= list.length ? { ...p, team: null } : p)) }));
  const deal = (order: DPlayer[]) => {
    const team: Record<string, number> = {};
    order.forEach((p, k) => {
      const lap = Math.floor(k / teams.length);
      const j = k % teams.length;
      team[p.key] = lap % 2 ? teams.length - 1 - j : j;
    });
    set((x) => ({ ...x, players: x.players.map((p) => (p.key in team ? { ...p, team: team[p.key] } : p)) }));
  };
  const shuffle = () => deal([...ps].sort(() => Math.random() - 0.5));
  const balance = () => deal([...ps].sort((a, b) => (indexOf(a) ?? 54) - (indexOf(b) ?? 54)));
  const unplaced = ps.filter((p) => p.team == null || p.team >= teams.length).length;
  return (
    <Screen q="The teams" hint="Name them, pick their colours, then tap each player onto a team.">
      <div className="wz-pt-row">
        <span>Number of teams</span>
        <Stepper
          value={teams.length}
          min={2}
          max={MAX_TEAMS}
          label="number of teams"
          onChange={(n) => setTeams(Array.from({ length: n }, (_, i) => teams[i] ?? { name: "", color: TEAM_COLOURS.find((c) => !teams.some((t) => t.color === c)) ?? TEAM_COLOURS[i % TEAM_COLOURS.length] }))}
        />
      </div>
      <div className="wz-teams">
        {teams.map((t, i) => (
          <div className="wz-team" key={i} style={{ borderColor: t.color }}>
            <input className="wz-input" aria-label={`Team ${i + 1} name`} placeholder={["e.g. The Locals", "e.g. The Blow-ins", "e.g. The Old Guard", "e.g. The Young Guns", "Team 5", "Team 6"][i]} value={t.name} onChange={(e) => setTeams(teams.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} maxLength={40} />
            <div className="wz-colours" role="group" aria-label={`Team ${i + 1} colour`}>
              {TEAM_COLOURS.map((c) => (
                <button type="button" key={c} className="wz-colour" style={{ background: c }} aria-pressed={t.color === c} disabled={teams.some((x, k) => k !== i && x.color === c)} aria-label={c} onClick={() => setTeams(teams.map((x, k) => (k === i ? { ...x, color: c } : x)))} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="wz-sides">
        {ps.map((p) => (
          <div className="wz-side" key={p.key}>
            <span className="wz-side-name">{p.name}</span>
            <div className="wz-side-b" style={{ gridTemplateColumns: `repeat(${Math.min(teams.length, 3)}, 1fr)` }}>
              {teams.map((t, k) => (
                <button
                  type="button"
                  key={k}
                  className="pick-tile"
                  aria-pressed={p.team === k}
                  style={p.team === k ? { background: t.color, borderColor: t.color, color: "#fff" } : undefined}
                  onClick={() => set((x) => ({ ...x, players: x.players.map((q) => (q.key === p.key ? { ...q, team: k } : q)) }))}
                >
                  {label(k)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="row">
        <button type="button" className="chip" onClick={shuffle}>
          Shuffle them
        </button>
        <button type="button" className="chip" onClick={balance}>
          Balance by handicap
        </button>
      </div>
      {unplaced > 0 && <p className="notice">{unplaced === 1 ? "One player isn't on a team yet." : `${unplaced} players aren't on a team yet.`}</p>}
      <Next disabled={unplaced > 0} onClick={() => done()} label={nextLabel} />
    </Screen>
  );
}

// ------------------------------------------------------------------ how it's won

export function WinScreen({ d, set, done, nextLabel }: StepProps) {
  const who = d.who ?? "individuals";
  const sizes = d.teams.map((_, i) => named(d).filter((p) => p.team === i).length);
  const wins = winsFor(who, d.teams.length, sizes);
  const chosen = d.win ?? defaultWin(who, d.teams.length);
  const official = (w: WinChoice) => handicapFor(w === "teamscore" ? "stableford" : w === "knockout" ? (d.ko.pairs ? "fourball" : "match") : w === "matches" ? "singles" : w === "skins" ? "skins" : w === "scramble" ? "scramble" : w === "stroke" ? "stroke" : "stableford", w, null).pct;
  return (
    <Screen q="How is the winner decided?">
      <Tiles>
        {wins.map((w) => (
          <Tile key={w.id} on={chosen === w.id && !w.off} title={w.name} note={w.off ? `${w.note}. ${w.off}` : w.note} disabled={!!w.off} onClick={() => done({ win: w.id })} />
        ))}
      </Tiles>
      <p className="small muted">Handicaps follow the official allowances for each format.</p>
      <More>
        <div className="wz-pt-row">
          <span>Handicap allowance{d.allowance == null ? ` (official: ${official(chosen)}%)` : ""}</span>
          <Stepper value={d.allowance ?? official(chosen)} step={5} max={100} label="handicap allowance" fmt={(n) => `${n}%`} onChange={(v) => set((x) => ({ ...x, allowance: v }))} />
        </div>
        <div className="row">
          <button type="button" className="chip" aria-pressed={d.allowance === 0} onClick={() => set((x) => ({ ...x, allowance: 0 }))}>
            Play off scratch (no shots)
          </button>
          {d.allowance != null && (
            <button type="button" className="chip" onClick={() => set((x) => ({ ...x, allowance: null }))}>
              Back to the official allowance
            </button>
          )}
        </div>
      </More>
      {d.win && <Next onClick={() => done()} label={nextLabel} />}
    </Screen>
  );
}

/** The follow-ups a way to win needs: a knockout's draw and ties, skins carrying over, team score's counting scores. */
export function WinMoreScreen({ d, set, done, nextLabel }: StepProps) {
  const ko = d.ko;
  const setKo = (p: Partial<Draft["ko"]>) => set((x) => ({ ...x, ko: { ...x.ko, ...p } }));
  if (d.win === "skins")
    return (
      <Screen q="A tied hole" hint="When two or more share the lowest score on a hole.">
        <Tiles>
          <Tile on={d.skinsCarry} title="Carries over" note="The skin goes on to the next hole, so that one's worth two" onClick={() => done({ skinsCarry: true })} />
          <Tile on={!d.skinsCarry} title="Nobody wins it" note="Each hole is worth one skin, no more" onClick={() => done({ skinsCarry: false })} />
        </Tiles>
      </Screen>
    );
  if (d.win === "teamscore") {
    const sizes = d.teams.map((_, i) => named(d).filter((p) => p.team === i).length);
    const most = Math.max(1, ...sizes);
    return (
      <Screen q="Scores that count on each hole" hint="Each team's best Stableford scores on every hole are added up.">
        <div className="pick-tiles">
          {[1, 2, 3, 0]
            .filter((n) => n === 0 || n <= most)
            .map((n) => (
              <button key={n} type="button" className="pick-tile" aria-pressed={d.teamCount === n} onClick={() => done({ teamCount: n })}>
                {n === 0 ? "All" : `Best ${n}`}
              </button>
            ))}
        </div>
      </Screen>
    );
  }
  // Knockout
  const players = named(d).length;
  const entrants = knockoutEntrants({ players: named(d).map((p) => ({ key: p.key, name: p.name, index: null })), ko }).length;
  const rounds = koRounds(d);
  const stages = ["Final", "Semi-finals", "Quarter-finals", "Round of 16", "Round of 32"].slice(0, rounds).reverse();
  const byes = bracketSize(entrants) - entrants;
  return (
    <Screen q="The knockout" hint={`${players} players: ${rounds} round${rounds === 1 ? "" : "s"}, ${stages.join(", ").toLowerCase()}${byes ? `. ${byes} bye${byes === 1 ? "" : "s"} in the first round` : ""}.`}>
      <div className="wz-yn">
        <div className="wz-yn-q">
          <strong>Singles or pairs</strong>
        </div>
        <Pair label="Singles or pairs" value={ko.pairs ? "pairs" : "singles"} options={[["singles", "Singles"], ["pairs", "Pairs (fourballs)"]]} onChange={(v) => setKo({ pairs: v === "pairs" })} />
      </div>
      <div className="wz-yn">
        <div className="wz-yn-q">
          <strong>The draw</strong>
          <span>{ko.draw === "seeded" ? "The lowest handicaps are kept apart until the later rounds." : ko.draw === "pick" ? "You'll put the first-round matches together next." : "Drawn at random when the tournament is made."}</span>
        </div>
        <Pair label="The draw" value={ko.draw} options={[["random", "Random"], ["seeded", "Seeded"], ["pick", "I'll pick"]]} onChange={(v) => setKo({ draw: v })} />
      </div>
      <div className="wz-yn">
        <div className="wz-yn-q">
          <strong>Level after 18</strong>
          <span>{ko.tie === "backnine" ? "The better back nine goes through, then the last 6, 3 and 1 holes." : "They play on from the 1st until one wins a hole."}</span>
        </div>
        <Pair label="Level after 18" value={ko.tie} options={[["backnine", "Better back nine"], ["extra", "Extra holes"]]} onChange={(v) => setKo({ tie: v })} />
      </div>
      <Next onClick={() => done()} label={nextLabel} />
    </Screen>
  );
}

// ------------------------------------------------------------------ rounds

export function CountScreen({ done }: StepProps) {
  return (
    <Screen q="How many rounds?">
      <div className="wz-nums">
        {Array.from({ length: MAX_ROUNDS }, (_, i) => i + 1).map((n) => (
          <button type="button" key={n} className="num-tile" onClick={() => done({ count: n })}>
            {n}
          </button>
        ))}
      </div>
    </Screen>
  );
}

interface Hit {
  ref: string;
  name: string;
  location: string;
  holes?: number;
  lat?: number;
  lon?: number;
}

export function CourseScreen({ d, done, i, nextLabel }: StepProps & { i: number }) {
  const r = d.rounds[i] ?? emptyRound();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [manual, setManual] = useState(!!r.manual);
  const [card, setCard] = useState<{ par: number; si: number; yards: number }[]>((r.manualCard ?? Array.from({ length: 18 }, (_, k) => ({ par: 4, si: k + 1 }))).map((h) => ({ ...h, yards: 0 })));
  const [mName, setMName] = useState(r.manual ? r.courseName : "");
  // Courses already chosen for earlier rounds: one tap, no search
  const earlier = d.rounds.slice(0, i).filter((x, k, all) => (x.courseRef || x.manual) && all.findIndex((y) => y.courseName === x.courseName && y.tee === x.tee && y.holeSet === x.holeSet) === k);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (q.trim().length < 3) return setErr("Type at least three letters of the club's name.");
    setErr(null);
    setBusy("search");
    const res = await fetch(`/api/courses?q=${encodeURIComponent(q.trim())}`).then((x) => x.json()).catch(() => null);
    setBusy(null);
    if (!res) return setErr("Couldn't search just now. Check the signal and try again.");
    setHits(res.hits ?? []);
  }

  async function pick(h: Hit) {
    setErr(null);
    setBusy(h.ref);
    const res = await fetch(`/api/courses?ref=${encodeURIComponent(h.ref)}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    setBusy(null);
    const c = res?.course as { tees: Tee[]; lat: number | null; lon: number | null } | undefined;
    if (!c?.tees?.length) return setErr("Couldn't load that course's scorecard. Try another, or type the card in.");
    const tees = c.tees.map((t) => ({ name: t.name, par: t.par, si: t.si, yards: t.yards, rating: t.rating, slope: t.slope }));
    done({ rounds: d.rounds.map((x, k) => (k === i ? { ...x, courseRef: h.ref, courseName: h.name, location: h.location, lat: c.lat ?? h.lat ?? null, lon: c.lon ?? h.lon ?? null, tees, tee: tees[0].name, playerTees: {}, holeSet: tees[0].par.length === 9 ? "all" : x.holeSet, manual: false, manualCard: null } : x)) });
  }

  function pickEarlier(x: DRound) {
    const rounds = d.rounds.map((y, k) => (k === i ? { ...y, courseRef: x.courseRef, courseName: x.courseName, location: x.location, lat: x.lat, lon: x.lon, tees: x.tees, tee: x.tee, playerTees: { ...x.playerTees }, holeSet: x.holeSet, manual: x.manual, manualCard: x.manualCard } : y));
    // Same course, tees and holes: straight past those questions
    const list = stepsFor({ ...d, rounds });
    const from = list.indexOf(`course:${i}`);
    const to = list.find((s, k) => k > from && !s.startsWith("tee:") && !s.startsWith("holes:"));
    done({ rounds, step: to ?? list[from + 1] });
  }

  if (manual)
    return (
      <Screen q="Type the card in" label={roundLabel(d, i)} hint="The par and stroke index (SI) for each hole, from the scorecard.">
        <div className="field">
          <label htmlFor="wz-mname">Course name</label>
          <input id="wz-mname" className="wz-input" value={mName} onChange={(e) => setMName(e.target.value)} placeholder="e.g. Birr Golf Club" />
        </div>
        <div className="pick-tiles" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {[18, 9].map((n) => (
            <button
              type="button"
              key={n}
              className="pick-tile"
              aria-pressed={card.length === n}
              onClick={() => setCard(Array.from({ length: n }, (_, k) => card[k] ?? { par: 4, si: k + 1, yards: 0 }).map((h, k) => ({ ...h, si: n === 9 ? Math.min(h.si, 9) || k + 1 : h.si })))}
            >
              {n} holes
            </button>
          ))}
        </div>
        <CardTable card={card} setCard={setCard} />
        {err && <p className="error">{err}</p>}
        <Next
          disabled={!mName.trim()}
          label={nextLabel}
          onClick={() => {
            const sis = card.map((h) => h.si);
            if (new Set(sis).size !== card.length || sis.some((s) => s < 1 || s > card.length)) return setErr(card.length === 18 ? "Each stroke index from 1 to 18 must be used once." : "Each hole needs a different stroke index, 1 to 9.");
            if (card.some((h) => h.par < 3 || h.par > 6)) return setErr("Each par must be 3 to 6.");
            done({ rounds: d.rounds.map((x, k) => (k === i ? { ...x, courseRef: null, courseName: mName.trim(), manual: true, manualCard: card.map((h) => ({ par: h.par, si: h.si })), tees: undefined, tee: null, playerTees: {}, holeSet: card.length === 9 ? ("all" as HoleSet) : x.holeSet } : x)) });
          }}
        />
        <button type="button" className="linklike" onClick={() => setManual(false)}>
          Search for the course instead
        </button>
      </Screen>
    );

  return (
    <Screen q={i === 0 ? "Where are you playing?" : `Where's round ${i + 1}?`} label={(d.count ?? 0) > 1 ? `Round ${i + 1} of ${d.count}` : undefined}>
      {earlier.length > 0 && (
        <Tiles>
          {earlier.map((x) => (
            <Tile key={`${x.courseName}-${x.tee}-${x.holeSet}`} on={r.courseName === x.courseName && r.tee === x.tee} title={`Same course: ${x.courseName}`} note={[x.tee ? `${x.tee} tees` : null, x.holeSet !== "all" ? (x.holeSet === "front" ? "front 9" : "back 9") : null].filter(Boolean).join(", ") || undefined} onClick={() => pickEarlier(x)} />
          ))}
        </Tiles>
      )}
      <form className="wz-search" onSubmit={search}>
        <label htmlFor="wz-q" className="sr-only">
          Club name
        </label>
        <input id="wz-q" className="wz-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Club name, e.g. Birr" autoComplete="off" enterKeyHint="search" />
        <button className="btn" disabled={busy === "search"}>
          {busy === "search" ? "Searching…" : "Search"}
        </button>
      </form>
      {r.courseName && !hits && (
        <p className="small muted">
          Chosen: <strong>{r.courseName}</strong>
          {r.tee ? `, ${r.tee} tees` : ""}.{" "}
          <button type="button" className="linklike" onClick={() => done()}>
            Keep it
          </button>
        </p>
      )}
      {err && <p className="error">{err}</p>}
      {hits && hits.length === 0 && <p className="notice">Nothing found for “{q}”. Try fewer words (just the town, say), or type the card in.</p>}
      {hits && hits.length > 0 && (
        <div className="wz-hits">
          {hits.map((h) => (
            <button type="button" key={h.ref} className="wz-hit" onClick={() => pick(h)} disabled={!!busy}>
              <span className="wz-t">{h.name}</span>
              <span className="wz-n">
                {[h.location, h.holes ? `${h.holes} holes` : null].filter(Boolean).join(", ")}
                {busy === h.ref ? ": loading the card…" : ""}
              </span>
            </button>
          ))}
        </div>
      )}
      <button type="button" className="linklike wz-manual" onClick={() => setManual(true)}>
        Can&apos;t find it? Type the card in
      </button>
    </Screen>
  );
}

export function TeeScreen({ d, set, done, i, nextLabel }: StepProps & { i: number }) {
  const r = d.rounds[i];
  const tees = r?.tees ?? [];
  const others = Object.keys(r?.playerTees ?? {}).length > 0;
  const [open, setOpen] = useState(others);
  const ps = named(d);
  const yards = (t: Tee) => t.yards.reduce((a, b) => a + b, 0);
  if (!r) return null;
  return (
    <Screen q={`Which tees at ${r.courseName}?`} label={roundLabel(d, i)}>
      <Tiles>
        {tees.map((t) => (
          <Tile
            key={t.name}
            on={r.tee === t.name}
            title={<TeeName t={t} />}
            note={[yards(t) ? `${yards(t).toLocaleString("en-IE")} yards` : null, t.slope && t.rating ? `slope ${t.slope}, rating ${t.rating}` : null].filter(Boolean).join(", ") || undefined}
            onClick={() => (open ? set((x) => setRound(x, i, { tee: t.name })) : done({ rounds: d.rounds.map((x, k) => (k === i ? { ...x, tee: t.name, playerTees: {} } : x)) }))}
          />
        ))}
      </Tiles>
      {ps.length > 1 && !open && (
        <button type="button" className="linklike wz-manual" onClick={() => setOpen(true)}>
          Some players on different tees
        </button>
      )}
      {open && (
        <>
          <p className="wz-hint">Everyone else plays the {r.tee} tees. Handicaps are worked out from each player&apos;s own tees, so it&apos;s fair.</p>
          <div className="wz-sides">
            {ps.map((p) => {
              const mine = r.playerTees[p.key] ?? r.tee;
              return (
                <div className="wz-side" key={p.key}>
                  <span className="wz-side-name">{p.name}</span>
                  <div className="wz-tee-pick">
                    {tees.map((t) => (
                      <button
                        key={t.name}
                        type="button"
                        className="pick-tile"
                        aria-pressed={mine === t.name}
                        onClick={() => set((x) => setRound(x, i, { playerTees: Object.fromEntries(Object.entries({ ...x.rounds[i].playerTees, [p.key]: t.name }).filter(([, v]) => v !== x.rounds[i].tee)) }))}
                      >
                        <TeeName t={t} />
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {tees.some((t) => !t.slope || !t.rating) && <p className="small muted">A tee without a slope and rating plays off the handicap index as it is.</p>}
          <Next onClick={() => done()} label={nextLabel} />
        </>
      )}
    </Screen>
  );
}

export function HolesScreen({ d, done, i }: StepProps & { i: number }) {
  return (
    <Screen q="How many holes?" label={roundLabel(d, i)}>
      <Tiles>
        {(
          [
            ["all", "All 18"],
            ["front", "Front 9"],
            ["back", "Back 9"],
          ] as [HoleSet, string][]
        ).map(([v, label]) => (
          <Tile key={v} on={d.rounds[i]?.holeSet === v} title={label} onClick={() => done({ rounds: d.rounds.map((r, k) => (k === i ? { ...r, holeSet: v } : r)) })} />
        ))}
      </Tiles>
    </Screen>
  );
}

export function FormatScreen({ d, done, i }: StepProps & { i: number }) {
  const solo = d.who === "solo";
  const opts = roundFormats(d.who ?? "individuals", solo ? null : d.win, d.ko.pairs);
  return (
    <Screen q={solo ? "How are you scoring?" : `What's round ${i + 1}?`} label={solo ? undefined : roundLabel(d, i)}>
      <Tiles>
        {opts.map((f) => (
          <Tile
            key={f}
            on={d.rounds[i]?.format === f}
            title={formatName(f)}
            note={FORMAT_NAMES[f].note}
            onClick={() => done({ rounds: d.rounds.map((r, k) => (k === i || solo ? { ...r, format: f, points: k === i ? undefined : r.points } : r)) })}
          />
        ))}
      </Tiles>
    </Screen>
  );
}

export function WhenScreen({ d, set, done, i, nextLabel, editing }: StepProps & { i: number }) {
  const r = d.rounds[i];
  const prev = d.rounds[i - 1]?.date;
  const suggest = prev ? new Date(new Date(prev).getTime() + 86400e3).toISOString().slice(0, 10) : null;
  if (!r) return null;
  return (
    <Screen q={d.win === "knockout" && d.who !== "solo" ? `When is round ${i + 1}?` : `When is round ${i + 1}?`} label={roundLabel(d, i)} hint="Not sure yet? Skip it and add it later.">
      <div className="field">
        <label htmlFor="wz-date">Date</label>
        <input id="wz-date" className="wz-input" type="date" value={r.date ?? ""} onChange={(e) => set((x) => setRound(x, i, { date: e.target.value || null }))} />
      </div>
      {suggest && !r.date && (
        <button type="button" className="chip" onClick={() => set((x) => setRound(x, i, { date: suggest }))}>
          The day after round {i}: {new Date(suggest).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" })}
        </button>
      )}
      <div className="field">
        <label htmlFor="wz-time">First tee time (optional)</label>
        <input id="wz-time" className="wz-input" type="time" value={r.time ?? ""} onChange={(e) => set((x) => setRound(x, i, { time: e.target.value || null }))} />
      </div>
      {!editing && (
        <More label="Handicaps for this round">
          <RoundHandicaps d={d} set={set} i={i} />
        </More>
      )}
      <Next onClick={() => done()} label={nextLabel ?? (r.date ? "Next" : "Skip for now")} />
    </Screen>
  );
}

// ------------------------------------------------------------------ handicaps for one round

/** Official allowance, flat (no shots), or the shots set by hand for each player. */
export function RoundHandicaps({ d, set, i }: { d: Draft; set: StepProps["set"]; i: number }) {
  const r = d.rounds[i];
  if (!r) return null;
  const f = r.format ?? "stableford";
  const mode = r.hcp ?? "official";
  const official = handicapFor(f, d.win, null, d.allowance).pct;
  const ps = named(d);
  const put = (p: Partial<DRound>) => set((x) => setRound(x, i, p));
  const start = () => Object.fromEntries(ps.map((p) => [p.key, Math.max(0, Math.round(indexOf(p) ?? 0))]));
  return (
    <>
      <Tiles>
        <Tile on={mode === "official"} title="Official allowance" note={d.allowance === 0 ? "The whole tournament is off scratch" : `${official}% of each player's handicap`} onClick={() => put({ hcp: "official" })} />
        <Tile on={mode === "flat"} title="Flat, no shots" note="Everyone plays off scratch in this round" onClick={() => put({ hcp: "flat" })} />
        {shotsByHand(f) && <Tile on={mode === "manual"} title="Set the shots myself" note="So many shots for each player" onClick={() => put({ hcp: "manual", shots: r.shots ?? start() })} />}
      </Tiles>
      {mode === "manual" && shotsByHand(f) && (
        <div className="wz-points">
          <div className="wz-pt">
            <div className="wz-pt-h">
              <strong>Shots for each player</strong> <span className="muted">in this round</span>
            </div>
            {ps.map((p) => (
              <div className="wz-pt-row" key={p.key}>
                <span>{p.name}</span>
                <Stepper value={r.shots?.[p.key] ?? 0} max={54} label={`${p.name}: shots`} fmt={(n) => String(n)} onChange={(v) => put({ shots: { ...(r.shots ?? start()), [p.key]: v } })} />
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** Tournament setup: a round's handicaps on their own screen. */
export function HandicapScreen({ d, set, done, i, nextLabel }: StepProps & { i: number }) {
  return (
    <Screen q={`Handicaps for round ${i + 1}`} label={roundLabel(d, i)}>
      <RoundHandicaps d={d} set={set} i={i} />
      <Next onClick={() => done()} label={nextLabel} />
    </Screen>
  );
}

// ------------------------------------------------------------------ points

export function PointsScreen({ d, set, done, nextLabel }: StepProps) {
  const n = named(d).length || 8;
  const rounds = settle(d).rounds;
  const setPts = (i: number, p: RoundPoints) => set((x) => setRound(x, i, { points: { ...(x.rounds[i]?.points ?? {}), ...p } }));
  const places = ["1st", "2nd", "3rd", "4th", "5th", "6th"];
  return (
    <Screen q="Points" hint="Already filled in. Change any with the + and − buttons. A halved match shares its point.">
      <div className="wz-points">
        {rounds.map((r, i) => {
          if (!r.format) return null;
          const p = { ...defaultPoints(r.format, n), ...r.points };
          const nines = holesOf(r) === 18 && r.holeSet === "all";
          return (
            <div className="wz-pt" key={i}>
              <div className="wz-pt-h">
                <strong>Round {i + 1}</strong> <span className="muted">{formatName(r.format)}</span>
              </div>
              {isMatch(r.format) && (
                <div className="wz-pt-row">
                  <span>For winning a match</span>
                  <Stepper value={p.win ?? 1} step={0.5} label={`round ${i + 1} points per match`} onChange={(v) => setPts(i, { win: v })} />
                </div>
              )}
              {r.format === "skins" && (
                <div className="wz-pt-row">
                  <span>For each skin</span>
                  <Stepper value={p.skin ?? 1} step={0.5} label={`round ${i + 1} points per skin`} onChange={(v) => setPts(i, { skin: v })} />
                </div>
              )}
              {(r.format === "stableford" || r.format === "stroke") && (
                <>
                  {(p.positions ?? []).map((v, k) => (
                    <div className="wz-pt-row" key={k}>
                      <span>{places[k]} place</span>
                      <Stepper value={v} label={`round ${i + 1} points for ${places[k]}`} onChange={(x) => setPts(i, { positions: (p.positions ?? []).map((y, j) => (j === k ? x : y)) })} />
                    </div>
                  ))}
                  <div className="row">
                    {(p.positions?.length ?? 0) < Math.min(6, n) && (
                      <button type="button" className="chip" onClick={() => setPts(i, { positions: [...(p.positions ?? []), 0] })}>
                        Pay another place
                      </button>
                    )}
                    {(p.positions?.length ?? 0) > 1 && (
                      <button type="button" className="chip" onClick={() => setPts(i, { positions: (p.positions ?? []).slice(0, -1) })}>
                        One place fewer
                      </button>
                    )}
                  </div>
                </>
              )}
              {nines && r.format !== "skins" && (
                <>
                  <label className="wz-switch">
                    <input type="checkbox" checked={!!p.nines} onChange={(e) => setPts(i, { nines: e.target.checked ? { front: 1, back: 1 } : null })} />
                    <span>Points for the front 9 and back 9 too</span>
                  </label>
                  {p.nines && (
                    <>
                      <div className="wz-pt-row">
                        <span>Front 9</span>
                        <Stepper value={p.nines.front} step={0.5} label={`round ${i + 1} front nine points`} onChange={(v) => setPts(i, { nines: { ...p.nines!, front: v } })} />
                      </div>
                      <div className="wz-pt-row">
                        <span>Back 9</span>
                        <Stepper value={p.nines.back} step={0.5} label={`round ${i + 1} back nine points`} onChange={(v) => setPts(i, { nines: { ...p.nines!, back: v } })} />
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      <Next onClick={() => done()} label={nextLabel} />
    </Screen>
  );
}

// ------------------------------------------------------------------ groups

interface Box {
  label: string;
  /** Places on each side: [4] for a group of four, [1, 1] for singles, [2, 2] for pairs */
  caps: number[];
  /** Which team each side is from (team matches) */
  teams?: (number | null)[];
  /** A name for each side ("The Locals") */
  sideLabels?: string[];
}

/** Tap a name, then tap where they go. Anyone not placed is listed above. */
function PickBoard({ items, boxes, value, onChange, teamOf, colours }: { items: { id: string; label: string }[]; boxes: Box[]; value: string[][][]; onChange: (v: string[][][]) => void; teamOf?: (id: string) => number | null; colours?: string[] }) {
  const [sel, setSel] = useState<string | null>(null);
  const placed = new Set(value.flat(2));
  const pool = items.filter((x) => !placed.has(x.id));
  const name = (id: string) => items.find((x) => x.id === id)?.label ?? id;
  const cleaned = (v: string[][][]) => v.map((g) => g.map((s) => s.filter((id) => id !== sel)));
  const put = (b: number, s: number) => {
    if (!sel) return;
    const box = boxes[b];
    const want = box.teams?.[s];
    if (want != null && teamOf && teamOf(sel) !== want) return;
    const v = cleaned(boxes.map((bx, bi) => bx.caps.map((_, si) => [...(value[bi]?.[si] ?? [])])));
    if (v[b][s].length >= box.caps[s]) v[b][s].shift();
    v[b][s].push(sel);
    onChange(v);
    setSel(null);
  };
  const chip = (id: string) => {
    const t = teamOf?.(id);
    return (
      <button key={id} type="button" className="chip wz-pchip" aria-pressed={sel === id} style={t != null && colours ? { borderColor: colours[t] } : undefined} onClick={(e) => (e.stopPropagation(), setSel(sel === id ? null : id))}>
        {name(id)}
      </button>
    );
  };
  return (
    <div className="wz-board">
      <div
        className="wz-pool"
        onClick={() => {
          if (!sel) return;
          onChange(cleaned(value));
          setSel(null);
        }}
      >
        {pool.length ? pool.map((x) => chip(x.id)) : <span className="small muted">Everyone&apos;s placed. Tap a name to move it.</span>}
      </div>
      {boxes.map((bx, b) => (
        <div className="wz-box" key={b}>
          <span className="wz-box-h">{bx.label}</span>
          <div className="wz-box-sides">
            {bx.caps.map((cap, s) => (
              <div key={s} className="wz-side-wrap">
                {s > 0 && bx.caps.length === 2 && (
                  <span className="wz-v" aria-hidden>
                    v
                  </span>
                )}
                <div className="wz-slot" role="button" tabIndex={0} aria-label={`${bx.label}${bx.sideLabels?.[s] ? `, ${bx.sideLabels[s]}` : bx.caps.length > 1 ? `, side ${s + 1}` : ""}`} data-ready={sel ? "true" : undefined} onClick={() => put(b, s)} onKeyDown={(e) => e.key === "Enter" && put(b, s)}>
                  {bx.sideLabels?.[s] && (
                    <span className="wz-slot-l" style={bx.teams?.[s] != null && colours ? { color: colours[bx.teams[s]!] } : undefined}>
                      {bx.sideLabels[s]}
                    </span>
                  )}
                  {(value[b]?.[s] ?? []).map((id) => chip(id))}
                  {(value[b]?.[s]?.length ?? 0) < cap && <span className="wz-empty">{sel ? "Tap here" : cap > 1 && (value[b]?.[s]?.length ?? 0) === 0 ? `${cap} places` : "Empty"}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The boxes to fill for a round: groups of four, or matches. */
function boxesFor(d: Draft, format: DayFormat): Box[] {
  const n = named(d).length;
  if (d.who === "teams" && isMatch(format)) {
    const per = isPairs(format) ? 2 : 1;
    const each = Math.floor(named(d).filter((p) => p.team === 0).length / per);
    const names = d.teams.map((t, i) => t.name.trim() || `Team ${i + 1}`);
    return Array.from({ length: each }, (_, k) => ({ label: `Match ${k + 1}`, caps: [per, per], teams: [0, 1], sideLabels: [names[0], names[1]] }));
  }
  if (isMatch(format)) return Array.from({ length: Math.floor(n / 2) }, (_, k) => ({ label: `Match ${k + 1}`, caps: [1, 1] }));
  return Array.from({ length: Math.ceil(n / 4) }, (_, k) => ({ label: `Group ${k + 1}`, caps: [4] }));
}

export function GroupsScreen({ d, set, done, nextLabel, editing }: StepProps) {
  const ps = named(d);
  const rounds = settle(d).rounds;
  const [at, setAt] = useState(0);
  const teamOf = (key: string) => ps.find((p) => p.key === key)?.team ?? null;
  const items = ps.map((p) => ({ id: p.key, label: p.name }));

  if (d.win === "knockout") {
    // The first round's matches, picked by hand (pairs first, for a pairs knockout)
    const pairsNeeded = d.ko.pairs;
    const pairs = d.ko.pairsPicked ?? [];
    const pairsDone = !pairsNeeded || pairs.filter((p) => p.length === 2).length === Math.floor(ps.length / 2);
    const entrants = pairsNeeded ? pairs.filter((p) => p.length === 2).map((p) => ({ id: p.join("+"), label: p.map((k) => ps.find((x) => x.key === k)?.name ?? k).join(" & ") })) : items;
    const size = bracketSize(entrants.length);
    const slots = d.ko.slots ?? [];
    const board = Array.from({ length: size / 2 }, (_, k) => [slots[2 * k] ? [slots[2 * k]!] : [], slots[2 * k + 1] ? [slots[2 * k + 1]!] : []]);
    const byes = size - entrants.length;
    const placed = slots.filter(Boolean).length;
    return (
      <Screen q={pairsNeeded && !pairsDone ? "The pairs" : "The first round"} hint={pairsNeeded && !pairsDone ? "Tap a name, then tap the pair they go in." : `Tap a name, then tap their match.${byes ? ` Leave ${byes === 1 ? "one side" : `${byes} sides`} empty for the bye${byes === 1 ? "" : "s"}: whoever's in that match goes straight through.` : ""}`}>
        {pairsNeeded && !pairsDone ? (
          <PickBoard
            items={items}
            boxes={Array.from({ length: Math.floor(ps.length / 2) }, (_, k) => ({ label: `Pair ${k + 1}`, caps: [2] }))}
            value={Array.from({ length: Math.floor(ps.length / 2) }, (_, k) => [pairs[k] ?? []])}
            onChange={(v) => set((x) => ({ ...x, ko: { ...x.ko, pairsPicked: v.map((g) => g[0] ?? []), slots: null } }))}
          />
        ) : (
          <PickBoard
            items={entrants}
            boxes={board.map((_, k) => ({ label: `Match ${k + 1}`, caps: [1, 1] }))}
            value={board}
            onChange={(v) => set((x) => ({ ...x, ko: { ...x.ko, slots: v.flatMap((g) => [g[0]?.[0] ?? null, g[1]?.[0] ?? null]) } }))}
          />
        )}
        {pairsNeeded && pairsDone && (
          <button type="button" className="linklike wz-manual" onClick={() => set((x) => ({ ...x, ko: { ...x.ko, pairsPicked: null, slots: null } }))}>
            Change the pairs
          </button>
        )}
        <Next disabled={!pairsDone || placed !== entrants.length || board.some(([a, b]) => !a.length && !b.length)} onClick={() => done()} label={nextLabel} />
      </Screen>
    );
  }

  const r = rounds[at];
  const fmt = r?.format ?? "stableford";
  const boxes = boxesFor(d, fmt);
  const value = r?.picks ?? boxes.map((b) => b.caps.map(() => [] as string[]));
  const placed = new Set(value.flat(2)).size;
  return (
    <Screen
      q="Who plays with whom?"
      hint={editing ? "Random or Balanced draws them again. Rounds already under way keep their groups." : d.draw === "pick" ? undefined : "Made for every round when the tournament is created. You can still change them afterwards."}
    >
      <Tiles>
        <Tile on={d.draw === "random"} title="Random" note="A fresh draw for each round" onClick={() => done({ draw: "random" })} />
        <Tile on={d.draw === "balanced"} title="Balanced by handicap" note={d.who === "teams" ? "Players of similar handicap play each other" : "Each group gets a mix of low and high handicaps"} onClick={() => done({ draw: "balanced" })} />
        <Tile on={d.draw === "pick"} title="I'll pick" note="Tap players into groups and matches" onClick={() => set((x) => ({ ...x, draw: "pick" }))} />
      </Tiles>
      {d.draw === "pick" && r && (
        <>
          {rounds.length > 1 && (
            <div className="pick-tiles" role="group" aria-label="Round">
              {rounds.map((_, k) => (
                <button key={k} type="button" className="pick-tile" aria-pressed={k === at} onClick={() => setAt(k)}>
                  Round {k + 1}
                </button>
              ))}
            </div>
          )}
          <p className="wz-hint">
            Round {at + 1}, {inSentence(formatName(fmt))}. Tap a name, then tap where they go.
          </p>
          <PickBoard items={items} boxes={boxes} value={value} teamOf={d.who === "teams" ? teamOf : undefined} colours={d.teams.map((t) => t.color)} onChange={(v) => set((x) => setRound(x, at, { picks: v }))} />
          <div className="row">
            {at > 0 && rounds[0]?.format === fmt && rounds[0]?.picks && (
              <button type="button" className="chip" onClick={() => set((x) => setRound(x, at, { picks: x.rounds[0].picks!.map((g) => g.map((s) => [...s])) }))}>
                Same as round 1
              </button>
            )}
            <button
              type="button"
              className="chip"
              onClick={() =>
                set((x) => {
                  const left = items.map((it) => it.id).filter((id) => !value.flat(2).includes(id)).sort(() => Math.random() - 0.5);
                  const v = boxes.map((b, bi) =>
                    b.caps.map((cap, si) => {
                      const side = [...(value[bi]?.[si] ?? [])];
                      while (side.length < cap) {
                        const k = left.findIndex((id) => b.teams?.[si] == null || teamOf(id) === b.teams[si]);
                        if (k < 0) break;
                        side.push(left.splice(k, 1)[0]);
                      }
                      return side;
                    }),
                  );
                  return setRound(x, at, { picks: v });
                })
              }
            >
              Fill the rest at random
            </button>
          </div>
          {placed < ps.length && <p className="small muted">Anyone not placed plays in a group at the end.</p>}
          <Next onClick={() => (at < rounds.length - 1 ? setAt(at + 1) : done())} label={at < rounds.length - 1 ? `Next: round ${at + 2}` : nextLabel} />
        </>
      )}
      <More>
        <div className="wz-pt-row">
          <span>Minutes between tee times</span>
          <Stepper value={d.teeGap} min={5} max={20} label="minutes between tee times" onChange={(v) => set((x) => ({ ...x, teeGap: v }))} />
        </div>
      </More>
    </Screen>
  );
}

// ------------------------------------------------------------------ side games

const SIDE_NOTE: Record<SideKind, string> = {
  ctp: "Nearest the hole from the tee, on the par 3s",
  ld: "Longest drive on the fairway, on the par 5s",
  birdies: "Gross birdies",
  eagles: "Gross eagles",
  gir: "On in par minus two",
  nines: "Best score on each nine",
  skins: "Holes won outright, ties carried over",
  bestround: "The best single round",
};
const EACH: Record<string, string> = { ctp: "For each closest the pin won", ld: "For each long drive won", birdies: "For each birdie", eagles: "For each eagle", gir: "For each green in regulation" };
const PER_ROUND: SideKind[] = ["ctp", "ld", "birdies", "gir", "skins", "bestround"];

/** The draft's rounds as the side games see them: the holes played (with par and yards), the course, the groups */
function sideRounds(d: Draft): (SideRound & { key: string })[] {
  const out: (SideRound & { key: string })[] = [];
  settle(d).rounds.forEach((r, i) => {
    const tee = r.tees?.find((t) => t.name === r.tee) ?? r.tees?.[0];
    const card = tee ? tee.par.map((p, k) => ({ par: p, yards: tee.yards[k] ?? 0 })) : r.manual ? (r.manualCard ?? []).map((h) => ({ par: h.par, yards: 0 })) : (r.card ?? []).map((h) => ({ par: h.par, yards: h.yards ?? 0 }));
    const nine = card.length === 18 && r.holeSet !== "all" ? r.holeSet : null;
    const holes = card.map((h, k) => ({ number: k + 1, par: h.par, yards: h.yards })).filter((h) => !nine || (nine === "front" ? h.number <= 9 : h.number >= 10));
    out.push({ number: i + 1, course: r.courseName, holes, nine, games: r.format ? boxesFor(d, r.format).length : 1, key: `${r.courseRef ?? r.courseName}|${r.tee ?? ""}|${r.holeSet}` });
  });
  return out;
}

export function sideSetupOfDraft(d: Draft): SideSetup {
  return { race: d.win === "points", bonus: d.bonus ?? {}, prizes: d.prizes ?? [], holes: d.sideHoles ?? {}, rounds: sideRounds(d) };
}

/** Stacked big buttons, one answer */
function Choice<T extends string>({ value, options, onChange, label }: { value: T | null; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="wz-choice" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" className="pick-tile" aria-pressed={value === v} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

/**
 * Side games: one screen for everything played alongside the rounds. Each is ticked, then answered right under its
 * tile (in a points race: points for each one, a prize for the most, or both), then folds to one line.
 * `played`: when changing a tournament, the holes already played in each round (round number → holes); those stay.
 */
export function SideGamesScreen({ d, set, done, nextLabel, played }: StepProps & { played?: Record<string, number[]> }) {
  const race = d.win === "points";
  const s = sideSetupOfDraft(d);
  const [open, setOpen] = useState<SideKind | null>(null);
  const kinds = SIDE_KINDS.filter((k) => (race || CAN_PRIZE.includes(k)) && !(k === "skins" && d.win === "skins") && !(k === "nines" && !s.rounds.some((r) => r.holes.length === 18)));
  const multi = (d.count ?? d.rounds.length) > 1;

  const prizeOf = (k: SideKind) => d.prizes.find((p) => p.kind === k);
  const putPrize = (x: Draft, k: SideKind, p: Partial<Prize> | null): Draft => {
    if (!CAN_PRIZE.includes(k)) return x;
    const kind = k as PrizeKind;
    const has = x.prizes.some((q) => q.kind === kind);
    const prizes = p === null ? x.prizes.filter((q) => q.kind !== kind) : has ? x.prizes.map((q) => (q.kind === kind ? { ...q, ...p } : q)) : [...x.prizes, { kind, per: kind === "nines" ? "round" : "trip", ...p } as Prize];
    return { ...x, prizes };
  };
  const putBonus = (x: Draft, k: SideKind, v: number): Draft => (CAN_POINTS.includes(k) ? { ...x, bonus: { ...x.bonus, [k]: v } } : x);
  const startPts = (k: SideKind) => (k === "eagles" ? 2 : 1);
  type Mode = "points" | "prize" | "both";
  const modeOf = (k: SideKind): Mode | null => {
    const pts = race && (d.bonus[k as BonusKind] ?? 0) > 0;
    const pr = !!prizeOf(k);
    return pts && pr ? "both" : pts ? "points" : pr ? "prize" : null;
  };
  const setMode = (k: SideKind, m: Mode) =>
    set((x) => {
      let y = putBonus(x, k, m === "prize" ? 0 : (x.bonus[k as BonusKind] ?? 0) > 0 ? x.bonus[k as BonusKind]! : startPts(k));
      y = m === "points" ? putPrize(y, k, null) : prizeOf(k) ? y : putPrize(y, k, {});
      return y;
    });
  const tick = (k: SideKind) => {
    if (modeOf(k)) return setOpen(open === k ? null : k);
    // Ticked: points for each one in a points race, otherwise a prize
    setMode(k, race && CAN_POINTS.includes(k) ? "points" : "prize");
    setOpen(k);
  };
  const untick = (k: SideKind) => {
    set((x) => {
      const y = putPrize(putBonus(x, k, 0), k, null);
      if (k !== "ctp" && k !== "ld") return y;
      const holes = { ...(y.sideHoles ?? {}) };
      delete holes[k];
      return { ...y, sideHoles: holes };
    });
    setOpen(null);
  };

  const on = kinds.filter((k) => modeOf(k));
  const total = onTopLine(s);
  return (
    <Screen q="Side games" hint="Played alongside the rounds. Tick the ones you want.">
      <div className="wz-prizes">
        {kinds.map((k) => {
          const m = modeOf(k);
          const isOpen = open === k && !!m;
          const rest = m ? sideLine(s, k)?.slice(SIDE_NAME[k].length + 2) : null;
          const line = rest ? rest[0].toUpperCase() + rest.slice(1) : null;
          const both = race && CAN_POINTS.includes(k) && CAN_PRIZE.includes(k);
          const pr = prizeOf(k);
          return (
            <div className={`wz-prize${m ? " on" : ""}${isOpen ? " open" : ""}`} key={k}>
              <button type="button" className="wz-prize-t" aria-pressed={!!m} aria-expanded={m ? isOpen : undefined} onClick={() => tick(k)}>
                <span className="wz-tick" aria-hidden />
                <span>
                  <strong>{SIDE_NAME[k]}</strong>
                  <small>{line ?? SIDE_NOTE[k]}</small>
                </span>
              </button>
              {isOpen && (
                <div className="wz-side-body">
                  {both && (
                    <div className="wz-side-q">
                      <p className="wz-side-k">How does it count?</p>
                      <Choice
                        label={`${SIDE_NAME[k]}: how it counts`}
                        value={m}
                        options={[
                          ["points", "Points for each one"],
                          ["prize", "A prize for the most"],
                          ["both", "Both"],
                        ]}
                        onChange={(v) => setMode(k, v)}
                      />
                    </div>
                  )}
                  {race && (m === "points" || m === "both") && (
                    <div className="wz-pt-row">
                      <span>{EACH[k]}</span>
                      <Stepper value={d.bonus[k as BonusKind] ?? startPts(k)} min={0.5} step={0.5} label={`${SIDE_NAME[k]}: points for each one`} onChange={(v) => set((x) => putBonus(x, k, v))} />
                    </div>
                  )}
                  {pr && (
                    <>
                      {multi && PER_ROUND.includes(k) && (
                        <div className="wz-side-q">
                          <p className="wz-side-k">The prize</p>
                          <Pair label={`${SIDE_NAME[k]}: how often`} value={pr.per} options={[["trip", "Whole trip"], ["round", "Each round"]]} onChange={(v) => set((x) => putPrize(x, k, { per: v }))} />
                        </div>
                      )}
                      {race && (
                        <div className="wz-pt-row">
                          <span>Worth points in the race</span>
                          <Stepper value={pr.points ?? 0} label={`${SIDE_NAME[k]}: prize points`} fmt={(v) => (v ? (Number.isInteger(v) ? String(v) : `${Math.floor(v) || ""}½`) : "No")} onChange={(v) => set((x) => putPrize(x, k, { points: v || null }))} />
                        </div>
                      )}
                    </>
                  )}
                  {(k === "ctp" || k === "ld") && <SideHolesPick d={d} set={set} kind={k} rounds={s.rounds as (SideRound & { key: string })[]} played={played} />}
                  <div className="wz-side-end">
                    <button type="button" className="btn" onClick={() => setOpen(null)}>
                      Done
                    </button>
                    <button type="button" className="btn secondary" onClick={() => untick(k)}>
                      Take it off
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {on.length > 0 && total && <p className="wz-side-total">{total}</p>}
      <Next onClick={() => done()} label={nextLabel ?? (on.length ? "Next" : "No side games")} />
    </Screen>
  );
}

/**
 * Closest the pin and long drive: every par 3 (par 5), or chosen round by round. Rounds on the same course share
 * their holes unless switched apart. A hole already played can't change.
 */
function SideHolesPick({ d, set, kind, rounds, played }: { d: Draft; set: StepProps["set"]; kind: "ctp" | "ld"; rounds: (SideRound & { key: string })[]; played?: Record<string, number[]> }) {
  const par = kind === "ctp" ? 3 : 5;
  const chosen = d.sideHoles?.[kind] ?? null;
  const [choosing, setChoosing] = useState(!!chosen && Object.keys(chosen).length > 0);
  const withPar = rounds.filter((r) => parHoles(r, kind).length);
  const without = rounds.filter((r) => r.holes.length && !parHoles(r, kind).length);
  // Rounds on one course (same tee, same holes) share, unless they were set differently or switched apart
  const groups: { key: string; rounds: (SideRound & { key: string })[] }[] = [];
  for (const r of withPar) {
    const g = groups.find((x) => x.key === r.key);
    if (g) g.rounds.push(r);
    else groups.push({ key: r.key, rounds: [r] });
  }
  const listOf = (r: SideRound) => chosen?.[String(r.number)] ?? parHoles(r, kind);
  const [apart, setApart] = useState<string[]>(() => groups.filter((g) => g.rounds.some((r) => listOf(r).join() !== listOf(g.rounds[0]).join())).map((g) => g.key));
  const every = kind === "ctp" ? "Every par 3" : "Every par 5";
  const isPlayed = (r: SideRound, n: number) => !!played?.[String(r.number)]?.includes(n);
  const write = (rs: SideRound[], next: (r: SideRound) => number[]) =>
    set((x) => {
      const now = { ...(x.sideHoles?.[kind] ?? Object.fromEntries(withPar.map((r) => [String(r.number), parHoles(r, kind)]))) };
      for (const r of rs) now[String(r.number)] = next(r);
      return { ...x, sideHoles: { ...(x.sideHoles ?? {}), [kind]: now } };
    });
  const toggle = (rs: SideRound[], n: number) => write(rs, (r) => (listOf(r).includes(n) ? listOf(r).filter((h) => h !== n) : [...listOf(r), n].sort((a, b) => a - b)));
  const noneIn = (rs: SideRound[]) => rs.every((r) => !listOf(r).length);
  // "Not in this round": every hole off (those played stay as they are); pressed again, every hole back on
  const allOff = (rs: SideRound[]) => write(rs, (r) => (noneIn(rs) ? parHoles(r, kind) : listOf(r).filter((h) => isPlayed(r, h))));
  const nineWords = (r: SideRound) => (r.nine === "front" ? " on the front nine" : r.nine === "back" ? " on the back nine" : "");
  const block = (rs: SideRound[]) => {
    const first = rs[0];
    const head = `${rs.length === 1 ? `Round ${first.number}` : `Rounds ${and(rs.map((r) => String(r.number)))}`}, ${first.course}`;
    return (
      <div className="wz-holes-pick" key={rs.map((r) => r.number).join("-")}>
        <p className="wz-side-k">{head}</p>
        <div className="pick-tiles">
          {parHoles(first, kind).map((n) => {
            const y = first.holes.find((h) => h.number === n)?.yards;
            const locked = rs.some((r) => isPlayed(r, n));
            return (
              <button key={n} type="button" className="pick-tile" aria-pressed={listOf(first).includes(n)} disabled={locked} onClick={() => toggle(rs, n)}>
                {ordinal(n)}
                {y ? <small>{y} yds</small> : null}
                {locked && <small className="wz-played">Played</small>}
              </button>
            );
          })}
        </div>
        <button type="button" className="pick-tile wz-not-in" aria-pressed={noneIn(rs)} onClick={() => allOff(rs)}>
          {rs.length === 1 ? "Not in this round" : "Not in these rounds"}
        </button>
      </div>
    );
  };
  if (!withPar.length) return <p className="small muted">{`No par ${par}s in ${rounds.length > 1 ? "any round" : "this round"}, so there's nowhere to play it.`}</p>;
  return (
    <div className="wz-prize-holes">
      <p className="wz-side-k">Which holes?</p>
      <Pair
        label={`${kind === "ctp" ? "Closest the pin" : "Long drive"}: which holes`}
        value={choosing ? "choose" : "every"}
        options={[
          ["every", every],
          ["choose", "Choose holes"],
        ]}
        onChange={(v) => {
          setChoosing(v === "choose");
          // Every par 3: the choice goes (a hole already played keeps how it was, on the server)
          if (v === "every") set((x) => ({ ...x, sideHoles: Object.fromEntries(Object.entries(x.sideHoles ?? {}).filter(([k]) => k !== kind)) }));
        }}
      />
      {choosing &&
        groups.map((g) =>
          g.rounds.length > 1 ? (
            <div key={g.key} className="wz-holes-group">
              <label className="wz-switch">
                <input
                  type="checkbox"
                  checked={!apart.includes(g.key)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setApart(apart.filter((k) => k !== g.key));
                      write(g.rounds.slice(1), () => listOf(g.rounds[0]));
                    } else setApart([...apart, g.key]);
                  }}
                />
                <span>Same holes in every round here</span>
              </label>
              {apart.includes(g.key) ? g.rounds.map((r) => block([r])) : block(g.rounds)}
            </div>
          ) : (
            block(g.rounds)
          ),
        )}
      {without.map((r) => (
        <p key={r.number} className="small muted">
          No par {par}s{nineWords(r)} at {r.course}
          {rounds.length > 1 ? ` (round ${r.number})` : ""}, so it isn&apos;t played there.
        </p>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ extras, look, about

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

function YN({ q, note, value, onChange }: { q: string; note: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="wz-yn">
      <div className="wz-yn-q">
        <strong>{q}</strong>
        <span>{note}</span>
      </div>
      <Pair label={q} value={value ? "yes" : "no"} options={[["yes", "Yes"], ["no", "No"]]} onChange={(v) => onChange(v === "yes")} />
    </div>
  );
}

export function ExtrasScreen({ d, set, done, nextLabel }: StepProps) {
  const e = d.extras;
  const put = (p: Partial<Draft["extras"]>) => set((x) => ({ ...x, extras: { ...x.extras, ...p } }));
  return (
    <Screen q="The extras" hint="All on to start. Turn off anything you don't want.">
      <div className="wz-yns">
        <YN q="Live feed" note="Photos, comments and notes from the course, for everyone following" value={e.feed} onChange={(v) => put({ feed: v })} />
        <YN q="AI writing" note="Previews before each round, reports after, and bulletins while you play" value={e.ai} onChange={(v) => put({ ai: v })} />
        {e.ai && (
          <div className="wz-yn">
            <div className="wz-yn-q">
              <strong>Writing style</strong>
            </div>
            <div className="wz-tones">
              {(Object.keys(TONE_LABEL) as Tone[]).map((t) => (
                <button key={t} type="button" className="pick-tile wz-tone" aria-pressed={d.tone === t} onClick={() => set((x) => ({ ...x, tone: t }))}>
                  <b>{TONE_LABEL[t].split(":")[0]}</b>
                  <small>{cap(TONE_LABEL[t].split(":").slice(1).join(":").trim())}</small>
                </button>
              ))}
            </div>
          </div>
        )}
        <YN q="Video" note="Film clips on the course, and a highlights film at the end" value={e.video} onChange={(v) => put({ video: v })} />
        {e.video && (
          <div className="wz-yn">
            <div className="wz-yn-q">
              <strong>Where will you mostly share your videos?</strong>
              <span>The camera asks you to hold the phone this way, and the film is made in this shape.</span>
            </div>
            <Pair label="Video shape" value={d.share} options={[["portrait", "Phones (upright)"], ["landscape", "YouTube and TV (wide)"]]} onChange={(v) => set((x) => ({ ...x, share: v }))} />
          </div>
        )}
        <div className="wz-yn">
          <div className="wz-yn-q">
            <strong>GPS distances in</strong>
            <span>Front, middle and back of the green. Anyone can switch on their own phone.</span>
          </div>
          <Pair label="Distances" value={d.units} options={[["yards", "Yards"], ["metres", "Metres"]]} onChange={(v) => set((x) => ({ ...x, units: v }))} />
        </div>
      </div>
      <Next onClick={() => done()} label={nextLabel} />
    </Screen>
  );
}

/** Who can watch: anyone with the link (the default), or only the players and the people they let in. */
export function WatchScreen({ d, set, done, nextLabel }: StepProps) {
  const priv = d.privacy === "private";
  return (
    <Screen q="Who can watch?" hint="You can change this any time.">
      <Tiles>
        <Tile on={!priv} title="Friends and family" note="Anyone you send the link to can watch and comment. It isn't listed anywhere or on Google." onClick={() => set((x) => ({ ...x, privacy: "friends", playersNeedEmail: false }))} />
        <Tile on={priv} title="Private" note="Only the players and the people they let in. Others ask to follow, and a player or organiser says yes." onClick={() => set((x) => ({ ...x, privacy: "private" }))} />
      </Tiles>
      {priv && d.who !== "solo" && (
        <div className="wz-yns">
          <YN q="Players sign in with their email too" note="As well as their personal link, for extra safety. Most groups leave this off." value={!!d.playersNeedEmail} onChange={(v) => set((x) => ({ ...x, playersNeedEmail: v }))} />
        </div>
      )}
      <Next onClick={() => done()} label={nextLabel} />
    </Screen>
  );
}

export function LookScreen({ d, done }: StepProps) {
  const ps = named(d);
  const a = ps[0]?.name || "Neil";
  const b = ps[1]?.name || "Oisin";
  return (
    <Screen q="Pick a look" hint="Colours for the whole site and the leaderboards.">
      <div className="wz-themes">
        {THEMES.filter((t) => t.id !== "custom" && t.id !== "clubhouse").map((t) => (
          <button key={t.id} type="button" className="wz-theme" data-theme={t.id} data-board={LIGHT_BOARD.includes(t.id) ? "light" : "dark"} aria-pressed={d.theme === t.id} onClick={() => done({ theme: t.id })}>
            <span className="wz-mini" aria-hidden>
              <span className="wz-mini-row lead">
                <span>{a}</span>
                <b>{d.win === "stroke" ? "−3" : "12"}</b>
              </span>
              <span className="wz-mini-row">
                <span>{b}</span>
                <b>{d.win === "stroke" ? "−1" : "9"}</b>
              </span>
            </span>
            <strong>{t.name}</strong>
            <span className="small muted">{t.note}</span>
          </button>
        ))}
      </div>
    </Screen>
  );
}

export function AboutScreen({ d, set, done, nextLabel }: StepProps) {
  const ps = named(d);
  const edit = (key: string, p: Partial<DPlayer>) => set((x) => ({ ...x, players: x.players.map((q) => (q.key === key ? { ...q, ...p } : q)) }));
  const any = ps.some((p) => p.nickname.trim() || p.line.trim());
  return (
    <Screen q="About the players" hint="A nickname and a line about each, so the previews and reports have some colour. Skip it if you like.">
      <div className="wz-abouts">
        {ps.map((p) => (
          <div className="wz-about" key={p.key}>
            <strong>{p.name}</strong>
            <input className="wz-input" aria-label={`${p.name}: nickname`} placeholder="Nickname" value={p.nickname} onChange={(e) => edit(p.key, { nickname: e.target.value })} maxLength={40} />
            <input className="wz-input" aria-label={`${p.name}: a line about them`} placeholder="e.g. Long off the tee, nervous over a short putt" value={p.line} onChange={(e) => edit(p.key, { line: e.target.value })} maxLength={200} />
          </div>
        ))}
      </div>
      <Next onClick={() => done()} label={nextLabel ?? (any ? "Next" : "Skip")} />
    </Screen>
  );
}

/** What stops the answers working, shown where it can be fixed. */
export function Problems({ d }: { d: Draft }) {
  const list = useMemo(() => draftProblems(d), [d]);
  if (!list.length) return null;
  return (
    <>
      {list.map((x) => (
        <p className="notice" key={x}>
          {x}
        </p>
      ))}
    </>
  );
}
