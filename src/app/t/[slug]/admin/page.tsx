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
import { THEMES, TONE_LABEL, toRoundCfg } from "@/lib/types";
import { cardInfo } from "@/lib/scorecards";
import { CardsAdmin } from "@/components/CardsAdmin";
import { BroadcastSettings } from "@/components/BroadcastSettings";

const SECTIONS = {
  rounds: "Rounds and courses",
  cards: "Scorecards",
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
      {s === "cards" && <CardsAdmin data={data} onSaved={reload} />}
      {s === "players" && <PlayersEditor data={data} onSaved={reload} />}
      {s === "write" && <Writer key={`${route.type}-${route.roundId}`} data={data} onSaved={reload} start={{ type: route.type, roundId: route.roundId }} />}
      {s === "email" && <EmailTab />}
      {s === "film" && (
        <>
          <BroadcastSettings />
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
  const cardStates = rounds
    .filter((r) => r.status !== "upcoming")
    .flatMap((r) => toRoundCfg(r, st.players).games.map((g) => ({ round: r, info: cardInfo(st, r.id, g.id) })));
  const waiting = cardStates.filter((c) => c.info.stage === "finished" || c.info.stage === "submitted");
  const flagged = cardStates.filter((c) => c.info.flag && c.info.stage === "submitted");

  // What needs doing, most urgent first. Only the top two are shown.
  const todo: { text: string; action: string; to: string; external?: boolean }[] = [];
  if (rounds.length === 0) todo.push({ text: "Add the courses you're playing.", action: "Add a round", to: "#rounds" });
  if (st.players.length < 2) todo.push({ text: "Add the players.", action: "Add players", to: "#players" });
  if (flagged.length) todo.push({ text: `${flagged[0].info.flag!.by} says something's not right on a round ${flagged[0].round.number} card.`, action: "Check the cards", to: "#cards" });
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
  if (noPin.length) todo.push({ text: `${listNames(noPin.map((p) => p.name))} can't log in yet. Send each player their link (or set a PIN).`, action: "Send links", to: "#players" });
  if (!t.published && rounds.length && st.players.length >= 2) todo.push({ text: "The site isn't public yet.", action: "Share it", to: "#share" });

  const theme = THEMES.find((x) => x.id === t.theme)?.name ?? "Custom";
  const tone = TONE_LABEL[t.tone]?.split(":")[0] ?? "";
  const posts = st.posts.length;
  const clips = st.posts.filter((p) => p.kind === "video").length;
  const sides = (t.side_games ?? []).filter((g) => g.enabled !== false).length;

  const tiles: [Section, string][] = [
    ["rounds", rounds.length ? `${rounds.length} round${rounds.length === 1 ? "" : "s"}${next ? `, next at ${short(next.course_name)}` : ""}` : "None yet"],
    ["cards", waiting.length ? `${waiting.length} card${waiting.length === 1 ? "" : "s"} not final yet` : cardStates.length ? "All final" : st.tournament.require_attestation ? "Players sign their cards" : "Final when submitted"],
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

      <AccountLink slug={t.slug} />

      <p className="org-foot">
        <Link href={href("/setup")}>Step-by-step setup</Link>
        <a href="#settings">Settings and test data</a>
      </p>
    </div>
  );
}

/** My tournaments: this tournament in the organiser's email account (one tap once signed in) */
function AccountLink({ slug }: { slug: string }) {
  const [acct, setAcct] = useState<{ account: { email: string } | null; tournaments: { slug: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/account", { cache: "no-store" })
      .then((r) => r.json())
      .then(setAcct)
      .catch(() => {});
  }, []);
  if (!acct) return null;
  if (!acct.account)
    return (
      <p className="org-acct">
        <Link href={`/account?add=${encodeURIComponent(slug)}`}>Sign in with your email</Link> to keep all your tournaments in one place, on any device.
      </p>
    );
  if (acct.tournaments.some((x) => x.slug === slug))
    return (
      <p className="org-acct">
        In <Link href="/account">My tournaments</Link> ({acct.account.email}).
      </p>
    );
  return (
    <p className="org-acct">
      <button
        className="btn secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await fetch("/api/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "link", t: slug }) });
          const j = await r.json().catch(() => ({}));
          setBusy(false);
          if (r.ok) setAcct((a) => (a ? { ...a, tournaments: j.tournaments } : a));
        }}
      >
        Add to My tournaments
      </button>
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
