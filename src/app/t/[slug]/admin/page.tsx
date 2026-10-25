"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/components/Providers";
import { Loading, timeAgo } from "@/components/ui";
import {
  BasicsEditor,
  ContentEditor,
  InviteEditor,
  OrganisersEditor,
  PlayersEditor,
  ResetTestData,
  RoundsEditor,
  SideGamesEditor,
  useAdmin,
  type AdminData,
} from "@/components/editors";
import { filmUnlock } from "@/lib/film";
import { EmailTab, useSubscribers } from "@/components/EmailAdmin";
import { Writer, WRITE_TYPES, type WriteType } from "@/components/Writer";
import { useCountdown } from "@/components/visual";
import { THEMES, TONE_LABEL, toRoundCfg, type SetupJob } from "@/lib/types";
import { cardInfo } from "@/lib/scorecards";
import { CardsAdmin } from "@/components/CardsAdmin";
import { BroadcastSettings } from "@/components/BroadcastSettings";

const SECTIONS = {
  rounds: "Rounds and courses",
  cards: "Scorecards",
  players: "Players",
  organisers: "Organisers",
  write: "Write and publish",
  email: "Email list",
  film: "Highlights film",
  posts: "Posts and photos",
  sides: "Side games",
  look: "Look and style",
  share: "Share and invite",
  settings: "Settings",
} as const;
type Section = keyof typeof SECTIONS;

/** "#write/preview/<roundId>" → section plus optional writer start. Hash routing keeps the phone's back button working. */
function readHash(): { section: Section | null; type?: WriteType; roundId?: string } {
  if (typeof window === "undefined") return { section: null };
  const [s, type, roundId] = window.location.hash.slice(1).split("/");
  if (!(s in SECTIONS)) return { section: null };
  return { section: s as Section, type: WRITE_TYPES.some((w) => w.id === type) ? (type as WriteType) : undefined, roundId };
}

export default function Admin() {
  const { session, href } = useT();
  const { data, err, reload } = useAdmin();
  const [route, setRoute] = useState<ReturnType<typeof readHash>>({ section: null });

  useEffect(() => {
    const on = () => {
      setRoute(readHash());
      window.scrollTo({ top: 0 });
    };
    setRoute(readHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const home = useCallback(() => {
    history.pushState(null, "", window.location.pathname + window.location.search);
    setRoute({ section: null });
    window.scrollTo({ top: 0 });
  }, []);

  if (!session)
    return (
      <p>
        <Link href={href(`/login?next=${encodeURIComponent(href("/admin"))}`)}>Sign in</Link> as organiser.
      </p>
    );
  if (session.role !== "organiser")
    return (
      <p>
        This is for the tournament&apos;s organisers. <Link href={href(`/login?as=organiser&next=${encodeURIComponent(href("/admin"))}`)}>Sign in as organiser</Link>.
      </p>
    );
  if (err) return <p className="error">{err}</p>;
  if (!data) return <Loading />;

  const s = route.section;
  if (!s) return <OrganiserHome data={data} />;

  return (
    <div className="stack org-section">
      <button className="back-home" onClick={home}>
        <span aria-hidden>←</span> Organiser home
      </button>
      <h1>{s === "rounds" && data.state.tournament.win ? "Course cards and photos" : SECTIONS[s]}</h1>
      {s === "rounds" && <RoundsEditor data={data} onSaved={reload} />}
      {s === "cards" && <CardsAdmin data={data} onSaved={reload} />}
      {s === "players" && <PlayersEditor data={data} onSaved={reload} />}
      {s === "write" && <Writer key={`${route.type}-${route.roundId}`} data={data} onSaved={reload} start={{ type: route.type, roundId: route.roundId }} />}
      {s === "email" && <EmailTab />}
      {s === "film" && (
        <>
          <FilmCard data={data} />
          <BroadcastSettings />
        </>
      )}
      {s === "posts" && <Moderate data={data} onSaved={reload} />}
      {s === "sides" && <SideGamesEditor data={data} onSaved={reload} />}
      {s === "look" && (
        <>
          <BasicsEditor data={data} onSaved={reload} />
          <ContentEditor data={data} onSaved={reload} />
        </>
      )}
      {s === "share" && <InviteEditor />}
      {s === "organisers" && <OrganisersEditor data={data} onSaved={reload} />}
      {s === "settings" && (
        <>
          <ResetTestData onSaved={reload} />
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------ home

function OrganiserHome({ data }: { data: AdminData }) {
  const { href } = useT();
  const subs = useSubscribers();
  const st = data.state;
  const t = st.tournament;
  const rounds = [...st.rounds].sort((a, b) => a.number - b.number);
  const live = rounds.find((r) => r.status === "live");
  const next = rounds.find((r) => r.status === "upcoming");
  const countdown = useCountdown(next?.play_date ?? null, next?.tee_time ?? null);
  const pieces = st.pieces.filter((p) => !(p.status === "hidden" && p.body === "(writing…)"));
  const drafts = pieces.filter((p) => p.status === "draft");
  const published = pieces.filter((p) => p.status === "published");
  // Players who can't get in yet: no personal link sent (or an old PIN) and not signed in (the organiser is already in)
  const noWay = st.players.filter((p) => p.id !== t.organiser_player_id && !data.linkSet?.[p.id] && !data.pinSet[p.id] && !data.linkUsed?.[p.id]);
  const complete = rounds.filter((r) => r.status === "complete");
  const cardStates = rounds
    .filter((r) => r.status !== "upcoming")
    .flatMap((r) => toRoundCfg(r, st.players).games.map((g) => ({ round: r, info: cardInfo(st, r.id, g.id) })));
  const waiting = cardStates.filter((c) => c.info.stage === "finished" || c.info.stage === "submitted");
  const flagged = cardStates.filter((c) => c.info.flag && c.info.stage === "submitted");

  // What needs doing, most urgent first. Only the top two are shown.
  const todo: { text: string; action: string; to: string; external?: boolean }[] = [];

  // Made with the set-up wizard: changes to rounds and groups are made in Tournament setup
  const fresh = !!t.win;
  if (rounds.length === 0) todo.push({ text: "Add the courses you're playing.", action: "Add a round", to: fresh ? href("/setup") : "#rounds", external: fresh });
  // Made with the wizard and "I'll set them myself": an empty list (older rounds have none at all: everyone in one game)
  const unset = rounds.filter((r) => r.status === "upcoming" && Array.isArray(r.games) && r.games.length === 0 && st.players.length > 1);
  if (unset.length)
    todo.push({
      text: `Who plays with whom in round${unset.length > 1 ? "s" : ""} ${listNames(unset.map((r) => String(r.number)))}: not set yet.`,
      action: "Set them",
      to: fresh ? href("/setup") : "#rounds",
      external: fresh,
    });
  if (st.players.length < 2) todo.push({ text: "Add the players.", action: "Add players", to: "#players" });
  // Everyone's link first: then they can keep score and post from their phones
  if (noWay.length) todo.push({ text: `Send ${listNames(noWay.map((p) => p.name))} ${noWay.length === 1 ? "their link" : "their links"}, so they can keep score and post from their phones.`, action: "Send links", to: "#players" });
  // Straight after setting up: the first preview, written while the courses were read up on
  const firstPreview = !published.length && drafts.find((p) => p.kind === "preview");
  if (firstPreview) todo.push({ text: "Your first preview is ready to read.", action: "Read it", to: "#write" });
  // The tournament is over: the film is the last thing to do
  const filmReady = t.video_enabled !== false && filmUnlock(st).ok;
  const filmMade = st.posts.some((p) => p.author_name === "AI director");
  if (filmReady && !filmMade) todo.unshift({ text: "The tournament is over. Time for the film.", action: "Make the film", to: href("/film"), external: true });
  if (flagged.length) todo.push({ text: `${flagged[0].info.flag!.by} says something's not right on a round ${flagged[0].round.number} card.`, action: "Check the cards", to: "#cards" });
  if (live) todo.push({ text: `Round ${live.number} at ${live.course_name} is under way.`, action: "Enter scores", to: href(`/score?round=${live.number}`), external: true });
  const lastDone = complete[complete.length - 1];
  const aiOn = t.ai_on !== false;
  if (aiOn && lastDone && !pieces.some((p) => p.kind === "report" && p.round_id === lastDone.id && p.status === "published")) {
    const d = drafts.find((p) => p.kind === "report" && p.round_id === lastDone.id);
    todo.push(
      d
        ? { text: `The round ${lastDone.number} report is written and waiting for you.`, action: "Read and publish", to: "#write" }
        : { text: `Round ${lastDone.number} is finished. Nobody has written it up yet.`, action: "Write the report", to: `#write/report/${lastDone.id}` },
    );
  }
  if (aiOn && next && !live && !pieces.some((p) => p.kind === "preview" && p.round_id === next.id))
    todo.push({ text: `No preview yet for round ${next.number} at ${next.course_name}.`, action: "Write the preview", to: `#write/preview/${next.id}` });
  if (drafts.length && !firstPreview && !todo.some((x) => x.to === "#write"))
    todo.push({ text: `${drafts.length} ${drafts.length === 1 ? "draft is" : "drafts are"} waiting to be read.`, action: "Read them", to: "#write" });

  const theme = THEMES.find((x) => x.id === t.theme)?.name ?? "Custom";
  const tone = TONE_LABEL[t.tone]?.split(":")[0] ?? "";
  const posts = st.posts.length;
  const clips = st.posts.filter((p) => p.kind === "video").length;
  const sides = (t.side_games ?? []).filter((g) => g.enabled !== false).length;

  const allTiles: [Section, string][] = [
    ["rounds", rounds.length ? `${rounds.length} round${rounds.length === 1 ? "" : "s"}${next ? `, next at ${short(next.course_name)}` : ""}` : "None yet"],
    ["cards", waiting.length ? `${waiting.length} card${waiting.length === 1 ? "" : "s"} not final yet` : cardStates.length ? "All final" : st.tournament.require_attestation ? "Players sign their cards" : "Final when submitted"],
    ["players", st.players.length ? `${st.players.length} players${noWay.length ? `, ${noWay.length} still to get their link` : ", all with their link"}` : "None yet"],
    ["write", drafts.length ? `${drafts.length} draft${drafts.length === 1 ? "" : "s"} waiting` : published.length ? `${published.length} published` : "Previews and reports"],
    ["email", !subs.list ? "" : !subs.configured ? "Not switched on yet" : `${subs.active} ${subs.active === 1 ? "person" : "people"} signed up`],
    ["film", filmMade ? "The film is made" : filmReady ? "Ready to make the film" : clips ? `${clips} clip${clips === 1 ? "" : "s"} so far` : "The film comes at the end"],
    ["posts", posts ? `${posts} post${posts === 1 ? "" : "s"}, ${st.comments.length} comment${st.comments.length === 1 ? "" : "s"}` : "Nothing posted yet"],
    ["sides", sides ? `${sides} running` : "Closest the pin and more"],
    ["look", `${theme}, ${tone.toLowerCase()} tone`],
    ["share", "The link for followers"],
    ["organisers", (() => {
      const n = (data.organisers ?? []).filter((o) => !o.pending).length;
      return n > 1 ? `${n} organisers` : "Add someone to help run it";
    })()],
  ];
  // Rounds, formats, groups and prizes live in Tournament setup for tournaments made with the wizard
  const tiles = fresh ? allTiles.filter(([id]) => id !== "rounds" && id !== "sides") : allTiles;

  return (
    <div className="org-home">
      <section className="org-hero">
        <p className="org-hello">Organiser</p>
        <h1>{t.name}</h1>
        <p className="org-when">
          {live
            ? `Round ${live.number} is being played now at ${live.course_name}.`
            : next
              ? `Round ${next.number}, ${next.course_name}${countdown ? `, ${countdown}` : ""}.`
              : rounds.length
                ? "All rounds played."
                : "Let's get your trip set up."}
        </p>
        <Link className="org-view" href={href("/")}>
          See the site as followers do
        </Link>
      </section>

      {!data.env.ai && <p className="notice">The AI writer is off until ANTHROPIC_API_KEY is added in Vercel.</p>}

      {data.needEmail && <KeepSafe data={data} />}

      <SetupResume jobs={t.setup_jobs ?? []} />

      <section className={`next-up${todo.length ? "" : " calm"}`} aria-label="Next up">
        <h2>Next up</h2>
        {todo.length === 0 ? (
          <p>Nothing needs doing right now.</p>
        ) : (
          <ul>
            {todo.slice(0, 2).map((x) => (
              <li key={x.text}>
                <span>{x.text}</span>
                {x.external ? (
                  <Link className="btn" href={x.to}>
                    {x.action}
                  </Link>
                ) : (
                  <a className="btn" href={x.to}>
                    {x.action}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <nav className="org-tiles" aria-label="Organiser sections">
        <Link href={href("/setup")} className="org-tile org-tile-setup">
          <strong>Tournament setup</strong>
          <span>Players, rounds, how it&apos;s won, groups and prizes</span>
        </Link>
        {tiles.map(([id, status]) => (
          <a key={id} href={`#${id}`} className={`org-tile org-tile-${id}${(id === "write" && drafts.length) || (id === "players" && noWay.length) ? " attn" : ""}`}>
            <strong>{SECTIONS[id]}</strong>
            <span>{status}</span>
          </a>
        ))}
      </nav>

      <p className="org-foot">
        <a href="#settings">Settings and test data</a>
      </p>
    </div>
  );
}

/**
 * Run from this phone without an email yet (the old organiser PIN, or this phone made it): keep it safe with an email,
 * so it can be run from any phone. Signed in already: one tap adds it. Not yet: sign in first, then come back here.
 */
function KeepSafe({ data }: { data: AdminData }) {
  const { href, reloadSession } = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const email = data.accountEmail;
  return (
    <section className="next-up keep-safe" aria-label="Keep it safe">
      <h2>Keep it safe</h2>
      <p>{email ? `Add this tournament to your email, ${email}, so you can run it from any phone.` : "Add your email, so you can run this tournament from any phone. You'll sign in with it from now on."}</p>
      {err && <p className="error">{err}</p>}
      {email ? (
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await fetch("/api/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "claim", tournament: data.state.tournament.id }) }).catch(() => null);
            setBusy(false);
            if (!r?.ok) return setErr((await r?.json().catch(() => ({})))?.error ?? "That didn't work. Try again.");
            await reloadSession();
            window.location.reload();
          }}
        >
          Add it to {email}
        </button>
      ) : (
        <Link className="btn" href={`/account?next=${encodeURIComponent(href("/admin"))}`}>
          Add my email
        </Link>
      )}
    </section>
  );
}

/** The end-of-tournament film: made from its own page; the studio for changes. */
function FilmCard({ data }: { data: AdminData }) {
  const { href } = useT();
  const st = data.state;
  const unlock = filmUnlock(st);
  const made = st.posts.filter((p) => p.author_name === "AI director");
  return (
    <section className="panel stack">
      <h2>The film</h2>
      {made.length ? (
        <p>Your film is in Highlights. Share it, change something in the film studio, or make another version.</p>
      ) : unlock.ok ? (
        <p>The tournament is over: everything&apos;s ready for the film.</p>
      ) : (
        <>
          <p>One film of the whole tournament, made once it&apos;s over. Still to do:</p>
          <ul>
            {unlock.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </>
      )}
      <Link className="btn block" href={href("/film")}>
        {made.length ? "See the film" : unlock.ok ? "Make the film" : "About the film"}
      </Link>
    </section>
  );
}

/** Still getting ready after the setup wizard (course guides, the first preview): carries on here, quietly. */
function SetupResume({ jobs: initial }: { jobs: SetupJob[] }) {
  const { api, href } = useT();
  const [jobs, setJobs] = useState(initial);
  const left = jobs.filter((j) => j.status === "todo").length;
  const pending = initial.some((j) => j.status === "todo");
  useEffect(() => {
    if (!pending) return;
    let stop = false;
    (async () => {
      for (let n = 0; n < 40 && !stop; n++) {
        const r = await api("/api/setup", {});
        if (!r.ok) break;
        const list = (r.j.jobs as SetupJob[]) ?? [];
        if (!stop) setJobs(list);
        if (!list.some((j) => j.status === "todo")) break;
        if (r.j.busy) await new Promise((res) => setTimeout(res, 5000));
      }
    })();
    return () => {
      stop = true;
    };
  }, [pending, api]);
  if (!pending) return null;
  const done = jobs.length - left;
  return (
    <p className="notice">
      {left ? `Still reading up on the courses: ${done} of ${jobs.length} done. ` : "All set: the course guides are in. "}
      <Link href={href("/ready")}>{left ? "Watch it" : "See what was found"}</Link>
    </p>
  );
}

const short = (name: string) => name.replace(/\s+(golf (club|course|links)|gc|resort|hotel.*|estate)$/i, "");
const listNames = (n: string[]) => (n.length <= 2 ? n.join(" and ") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`);

// ------------------------------------------------------------ posts and photos

function Moderate({ data, onSaved }: { data: AdminData; onSaved: () => void }) {
  const { api } = useT();
  async function hide(table: "posts" | "comments", id: string, hidden: boolean) {
    await api("/api/admin", { action: "hide", table, id, hidden });
    onSaved();
  }
  async function block(fanId: string, blocked: boolean) {
    await api("/api/admin", { action: "blockFan", fanId, blocked });
    onSaved();
  }
  const fans = new Map((data.fans ?? []).map((f) => [f.id, f]));
  const review = [
    ...data.state.posts.filter((p) => p.hidden && p.hidden_by_reports).map((p) => ({ table: "posts" as const, id: p.id, who: p.author_name, body: p.body, at: p.created_at, fanId: p.fan_id })),
    ...data.state.comments.filter((c) => c.hidden && c.hidden_by_reports).map((c) => ({ table: "comments" as const, id: c.id, who: c.author_name, body: c.body, at: c.created_at, fanId: c.fan_id })),
  ];
  const FanTools = ({ fanId }: { fanId?: string | null }) => {
    const f = fanId ? fans.get(fanId) : null;
    if (!f) return null;
    return (
      <button className="chip" onClick={() => block(f.id, !f.blocked)}>
        {f.blocked ? `Let ${f.name} post again` : `Stop ${f.name} posting`}
      </button>
    );
  };
  return (
    <div className="stack">
      {review.length > 0 && (
        <section className="panel stack" style={{ borderColor: "var(--red)" }}>
          <h2 style={{ margin: 0 }}>Needs a look</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Three people reported these, so they were hidden. Put each one back, or keep it hidden.
          </p>
          {review.map((r) => (
            <div key={r.id} className="post">
              <div className="who display">
                {r.who}
                {r.fanId ? " (fan)" : ""}, {r.table === "comments" ? "comment, " : ""}
                {timeAgo(r.at)}
              </div>
              {r.body && <p style={{ margin: "4px 0" }}>{r.body}</p>}
              <div className="row">
                <button className="chip" onClick={() => hide(r.table, r.id, false)}>
                  Put it back
                </button>
                <button className="chip" onClick={() => hide(r.table, r.id, true)}>
                  Keep hidden
                </button>
                <FanTools fanId={r.fanId} />
              </div>
            </div>
          ))}
        </section>
      )}
      <div className="grid2">
        <section className="stack">
          <h2>Posts</h2>
          {data.state.posts.length === 0 && <p className="muted">No posts yet.</p>}
          {data.state.posts.map((p) => (
            <div key={p.id} className="post">
              <div className="who display">
                {p.author_name}
                {p.fan_id ? " (fan)" : ""}, {p.hole ? `hole ${p.hole}, ` : ""}
                {timeAgo(p.created_at)}
                {p.visibility === "report" && <span className="report-only">, film only</span>}
                {p.hidden && <span className="error">, hidden</span>}
              </div>
              {p.body && <p style={{ margin: "4px 0" }}>{p.body}</p>}
              <div className="row">
                <button className="chip" onClick={() => hide("posts", p.id, !p.hidden)}>
                  {p.hidden ? "Show" : "Hide"}
                </button>
                <FanTools fanId={p.fan_id} />
              </div>
            </div>
          ))}
        </section>
        <section className="stack">
          <h2>Comments</h2>
          {data.state.comments.length === 0 && <p className="muted">No comments yet.</p>}
          {data.state.comments.map((c) => (
            <div key={c.id} className="post">
              <div className="who display">
                {c.author_name}
                {c.fan_id ? " (fan)" : ""}, {timeAgo(c.created_at)}
                {c.hidden && <span className="error">, hidden</span>}
              </div>
              <p style={{ margin: "4px 0" }}>{c.body}</p>
              <div className="row">
                <button className="chip" onClick={() => hide("comments", c.id, !c.hidden)}>
                  {c.hidden ? "Show" : "Hide"}
                </button>
                <FanTools fanId={c.fan_id} />
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
