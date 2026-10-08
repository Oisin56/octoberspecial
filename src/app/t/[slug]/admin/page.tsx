"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/components/Providers";
import { Loading, timeAgo } from "@/components/ui";
import {
  BasicsEditor,
  ContentEditor,
  InviteEditor,
  PlayersEditor,
  ResetTestData,
  RoundsEditor,
  SideGamesEditor,
  useAdmin,
  type AdminData,
} from "@/components/editors";
import { ReelBuilder } from "@/components/ReelBuilder";
import { DirectorPanel } from "@/components/DirectorPanel";
import { EmailTab, useSubscribers } from "@/components/EmailAdmin";
import { Writer, WRITE_TYPES, type WriteType } from "@/components/Writer";
import { useCountdown } from "@/components/visual";
import { THEMES, TONE_LABEL } from "@/lib/types";

const SECTIONS = {
  rounds: "Rounds and courses",
  players: "Players and PINs",
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
        <Link href={href(`/login?next=${encodeURIComponent(href("/admin"))}`)}>Log in</Link> as organiser.
      </p>
    );
  if (session.role !== "organiser") return <p>Organiser only.</p>;
  if (err) return <p className="error">{err}</p>;
  if (!data) return <Loading />;

  const s = route.section;
  if (!s) return <OrganiserHome data={data} />;

  return (
    <div className="stack org-section">
      <button className="back-home" onClick={home}>
        <span aria-hidden>←</span> Organiser home
      </button>
      <h1>{SECTIONS[s]}</h1>
      {s === "rounds" && <RoundsEditor data={data} onSaved={reload} />}
      {s === "players" && <PlayersEditor data={data} onSaved={reload} />}
      {s === "write" && <Writer key={`${route.type}-${route.roundId}`} data={data} onSaved={reload} start={{ type: route.type, roundId: route.roundId }} />}
      {s === "email" && <EmailTab />}
      {s === "film" && (
        <>
          <DirectorPanel />
          <ReelBuilder />
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
      {s === "share" && <InviteEditor data={data} onSaved={reload} />}
      {s === "settings" && (
        <>
          <section className="panel stack">
            <h2>Setup checklist</h2>
            <p style={{ margin: 0 }}>Going through it all again from the start? The step-by-step setup walks you through every part in order.</p>
            <div>
              <Link className="btn secondary" href={href("/setup")}>
                Open step-by-step setup
              </Link>
            </div>
          </section>
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
  const noPin = st.players.filter((p) => !data.pinSet[p.id]);
  const complete = rounds.filter((r) => r.status === "complete");

  // What needs doing, most urgent first. Only the top two are shown.
  const todo: { text: string; action: string; to: string; external?: boolean }[] = [];
  if (rounds.length === 0) todo.push({ text: "Add the courses you're playing.", action: "Add a round", to: "#rounds" });
  if (st.players.length < 2) todo.push({ text: "Add the players.", action: "Add players", to: "#players" });
  if (live) todo.push({ text: `Round ${live.number} at ${live.course_name} is under way.`, action: "Enter scores", to: href(`/score?round=${live.number}`), external: true });
  const lastDone = complete[complete.length - 1];
  if (lastDone && !pieces.some((p) => p.kind === "report" && p.round_id === lastDone.id && p.status === "published")) {
    const d = drafts.find((p) => p.kind === "report" && p.round_id === lastDone.id);
    todo.push(
      d
        ? { text: `The round ${lastDone.number} report is written and waiting for you.`, action: "Read and publish", to: "#write" }
        : { text: `Round ${lastDone.number} is finished. Nobody has written it up yet.`, action: "Write the report", to: `#write/report/${lastDone.id}` },
    );
  }
  if (next && !live && !pieces.some((p) => p.kind === "preview" && p.round_id === next.id))
    todo.push({ text: `No preview yet for round ${next.number} at ${next.course_name}.`, action: "Write the preview", to: `#write/preview/${next.id}` });
  if (drafts.length && !todo.some((x) => x.to === "#write"))
    todo.push({ text: `${drafts.length} ${drafts.length === 1 ? "draft is" : "drafts are"} waiting to be read.`, action: "Read them", to: "#write" });
  if (noPin.length) todo.push({ text: `${listNames(noPin.map((p) => p.name))} ${noPin.length === 1 ? "has" : "have"} no PIN yet, so can't log in.`, action: "Set PINs", to: "#players" });
  if (!t.published && rounds.length && st.players.length >= 2) todo.push({ text: "The site isn't public yet.", action: "Share it", to: "#share" });

  const theme = THEMES.find((x) => x.id === t.theme)?.name ?? "Custom";
  const tone = TONE_LABEL[t.tone]?.split(":")[0] ?? "";
  const posts = st.posts.length;
  const clips = st.posts.filter((p) => p.kind === "video").length;
  const sides = (t.side_games ?? []).filter((g) => g.enabled !== false).length;

  const tiles: [Section, string][] = [
    ["rounds", rounds.length ? `${rounds.length} round${rounds.length === 1 ? "" : "s"}${next ? `, next at ${short(next.course_name)}` : ""}` : "None yet"],
    ["players", st.players.length ? `${st.players.length} players${noPin.length ? `, ${noPin.length} without a PIN` : ", all with PINs"}` : "None yet"],
    ["write", drafts.length ? `${drafts.length} draft${drafts.length === 1 ? "" : "s"} waiting` : published.length ? `${published.length} published` : "Previews and reports"],
    ["email", !subs.list ? "" : !subs.configured ? "Not switched on yet" : `${subs.active} ${subs.active === 1 ? "person" : "people"} signed up`],
    ["film", clips ? `${clips} clip${clips === 1 ? "" : "s"} so far` : "Build a recap film"],
    ["posts", posts ? `${posts} post${posts === 1 ? "" : "s"}, ${st.comments.length} comment${st.comments.length === 1 ? "" : "s"}` : "Nothing posted yet"],
    ["sides", sides ? `${sides} running` : "Closest the pin and more"],
    ["look", `${theme}, ${tone.toLowerCase()} tone`],
    ["share", t.published ? "Public" : "Not public yet"],
  ];

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
        {tiles.map(([id, status]) => (
          <a key={id} href={`#${id}`} className={`org-tile org-tile-${id}${(id === "write" && drafts.length) || (id === "players" && noPin.length) ? " attn" : ""}`}>
            <strong>{SECTIONS[id]}</strong>
            <span>{status}</span>
          </a>
        ))}
      </nav>

      <p className="org-foot">
        <Link href={href("/setup")}>Step-by-step setup</Link>
        <a href="#settings">Settings and test data</a>
      </p>
    </div>
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
  return (
    <div className="grid2">
      <section className="stack">
        <h2>Posts</h2>
        {data.state.posts.length === 0 && <p className="muted">No posts yet.</p>}
        {data.state.posts.map((p) => (
          <div key={p.id} className="post">
            <div className="who display">
              {p.author_name}, {p.hole ? `hole ${p.hole}, ` : ""}
              {timeAgo(p.created_at)}
              {p.visibility === "report" && <span className="report-only">, report only</span>}
              {p.hidden && <span className="error">, hidden</span>}
            </div>
            {p.body && <p style={{ margin: "4px 0" }}>{p.body}</p>}
            <button className="chip" onClick={() => hide("posts", p.id, !p.hidden)}>
              {p.hidden ? "Show" : "Hide"}
            </button>
          </div>
        ))}
      </section>
      <section className="stack">
        <h2>Comments</h2>
        {data.state.comments.length === 0 && <p className="muted">No comments yet.</p>}
        {data.state.comments.map((c) => (
          <div key={c.id} className="post">
            <div className="who display">
              {c.author_name}, {timeAgo(c.created_at)}
              {c.hidden && <span className="error">, hidden</span>}
            </div>
            <p style={{ margin: "4px 0" }}>{c.body}</p>
            <button className="chip" onClick={() => hide("comments", c.id, !c.hidden)}>
              {c.hidden ? "Show" : "Hide"}
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
