"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useT } from "@/components/Providers";
import { Loading } from "@/components/ui";
import { useAdmin } from "@/components/editors";
import { THEMES, TONE_LABEL } from "@/lib/types";
import { formatName, inSentence, isMatch, roundFormats, usesPoints, winName, type DayFormat } from "@/lib/wizard";
import { fromState } from "@/components/setup/fromState";
import { GuideScreen, guideStatus } from "@/components/setup/GuideScreen";
import { badIndex, draftProblems, emptyRound, holesOf, named, settle, toWizard, type Draft } from "@/components/setup/model";
import {
  AboutScreen,
  CourseScreen,
  ExtrasScreen,
  FormatScreen,
  GroupsScreen,
  HolesScreen,
  LookScreen,
  NameScreen,
  PlayersScreen,
  PointsScreen,
  PrizesScreen,
  Problems,
  TeamsScreen,
  TeeScreen,
  WhenScreen,
  WinMoreScreen,
  WinScreen,
  type StepProps,
} from "@/components/setup/Screens";

/**
 * Tournament setup: every answer from the set-up wizard, one line each. Tap a line and the same screen opens;
 * changes save as you tap, with a small Saved tick, and Back returns to the list. Rounds already under way keep
 * what their scores depend on, and changes that work their results out again are asked about first.
 */

type View = { kind: "list" } | { kind: "round"; i: number } | { kind: "guide"; i: number };
interface Edit {
  /** What's being changed: name, players, win… or round:<i>:<part>, addround */
  what: string;
  d: Draft;
  at: number;
  back: View;
  /** Asked first (a round has scores) and answered */
  agreed: boolean;
}
type SaveState = { state: "idle" | "saving" | "saved" | "error"; msg?: string; note?: string };

const PRIZE_NAMES = { ctp: "closest the pin", ld: "long drive", nines: "front 9 and back 9", birdies: "most birdies", gir: "most greens", skins: "skins", bestround: "best round" } as const;
const HOLES = { all: "All 18", front: "Front 9", back: "Back 9" } as const;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The screens one change goes through, for the answers so far. */
function flowFor(what: string, d: Draft, base: Draft): string[] {
  const [kind, n, part] = what.split(":");
  const i = Number(n ?? 0);
  switch (kind) {
    case "players":
      return d.who === "teams" ? ["players", "teams"] : ["players"];
    case "win":
      return ["win", ...(d.win === "knockout" || d.win === "skins" || d.win === "teamscore" ? ["winmore"] : [])];
    case "round": {
      if (part !== "course") return [`${part}:${i}`];
      const r = d.rounds[i];
      const moved = r && (r.courseRef !== base.rounds[i]?.courseRef || r.courseName !== base.rounds[i]?.courseName);
      return [`course:${i}`, ...(moved && !r.manual && (r.tees?.length ?? 0) > 1 ? [`tee:${i}`] : [])];
    }
    case "addround": {
      const k = base.rounds.length;
      const r = d.rounds[k];
      const opts = roundFormats(d.who ?? "individuals", d.who === "solo" ? null : d.win, d.ko.pairs);
      return [`course:${k}`, ...(r && !r.manual && (r.tees?.length ?? 0) > 1 ? [`tee:${k}`] : []), ...(r && holesOf(r) === 18 ? [`holes:${k}`] : []), ...(opts.length > 1 && d.who !== "solo" ? [`format:${k}`] : []), `when:${k}`];
    }
    default:
      return [kind];
  }
}

/** The server's name for the change. */
const scopeOf = (what: string) => (what.startsWith("round:") ? what.split(":").slice(0, 2).join(":") : what);

/** A knockout that needs another round (more players): the new one at the same course as the last. */
function fill(d: Draft): Draft {
  const rounds = d.rounds.map((r, i) => {
    if (r.courseName || i === 0) return r;
    const prev = d.rounds[i - 1];
    return { ...r, courseRef: prev.courseRef, courseName: prev.courseName, location: prev.location, lat: prev.lat, lon: prev.lon, tees: prev.tees, tee: prev.tee, holeSet: prev.holeSet, manual: prev.manual, manualCard: prev.manualCard };
  });
  return { ...d, rounds };
}

/** Answers complete enough to save (anything else waits, with the reason shown on the screen). */
function ready(d: Draft): boolean {
  if (!d.name.trim()) return false;
  if (d.players.some(badIndex)) return false;
  if (named(d).length < (d.who === "solo" ? 1 : 2)) return false;
  return draftProblems(d).length === 0;
}

export default function TournamentSetup() {
  const { session, href, api } = useT();
  const { data, err, reload } = useAdmin();
  const base = useMemo(() => (data ? fromState(data.state) : null), [data]);
  const [view, setView] = useState<View>({ kind: "list" });
  const [edit, setEdit] = useState<Edit | null>(null);
  const [save, setSave] = useState<SaveState>({ state: "idle" });
  /** The lines changed on the last visit to a screen (each gets a Saved tick) */
  const [ticked, setTicked] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  // Saving as you tap: the newest answers wait a moment (typing), then go; one save at a time
  const pending = useRef<{ d: Draft; what: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef<Promise<boolean> | null>(null);
  const lastSent = useRef<string>("");
  const failed = useRef(false);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  if (!session)
    return (
      <p>
        <Link href={href(`/login?next=${encodeURIComponent(href("/setup"))}`)}>Log in</Link> as organiser.
      </p>
    );
  if (session.role !== "organiser") return <p>Organiser only.</p>;
  if (err) return <p className="error">{err}</p>;
  if (!data || !base) return <Loading />;

  const st = data.state;
  const rounds = [...st.rounds].sort((a, b) => a.number - b.number);
  const startedIds = new Set(st.entries.map((e) => e.round_id));
  const started = (i: number) => !!rounds[i] && startedIds.has(rounds[i].id);
  const scoredRounds = rounds.map((_, i) => i).filter(started);
  const solo = base.who === "solo";
  const ko = base.win === "knockout";
  const legacy = !st.tournament.win;
  const top = () => topRef.current?.scrollIntoView({ block: "start" });

  /** Send one change; true when it's saved. */
  async function send(d: Draft, what: string): Promise<boolean> {
    const body = JSON.stringify(toWizard(fill(d)));
    if (body === lastSent.current) return true;
    setSave({ state: "saving" });
    const r = await api("/api/setup-edit", { scope: scopeOf(what), wizard: JSON.parse(body) }).catch(() => null);
    if (!r?.ok) {
      failed.current = true;
      setSave({ state: "error", msg: String(r?.j.error ?? "Couldn't save that. Check the signal and try again.") });
      return false;
    }
    failed.current = false;
    lastSent.current = body;
    await reload();
    setSave({ state: "saved", note: r.j.note ? String(r.j.note) : undefined });
    setTicked((t) => (t.includes(what) ? t : [...t, what]));
    return true;
  }
  /** Save the newest answers now (after anything already on its way). */
  async function flush(): Promise<boolean> {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (running.current) await running.current;
    const p = pending.current;
    pending.current = null;
    if (!p) return !failed.current;
    running.current = send(p.d, p.what);
    const ok = await running.current;
    running.current = null;
    return ok;
  }
  /** Queue a save: straight away for a tap, after a pause for typing. */
  function queue(d: Draft, what: string, wait: number) {
    // Adding a round is one action, at the end; anything else saves whenever the answers are complete
    if (what === "addround" || !ready(d)) return;
    pending.current = { d, what };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), wait);
  }

  const open = (what: string, back: View = view) => {
    const k = base.rounds.length;
    const d0 = what === "addround" ? settle({ ...base, count: k + 1, rounds: [...base.rounds, emptyRound()] }) : base;
    lastSent.current = JSON.stringify(toWizard(fill(base)));
    failed.current = false;
    setEdit({ what, d: d0, at: 0, back, agreed: false });
    setSave({ state: "idle" });
    setTicked([]);
    setNote(null);
    top();
  };
  const leave = async (back: View) => {
    // A change that didn't save keeps you on the screen, with the reason
    if (!(await flush())) return;
    setEdit(null);
    setView(back);
    top();
  };

  /** Asked before a screen opens when what's changed there works out a round's results again. */
  function askFirst(what: string): string | null {
    if (!scoredRounds.length) return null;
    const [kind, n, part] = what.split(":");
    if (kind === "round") {
      const i = Number(n);
      return started(i) && part === "tee" ? `Round ${i + 1} has scores. Changing the tees works out its results again from them.` : null;
    }
    if (!["points", "win", "players", "teams"].includes(kind)) return null;
    const names = list(scoredRounds.map((i) => String(i + 1)));
    const which = scoredRounds.length === 1 ? `Round ${names} has scores` : `Rounds ${names} have scores`;
    const what2 = kind === "players" ? "a handicap or a team" : kind === "teams" ? "the teams" : kind === "win" ? "the handicaps" : "the points";
    return `${which}. Changing ${what2} works out ${scoredRounds.length === 1 ? "its" : "their"} results again from them.`;
  }

  async function addRound(d: Draft) {
    setSave({ state: "saving" });
    const r = await api("/api/setup-edit", { scope: "addround", wizard: toWizard(fill(d)) }).catch(() => null);
    if (!r?.ok) return setSave({ state: "error", msg: String(r?.j.error ?? "Couldn't add it. Check the signal and try again.") });
    await reload();
    setEdit(null);
    setTicked(["addround"]);
    setNote(null);
    setView({ kind: "round", i: base!.rounds.length });
    top();
  }

  async function removeRound(i: number) {
    setBusy(true);
    setNote(null);
    const d = { ...base!, count: base!.rounds.length - 1, rounds: base!.rounds.filter((_, k) => k !== i) };
    const r = await api("/api/setup-edit", { scope: `removeround:${i}`, wizard: toWizard(d) }).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setNote(String(r?.j.error ?? "Couldn't remove it. Check the signal and try again."));
    await reload();
    setRemoving(false);
    setTicked([]);
    setNote(`Round ${i + 1} removed.`);
    setView({ kind: "list" });
    top();
  }

  // ------------------------------------------------------------ changing one answer
  if (edit) {
    const steps = flowFor(edit.what, edit.d, base);
    const step = steps[Math.min(edit.at, steps.length - 1)];
    const [kind, idx] = step.split(":");
    const i = Number(idx ?? 0);
    const last = edit.at >= steps.length - 1;
    const adding = edit.what === "addround";
    const warn = !edit.agreed && askFirst(edit.what);
    const props: StepProps = {
      d: edit.d,
      editing: true,
      nextLabel: last ? (adding ? "Add this round" : "Done") : "Next",
      set: (fn) =>
        setEdit((e) => {
          if (!e) return e;
          const d = fill(settle(fn(e.d)));
          queue(d, e.what, 900);
          return { ...e, d };
        }),
      done: (patch) => {
        const nd = fill(settle({ ...edit.d, ...patch, step: "" }));
        const list = flowFor(edit.what, nd, base);
        const to = patch?.step && list.includes(patch.step) ? list.indexOf(patch.step) : list.indexOf(step) + 1;
        if (to > 0 && to < list.length) {
          queue(nd, edit.what, 0);
          setEdit({ ...edit, d: nd, at: to });
          top();
        } else if (adding) addRound(nd);
        else if (!ready(nd) && JSON.stringify(toWizard(fill(nd))) !== lastSent.current) {
          // Not complete enough to save: stay, with the reason shown under the button
          setEdit({ ...edit, d: nd });
        } else {
          queue(nd, edit.what, 0);
          setEdit({ ...edit, d: nd });
          leave(edit.back);
        }
      },
    };
    return (
      <div ref={topRef} className="wz su-edit" data-step={kind}>
        <div className="wz-top">
          <button type="button" className="back-home" onClick={() => (edit.at > 0 ? setEdit({ ...edit, at: edit.at - 1 }) : leave(edit.back))}>
            <span aria-hidden>←</span> Back
          </button>
          <span className={`su-status su-${save.state}`} aria-live="polite">
            {save.state === "saving" ? "Saving…" : save.state === "saved" ? "✓ Saved" : ""}
          </span>
        </div>
        {warn ? (
          <section className="wz-screen">
            <h1 className="wz-q">Before you change this</h1>
            <p className="wz-hint">{warn}</p>
            <div className="wz-body">
              <button type="button" className="btn glow block" onClick={() => setEdit({ ...edit, agreed: true })}>
                Carry on
              </button>
              <button type="button" className="btn secondary block" onClick={() => leave(edit.back)}>
                Leave it as it is
              </button>
            </div>
          </section>
        ) : (
          <>
            {kind === "name" && <NameScreen {...props} />}
            {kind === "players" && <PlayersScreen {...props} />}
            {kind === "teams" && <TeamsScreen {...props} />}
            {kind === "win" && <WinScreen {...props} />}
            {kind === "winmore" && <WinMoreScreen {...props} />}
            {kind === "course" && <CourseScreen key={i} {...props} i={i} />}
            {kind === "tee" && <TeeScreen key={i} {...props} i={i} />}
            {kind === "holes" && <HolesScreen {...props} i={i} />}
            {kind === "format" && <FormatScreen {...props} i={i} />}
            {kind === "when" && <WhenScreen key={i} {...props} i={i} />}
            {kind === "points" && <PointsScreen {...props} />}
            {kind === "groups" && <GroupsScreen {...props} />}
            {kind === "prizes" && <PrizesScreen {...props} />}
            {kind === "extras" && <ExtrasScreen {...props} />}
            {kind === "look" && <LookScreen {...props} />}
            {kind === "about" && <AboutScreen {...props} />}
            {kind !== "name" && <Problems d={edit.d} />}
          </>
        )}
        {save.state === "error" && <p className="error">{save.msg}</p>}
        {save.state === "saved" && save.note && <p className="notice">{save.note}</p>}
      </div>
    );
  }

  const roundLine = (i: number) => {
    const r = base.rounds[i];
    return [r.courseName, r.format ? inSentence(formatName(r.format)) : null, r.date ? day(r.date) : null].filter(Boolean).join(", ");
  };
  const tick = (what: string) => ticked.includes(what);

  // ------------------------------------------------------------ a round's course guide
  if (view.kind === "guide" && rounds[view.i]) {
    const i = view.i;
    return (
      <div ref={topRef} className="wz su-edit">
        <div className="wz-top">
          <button type="button" className="back-home" onClick={() => (setView({ kind: "round", i }), top())}>
            <span aria-hidden>←</span> Back
          </button>
        </div>
        <GuideScreen key={`${rounds[i].id}${rounds[i].course_guide ? "-g" : ""}`} round={rounds[i]} searching={(st.tournament.setup_jobs ?? []).some((j) => j.kind === "guide" && j.roundId === rounds[i].id && j.status === "todo")} onSaved={reload} />
      </div>
    );
  }

  // ------------------------------------------------------------ one round
  if (view.kind === "round" && base.rounds[view.i]) {
    const i = view.i;
    const r = base.rounds[i];
    const on = started(i);
    const opts = roundFormats(base.who ?? "individuals", solo ? null : base.win, base.ko.pairs);
    const others = Object.keys(r.playerTees ?? {}).length;
    const back: View = { kind: "list" };
    const added = tick("addround");
    return (
      <div ref={topRef} className="stack su">
        <button type="button" className="back-home" onClick={() => (setView(back), setTicked([]), setNote(null), setRemoving(false), top())}>
          <span aria-hidden>←</span> Tournament setup
        </button>
        <h1>Round {i + 1}</h1>
        {added && <p className="notice">Round {i + 1} is added, with its groups made the same way as the others.</p>}
        {on && <p className="notice">This round has scores, so its course, holes, format and groups stay as they are.</p>}
        {note && <p className="notice">{note}</p>}
        <ul className="su-list">
          <Row label="Course" value={[r.courseName, r.location].filter(Boolean).join(", ")} onChange={on ? undefined : () => open(`round:${i}:course`, view)} saved={tick(`round:${i}:course`)} />
          {!r.manual && (r.tees?.length ?? 0) > 1 && <Row label="Tees" value={`${r.tee}${others ? `, ${others} player${others === 1 ? "" : "s"} on other tees` : ""}`} onChange={() => open(`round:${i}:tee`, view)} saved={tick(`round:${i}:tee`)} />}
          {holesOf(r) === 18 && <Row label="Holes" value={HOLES[r.holeSet]} onChange={on ? undefined : () => open(`round:${i}:holes`, view)} saved={tick(`round:${i}:holes`)} />}
          {r.format && <Row label="Format" value={formatName(r.format)} onChange={on || ko || legacy || opts.length < 2 || (solo && i > 0) ? undefined : () => open(`round:${i}:format`, view)} saved={tick(`round:${i}:format`)} />}
          <Row label="Date and first tee time" value={r.date ? `${day(r.date)}${r.time ? ` at ${r.time}` : ""}` : "Not set yet"} onChange={() => open(`round:${i}:when`, view)} saved={tick(`round:${i}:when`)} />
          {st.tournament.ai_on !== false && rounds[i] && <Row label="Course guide" value={guideStatus(rounds[i], st.tournament.setup_jobs ?? [])} onChange={() => (setView({ kind: "guide", i }), top())} />}
        </ul>
        {!ko && !on && base.rounds.length > 1 && (
          <div className="su-remove">
            {removing ? (
              <>
                <p>
                  Remove round {i + 1} at {r.courseName}?
                </p>
                <div className="row">
                  <button type="button" className="btn danger" disabled={busy} onClick={() => removeRound(i)}>
                    {busy ? "Removing…" : "Yes, remove it"}
                  </button>
                  <button type="button" className="btn secondary" disabled={busy} onClick={() => setRemoving(false)}>
                    Keep it
                  </button>
                </div>
              </>
            ) : (
              <button type="button" className="linklike" onClick={() => setRemoving(true)}>
                Remove this round
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------ everything
  const ps = named(base);
  const t = st.tournament;
  const winDetail = (() => {
    if (!base.win) return "";
    const bits: string[] = [winName(base.win)];
    if (base.win === "knockout") bits.push(base.ko.pairs ? "pairs" : "singles", base.ko.tie === "backnine" ? "level after 18: better back nine" : "level after 18: extra holes");
    if (base.win === "skins") bits.push(base.skinsCarry ? "ties carry over" : "ties not carried");
    if (base.win === "teamscore") bits.push(base.teamCount ? `best ${base.teamCount} count` : "every score counts");
    if (base.allowance != null) bits.push(base.allowance === 0 ? "off scratch" : `${base.allowance}% handicaps`);
    return bits.join(", ");
  })();
  const pointsLine = [
    ...new Set(
      base.rounds.map((r) => {
        const p = r.points;
        if (r.format && isMatch(r.format)) return `${p?.win ?? 1} a match`;
        if (r.format === "skins") return `${p?.skin ?? 1} a skin`;
        return p?.positions?.length ? `${p.positions.join("-")} for the places` : "places";
      }),
    ),
  ].join("; ");
  const groupsLine = list(
    rounds.map((r, i) => {
      const n = r.games?.length ?? 0;
      const f = base.rounds[i]?.format as DayFormat | null;
      return `${n} ${f && isMatch(f) ? (n === 1 ? "match" : "matches") : n === 1 ? "group" : "groups"}${rounds.length > 1 ? ` in round ${i + 1}` : ""}`;
    }),
  );
  const lines = ps.filter((p) => p.nickname.trim() || p.line.trim()).length;
  const tone = TONE_LABEL[base.tone]?.split(":")[0];
  const extras = [base.extras.feed ? "live feed" : null, base.extras.ai ? `AI writing (${tone?.toLowerCase()})` : null, base.extras.video ? "video" : null].filter(Boolean).join(", ");

  return (
    <div ref={topRef} className="stack su">
      <Link className="back-home" href={href("/admin")}>
        <span aria-hidden>←</span> Organiser home
      </Link>
      <h1>Tournament setup</h1>
      <p className="lead">Tap any line to change it. Changes save as you go.</p>
      {note && <p className="notice">{note}</p>}
      <ul className="su-list">
        <Row label="Name" value={base.subtitle ? `${base.name}: ${base.subtitle}` : base.name} onChange={() => open("name")} saved={tick("name")} />
        <Row
          label={solo ? "You" : "Players"}
          value={solo ? `${ps[0]?.name ?? ""}${ps[0]?.index ? `, ${ps[0].plus ? "+" : ""}${ps[0].index}` : ""}` : `${ps.length}: ${list(ps.map((p) => p.name))}`}
          onChange={() => open("players")}
          saved={tick("players")}
        />
        {base.who === "teams" && <Row label="Teams" value={base.teams.map((x, i) => x.name || `Team ${i + 1}`).join(" v ")} onChange={() => open("teams")} saved={tick("teams")} />}
        {!solo && <Row label="How the winner is decided" value={winDetail} onChange={legacy ? undefined : () => open("win")} saved={tick("win")} />}
      </ul>

      <h2 className="su-h">Rounds</h2>
      <ul className="su-list">
        {base.rounds.map((_, i) => (
          <Row key={i} label={`Round ${i + 1}${started(i) ? ": under way" : ""}`} value={roundLine(i)} onChange={() => (setView({ kind: "round", i }), setTicked([]), setNote(null), top())} action="Open" />
        ))}
      </ul>
      {!ko && base.rounds.length < 10 && (
        <button type="button" className="btn secondary block" onClick={() => open("addround", { kind: "list" })}>
          + Add a round
        </button>
      )}

      {!solo && !legacy && (
        <>
          <h2 className="su-h">Scoring and groups</h2>
          <ul className="su-list">
            {usesPoints(base.win) && <Row label="Points" value={pointsLine} onChange={() => open("points")} saved={tick("points")} />}
            {base.win !== "scramble" && (
              <Row label={ko ? "The draw" : "Who plays with whom"} value={ko ? (base.ko.draw === "pick" ? "Picked by you" : base.ko.draw === "seeded" ? "Seeded" : "Random") : groupsLine} onChange={() => open("groups")} saved={tick("groups")} />
            )}
            <Row label="Prizes" value={base.prizes.length ? list(base.prizes.map((p) => PRIZE_NAMES[p.kind])) : "None"} onChange={() => open("prizes")} saved={tick("prizes")} />
          </ul>
        </>
      )}

      <h2 className="su-h">Extras and look</h2>
      <ul className="su-list">
        <Row label="The extras" value={extras ? extras.charAt(0).toUpperCase() + extras.slice(1) : "All off"} onChange={() => open("extras")} saved={tick("extras")} />
        <Row label="Look" value={THEMES.find((x) => x.id === t.theme)?.name ?? "Your own colours"} onChange={() => open("look")} saved={tick("look")} />
        {!solo && <Row label="About the players" value={lines ? `${lines} of ${ps.length} with a nickname or a line` : "Nothing yet"} onChange={() => open("about")} saved={tick("about")} />}
      </ul>

      <h2 className="su-h">Other details</h2>
      <ul className="su-links">
        <li>
          <a href={href("/admin#rounds")}>{legacy ? "Points, groups, scorecards and course photos" : "Scorecards and course photos"}</a>
        </li>
        <li>
          <a href={href("/admin#look")}>Logo, photos and your own colours</a>
        </li>
        <li>
          <a href={href("/admin#players")}>Players&apos; links, PINs and photos</a>
        </li>
        {legacy && (
          <li>
            <a href={href("/admin#sides")}>Side games</a>
          </li>
        )}
      </ul>
    </div>
  );
}

function Row({ label, value, onChange, saved, action = "Change" }: { label: string; value: string; onChange?: () => void; saved?: boolean; action?: string }) {
  const body = (
    <>
      <span className="su-l">{label}</span>
      <span className="su-v">
        {value}
        {saved && <span className="su-saved"> Saved</span>}
      </span>
      {onChange && <span className="su-c">{action}</span>}
    </>
  );
  return (
    <li>
      {onChange ? (
        <button type="button" className="su-row" onClick={onChange}>
          {body}
        </button>
      ) : (
        <div className="su-row fixed">{body}</div>
      )}
    </li>
  );
}
