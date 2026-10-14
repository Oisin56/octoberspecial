"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CardTable } from "@/components/editors";
import { LIGHT_BOARD, THEMES, type HoleSet, type ThemeId } from "@/lib/types";
import {
  FORMATS,
  MAX_PLAYERS,
  MAX_ROUNDS,
  defaultPoints,
  drawProblems,
  formatName,
  isMatch,
  needsDraw,
  standingsFor,
  type DayFormat,
  type RoundPoints,
  type Who,
  type WizRound,
} from "@/lib/wizard";

/**
 * The setup wizard: one question per screen, big tiles, and one "Create my tournament" at the end.
 * Answers stay on this phone as you go, so a locked screen or a phone call loses nothing.
 */

interface Tee {
  name: string;
  par: number[];
  yards: number[];
  rating?: number;
  slope?: number;
}
interface Hit {
  ref: string;
  name: string;
  location: string;
  holes?: number;
  lat?: number;
  lon?: number;
}
type DRound = Omit<WizRound, "format"> & { format: DayFormat | null; tees?: Tee[]; manual?: boolean };
interface DPlayer {
  name: string;
  index: string;
  team: 0 | 1 | null;
}
interface Draft {
  v: 1;
  step: string;
  who: Who | null;
  name: string;
  subtitle: string;
  count: number | null;
  rounds: DRound[];
  same: boolean | null;
  organiserPlays: boolean | null;
  players: DPlayer[];
  teams: { name: string; color: string }[];
  draw: "myself" | "random" | null;
  extras: { feed: boolean | null; ai: boolean | null; video: boolean | null };
  units?: "yards" | "metres";
  theme: ThemeId | null;
  keep: "email" | "pin" | null;
  email: string;
  pin: string;
}

const KEY = "mgs-wizard-v1";
const TEAM_COLOURS = ["#c8102e", "#1d4f91", "#2e7d4f", "#a8741f", "#5b3f8c", "#1b1b1b"];

const fresh = (): Draft => ({
  v: 1,
  step: "who",
  who: null,
  name: "",
  subtitle: "",
  count: null,
  rounds: [],
  same: null,
  organiserPlays: null,
  players: [],
  teams: [
    { name: "", color: TEAM_COLOURS[0] },
    { name: "", color: TEAM_COLOURS[1] },
  ],
  draw: null,
  extras: { feed: null, ai: null, video: null },
  theme: null,
  keep: null,
  email: "",
  pin: "",
});

const emptyRound = (): DRound => ({ courseRef: null, courseName: "", holeSet: "all", format: null, date: null, time: null });

const holesOf = (r: DRound) => (r.manual ? r.manualCard?.length ?? 18 : r.tees?.[0]?.par.length ?? 18);

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

const indexNumber = (s: string): number | null => {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const plus = t.startsWith("+");
  const n = Number(t.replace(/^\+/, ""));
  if (!Number.isFinite(n)) return null;
  return plus ? -n : n;
};

/** Every screen, in order, for the answers so far. */
function stepsFor(d: Draft): string[] {
  const s = ["who", "name", "count"];
  const n = d.count ?? 0;
  for (let i = 0; i < n; i++) {
    const r = d.rounds[i];
    s.push(`course:${i}`);
    if (r && !r.manual && (r.tees?.length ?? 0) > 1) s.push(`tee:${i}`);
    if (r && holesOf(r) === 18) s.push(`holes:${i}`);
    if (i === 0 || !(d.same || d.who === "solo")) s.push(`format:${i}`);
    if (i === 0 && n > 1 && d.who !== "solo") s.push("same");
    s.push(`when:${i}`);
  }
  const fmt = d.rounds.slice(0, n).map((r) => r.format).filter(Boolean) as DayFormat[];
  const standings = d.who ? standingsFor({ who: d.who, rounds: fmt.map((f) => ({ format: f })) as WizRound[] }) : "points";
  if (d.who !== "solo" && standings === "points") s.push("points");
  s.push("players");
  if (d.who === "teams") s.push("teams");
  if (d.who && needsDraw({ who: d.who, rounds: fmt.map((f) => ({ format: f })) as WizRound[], players: d.players.map(() => ({ name: "", index: null })) })) s.push("draw");
  s.push("extras", "look", "safe");
  return s;
}

export default function NewTournament() {
  const router = useRouter();
  const [d, setD] = useState<Draft>(fresh);
  const [loaded, setLoaded] = useState(false);
  const [hasOld, setHasOld] = useState(false);
  const [me, setMe] = useState<{ owner: boolean; email: string | null } | null>(null);

  // Pick up where you left off
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
          const old = JSON.parse(raw) as Draft;
          if (old?.v === 1 && old.who) {
            setD(old);
            setHasOld(true);
          }
        }
      } catch {
        /* private browsing: start fresh */
      }
      setLoaded(true);
    }, 0);
    Promise.all([fetch("/api/owner").then((r) => r.json()).catch(() => ({})), fetch("/api/account").then((r) => r.json()).catch(() => ({}))]).then(([o, a]) =>
      setMe({ owner: !!o.owner, email: a.account?.email ?? null }),
    );
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(d));
    } catch {
      /* fine */
    }
  }, [d, loaded]);

  const steps = useMemo(() => stepsFor(d), [d]);
  const at = Math.max(0, steps.indexOf(d.step));
  const step = steps[at] ?? "who";
  const [kind, idxRaw] = step.split(":");
  const ri = Number(idxRaw ?? 0);
  const topRef = useRef<HTMLDivElement>(null);

  const go = (to: string) => {
    setD((x) => ({ ...x, step: to }));
    topRef.current?.scrollIntoView({ block: "start" });
  };
  const next = (patch?: Partial<Draft>) => {
    const nd = { ...d, ...patch };
    const list = stepsFor(nd);
    const i = list.indexOf(step);
    nd.step = list[Math.min(list.length - 1, i + 1)];
    setD(nd);
    topRef.current?.scrollIntoView({ block: "start" });
  };
  const back = () => (at > 0 ? go(steps[at - 1]) : router.push("/"));
  const setRound = (i: number, patch: Partial<DRound>) =>
    setD((x) => ({ ...x, rounds: x.rounds.map((r, k) => (k === i ? { ...r, ...patch } : r)) }));

  const startAgain = () => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* fine */
    }
    setHasOld(false);
    setD(fresh());
  };

  if (!loaded) return <Shell>{null}</Shell>;

  return (
    <Shell>
      <div ref={topRef} className="wz" data-step={kind}>
        <div className="wz-top">
          <button type="button" className="back-home" onClick={back}>
            <span aria-hidden>←</span> {at === 0 ? "Home" : "Back"}
          </button>
          <div className="wz-progress" aria-label={`Step ${at + 1} of ${steps.length}`}>
            <span style={{ width: `${((at + 1) / steps.length) * 100}%` }} />
          </div>
        </div>

        {kind === "who" && (
          <Screen q="Who's playing?">
            {hasOld && (
              <p className="notice">
                Carrying on from where you left off.{" "}
                <button type="button" className="linklike" onClick={startAgain}>
                  Start again
                </button>
              </p>
            )}
            <Tiles>
              <Tile on={d.who === "solo"} title="Just me" note="A round or a trip on your own: film it, keep score, make the vlog" onClick={() => next({ who: "solo", draw: null, organiserPlays: true })} />
              <Tile on={d.who === "individuals"} title="A group of us" note="Everyone for themselves: Stableford, stroke play, matches or skins" onClick={() => next({ who: "individuals" })} />
              <Tile on={d.who === "teams"} title="Two teams" note="Ryder Cup style: fourballs, foursomes and singles" onClick={() => next({ who: "teams" })} />
            </Tiles>
          </Screen>
        )}

        {kind === "name" && (
          <Screen q={d.who === "solo" ? "What shall we call it?" : "What's it called?"}>
            <div className="field">
              <label htmlFor="wz-name">Name</label>
              <input id="wz-name" className="wz-input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder={d.who === "solo" ? "e.g. My Algarve golf trip" : "e.g. The Lads' Cup 2027"} autoFocus maxLength={80} />
            </div>
            <div className="field">
              <label htmlFor="wz-sub">A line underneath (optional)</label>
              <input id="wz-sub" className="wz-input" value={d.subtitle} onChange={(e) => setD({ ...d, subtitle: e.target.value })} placeholder="e.g. Three days, two teams, one trophy" maxLength={120} />
            </div>
            <Next disabled={!d.name.trim()} onClick={() => next()} />
          </Screen>
        )}

        {kind === "count" && (
          <Screen q="How many rounds?" hint="You can add or remove rounds later in Fine-tune.">
            <div className="wz-nums">
              {Array.from({ length: MAX_ROUNDS }, (_, i) => i + 1).map((n) => (
                <button
                  type="button"
                  key={n}
                  className="num-tile"
                  aria-pressed={d.count === n}
                  onClick={() => {
                    const rounds = Array.from({ length: n }, (_, i) => d.rounds[i] ?? emptyRound());
                    next({ count: n, rounds });
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          </Screen>
        )}

        {kind === "course" && <CourseStep key={ri} d={d} i={ri} setD={setD} next={next} />}

        {kind === "tee" && (
          <Screen q={`Which tees at ${d.rounds[ri].courseName}?`} label={roundLabel(d, ri)} hint="Everyone plays the same tees.">
            <Tiles>
              {(d.rounds[ri].tees ?? []).map((t) => {
                const total = t.yards.reduce((a, b) => a + b, 0);
                const col = teeColour(t.name);
                return (
                  <Tile
                    key={t.name}
                    on={d.rounds[ri].tee === t.name}
                    title={
                      <>
                        {col && <span className="wz-tee" style={{ background: col }} aria-hidden />}
                        {t.name}
                      </>
                    }
                    note={[total ? `${total.toLocaleString("en-IE")} yards` : null, t.slope && t.rating ? `slope ${t.slope}, rating ${t.rating}` : null].filter(Boolean).join(" · ") || undefined}
                    onClick={() => {
                      const rounds = d.rounds.map((r, k) => (k === ri ? { ...r, tee: t.name } : r));
                      next({ rounds });
                    }}
                  />
                );
              })}
            </Tiles>
          </Screen>
        )}

        {kind === "holes" && (
          <Screen q="How many holes?" label={roundLabel(d, ri)}>
            <Tiles>
              {(
                [
                  ["all", "All 18"],
                  ["front", "Front 9"],
                  ["back", "Back 9"],
                ] as [HoleSet, string][]
              ).map(([v, label]) => (
                <Tile
                  key={v}
                  on={d.rounds[ri].holeSet === v}
                  title={label}
                  onClick={() => {
                    const rounds = d.rounds.map((r, k) => (k === ri ? { ...r, holeSet: v } : r));
                    next({ rounds });
                  }}
                />
              ))}
            </Tiles>
          </Screen>
        )}

        {kind === "format" && (
          <Screen q={d.who === "solo" ? "How are you scoring?" : `What's the format for round ${ri + 1}?`} label={d.who === "solo" ? undefined : roundLabel(d, ri)}>
            <Tiles>
              {FORMATS[d.who ?? "individuals"].map((f) => (
                <Tile
                  key={f.id}
                  on={d.rounds[ri].format === f.id}
                  title={f.name}
                  note={f.note}
                  onClick={() => {
                    const all = d.who === "solo" || d.same === true;
                    const rounds = d.rounds.map((r, k) => (k === ri || (all && ri === 0) ? { ...r, format: f.id, points: undefined } : r));
                    next({ rounds });
                  }}
                />
              ))}
            </Tiles>
          </Screen>
        )}

        {kind === "same" && (
          <Screen q="Same format every round?" hint={d.rounds[0].format ? `Round 1 is ${formatName(d.rounds[0].format).toLowerCase()}.` : undefined}>
            <Tiles>
              <Tile
                on={d.same === true}
                title={`Yes, ${d.rounds[0].format ? formatName(d.rounds[0].format).toLowerCase() : "the same"} every round`}
                note={d.rounds[0].format === "stableford" || d.rounds[0].format === "stroke" ? "The leaderboard is the running total over every round" : "Points for each match, added up"}
                onClick={() => next({ same: true, rounds: d.rounds.map((r) => ({ ...r, format: d.rounds[0].format, points: undefined })) })}
              />
              <Tile on={d.same === false} title="No, they're different" note="You'll pick each round's format. Points for each round are added up, October Special style" onClick={() => next({ same: false })} />
            </Tiles>
          </Screen>
        )}

        {kind === "when" && <WhenStep d={d} i={ri} setRound={setRound} next={next} />}

        {kind === "points" && <PointsStep d={d} setD={setD} next={next} />}

        {kind === "players" && <PlayersStep d={d} setD={setD} next={next} />}

        {kind === "teams" && <TeamsStep d={d} setD={setD} next={next} />}

        {kind === "draw" && (
          <Screen q="Who plays with whom?" hint={d.who === "teams" ? "The matches for each round: who's paired with whom, and who they play." : "The groups (and matches) for each round."}>
            <Tiles>
              <Tile on={d.draw === "myself"} title="I'll set them myself" note="In Fine-tune, once the tournament is made. It'll be on your to-do list" onClick={() => next({ draw: "myself" })} />
              <Tile on={d.draw === "random"} title="Random draw" note="Made for you now. You can still change any of it in Fine-tune" onClick={() => next({ draw: "random" })} />
            </Tiles>
          </Screen>
        )}

        {kind === "extras" && <ExtrasStep d={d} setD={setD} next={next} />}

        {kind === "look" && (
          <Screen q="Pick a look" hint="Colours for the whole site and the leaderboards. You can change it later.">
            <div className="wz-themes">
              {THEMES.filter((t) => t.id !== "custom").map((t) => (
                <button key={t.id} type="button" className="wz-theme" data-theme={t.id} data-board={LIGHT_BOARD.includes(t.id) ? "light" : "dark"} aria-pressed={d.theme === t.id} onClick={() => next({ theme: t.id })}>
                  <span className="wz-mini" aria-hidden>
                    <span className="wz-mini-row lead">
                      <span>Neil</span>
                      <b>12</b>
                    </span>
                    <span className="wz-mini-row">
                      <span>Oisin</span>
                      <b>9½</b>
                    </span>
                  </span>
                  <strong>{t.name}</strong>
                  <span className="small muted">{t.note}</span>
                </button>
              ))}
            </div>
          </Screen>
        )}

        {kind === "safe" && <SafeStep d={d} setD={setD} me={me} onDone={(slug) => (startAgainQuiet(), router.push(`/t/${slug}/ready`))} />}
      </div>
    </Shell>
  );
}

function startAgainQuiet() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* fine */
  }
}

const roundLabel = (d: Draft, i: number) => (d.count && d.count > 1 ? `Round ${i + 1} of ${d.count}${d.rounds[i]?.courseName ? ` · ${d.rounds[i].courseName}` : ""}` : d.rounds[i]?.courseName || undefined);

// ------------------------------------------------------------------ pieces

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-root" data-theme="clubhouse">
      <header className="site-head">
        <div className="wrap" style={{ padding: "18px 16px" }}>
          <Link href="/" className="site-title">
            MyGolfSpecial
          </Link>
        </div>
      </header>
      <main className="wrap">{children}</main>
    </div>
  );
}

function Screen({ q, label, hint, children }: { q: string; label?: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="wz-screen">
      {label && <p className="wz-label">{label}</p>}
      <h1 className="wz-q">{q}</h1>
      {hint && <p className="wz-hint">{hint}</p>}
      <div className="wz-body">{children}</div>
    </section>
  );
}

function Tiles({ children }: { children: React.ReactNode }) {
  return <div className="wz-tiles">{children}</div>;
}

function Tile({ on, title, note, onClick, disabled }: { on?: boolean; title: React.ReactNode; note?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="wz-tile" aria-pressed={!!on} onClick={onClick} disabled={disabled}>
      <span className="wz-t">{title}</span>
      {note && <span className="wz-n">{note}</span>}
    </button>
  );
}

function Next({ onClick, disabled, label = "Next" }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" className="btn block wz-next" disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
}

function YesNo({ q, note, value, onChange }: { q: string; note: string; value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div className="wz-yn">
      <div className="wz-yn-q">
        <strong>{q}</strong>
        <span>{note}</span>
      </div>
      <div className="wz-yn-b">
        <button type="button" className="pick-tile" aria-pressed={value === true} onClick={() => onChange(true)}>
          Yes
        </button>
        <button type="button" className="pick-tile" aria-pressed={value === false} onClick={() => onChange(false)}>
          No
        </button>
      </div>
    </div>
  );
}

function Stepper({ value, onChange, label, step = 1 }: { value: number; onChange: (n: number) => void; label: string; step?: number }) {
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : `${Math.floor(n)}½`);
  return (
    <div className="wz-stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`Less: ${label}`} onClick={() => onChange(Math.max(0, value - step))}>
        −
      </button>
      <span className="num">{fmt(value)}</span>
      <button type="button" aria-label={`More: ${label}`} onClick={() => onChange(Math.min(50, value + step))}>
        +
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ course

function CourseStep({ d, i, setD, next }: { d: Draft; i: number; setD: React.Dispatch<React.SetStateAction<Draft>>; next: (p?: Partial<Draft>) => void }) {
  const r = d.rounds[i];
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [manual, setManual] = useState(!!r.manual);
  const [card, setCard] = useState<{ par: number; si: number; yards: number }[]>(
    (r.manualCard ?? Array.from({ length: 18 }, (_, k) => ({ par: 4, si: k + 1 }))).map((h) => ({ ...h, yards: 0 })),
  );
  const [mName, setMName] = useState(r.manual ? r.courseName : "");

  // Courses already chosen for earlier rounds: one tap, no search
  const earlier = d.rounds
    .slice(0, i)
    .filter((x, k, all) => (x.courseRef || x.manual) && all.findIndex((y) => y.courseName === x.courseName && y.tee === x.tee && y.holeSet === x.holeSet) === k);

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
    const tees = c.tees.map((t) => ({ name: t.name, par: t.par, yards: t.yards, rating: t.rating, slope: t.slope }));
    const holeSet: HoleSet = tees[0].par.length === 9 ? "all" : r.holeSet;
    const rounds = d.rounds.map((x, k) =>
      k === i ? { ...x, courseRef: h.ref, courseName: h.name, location: h.location, lat: c.lat ?? h.lat ?? null, lon: c.lon ?? h.lon ?? null, tees, tee: tees[0].name, holeSet, manual: false, manualCard: null } : x,
    );
    next({ rounds });
  }

  function pickEarlier(x: DRound) {
    const rounds = d.rounds.map((y, k) => (k === i ? { ...y, courseRef: x.courseRef, courseName: x.courseName, location: x.location, lat: x.lat, lon: x.lon, tees: x.tees, tee: x.tee, holeSet: x.holeSet, manual: x.manual, manualCard: x.manualCard } : y));
    // Same course, same tees and holes: straight on to the format
    const list = stepsFor({ ...d, rounds });
    const to = list.find((s, k) => k > list.indexOf(`course:${i}`) && !s.startsWith("tee:") && !s.startsWith("holes:")) ?? list[list.indexOf(`course:${i}`) + 1];
    setD((x) => ({ ...x, rounds, step: to }));
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
          onClick={() => {
            const sis = card.map((h) => h.si);
            if (new Set(sis).size !== card.length || sis.some((s) => s < 1 || s > card.length)) return setErr(card.length === 18 ? "Each stroke index from 1 to 18 must be used once." : "Each hole needs a different stroke index, 1 to 9.");
            if (card.some((h) => h.par < 3 || h.par > 6)) return setErr("Each par must be 3 to 6.");
            const rounds = d.rounds.map((x, k) => (k === i ? { ...x, courseRef: null, courseName: mName.trim(), manual: true, manualCard: card.map((h) => ({ par: h.par, si: h.si })), tees: undefined, tee: null, holeSet: card.length === 9 ? ("all" as HoleSet) : x.holeSet } : x));
            next({ rounds });
          }}
        />
        <button type="button" className="linklike" onClick={() => setManual(false)}>
          Search for the course instead
        </button>
      </Screen>
    );

  return (
    <Screen q={i === 0 ? "Where are you playing?" : `Where's round ${i + 1}?`} label={d.count && d.count > 1 ? `Round ${i + 1} of ${d.count}` : undefined}>
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
          <button type="button" className="linklike" onClick={() => next()}>
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
                {[h.location, h.holes ? `${h.holes} holes` : null].filter(Boolean).join(" · ")}
                {busy === h.ref ? " · loading the card…" : ""}
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

// ------------------------------------------------------------------ when

function WhenStep({ d, i, setRound, next }: { d: Draft; i: number; setRound: (i: number, p: Partial<DRound>) => void; next: (p?: Partial<Draft>) => void }) {
  const r = d.rounds[i];
  const prev = d.rounds[i - 1]?.date;
  const suggest = prev ? new Date(new Date(prev).getTime() + 86400e3).toISOString().slice(0, 10) : null;
  return (
    <Screen q={`When is round ${i + 1}?`} label={roundLabel(d, i)} hint="Not sure yet? Skip it and add it later.">
      <div className="field">
        <label htmlFor="wz-date">Date</label>
        <input id="wz-date" className="wz-input" type="date" value={r.date ?? ""} onChange={(e) => setRound(i, { date: e.target.value || null })} />
      </div>
      {suggest && !r.date && (
        <button type="button" className="chip" onClick={() => setRound(i, { date: suggest })}>
          The day after round {i}: {new Date(suggest).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" })}
        </button>
      )}
      <div className="field">
        <label htmlFor="wz-time">First tee time (optional)</label>
        <input id="wz-time" className="wz-input" type="time" value={r.time ?? ""} onChange={(e) => setRound(i, { time: e.target.value || null })} />
      </div>
      <Next onClick={() => next()} label={r.date ? "Next" : "Skip for now"} />
    </Screen>
  );
}

// ------------------------------------------------------------------ points

function PointsStep({ d, setD, next }: { d: Draft; setD: (x: Draft) => void; next: (p?: Partial<Draft>) => void }) {
  const n = d.players.length || 8;
  const rounds = d.rounds.slice(0, d.count ?? 0);
  const set = (i: number, p: RoundPoints) => setD({ ...d, rounds: d.rounds.map((r, k) => (k === i ? { ...r, points: { ...(r.points ?? {}), ...p } } : r)) });
  return (
    <Screen q="Points for each round" hint="Already filled in. Change any with the + and − buttons. A halved match shares its point.">
      <div className="wz-points">
        {rounds.map((r, i) => {
          if (!r.format) return null;
          const p = { ...defaultPoints(r.format, n), ...r.points };
          return (
            <div className="wz-pt" key={i}>
              <div className="wz-pt-h">
                <strong>Round {i + 1}</strong> <span className="muted">{formatName(r.format)}</span>
              </div>
              {isMatch(r.format) && (
                <div className="wz-pt-row">
                  <span>For winning a match</span>
                  <Stepper value={p.win ?? 1} step={0.5} label={`round ${i + 1} points per match`} onChange={(v) => set(i, { win: v })} />
                </div>
              )}
              {r.format === "skins" && (
                <div className="wz-pt-row">
                  <span>For each skin</span>
                  <Stepper value={p.skin ?? 1} step={0.5} label={`round ${i + 1} points per skin`} onChange={(v) => set(i, { skin: v })} />
                </div>
              )}
              {(r.format === "stableford" || r.format === "stroke") &&
                (p.positions ?? []).map((v, k) => (
                  <div className="wz-pt-row" key={k}>
                    <span>{["1st", "2nd", "3rd", "4th", "5th"][k]} place</span>
                    <Stepper
                      value={v}
                      label={`round ${i + 1} points for ${["1st", "2nd", "3rd", "4th", "5th"][k]}`}
                      onChange={(x) => set(i, { positions: (p.positions ?? []).map((y, j) => (j === k ? x : y)) })}
                    />
                  </div>
                ))}
            </div>
          );
        })}
      </div>
      <Next onClick={() => next()} />
    </Screen>
  );
}

// ------------------------------------------------------------------ players

function PlayersStep({ d, setD, next }: { d: Draft; setD: (x: Draft) => void; next: (p?: Partial<Draft>) => void }) {
  const solo = d.who === "solo";
  const players = d.players.length ? d.players : [{ name: "", index: "", team: null }];
  const set = (list: DPlayer[]) => setD({ ...d, players: list });
  const lastRef = useRef<HTMLInputElement>(null);
  const [added, setAdded] = useState(0);
  useEffect(() => {
    if (added) lastRef.current?.focus();
  }, [added]);

  const named = players.filter((p) => p.name.trim());
  const badIndex = players.some((p) => p.index.trim() && indexNumber(p.index) == null);
  const fmts = d.rounds.slice(0, d.count ?? 0).map((r) => ({ format: r.format as DayFormat }));
  const problems = d.who === "individuals" ? drawProblems({ who: "individuals", rounds: fmts as WizRound[], players: named.map((p) => ({ name: p.name, index: null })) }).filter((x) => !x.startsWith("Add at least")) : [];

  if (!solo && d.organiserPlays == null)
    return (
      <Screen q="Are you playing?">
        <Tiles>
          <Tile title="Yes, I'm playing" note="You'll be first on the list" onClick={() => setD({ ...d, organiserPlays: true })} />
          <Tile title="No, I'm just organising" onClick={() => setD({ ...d, organiserPlays: false })} />
        </Tiles>
      </Screen>
    );

  return (
    <Screen q={solo ? "Your name and handicap" : "Who's playing?"} hint="First names are fine. Handicap index from your club app (for a plus handicap, type +2).">
      {!solo && (
        <p className="small">
          {d.organiserPlays ? "You're playing: you're first on the list." : "You're organising, not playing."}{" "}
          <button type="button" className="linklike" onClick={() => setD({ ...d, organiserPlays: null })}>
            Change
          </button>
        </p>
      )}
      <div className="wz-players">
        <div className="wz-player-h" aria-hidden>
          <span>Name</span>
          <span>Index</span>
        </div>
        {players.map((p, i) => (
          <div className="wz-player" key={i}>
            <input
              ref={i === players.length - 1 ? lastRef : undefined}
              className="wz-input"
              aria-label={`Player ${i + 1} name`}
              placeholder={i === 0 && (solo || d.organiserPlays) ? "Your first name" : `Player ${i + 1}`}
              value={p.name}
              onChange={(e) => set(players.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))}
              maxLength={40}
            />
            <input
              className="wz-input wz-hcp"
              aria-label={`Player ${i + 1} handicap index`}
              placeholder="Index"
              inputMode="decimal"
              value={p.index}
              onChange={(e) => set(players.map((x, k) => (k === i ? { ...x, index: e.target.value } : x)))}
            />
            {!solo && players.length > 1 && (
              <button type="button" className="wz-x" aria-label={`Remove ${p.name || `player ${i + 1}`}`} onClick={() => set(players.filter((_, k) => k !== i))}>
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      {!solo && players.length < MAX_PLAYERS && (
        <button
          type="button"
          className="btn secondary block wz-add"
          onClick={() => {
            set([...players, { name: "", index: "", team: null }]);
            setAdded((n) => n + 1);
          }}
        >
          + Add another player
        </button>
      )}
      {badIndex && <p className="error">A handicap index is a number, like 12.4 (or +2 for a plus handicap).</p>}
      {problems.map((x) => (
        <p className="notice" key={x}>
          {x}
        </p>
      ))}
      <Next
        disabled={badIndex || (solo ? !named.length : named.length < 2) || problems.length > 0}
        onClick={() => next({ players: players.filter((p) => p.name.trim()) })}
        label={!solo && named.length < 2 ? "Add at least two players" : "Next"}
      />
    </Screen>
  );
}

function TeamsStep({ d, setD, next }: { d: Draft; setD: (x: Draft) => void; next: (p?: Partial<Draft>) => void }) {
  const teams = d.teams;
  const setTeam = (i: number, p: Partial<Draft["teams"][number]>) => setD({ ...d, teams: teams.map((t, k) => (k === i ? { ...t, ...p } : t)) });
  const fmts = d.rounds.slice(0, d.count ?? 0).map((r) => ({ format: r.format as DayFormat }));
  const problems = drawProblems({ who: "teams", rounds: fmts as WizRound[], players: d.players.map((p) => ({ name: p.name, index: null, team: p.team })) });
  const shuffle = () => {
    const order = d.players.map((_, i) => i).sort(() => Math.random() - 0.5);
    const team: Record<number, 0 | 1> = {};
    order.forEach((p, k) => (team[p] = (k % 2) as 0 | 1));
    setD({ ...d, players: d.players.map((p, i) => ({ ...p, team: team[i] })) });
  };
  const label = (i: number) => teams[i].name.trim() || `Team ${i + 1}`;
  return (
    <Screen q="The two teams" hint="Name them, pick their colours, then tap each player onto a side.">
      <div className="wz-teams">
        {[0, 1].map((i) => (
          <div className="wz-team" key={i} style={{ borderColor: teams[i].color }}>
            <input className="wz-input" aria-label={`Team ${i + 1} name`} placeholder={i === 0 ? "e.g. The Locals" : "e.g. The Blow-ins"} value={teams[i].name} onChange={(e) => setTeam(i, { name: e.target.value })} maxLength={40} />
            <div className="wz-colours" role="group" aria-label={`Team ${i + 1} colour`}>
              {TEAM_COLOURS.filter((c) => teams[1 - i].color !== c).map((c) => (
                <button type="button" key={c} className="wz-colour" style={{ background: c }} aria-pressed={teams[i].color === c} aria-label={c} onClick={() => setTeam(i, { color: c })} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="wz-sides">
        {d.players.map((p, i) => (
          <div className="wz-side" key={i}>
            <span className="wz-side-name">{p.name}</span>
            <div className="wz-side-b">
              {[0, 1].map((t) => (
                <button
                  type="button"
                  key={t}
                  className="pick-tile"
                  aria-pressed={p.team === t}
                  style={p.team === t ? { background: teams[t].color, borderColor: teams[t].color, color: "#fff" } : undefined}
                  onClick={() => setD({ ...d, players: d.players.map((x, k) => (k === i ? { ...x, team: t as 0 | 1 } : x)) })}
                >
                  {label(t)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="chip" onClick={shuffle}>
        Shuffle them for me
      </button>
      {problems.map((x) => (
        <p className="notice" key={x}>
          {x}
        </p>
      ))}
      <Next disabled={problems.length > 0} onClick={() => next()} />
    </Screen>
  );
}

// ------------------------------------------------------------------ extras

function ExtrasStep({ d, setD, next }: { d: Draft; setD: (x: Draft) => void; next: (p?: Partial<Draft>) => void }) {
  const e = d.extras;
  const set = (p: Partial<Draft["extras"]>) => setD({ ...d, extras: { ...e, ...p } });
  return (
    <Screen q="The extras" hint="All on to start. Turn off anything you don't want; you can change your mind later.">
      <div className="wz-yns">
        <YesNo q="Live feed" note="Photos, comments and notes from the course, for everyone following" value={e.feed ?? true} onChange={(v) => set({ feed: v })} />
        <YesNo q="AI writing" note="Previews before each round, reports after, and bulletins while you play" value={e.ai ?? true} onChange={(v) => set({ ai: v })} />
        <YesNo q="Video" note="Film clips on the course, and a highlights film at the end" value={e.video ?? true} onChange={(v) => set({ video: v })} />
        <div className="wz-yn">
          <div className="wz-yn-q">
            <strong>GPS distances in</strong>
            <span>Front, middle and back of the green, and how far each shot was. Anyone can switch on their own phone.</span>
          </div>
          <div className="wz-yn-b">
            <button type="button" className="pick-tile" aria-pressed={(d.units ?? "yards") === "yards"} onClick={() => setD({ ...d, units: "yards" })}>
              Yards
            </button>
            <button type="button" className="pick-tile" aria-pressed={d.units === "metres"} onClick={() => setD({ ...d, units: "metres" })}>
              Metres
            </button>
          </div>
        </div>
      </div>
      <Next
        onClick={() => next({ extras: { feed: e.feed ?? true, ai: e.ai ?? true, video: e.video ?? true } })}
      />
    </Screen>
  );
}

// ------------------------------------------------------------------ create

function SafeStep({ d, setD, me, onDone }: { d: Draft; setD: (x: Draft) => void; me: { owner: boolean; email: string | null } | null; onDone: (slug: string) => void }) {
  const [ownerPin, setOwnerPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const signedIn = me?.email;
  const needOwner = me && !me.owner;
  const okKeep = signedIn || (d.keep === "email" && /\S+@\S+\.\S+/.test(d.email)) || (d.keep === "pin" && /^\d{4,8}$/.test(d.pin));

  async function create() {
    setBusy(true);
    setErr(null);
    const wizard = {
      who: d.who,
      name: d.name,
      subtitle: d.subtitle,
      rounds: d.rounds.slice(0, d.count ?? 0).map((r) => ({
        courseRef: r.manual ? null : r.courseRef,
        courseName: r.courseName,
        location: r.location,
        lat: r.lat,
        lon: r.lon,
        tee: r.tee,
        holeSet: r.holeSet,
        manualCard: r.manual ? r.manualCard : null,
        format: r.format,
        date: r.date,
        time: r.time,
        points: r.points,
      })),
      players: d.players.map((p) => ({ name: p.name, index: indexNumber(p.index), team: p.team })),
      organiserPlays: d.who === "solo" ? true : !!d.organiserPlays,
      teams: d.teams,
      draw: d.draw ?? "myself",
      extras: { feed: d.extras.feed !== false, ai: d.extras.ai !== false, video: d.extras.video !== false },
      theme: d.theme ?? "spring",
      units: d.units ?? "yards",
    };
    const r = await fetch("/api/tournaments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wizard, email: !signedIn && d.keep === "email" ? d.email : "", pin: d.keep === "pin" ? d.pin : "", ownerPin }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r?.ok) return setErr(j.error ?? "Couldn't create it just now. Check the signal and try again.");
    onDone(j.slug);
  }

  return (
    <Screen q="Last thing: keeping it safe" hint="So only you can run it, and you can get back in on any phone.">
      {signedIn ? (
        <p className="notice">
          Signed in as <strong>{me?.email}</strong>. It&apos;ll be in My tournaments.
        </p>
      ) : (
        <>
          <Tiles>
            <Tile on={d.keep === "email"} title="Use my email" note="Recommended. It goes in My tournaments; we email you a link to sign in. No password" onClick={() => setD({ ...d, keep: "email" })} />
            <Tile on={d.keep === "pin"} title="Use a PIN" note="4 to 8 numbers you'll type to run it" onClick={() => setD({ ...d, keep: "pin" })} />
          </Tiles>
          {d.keep === "email" && (
            <div className="field">
              <label htmlFor="wz-email">Your email</label>
              <input id="wz-email" className="wz-input" type="email" inputMode="email" autoComplete="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} />
            </div>
          )}
          {d.keep === "pin" && (
            <div className="field">
              <label htmlFor="wz-pin">Organiser PIN</label>
              <input id="wz-pin" className="wz-input" inputMode="numeric" autoComplete="off" value={d.pin} onChange={(e) => setD({ ...d, pin: e.target.value.replace(/\D/g, "").slice(0, 8) })} placeholder="4 to 8 numbers" />
            </div>
          )}
        </>
      )}
      {needOwner && (
        <div className="field">
          <label htmlFor="wz-owner">Site owner PIN</label>
          <input id="wz-owner" className="wz-input" inputMode="numeric" value={ownerPin} onChange={(e) => setOwnerPin(e.target.value)} placeholder="Needed while new tournaments are invite-only" />
        </div>
      )}
      <Summary d={d} />
      {err && <p className="error">{err}</p>}
      <button type="button" className="btn glow block wz-create" disabled={busy || !okKeep || (!!needOwner && !ownerPin)} onClick={create}>
        {busy ? "Creating…" : "Create my tournament"}
      </button>
    </Screen>
  );
}

function Summary({ d }: { d: Draft }) {
  const rounds = d.rounds.slice(0, d.count ?? 0);
  return (
    <details className="wz-summary">
      <summary>Check everything</summary>
      <ul>
        <li>
          <strong>{d.name}</strong>
          {d.subtitle ? `: ${d.subtitle}` : ""}
        </li>
        {rounds.map((r, i) => (
          <li key={i}>
            Round {i + 1}: {r.courseName}
            {r.tee ? ` (${r.tee})` : ""}
            {r.holeSet !== "all" ? `, ${r.holeSet === "front" ? "front 9" : "back 9"}` : ""}, {r.format ? formatName(r.format).toLowerCase() : "no format"}
            {r.date ? `, ${new Date(r.date).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" })}` : ""}
            {r.time ? ` at ${r.time}` : ""}
          </li>
        ))}
        <li>{d.players.map((p) => p.name).join(", ")}</li>
      </ul>
    </details>
  );
}
