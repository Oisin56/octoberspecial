"use client";

import { useEffect, useMemo, useState } from "react";
import { useT } from "./Providers";
import { pts } from "./ui";
import type { Game, HandicapRule, PlayType, PointsRule, ScoringType, SideGameCfg, Team } from "@/lib/engine";
import { ONE_BALL, roundPointsAvailable } from "@/lib/engine";
import {
  PLAY_LABEL,
  SCORING_LABEL,
  SIDE_GAME_LABEL,
  THEMES,
  TONE_LABEL,
  toRoundCfg,
  type PlayerRow,
  type RoundRow,
  type ThemeId,
  type Tone,
  type TournamentState,
} from "@/lib/types";

export interface AdminData {
  state: TournamentState;
  pinSet: Record<string, boolean>;
  organiserPinSet: boolean;
  contributorPinSet: boolean;
  env: { ai: boolean; courses: boolean };
}

export function useAdmin() {
  const { api, session, refresh } = useT();
  const [data, setData] = useState<AdminData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = async () => {
    const r = await api("/api/admin", { action: "state" });
    if (r.ok) setData(r.j as unknown as AdminData);
    else setErr(String(r.j.error ?? "Couldn't load"));
  };
  useEffect(() => {
    if (session?.role === "organiser") load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.role]);
  const reload = async () => {
    await load();
    refresh();
  };
  return { data, err, reload };
}

function useSave() {
  const { api } = useT();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(body: Record<string, unknown>, ok = "Saved") {
    setBusy(true);
    setMsg(null);
    const r = await api("/api/admin", body);
    setBusy(false);
    setMsg(r.ok ? ok : String(r.j.error ?? "Didn't save"));
    if (r.ok) setTimeout(() => setMsg(null), 2500);
    return r;
  }
  return { msg, busy, run, setMsg };
}

async function uploadFile(api: ReturnType<typeof useT>["api"], file: File): Promise<string> {
  const r = await api("/api/upload-url", { filename: file.name, contentType: file.type });
  if (!r.ok) throw new Error(String(r.j.error ?? "Upload failed"));
  const fd = new FormData();
  fd.append("cacheControl", "3600");
  fd.append("", file);
  const up = await fetch(String(r.j.signedUrl), {
    method: "PUT",
    body: fd,
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, "x-upsert": "false" },
  });
  if (!up.ok) throw new Error("Upload failed");
  return String(r.j.path);
}

function Msg({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <span className={`display ${/saved|added|published|deleted|ready/i.test(msg) ? "" : "error"}`}>{msg}</span>;
}

// ============================================================ 1. basics

export function BasicsEditor({ data, onSaved }: { data: AdminData; onSaved: () => void }) {
  const { api } = useT();
  const t = data.state.tournament;
  const [f, setF] = useState({
    name: t.name,
    subtitle: t.subtitle ?? "",
    start_date: t.start_date ?? "",
    end_date: t.end_date ?? "",
    theme: t.theme,
    custom_colors: t.custom_colors ?? { primary: "#1f3d2b", accent: "#c8102e", background: "#e4e9e5" },
  });
  const [logo, setLogo] = useState<File | null>(null);
  const [hero, setHero] = useState<File | null>(null);
  const s = useSave();

  async function save() {
    try {
      const patch: Record<string, unknown> = { ...f };
      if (logo) patch.logo_path = await uploadFile(api, logo);
      if (hero) patch.hero_path = await uploadFile(api, hero);
      const r = await s.run({ action: "updateTournament", patch });
      if (r.ok) onSaved();
    } catch (e) {
      s.setMsg(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <section className="panel stack">
      <h2>Basics and look</h2>
      <div className="row">
        <div className="field" style={{ flex: "2 1 260px" }}>
          <label>Tournament name</label>
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div className="field" style={{ flex: "2 1 260px" }}>
          <label>Strapline</label>
          <input value={f.subtitle} onChange={(e) => setF({ ...f, subtitle: e.target.value })} placeholder="e.g. Seven rounds. Two men. 360 points." />
        </div>
        <div className="field" style={{ flex: "1 1 150px" }}>
          <label>First day</label>
          <input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} />
        </div>
        <div className="field" style={{ flex: "1 1 150px" }}>
          <label>Last day</label>
          <input type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} />
        </div>
      </div>
      <div className="field">
        <label>Theme</label>
        <div className="theme-picks">
          {THEMES.map((th) => (
            <button
              type="button"
              key={th.id}
              className="theme-pick"
              data-theme={th.id === "custom" ? undefined : th.id}
              aria-pressed={f.theme === th.id}
              onClick={() => setF({ ...f, theme: th.id as ThemeId })}
              style={th.id === "custom" ? ({ "--board": f.custom_colors.primary, "--red": f.custom_colors.accent, "--mist": f.custom_colors.background } as React.CSSProperties) : undefined}
            >
              <span className="swatch">
                <span style={{ background: "var(--board)" }} />
                <span style={{ background: "var(--tile)" }} />
                <span style={{ background: "var(--red)" }} />
                <span style={{ background: "var(--mist)" }} />
              </span>
              <strong>{th.name}</strong>
              <span className="small muted">{th.note}</span>
            </button>
          ))}
        </div>
      </div>
      {f.theme === "custom" && (
        <div className="row">
          {(
            [
              ["primary", "Main colour"],
              ["accent", "Highlight (leader, under par)"],
              ["background", "Page background"],
            ] as const
          ).map(([k, label]) => (
            <div className="field" key={k} style={{ flex: "1 1 160px" }}>
              <label>{label}</label>
              <input type="color" value={f.custom_colors[k] ?? "#000000"} onChange={(e) => setF({ ...f, custom_colors: { ...f.custom_colors, [k]: e.target.value } })} style={{ height: 46, padding: 4 }} />
            </div>
          ))}
        </div>
      )}
      <div className="row">
        <div className="field" style={{ flex: "1 1 220px" }}>
          <label>Logo (square works best)</label>
          <input type="file" accept="image/*" onChange={(e) => setLogo(e.target.files?.[0] ?? null)} />
        </div>
        <div className="field" style={{ flex: "1 1 220px" }}>
          <label>Homepage photo</label>
          <input type="file" accept="image/*" onChange={(e) => setHero(e.target.files?.[0] ?? null)} />
        </div>
      </div>
      <div className="row">
        <button className="btn" disabled={s.busy} onClick={save}>
          Save basics
        </button>
        <Msg msg={s.msg} />
      </div>
    </section>
  );
}

// ============================================================ 2. players + teams

const TEAM_COLOURS = ["#c8102e", "#1d4f91", "#2e7d4f", "#a8741f"];

export function PlayersEditor({ data, onSaved }: { data: AdminData; onSaved: () => void }) {
  const t = data.state.tournament;
  const [teams, setTeams] = useState<Team[]>(t.teams ?? []);
  const s = useSave();

  async function saveTeams(next: Team[]) {
    const r = await s.run({ action: "updateTournament", patch: { teams: next, side_games_by: next.length >= 2 ? t.side_games_by : "player" } });
    if (r.ok) onSaved();
  }

  return (
    <div className="stack">
      <section className="panel stack">
        <h2>Teams</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Only for team events (Ryder Cup style). Leave empty for an individual event.
        </p>
        {teams.map((tm, i) => (
          <div className="row" key={i}>
            <input value={tm.name} onChange={(e) => setTeams(teams.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} style={{ flex: "1 1 200px" }} placeholder="Team name" />
            <input type="color" value={tm.color ?? TEAM_COLOURS[i % 4]} onChange={(e) => setTeams(teams.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} style={{ width: 64, height: 46, padding: 4 }} aria-label="Team colour" />
            <button className="chip" onClick={() => setTeams(teams.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        ))}
        <div className="row">
          <button className="btn secondary" onClick={() => setTeams([...teams, { id: "", name: teams.length === 0 ? "Team 1" : `Team ${teams.length + 1}`, color: TEAM_COLOURS[teams.length % 4] }])}>
            Add a team
          </button>
          <button className="btn" disabled={s.busy} onClick={() => saveTeams(teams)}>
            Save teams
          </button>
          <Msg msg={s.msg} />
        </div>
      </section>

      {data.state.players.map((p) => (
        <PlayerCard key={p.id} player={p} teams={t.teams ?? []} pinSet={data.pinSet[p.id]} onSaved={onSaved} />
      ))}
      <NewPlayer teams={t.teams ?? []} count={data.state.players.length} onSaved={onSaved} />
    </div>
  );
}

const PROFILE_FIELDS = [
  ["nickname", "Nickname"],
  ["home_club", "Home club"],
  ["best_club", "Best club in the bag"],
  ["worst_club", "Worst club in the bag"],
  ["weakness", "Known weakness"],
  ["quote", "Pre-tournament trash talk"],
] as const;

function PlayerCard({ player, teams, pinSet, onSaved }: { player: PlayerRow; teams: Team[]; pinSet: boolean; onSaved: () => void }) {
  const { api, state } = useT();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Record<string, string>>(() => ({
    name: player.name,
    handicap: player.handicap == null ? "" : String(player.handicap),
    team_id: player.team_id ?? "",
    bio: player.bio ?? "",
    ...Object.fromEntries(PROFILE_FIELDS.map(([k]) => [k, String(player[k] ?? "")])),
  }));
  const [pin, setPin] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const s = useSave();
  const isOrganiserPlayer = state?.tournament.organiser_player_id === player.id;

  async function save() {
    try {
      const p: Record<string, unknown> = { ...f, id: player.id };
      if (photo) p.photo_path = await uploadFile(api, photo);
      const r = await s.run({ action: "savePlayer", player: p, pin: pin || undefined });
      if (r.ok) {
        setPin("");
        onSaved();
      }
    } catch (e) {
      s.setMsg(e instanceof Error ? e.message : "Failed");
    }
  }
  async function remove() {
    if (!confirm(`Remove ${player.name}?`)) return;
    const r = await s.run({ action: "deletePlayer", playerId: player.id }, "Deleted");
    if (r.ok) onSaved();
  }
  async function makeMe() {
    const r = await s.run({ action: "updateTournament", patch: { organiser_player_id: player.id } });
    if (r.ok) onSaved();
  }

  return (
    <section className="panel stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3>
          {player.name}
          {player.handicap != null && <span className="muted small"> · hcp {player.handicap}</span>}
          {teams.length > 0 && <span className="muted small"> · {teams.find((x) => x.id === player.team_id)?.name ?? "no team"}</span>}
          {!pinSet && <span className="error small"> · no PIN</span>}
        </h3>
        <button className="chip" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Close" : "Edit"}
        </button>
      </div>
      {open && (
        <>
          <div className="row">
            <div className="field" style={{ flex: "2 1 200px" }}>
              <label>Name</label>
              <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </div>
            <div className="field" style={{ flex: "1 1 100px" }}>
              <label>Handicap</label>
              <input inputMode="decimal" value={f.handicap} onChange={(e) => setF({ ...f, handicap: e.target.value })} />
            </div>
            {teams.length > 0 && (
              <div className="field" style={{ flex: "1 1 140px" }}>
                <label>Team</label>
                <select value={f.team_id} onChange={(e) => setF({ ...f, team_id: e.target.value })}>
                  <option value="">None</option>
                  {teams.map((tm) => (
                    <option key={tm.id} value={tm.id}>
                      {tm.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {PROFILE_FIELDS.map(([k, label]) => (
              <div className="field" key={k} style={{ flex: "1 1 200px" }}>
                <label>{label}</label>
                <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
              </div>
            ))}
          </div>
          <div className="field">
            <label>Bio (the AI writer uses this)</label>
            <textarea value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} />
          </div>
          <div className="row">
            <div className="field" style={{ flex: "1 1 200px" }}>
              <label>Photo</label>
              <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
            </div>
            <div className="field" style={{ flex: "1 1 200px" }}>
              <label>{pinSet ? "Change login PIN" : "Set login PIN"}</label>
              <input value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" placeholder="4–8 digits" />
            </div>
          </div>
          <div className="row">
            <button className="btn" disabled={s.busy} onClick={save}>
              Save {player.name}
            </button>
            {!isOrganiserPlayer && (
              <button className="btn secondary" onClick={makeMe}>
                This is me (organiser)
              </button>
            )}
            <button className="btn secondary" onClick={remove}>
              Remove
            </button>
            <Msg msg={s.msg} />
          </div>
        </>
      )}
    </section>
  );
}

function NewPlayer({ teams, count, onSaved }: { teams: Team[]; count: number; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [handicap, setHandicap] = useState("");
  const [team, setTeam] = useState("");
  const [pin, setPin] = useState("");
  const s = useSave();
  async function add(e: React.FormEvent) {
    e.preventDefault();
    const r = await s.run({ action: "savePlayer", player: { name, handicap, team_id: team, sort: count + 1 }, pin: pin || undefined }, "Player added");
    if (r.ok) {
      setName("");
      setHandicap("");
      setPin("");
      onSaved();
    }
  }
  return (
    <form className="panel stack" onSubmit={add}>
      <h3>Add a player</h3>
      <div className="row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required style={{ flex: "2 1 200px" }} />
        <input value={handicap} onChange={(e) => setHandicap(e.target.value)} placeholder="Handicap" inputMode="decimal" style={{ flex: "1 1 100px" }} />
        {teams.length > 0 && (
          <select value={team} onChange={(e) => setTeam(e.target.value)} style={{ flex: "1 1 140px" }}>
            <option value="">No team</option>
            {teams.map((tm) => (
              <option key={tm.id} value={tm.id}>
                {tm.name}
              </option>
            ))}
          </select>
        )}
        <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN (4–8 digits)" inputMode="numeric" style={{ flex: "1 1 140px" }} />
      </div>
      <div className="row">
        <button className="btn" disabled={s.busy}>
          Add player
        </button>
        <Msg msg={s.msg} />
      </div>
    </form>
  );
}

// ============================================================ 3. rounds

const PLAY_DEFAULTS: Record<PlayType, { pct: number; relative: boolean }> = {
  singles: { pct: 100, relative: false },
  fourball: { pct: 90, relative: true },
  foursomes: { pct: 50, relative: true },
  greensomes: { pct: 100, relative: true },
  scramble: { pct: 100, relative: false },
};

export function RoundsEditor({ data, onSaved }: { data: AdminData; onSaved: () => void }) {
  const [adding, setAdding] = useState(data.state.rounds.length === 0);
  return (
    <div className="stack">
      {data.state.rounds.map((r) => (
        <RoundCard key={r.id} round={r} data={data} onSaved={onSaved} />
      ))}
      {adding ? (
        <AddRound data={data} onDone={() => { setAdding(false); onSaved(); }} onCancel={data.state.rounds.length ? () => setAdding(false) : undefined} />
      ) : (
        <button className="btn" onClick={() => setAdding(true)}>
          Add a round
        </button>
      )}
    </div>
  );
}

interface Hit {
  ref: string;
  name: string;
  location: string;
}
interface CourseOpt {
  ref: string;
  name: string;
  location: string;
  tees: { name: string; par: number[]; si: number[]; yards: number[] }[];
}

function AddRound({ data, onDone, onCancel }: { data: AdminData; onDone: () => void; onCancel?: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [course, setCourse] = useState<CourseOpt | null>(null);
  const [tee, setTee] = useState("");
  const [manual, setManual] = useState(false);
  const [mName, setMName] = useState("");
  const [card, setCard] = useState(() => Array.from({ length: 18 }, (_, i) => ({ par: 4, si: i + 1, yards: 0 })));
  const s = useSave();

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (q.trim().length < 2) return;
    setSearching(true);
    setNote(null);
    const r = await fetch(`/api/courses?q=${encodeURIComponent(q)}`);
    const j = await r.json();
    setSearching(false);
    setHits(j.hits ?? []);
    if (!j.remote) setNote(data.env.courses ? j.error ?? "Online course search unavailable just now." : "Online course search isn't connected (GOLFCOURSEAPI_KEY). Showing built-in courses only.");
    if (!(j.hits ?? []).length) setNote((n) => `${n ? n + " " : ""}No matches. Try another name, or enter the card by hand.`);
  }
  async function pick(h: Hit) {
    const r = await fetch(`/api/courses?ref=${encodeURIComponent(h.ref)}`);
    const j = await r.json();
    if (!r.ok) return setNote(j.error ?? "Couldn't load that course");
    setCourse(j.course);
    setTee(j.course.tees[0]?.name ?? "");
    if (!j.course.tees.length) setNote("That course has no 18-hole tees listed. Enter the card by hand.");
  }
  async function create() {
    const r = course
      ? await s.run({ action: "saveRound", round: { courseRef: course.ref, tee } }, "Round added")
      : await s.run({ action: "saveRound", round: { manualCourse: { name: mName }, holes: card } }, "Round added");
    if (r.ok) onDone();
  }

  return (
    <section className="panel stack">
      <h2>Add a round</h2>
      {!manual && !course && (
        <>
          <form className="row" onSubmit={search}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for a course" style={{ flex: "1 1 240px" }} />
            <button className="btn" disabled={searching}>
              {searching ? "Searching…" : "Search"}
            </button>
          </form>
          {note && <p className="small muted">{note}</p>}
          <div className="stack">
            {hits.map((h) => (
              <button key={h.ref} className="post" style={{ textAlign: "left", cursor: "pointer", font: "inherit" }} onClick={() => pick(h)}>
                <strong className="display">{h.name}</strong> <span className="muted small">{h.location}</span>
              </button>
            ))}
          </div>
          <button className="chip" onClick={() => setManual(true)}>
            Enter the scorecard by hand instead
          </button>
        </>
      )}
      {course && (
        <>
          <p className="display" style={{ fontSize: 20, margin: 0 }}>
            {course.name} <span className="muted small">{course.location}</span>
          </p>
          <div className="field">
            <label>Tees</label>
            <select value={tee} onChange={(e) => setTee(e.target.value)}>
              {course.tees.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name} · par {t.par.reduce((a, b) => a + b, 0)} · {t.yards.reduce((a, b) => a + b, 0).toLocaleString()} yds
                </option>
              ))}
            </select>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            You&apos;ll set the format, matches, points and handicaps on the next screen.
          </p>
        </>
      )}
      {manual && (
        <>
          <div className="field">
            <label>Course name</label>
            <input value={mName} onChange={(e) => setMName(e.target.value)} />
          </div>
          <CardTable card={card} setCard={setCard} />
        </>
      )}
      <div className="row">
        {(course || manual) && (
          <button className="btn" disabled={s.busy || (manual && !mName.trim())} onClick={create}>
            Add this round
          </button>
        )}
        {(course || manual) && (
          <button className="btn secondary" onClick={() => { setCourse(null); setManual(false); }}>
            Back
          </button>
        )}
        {onCancel && (
          <button className="btn secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
        <Msg msg={s.msg} />
      </div>
    </section>
  );
}

function CardTable({ card, setCard }: { card: { par: number; si: number; yards?: number }[]; setCard: (c: { par: number; si: number; yards: number }[]) => void }) {
  const siOk = [...card.map((h) => h.si)].sort((a, b) => a - b).every((v, i) => v === i + 1);
  return (
    <div className="stack">
      <div className="card-scroll">
        <table className="card">
          <thead>
            <tr>
              <th>Hole</th>
              {card.map((_, i) => (
                <th key={i}>{i + 1}</th>
              ))}
              <th>Tot</th>
            </tr>
          </thead>
          <tbody>
            {(["par", "si"] as const).map((k) => (
              <tr key={k}>
                <td className="label">{k === "par" ? "Par" : "SI"}</td>
                {card.map((h, i) => (
                  <td key={i}>
                    <input
                      aria-label={`${k} hole ${i + 1}`}
                      style={{ width: 40, padding: 4, textAlign: "center" }}
                      inputMode="numeric"
                      value={h[k] || ""}
                      onChange={(e) => setCard(card.map((x, j) => (j === i ? { par: x.par, si: x.si, yards: x.yards ?? 0, [k]: Number(e.target.value) || 0 } : { par: x.par, si: x.si, yards: x.yards ?? 0 })))}
                    />
                  </td>
                ))}
                <td className="sum">{k === "par" ? card.reduce((a, h) => a + h.par, 0) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!siOk && <p className="error small">Stroke indexes must use each number from 1 to 18 once.</p>}
    </div>
  );
}

function RoundCard({ round, data, onSaved }: { round: RoundRow; data: AdminData; onSaved: () => void }) {
  const { href } = useT();
  const players = data.state.players;
  const teams = data.state.tournament.teams ?? [];
  const cfg = toRoundCfg(round, players);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    play_date: round.play_date ?? "",
    tee_time: round.tee_time ?? "",
    status: round.status,
    play: cfg.play,
    format: cfg.scoring,
  });
  const [points, setPoints] = useState<PointsRule>(cfg.points);
  const [hcp, setHcp] = useState<HandicapRule>(cfg.handicap);
  const [games, setGames] = useState<Game[]>(cfg.games);
  const [tee, setTee] = useState(round.tee ?? "");
  const [tees, setTees] = useState<string[]>(round.tee ? [round.tee] : []);
  const [showCard, setShowCard] = useState(false);
  const [card, setCard] = useState(round.holes.map((h) => ({ par: h.par, si: h.si, yards: h.yards ?? 0 })));
  const s = useSave();
  const scored = data.state.entries.some((e) => e.round_id === round.id);

  useEffect(() => {
    if (!open || round.course_slug.startsWith("manual:")) return;
    const ref = round.course_slug.includes(":") ? round.course_slug : `local:${round.course_slug}`;
    fetch(`/api/courses?ref=${encodeURIComponent(ref)}`)
      .then((r) => r.json())
      .then((j) => j.course && setTees(j.course.tees.map((t: { name: string }) => t.name)))
      .catch(() => {});
  }, [open, round.course_slug]);

  const field = games.some((g) => g.sides.length > 2);
  const previewCfg = { ...cfg, play: f.play, scoring: f.format, points, games };

  async function save() {
    const r: Record<string, unknown> = { id: round.id, ...f, points_rule: points, handicap_rule: hcp, games };
    if (tee && tee !== round.tee) r.tee = tee;
    if (showCard) r.holes = card;
    const res = await s.run({ action: "saveRound", round: r });
    if (res.ok) onSaved();
  }
  async function del() {
    let res = await s.run({ action: "deleteRound", roundId: round.id }, "Deleted");
    if (res.status === 409 && confirm("This round has scores. Delete it anyway?")) res = await s.run({ action: "deleteRound", roundId: round.id, force: true }, "Deleted");
    if (res.ok) onSaved();
  }

  function setPlay(play: PlayType) {
    setF({ ...f, play });
    const d = PLAY_DEFAULTS[play];
    if (hcp.mode === "allowance") setHcp({ mode: "allowance", pct: d.pct, relative: d.relative });
  }

  return (
    <section className="panel stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3>
          R{round.number} {round.course_name}{" "}
          <span className="muted small display">
            {f.play === "singles" ? SCORING_LABEL[f.format] : `${PLAY_LABEL[f.play].split(" (")[0]} ${SCORING_LABEL[f.format].toLowerCase()}`} · {pts(roundPointsAvailable(previewCfg))} pts · {games.length} {games.length === 1 ? "match" : "matches"} · {round.status}
          </span>
        </h3>
        <div className="row">
          <a className="chip" href={href(`/score?round=${round.number}`)}>
            Score
          </a>
          <button className="chip" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Close" : "Edit"}
          </button>
        </div>
      </div>
      {open && (
        <>
          <div className="row">
            <div className="field" style={{ flex: "1 1 140px" }}>
              <label>Date</label>
              <input type="date" value={f.play_date} onChange={(e) => setF({ ...f, play_date: e.target.value })} />
            </div>
            <div className="field" style={{ flex: "1 1 100px" }}>
              <label>Tee time</label>
              <input value={f.tee_time} onChange={(e) => setF({ ...f, tee_time: e.target.value })} placeholder="10:30" />
            </div>
            <div className="field" style={{ flex: "1 1 140px" }}>
              <label>Tees</label>
              {tees.length > 1 ? (
                <select value={tee} onChange={(e) => setTee(e.target.value)}>
                  {tees.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              ) : (
                <input value={tee} onChange={(e) => setTee(e.target.value)} />
              )}
            </div>
            <div className="field" style={{ flex: "1 1 120px" }}>
              <label>Status</label>
              <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as RoundRow["status"] })}>
                <option value="upcoming">Upcoming</option>
                <option value="live">Live</option>
                <option value="complete">Complete</option>
              </select>
            </div>
          </div>

          <h4 className="display" style={{ margin: "8px 0 0", fontSize: 18 }}>
            Format
          </h4>
          {scored && <p className="notice small" style={{ margin: 0 }}>Scores already entered. Changing the format or matches recalculates everything from them.</p>}
          <div className="row">
            <div className="field" style={{ flex: "1 1 200px" }}>
              <label>How it&apos;s played</label>
              <select value={f.play} onChange={(e) => setPlay(e.target.value as PlayType)}>
                {(Object.keys(PLAY_LABEL) as PlayType[]).map((p) => (
                  <option key={p} value={p}>
                    {PLAY_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: "1 1 160px" }}>
              <label>Scoring</label>
              <select value={f.format} onChange={(e) => setF({ ...f, format: e.target.value as ScoringType })}>
                {(Object.keys(SCORING_LABEL) as ScoringType[]).map((x) => (
                  <option key={x} value={x}>
                    {SCORING_LABEL[x]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <h4 className="display" style={{ margin: "8px 0 0", fontSize: 18 }}>
            Points
          </h4>
          {f.format === "skins" ? (
            <div className="field" style={{ maxWidth: 200 }}>
              <label>Points per skin</label>
              <input inputMode="decimal" value={points.skin ?? 1} onChange={(e) => setPoints({ ...points, skin: Number(e.target.value) || 0 })} />
            </div>
          ) : (
            <div className="row">
              {(["front", "back", "full"] as const).map((k) => (
                <div className="field" key={k} style={{ flex: "1 1 110px" }}>
                  <label>{k === "front" ? "Front 9" : k === "back" ? "Back 9" : field ? "18 (if no positions)" : "Full 18"}</label>
                  <input inputMode="decimal" value={points[k]} onChange={(e) => setPoints({ ...points, [k]: Number(e.target.value) || 0 })} />
                </div>
              ))}
              {field && (
                <div className="field" style={{ flex: "2 1 220px" }}>
                  <label>Points by position (1st, 2nd…)</label>
                  <input
                    value={(points.positions ?? []).join(", ")}
                    onChange={(e) => setPoints({ ...points, positions: e.target.value.split(/[,\s]+/).filter(Boolean).map(Number) })}
                    placeholder="e.g. 10, 6, 4, 2"
                  />
                </div>
              )}
              <p className="small muted" style={{ flexBasis: "100%", margin: 0 }}>
                Ryder Cup style: front 0, back 0, 18 = 1. A tie splits the points.
              </p>
            </div>
          )}

          <h4 className="display" style={{ margin: "8px 0 0", fontSize: 18 }}>
            Handicaps
          </h4>
          <HandicapEditor play={f.play} hcp={hcp} setHcp={setHcp} games={games} players={players} />

          <h4 className="display" style={{ margin: "8px 0 0", fontSize: 18 }}>
            Matches and groups
          </h4>
          <GamesBuilder play={f.play} games={games} setGames={setGames} players={players} teams={teams} />

          <button type="button" className="chip" aria-pressed={showCard} onClick={() => setShowCard(!showCard)}>
            {showCard ? "Hide card" : "Check par and stroke index"}
          </button>
          {showCard && <CardTable card={card} setCard={setCard} />}

          <div className="row">
            <button className="btn" disabled={s.busy} onClick={save}>
              Save round {round.number}
            </button>
            <button className="btn secondary" onClick={del}>
              Delete round
            </button>
            <Msg msg={s.msg} />
          </div>
        </>
      )}
    </section>
  );
}

function HandicapEditor({
  play,
  hcp,
  setHcp,
  games,
  players,
}: {
  play: PlayType;
  hcp: HandicapRule;
  setHcp: (h: HandicapRule) => void;
  games: Game[];
  players: PlayerRow[];
}) {
  const oneBall = ONE_BALL.includes(play);
  const balls = useMemo(() => {
    const out: { id: string; name: string }[] = [];
    for (const g of games)
      for (const s of g.sides) {
        if (oneBall) out.push({ id: s.id, name: s.name || s.playerIds.map((p) => players.find((x) => x.id === p)?.name).join(" & ") });
        else for (const p of s.playerIds) if (!out.some((o) => o.id === p)) out.push({ id: p, name: players.find((x) => x.id === p)?.name ?? p });
      }
    return out;
  }, [games, players, oneBall]);
  const d = PLAY_DEFAULTS[play];

  return (
    <div className="stack">
      <div className="row" role="group" aria-label="Handicap mode">
        <button type="button" className="chip" aria-pressed={hcp.mode === "manual" && Object.values(hcp.shots).every((v) => !v)} onClick={() => setHcp({ mode: "manual", shots: {} })}>
          Flat (no shots)
        </button>
        <button type="button" className="chip" aria-pressed={hcp.mode === "allowance"} onClick={() => setHcp({ mode: "allowance", pct: d.pct, relative: d.relative })}>
          From handicaps
        </button>
        <button type="button" className="chip" aria-pressed={hcp.mode === "manual" && Object.values(hcp.shots).some((v) => v)} onClick={() => setHcp({ mode: "manual", shots: hcp.mode === "manual" ? hcp.shots : {} })}>
          Set shots by hand
        </button>
      </div>
      {hcp.mode === "allowance" && (
        <div className="row">
          {play !== "greensomes" && play !== "scramble" && (
            <div className="field" style={{ flex: "1 1 140px" }}>
              <label>{play === "foursomes" ? "% of combined handicaps" : "% of handicap"}</label>
              <input inputMode="numeric" value={hcp.pct} onChange={(e) => setHcp({ ...hcp, pct: Number(e.target.value) || 0 })} />
            </div>
          )}
          <label className="row display" style={{ flex: "1 1 220px" }}>
            <input type="checkbox" checked={hcp.relative} onChange={(e) => setHcp({ ...hcp, relative: e.target.checked })} style={{ width: 22, height: 22 }} />
            Give shots off the lowest (match play)
          </label>
          <p className="small muted" style={{ flexBasis: "100%", margin: 0 }}>
            Standard: singles stableford 95–100%, fourball 90% off the low, foursomes 50% of combined, greensomes 60/40, scramble 35/15. Uses each player&apos;s handicap from the Players step.
          </p>
        </div>
      )}
      {hcp.mode === "manual" && (
        <div className="row">
          {balls.map((b) => (
            <div className="field" key={b.id} style={{ flex: "1 1 140px" }}>
              <label>{b.name} gets</label>
              <input
                inputMode="numeric"
                value={hcp.shots[b.id] ?? 0}
                onChange={(e) => setHcp({ mode: "manual", shots: { ...hcp.shots, [b.id]: Math.max(0, Number(e.target.value) || 0) } })}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GamesBuilder({
  play,
  games,
  setGames,
  players,
  teams,
}: {
  play: PlayType;
  games: Game[];
  setGames: (g: Game[]) => void;
  players: PlayerRow[];
  teams: Team[];
}) {
  const pairs = play !== "singles";
  const perSide = play === "scramble" ? 4 : pairs ? 2 : 1;
  const nm = (id: string) => players.find((p) => p.id === id)?.name ?? id;

  function auto(kind: "everyone" | "teams") {
    if (kind === "everyone" || teams.length < 2) {
      if (!pairs) {
        setGames([{ id: "main", sides: players.map((p) => ({ id: p.id, playerIds: [p.id], teamId: p.team_id })), scorerId: games[0]?.scorerId ?? null }]);
      } else {
        const sides = [];
        for (let i = 0; i < players.length; i += 2) sides.push({ id: `s${i / 2 + 1}`, playerIds: players.slice(i, i + 2).map((p) => p.id) });
        setGames([{ id: "main", sides, scorerId: null }]);
      }
      return;
    }
    // Team v team, lined up in order
    const [a, b] = teams;
    const A = players.filter((p) => p.team_id === a.id);
    const B = players.filter((p) => p.team_id === b.id);
    const n = Math.floor(Math.min(A.length, B.length) / (pairs ? 2 : 1));
    const out: Game[] = [];
    for (let i = 0; i < n; i++) {
      const pa = pairs ? A.slice(i * 2, i * 2 + 2) : [A[i]];
      const pb = pairs ? B.slice(i * 2, i * 2 + 2) : [B[i]];
      out.push({
        id: `m${i + 1}`,
        name: `Match ${i + 1}`,
        sides: [
          { id: pairs ? `m${i + 1}-a` : pa[0].id, playerIds: pa.map((p) => p.id), teamId: a.id },
          { id: pairs ? `m${i + 1}-b` : pb[0].id, playerIds: pb.map((p) => p.id), teamId: b.id },
        ],
        scorerId: pa[0].id,
      });
    }
    setGames(out);
  }

  function update(gi: number, g: Game) {
    setGames(games.map((x, i) => (i === gi ? g : x)));
  }

  return (
    <div className="stack">
      <div className="row">
        <button type="button" className="chip" onClick={() => auto("everyone")}>
          {pairs ? "Everyone in pairs, one group" : "Everyone in one group"}
        </button>
        {teams.length >= 2 && (
          <button type="button" className="chip" onClick={() => auto("teams")}>
            {teams[0].name} v {teams[1].name}, {pairs ? "pairs" : "singles"} matches in order
          </button>
        )}
        <button
          type="button"
          className="chip"
          onClick={() => setGames([...games, { id: `m${games.length + 1}`, name: `Match ${games.length + 1}`, sides: [{ id: "", playerIds: [] }, { id: "", playerIds: [] }], scorerId: null }])}
        >
          Add a match
        </button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Two sides = head to head. Three or more = a group leaderboard. {pairs ? `Each side has ${perSide === 4 ? "up to four" : "two"} players.` : "Each side is one player."}
      </p>
      {games.map((g, gi) => (
        <div key={gi} className="post stack">
          <div className="row">
            <input value={g.name ?? ""} placeholder={`Match ${gi + 1}`} onChange={(e) => update(gi, { ...g, name: e.target.value })} style={{ flex: "1 1 160px" }} aria-label="Match name" />
            <select value={g.scorerId ?? ""} onChange={(e) => update(gi, { ...g, scorerId: e.target.value || null })} style={{ flex: "1 1 160px" }} aria-label="Scorer">
              <option value="">Scorer: organiser only</option>
              {g.sides.flatMap((s) => s.playerIds).map((p) => (
                <option key={p} value={p}>
                  Scorer: {nm(p)}
                </option>
              ))}
            </select>
            <button type="button" className="chip" onClick={() => setGames(games.filter((_, i) => i !== gi))}>
              Remove match
            </button>
          </div>
          {g.sides.map((sd, si) => (
            <div key={si} className="row" style={{ alignItems: "flex-start" }}>
              <span className="display" style={{ minWidth: 60, paddingTop: 6 }}>
                Side {si + 1}
              </span>
              <div className="row" style={{ flex: 1, gap: 4 }}>
                {players.map((p) => {
                  const on = sd.playerIds.includes(p.id);
                  return (
                    <button
                      type="button"
                      key={p.id}
                      className="chip"
                      aria-pressed={on}
                      onClick={() => {
                        const ids = on ? sd.playerIds.filter((x) => x !== p.id) : [...sd.playerIds, p.id].slice(-perSide);
                        const sides = g.sides.map((x, j) => (j === si ? { ...x, id: pairs ? x.id || `${g.id}-s${si + 1}` : ids[0] ?? "", playerIds: ids, teamId: players.find((pp) => pp.id === ids[0])?.team_id ?? null } : x));
                        update(gi, { ...g, sides });
                      }}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
              {g.sides.length > 2 && (
                <button type="button" className="chip" onClick={() => update(gi, { ...g, sides: g.sides.filter((_, j) => j !== si) })}>
                  ✕
                </button>
              )}
            </div>
          ))}
          <button type="button" className="chip" onClick={() => update(gi, { ...g, sides: [...g.sides, { id: "", playerIds: [] }] })}>
            Add a side
          </button>
        </div>
      ))}
    </div>
  );
}

// ============================================================ 4. side games

export function SideGamesEditor({ data, onSaved }: { data: AdminData; onSaved: () => void }) {
  const t = data.state.tournament;
  const kinds = Object.keys(SIDE_GAME_LABEL) as SideGameCfg["kind"][];
  const [games, setGames] = useState<SideGameCfg[]>(() => kinds.map((k) => t.side_games.find((g) => g.kind === k) ?? { kind: k, points: 0, enabled: false }));
  const [by, setBy] = useState(t.side_games_by);
  const s = useSave();
  async function save() {
    const r = await s.run({ action: "updateTournament", patch: { side_games: games, side_games_by: by } });
    if (r.ok) onSaved();
  }
  return (
    <section className="panel stack">
      <h2>Side games</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Counted across the whole event. Points go to whoever wins the most; a tie splits them. 0 points = tally only.
      </p>
      {games.map((g, i) => (
        <div className="row" key={g.kind}>
          <label className="row display" style={{ flex: "2 1 240px", fontSize: 18 }}>
            <input type="checkbox" checked={g.enabled} onChange={(e) => setGames(games.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} style={{ width: 22, height: 22 }} />
            {SIDE_GAME_LABEL[g.kind]}
            <span className="small muted">
              {g.kind === "ctp" ? "par 3s, on the green" : g.kind === "ld" ? "par 5s, on the fairway" : g.kind === "gir" ? "every hole" : "gross"}
            </span>
          </label>
          <div className="field" style={{ flex: "1 1 120px" }}>
            <label>Points</label>
            <input inputMode="decimal" value={g.points} disabled={!g.enabled} onChange={(e) => setGames(games.map((x, j) => (j === i ? { ...x, points: Number(e.target.value) || 0 } : x)))} />
          </div>
        </div>
      ))}
      {(t.teams ?? []).length >= 2 && (
        <div className="row" role="group" aria-label="Award side games to">
          <span className="display">Award to:</span>
          <button className="chip" aria-pressed={by === "player"} onClick={() => setBy("player")}>
            Individual players
          </button>
          <button className="chip" aria-pressed={by === "team"} onClick={() => setBy("team")}>
            Teams
          </button>
        </div>
      )}
      <div className="row">
        <button className="btn" disabled={s.busy} onClick={save}>
          Save side games
        </button>
        <Msg msg={s.msg} />
      </div>
    </section>
  );
}

// ============================================================ 5. content

export function ContentEditor({ data, onSaved }: { data: AdminData; onSaved: () => void }) {
  const t = data.state.tournament;
  const [tone, setTone] = useState<Tone>(t.tone);
  const [auto, setAuto] = useState(t.auto_bulletins);
  const [video, setVideo] = useState(t.video_enabled);
  const s = useSave();
  async function save() {
    const r = await s.run({ action: "updateTournament", patch: { tone, auto_bulletins: auto, video_enabled: video } });
    if (r.ok) onSaved();
  }
  return (
    <section className="panel stack">
      <h2>Writing and media</h2>
      {!data.env.ai && <p className="notice small">The AI writer is switched off until ANTHROPIC_API_KEY is set in Vercel.</p>}
      <div className="field">
        <label>Writing style for previews, bulletins and reports</label>
        <div className="stack">
          {(Object.keys(TONE_LABEL) as Tone[]).map((k) => (
            <label key={k} className="row" style={{ gap: 10 }}>
              <input type="radio" name="tone" checked={tone === k} onChange={() => setTone(k)} style={{ width: 20, height: 20 }} />
              {TONE_LABEL[k]}
            </label>
          ))}
        </div>
      </div>
      <label className="row display" style={{ fontSize: 18 }}>
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} style={{ width: 22, height: 22 }} />
        Write live bulletins automatically at key moments
      </label>
      <label className="row display" style={{ fontSize: 18 }}>
        <input type="checkbox" checked={video} onChange={(e) => setVideo(e.target.checked)} style={{ width: 22, height: 22 }} />
        Allow video clips from the course
      </label>
      <div className="row">
        <button className="btn" disabled={s.busy} onClick={save}>
          Save
        </button>
        <Msg msg={s.msg} />
      </div>
    </section>
  );
}

// ============================================================ 6. invite + publish

export function InviteEditor({ data, onSaved }: { data: AdminData; onSaved: () => void }) {
  const { href } = useT();
  const t = data.state.tournament;
  const [orgPin, setOrgPin] = useState("");
  const [cPin, setCPin] = useState("");
  const s = useSave();
  const link = typeof window !== "undefined" ? `${window.location.origin}${href("/")}` : href("/");
  const missingPins = data.state.players.filter((p) => !data.pinSet[p.id]);

  async function savePins() {
    const r = await s.run({ action: "updateTournament", patch: {}, organiserPin: orgPin || undefined, contributorPin: cPin || undefined });
    if (r.ok) {
      setOrgPin("");
      setCPin("");
      onSaved();
    }
  }
  async function publish(p: boolean) {
    const r = await s.run({ action: "updateTournament", patch: { published: p } }, p ? "Published" : "Saved");
    if (r.ok) onSaved();
  }

  return (
    <section className="panel stack">
      <h2>Invite and go live</h2>
      <div className="field">
        <label>Share link (followers need nothing else)</label>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input readOnly value={link} onFocus={(e) => e.target.select()} />
          <button
            className="btn secondary"
            onClick={() => {
              navigator.clipboard?.writeText(link);
              s.setMsg("Link copied");
            }}
          >
            Copy
          </button>
        </div>
      </div>
      <p className="small" style={{ margin: 0 }}>
        Players log in with their own PIN (set on the Players step).
        {missingPins.length > 0 && <span className="error"> Still no PIN: {missingPins.map((p) => p.name).join(", ")}.</span>}
      </p>
      <div className="row">
        <div className="field" style={{ flex: "1 1 200px" }}>
          <label>{data.organiserPinSet ? "Change organiser PIN" : "Organiser PIN"}</label>
          <input value={orgPin} onChange={(e) => setOrgPin(e.target.value)} inputMode="numeric" placeholder="4–8 digits" />
        </div>
        <div className="field" style={{ flex: "1 1 200px" }}>
          <label>{data.contributorPinSet ? "Change caddie and friends PIN" : "Caddie and friends PIN"}</label>
          <input value={cPin} onChange={(e) => setCPin(e.target.value)} inputMode="numeric" placeholder="4–8 digits" />
        </div>
      </div>
      <div className="row">
        <button className="btn secondary" disabled={s.busy || (!orgPin && !cPin)} onClick={savePins}>
          Save PINs
        </button>
        {t.published ? (
          <button className="btn secondary" onClick={() => publish(false)}>
            Unpublish
          </button>
        ) : (
          <button className="btn" onClick={() => publish(true)}>
            Publish
          </button>
        )}
        <Msg msg={s.msg} />
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {t.published ? "Published: anyone with the link can follow." : "Not published yet: it won't appear in the tournament list, but the link still works for testing."}
      </p>
    </section>
  );
}
