"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useT } from "@/components/Providers";
import { Loading } from "@/components/ui";
import { useAdmin } from "@/components/editors";
import { THEMES, TONE_LABEL } from "@/lib/types";
import {
  formatName,
  isMatch,
  roundFormats,
  usesPoints,
  winName,
  type DayFormat,
} from "@/lib/wizard";
import { fromState } from "@/components/setup/fromState";
import {
  emptyRound,
  holesOf,
  named,
  settle,
  toWizard,
  type Draft,
} from "@/components/setup/model";
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
 * save, and you're back here. Rounds already under way keep what their scores depend on.
 */

type View = { kind: "list" } | { kind: "round"; i: number };
interface Edit {
  /** What's being changed: name, players, win… or round:<i>:<part>, addround */
  what: string;
  d: Draft;
  at: number;
  back: View;
}

const PRIZE_NAMES = {
  ctp: "closest the pin",
  ld: "long drive",
  nines: "front 9 and back 9",
  birdies: "most birdies",
  gir: "most greens",
  skins: "skins",
  bestround: "best round",
} as const;
const HOLES = { all: "All 18", front: "Front 9", back: "Back 9" } as const;
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IE", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
const list = (xs: string[]) =>
  xs.length < 2
    ? xs.join("")
    : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/** The screens one change goes through, for the answers so far. */
function flowFor(what: string, d: Draft, base: Draft): string[] {
  const [kind, n, part] = what.split(":");
  const i = Number(n ?? 0);
  switch (kind) {
    case "players":
      return d.who === "teams" ? ["players", "teams"] : ["players"];
    case "win":
      return [
        "win",
        ...(d.win === "knockout" || d.win === "skins" || d.win === "teamscore"
          ? ["winmore"]
          : []),
      ];
    case "round": {
      if (part !== "course") return [`${part}:${i}`];
      const r = d.rounds[i];
      const moved =
        r &&
        (r.courseRef !== base.rounds[i]?.courseRef ||
          r.courseName !== base.rounds[i]?.courseName);
      return [
        `course:${i}`,
        ...(moved && !r.manual && (r.tees?.length ?? 0) > 1
          ? [`tee:${i}`]
          : []),
      ];
    }
    case "addround": {
      const k = base.rounds.length;
      const r = d.rounds[k];
      const opts = roundFormats(
        d.who ?? "individuals",
        d.who === "solo" ? null : d.win,
        d.ko.pairs,
      );
      return [
        `course:${k}`,
        ...(r && !r.manual && (r.tees?.length ?? 0) > 1 ? [`tee:${k}`] : []),
        ...(r && holesOf(r) === 18 ? [`holes:${k}`] : []),
        ...(opts.length > 1 && d.who !== "solo" ? [`format:${k}`] : []),
        `when:${k}`,
      ];
    }
    default:
      return [kind];
  }
}

/** The server's name for the change. */
const scopeOf = (what: string) =>
  what.startsWith("round:") ? what.split(":").slice(0, 2).join(":") : what;

/** A knockout that needs another round (more players): the new one at the same course as the last. */
function fill(d: Draft): Draft {
  const rounds = d.rounds.map((r, i) => {
    if (r.courseName || i === 0) return r;
    const prev = d.rounds[i - 1];
    return {
      ...r,
      courseRef: prev.courseRef,
      courseName: prev.courseName,
      location: prev.location,
      lat: prev.lat,
      lon: prev.lon,
      tees: prev.tees,
      tee: prev.tee,
      holeSet: prev.holeSet,
      manual: prev.manual,
      manualCard: prev.manualCard,
    };
  });
  return { ...d, rounds };
}

export default function TournamentSetup() {
  const { session, href, api } = useT();
  const { data, err, reload } = useAdmin();
  const base = useMemo(() => (data ? fromState(data.state) : null), [data]);
  const [view, setView] = useState<View>({ kind: "list" });
  const [edit, setEdit] = useState<Edit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ text: string; d: Draft } | null>(
    null,
  );
  const [saved, setSaved] = useState<{ what: string; note?: string } | null>(
    null,
  );
  const [removing, setRemoving] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  if (!session)
    return (
      <p>
        <Link href={href(`/login?next=${encodeURIComponent(href("/setup"))}`)}>
          Log in
        </Link>{" "}
        as organiser.
      </p>
    );
  if (session.role !== "organiser") return <p>Organiser only.</p>;
  if (err) return <p className="error">{err}</p>;
  if (!data || !base) return <Loading />;

  const st = data.state;
  const rounds = [...st.rounds].sort((a, b) => a.number - b.number);
  const startedIds = new Set(st.entries.map((e) => e.round_id));
  const started = (i: number) => !!rounds[i] && startedIds.has(rounds[i].id);
  const solo = base.who === "solo";
  const ko = base.win === "knockout";
  const legacy = !st.tournament.win;
  const top = () => topRef.current?.scrollIntoView({ block: "start" });

  const open = (what: string, back: View = view) => {
    const k = base.rounds.length;
    const d0 =
      what === "addround"
        ? settle({
            ...base,
            count: k + 1,
            rounds: [...base.rounds, emptyRound()],
          })
        : base;
    setEdit({ what, d: d0, at: 0, back });
    setError(null);
    setSaved(null);
    setConfirm(null);
    top();
  };
  const close = (back: View) => {
    setEdit(null);
    setConfirm(null);
    setError(null);
    setView(back);
    top();
  };

  /** A warning before changing something a round with scores depends on. */
  function warning(what: string, d: Draft): string | null {
    const scoredRounds = rounds.map((_, i) => i).filter(started);
    if (!scoredRounds.length) return null;
    const names = list(scoredRounds.map((i) => String(i + 1)));
    const which =
      scoredRounds.length === 1
        ? `Round ${names} has scores`
        : `Rounds ${names} have scores`;
    const again = `${which}. Changing this works out ${scoredRounds.length === 1 ? "its" : "their"} results again from the scores.`;
    const [kind, n] = what.split(":");
    if (kind === "round") {
      const i = Number(n);
      const a = d.rounds[i];
      const b = base!.rounds[i];
      if (!started(i) || !a || !b) return null;
      return a.tee !== b.tee ||
        JSON.stringify(a.playerTees) !== JSON.stringify(b.playerTees)
        ? `Round ${i + 1} has scores. Changing the tees works out its results again from the scores.`
        : null;
    }
    if (kind === "points" || kind === "win") return again;
    if (kind === "players" || kind === "teams") {
      const changed = named(d).some((p) => {
        const was = base!.players.find((x) => x.key === p.key);
        return (
          was &&
          (was.index !== p.index || was.plus !== p.plus || was.team !== p.team)
        );
      });
      return changed ? again : null;
    }
    return null;
  }

  async function save(d: Draft, what: string, ok = false) {
    const w = warning(what, d);
    if (w && !ok) return setConfirm({ text: w, d });
    setConfirm(null);
    setBusy(true);
    setError(null);
    const r = await api("/api/setup-edit", {
      scope: scopeOf(what),
      wizard: toWizard(fill(d)),
    }).catch(() => null);
    if (!r?.ok) {
      setBusy(false);
      return setError(
        String(
          r?.j.error ?? "Couldn't save that. Check the signal and try again.",
        ),
      );
    }
    await reload();
    setBusy(false);
    const back = edit?.back ?? { kind: "list" };
    setSaved({ what, note: r.j.note ? String(r.j.note) : undefined });
    setEdit(null);
    setView(
      what === "addround" ? { kind: "round", i: base!.rounds.length } : back,
    );
    top();
  }

  async function removeRound(i: number) {
    setBusy(true);
    setError(null);
    const d = {
      ...base!,
      count: base!.rounds.length - 1,
      rounds: base!.rounds.filter((_, k) => k !== i),
    };
    const r = await api("/api/setup-edit", {
      scope: `removeround:${i}`,
      wizard: toWizard(d),
    }).catch(() => null);
    if (!r?.ok) {
      setBusy(false);
      return setError(
        String(
          r?.j.error ?? "Couldn't remove it. Check the signal and try again.",
        ),
      );
    }
    await reload();
    setBusy(false);
    setRemoving(false);
    setSaved({ what: "removeround", note: `Round ${i + 1} removed.` });
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
    const props: StepProps = {
      d: edit.d,
      editing: true,
      nextLabel: last
        ? edit.what === "addround"
          ? "Add this round"
          : "Save"
        : "Next",
      set: (fn) => setEdit((e) => (e ? { ...e, d: fill(settle(fn(e.d))) } : e)),
      done: (patch) => {
        const nd = fill(settle({ ...edit.d, ...patch, step: "" }));
        const list = flowFor(edit.what, nd, base);
        const to =
          patch?.step && list.includes(patch.step)
            ? list.indexOf(patch.step)
            : list.indexOf(step) + 1;
        if (to > 0 && to < list.length) {
          setEdit({ ...edit, d: nd, at: to });
          top();
        } else save(nd, edit.what);
      },
    };
    return (
      <div
        ref={topRef}
        className={`wz su-edit${busy ? " su-busy" : ""}`}
        data-step={kind}
      >
        <div className="wz-top">
          <button
            type="button"
            className="back-home"
            onClick={() =>
              edit.at > 0
                ? setEdit({ ...edit, at: edit.at - 1 })
                : close(edit.back)
            }
            disabled={busy}
          >
            <span aria-hidden>←</span> {edit.at > 0 ? "Back" : "Cancel"}
          </button>
          {busy && <span className="su-saving">Saving…</span>}
        </div>
        {confirm ? (
          <section className="wz-screen">
            <h1 className="wz-q">Before you save</h1>
            <p className="wz-hint">{confirm.text}</p>
            <div className="wz-body">
              <button
                type="button"
                className="btn glow block"
                disabled={busy}
                onClick={() => save(confirm.d, edit.what, true)}
              >
                Save anyway
              </button>
              <button
                type="button"
                className="btn secondary block"
                disabled={busy}
                onClick={() => close(edit.back)}
              >
                Don&apos;t change it
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
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  const roundLine = (i: number) => {
    const r = base.rounds[i];
    return [
      r.courseName,
      r.format ? formatName(r.format).toLowerCase() : null,
      r.date ? day(r.date) : null,
    ]
      .filter(Boolean)
      .join(", ");
  };

  // ------------------------------------------------------------ one round
  if (view.kind === "round" && base.rounds[view.i]) {
    const i = view.i;
    const r = base.rounds[i];
    const on = started(i);
    const opts = roundFormats(
      base.who ?? "individuals",
      solo ? null : base.win,
      base.ko.pairs,
    );
    const others = Object.keys(r.playerTees ?? {}).length;
    const back: View = { kind: "list" };
    return (
      <div ref={topRef} className="stack su">
        <button
          type="button"
          className="back-home"
          onClick={() => (
            setView(back),
            setSaved(null),
            setRemoving(false),
            top()
          )}
        >
          <span aria-hidden>←</span> Tournament setup
        </button>
        <h1>Round {i + 1}</h1>
        {on && (
          <p className="notice">
            This round has scores, so its course, holes, format and groups stay
            as they are.
          </p>
        )}
        {saved?.note && <p className="notice">{saved.note}</p>}
        <ul className="su-list">
          <Row
            label="Course"
            value={[r.courseName, r.location].filter(Boolean).join(", ")}
            onChange={on ? undefined : () => open(`round:${i}:course`, view)}
            saved={
              saved?.what === `round:${i}:course` || saved?.what === "addround"
            }
          />
          {!r.manual && (r.tees?.length ?? 0) > 1 && (
            <Row
              label="Tees"
              value={`${r.tee}${others ? `, ${others} player${others === 1 ? "" : "s"} on other tees` : ""}`}
              onChange={() => open(`round:${i}:tee`, view)}
              saved={saved?.what === `round:${i}:tee`}
            />
          )}
          {holesOf(r) === 18 && (
            <Row
              label="Holes"
              value={HOLES[r.holeSet]}
              onChange={on ? undefined : () => open(`round:${i}:holes`, view)}
              saved={saved?.what === `round:${i}:holes`}
            />
          )}
          {r.format && (
            <Row
              label="Format"
              value={formatName(r.format)}
              onChange={
                on || ko || legacy || opts.length < 2 || (solo && i > 0)
                  ? undefined
                  : () => open(`round:${i}:format`, view)
              }
              saved={saved?.what === `round:${i}:format`}
            />
          )}
          <Row
            label="Date and first tee time"
            value={
              r.date
                ? `${day(r.date)}${r.time ? ` at ${r.time}` : ""}`
                : "Not set yet"
            }
            onChange={() => open(`round:${i}:when`, view)}
            saved={saved?.what === `round:${i}:when`}
          />
        </ul>
        {!ko && !on && base.rounds.length > 1 && (
          <div className="su-remove">
            {removing ? (
              <>
                <p>
                  Remove round {i + 1} at {r.courseName}?
                </p>
                <div className="row">
                  <button
                    type="button"
                    className="btn danger"
                    disabled={busy}
                    onClick={() => removeRound(i)}
                  >
                    {busy ? "Removing…" : "Yes, remove it"}
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={busy}
                    onClick={() => setRemoving(false)}
                  >
                    Keep it
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                className="linklike"
                onClick={() => setRemoving(true)}
              >
                Remove this round
              </button>
            )}
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  // ------------------------------------------------------------ everything
  const ps = named(base);
  const t = st.tournament;
  const winDetail = (() => {
    if (!base.win) return "";
    const bits: string[] = [winName(base.win)];
    if (base.win === "knockout")
      bits.push(
        base.ko.pairs ? "pairs" : "singles",
        base.ko.tie === "backnine"
          ? "level after 18: better back nine"
          : "level after 18: extra holes",
      );
    if (base.win === "skins")
      bits.push(base.skinsCarry ? "ties carry over" : "ties not carried");
    if (base.win === "teamscore")
      bits.push(
        base.teamCount ? `best ${base.teamCount} count` : "every score counts",
      );
    if (base.allowance != null)
      bits.push(
        base.allowance === 0 ? "off scratch" : `${base.allowance}% handicaps`,
      );
    return bits.join(", ");
  })();
  const pointsLine = (() => {
    const xs = new Set(
      base.rounds.map((r) => {
        const p = r.points;
        if (r.format && isMatch(r.format)) return `${p?.win ?? 1} a match`;
        if (r.format === "skins") return `${p?.skin ?? 1} a skin`;
        return p?.positions?.length
          ? `${p.positions.join("-")} for the places`
          : "places";
      }),
    );
    return [...xs].join("; ");
  })();
  const groupsLine = rounds.length
    ? list(
        rounds.map((r, i) => {
          const n = r.games?.length ?? 0;
          const f = base.rounds[i]?.format as DayFormat | null;
          return `${n} ${f && isMatch(f) ? (n === 1 ? "match" : "matches") : n === 1 ? "group" : "groups"}${rounds.length > 1 ? ` in round ${i + 1}` : ""}`;
        }),
      )
    : "";
  const lines = ps.filter((p) => p.nickname.trim() || p.line.trim()).length;
  const tone = TONE_LABEL[base.tone]?.split(":")[0];

  return (
    <div ref={topRef} className="stack su">
      <Link className="back-home" href={href("/admin")}>
        <span aria-hidden>←</span> Organiser home
      </Link>
      <h1>Tournament setup</h1>
      <p className="lead">Tap any line to change it.</p>
      {saved?.note && <p className="notice">{saved.note}</p>}
      <ul className="su-list">
        <Row
          label="Name"
          value={base.subtitle ? `${base.name}: ${base.subtitle}` : base.name}
          onChange={() => open("name")}
          saved={saved?.what === "name"}
        />
        <Row
          label={solo ? "You" : "Players"}
          value={
            solo
              ? `${ps[0]?.name ?? ""}${ps[0]?.index ? `, ${ps[0].plus ? "+" : ""}${ps[0].index}` : ""}`
              : `${ps.length}: ${list(ps.map((p) => p.name))}`
          }
          onChange={() => open("players")}
          saved={saved?.what === "players"}
        />
        {base.who === "teams" && (
          <Row
            label="Teams"
            value={base.teams
              .map((x, i) => x.name || `Team ${i + 1}`)
              .join(" v ")}
            onChange={() => open("teams")}
            saved={saved?.what === "teams"}
          />
        )}
        {!solo && (
          <Row
            label="How the winner is decided"
            value={winDetail}
            onChange={legacy ? undefined : () => open("win")}
            saved={saved?.what === "win"}
          />
        )}
      </ul>

      <h2 className="su-h">Rounds</h2>
      <ul className="su-list">
        {base.rounds.map((_, i) => (
          <Row
            key={i}
            label={`Round ${i + 1}${started(i) ? ": under way" : ""}`}
            value={roundLine(i)}
            onChange={() => (
              setView({ kind: "round", i }),
              setSaved(null),
              top()
            )}
            action="Open"
          />
        ))}
      </ul>
      {!ko && base.rounds.length < 10 && (
        <button
          type="button"
          className="btn secondary block"
          onClick={() => open("addround", { kind: "list" })}
        >
          + Add a round
        </button>
      )}

      {!solo && !legacy && <h2 className="su-h">Scoring and groups</h2>}
      <ul className="su-list">
        {!solo && !legacy && usesPoints(base.win) && (
          <Row
            label="Points"
            value={pointsLine}
            onChange={() => open("points")}
            saved={saved?.what === "points"}
          />
        )}
        {!solo && !legacy && base.win !== "scramble" && (
          <Row
            label={ko ? "The draw" : "Who plays with whom"}
            value={
              ko
                ? base.ko.draw === "pick"
                  ? "Picked by you"
                  : base.ko.draw === "seeded"
                    ? "Seeded"
                    : "Random"
                : groupsLine
            }
            onChange={() => open("groups")}
            saved={saved?.what === "groups"}
          />
        )}
        {!solo && !legacy && (
          <Row
            label="Prizes"
            value={
              base.prizes.length
                ? list(base.prizes.map((p) => PRIZE_NAMES[p.kind]))
                : "None"
            }
            onChange={() => open("prizes")}
            saved={saved?.what === "prizes"}
          />
        )}
      </ul>

      <h2 className="su-h">Extras and look</h2>
      <ul className="su-list">
        <Row
          label="The extras"
          value={
            [
              base.extras.feed ? "live feed" : null,
              base.extras.ai ? `AI writing (${tone?.toLowerCase()})` : null,
              base.extras.video ? "video" : null,
            ]
              .filter(Boolean)
              .join(", ")
              .replace(/^./, (c) => c.toUpperCase()) || "All off"
          }
          onChange={() => open("extras")}
          saved={saved?.what === "extras"}
        />
        <Row
          label="Look"
          value={
            THEMES.find((x) => x.id === t.theme)?.name ?? "Your own colours"
          }
          onChange={() => open("look")}
          saved={saved?.what === "look"}
        />
        {!solo && (
          <Row
            label="About the players"
            value={
              lines
                ? `${lines} of ${ps.length} with a nickname or a line`
                : "Nothing yet"
            }
            onChange={() => open("about")}
            saved={saved?.what === "about"}
          />
        )}
      </ul>

      <h2 className="su-h">Other details</h2>
      <ul className="su-links">
        <li>
          <a href={href("/admin#rounds")}>
            {legacy
              ? "Points, groups, scorecards and course photos"
              : "Scorecards, course photos and hole guides"}
          </a>
        </li>
        <li>
          <a href={href("/admin#look")}>Logo, photos and your own colours</a>
        </li>
        <li>
          <a href={href("/admin#players")}>
            Players&apos; links, PINs and photos
          </a>
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

function Row({
  label,
  value,
  onChange,
  saved,
  action = "Change",
}: {
  label: string;
  value: string;
  onChange?: () => void;
  saved?: boolean;
  action?: string;
}) {
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
