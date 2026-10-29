import "server-only";
import { adminClient } from "../admin";
import { loadServerState } from "../server-data";
import { toEntries, toTournamentCfg, type TournamentRow } from "../types";
import { tournamentSummary } from "../engine";
import { totalsView } from "../live";
import { winBoard } from "../boards";
import { fill, paragraphs, wordsFor, type Words, type WordsDef } from "./words";
import { compose, type Look, type Piece } from "./design";
import { BRAND_LOOK, BRAND_FROM, firstName, listFooter, oneTap, supportReplyTo, tournamentLook } from "./emails";
import { deliverMany, newSendId, type Outgoing } from "./send";
import { tapLink } from "./tokens";
import { dublinToday, marketingGate } from "./limits";
import type { Stream } from "./postmark";

/**
 * The series: short runs of emails that go on their own when something happens. All start switched off; the owner
 * reads them in the console, changes what they like and switches each on. A step goes at 10am (Irish time) on its day,
 * or straight away for "straight after setup". Each goes once per person (per tournament), and a later step only to
 * people who had the first, so switching a series on part-way never sends half a run.
 */

export type From = "setup" | "round1" | "lastRound" | "idle";
export type SeriesKey = "welcome" | "owntrip" | "friends" | "anniversary" | "comeback";

export interface StepCfg {
  id: string;
  from: From;
  days: number;
  on: boolean;
  /** Built-in: only when no player links have gone */
  condition?: "noLinks" | null;
}

export interface SeriesDef {
  key: SeriesKey;
  name: string;
  about: string;
  stream: Stream;
  /** Which choice on the preferences page turns it off */
  pref: "tips" | "tripNews";
  /** When steps can go (an added step picks one) */
  froms: From[];
  placeholders: string[];
  look: "tournament" | "brand";
  /** Where the button goes */
  target: string;
  steps: (StepCfg & { words: WordsDef["words"] })[];
  mayBeEmpty?: boolean;
}

const TIPS_WHY = (t: string) => `You're getting this because you're organising ${t} on MyGolfBroadcast.`;
const NEWS_WHY = "You're getting this because you asked for news from MyGolfBroadcast.";

export const SERIES: SeriesDef[] = [
  {
    key: "welcome",
    name: "Welcome, for new organisers",
    about: "Tips while they set up a group trip (not a round on their own). It's about the service they're using, so it doesn't need the marketing tick, but they can turn it off (Tips for my tournament).",
    stream: "updates",
    pref: "tips",
    froms: ["setup", "round1"],
    placeholders: ["tournament", "first name"],
    look: "tournament",
    target: "admin",
    steps: [
      {
        id: "ready",
        from: "setup",
        days: 0,
        on: true,
        words: {
          subject: "{tournament} is ready to share",
          headline: "Your site is live",
          lines: "Three things before the first tee: send the players their links, share the follow link with family and friends, and check the rounds are right.",
          button: "Open my tournament",
        },
      },
      {
        id: "links",
        from: "setup",
        days: 2,
        on: true,
        condition: "noLinks",
        words: {
          subject: "Send your players their links",
          headline: "Send your players their links",
          lines: "Each player gets their own link to keep score and post photos. It takes a minute from the Players page, by email or WhatsApp.",
          button: "Send the links",
        },
      },
      {
        id: "countdown",
        from: "round1",
        days: 3,
        on: true,
        words: {
          subject: "Three days to go",
          headline: "Three days to go",
          lines: "A short checklist: everyone has their link, tee times are in, and each group knows anyone in it can enter the scores on their own phone.",
          button: "Check everything",
        },
      },
    ],
  },
  {
    key: "owntrip",
    name: "Your own trip, for players and followers",
    about: "Two weeks after a trip they played in or followed. Only to people with the marketing tick, never to someone who already runs a tournament, and at most once a year.",
    stream: "marketing",
    pref: "tripNews",
    froms: ["lastRound"],
    placeholders: ["tournament", "first name"],
    look: "brand",
    target: "invite",
    steps: [
      {
        id: "invite",
        from: "lastRound",
        days: 14,
        on: true,
        words: {
          subject: "Fancy running your own trip?",
          headline: "Fancy running your own trip?",
          lines:
            "{tournament} was covered on MyGolfBroadcast. If you organise a society day or a trip of your own, you can have the same: live scores, a leaderboard for the folks at home, and a highlights film at the end.",
          button: "Ask to run a tournament",
        },
      },
    ],
  },
  {
    key: "friends",
    name: "Bring your friends, for golfers on their own",
    about: "Two weeks after a round recorded on their own. Only to people with the marketing tick, never to someone who already runs a group trip, and at most once a year.",
    stream: "marketing",
    pref: "tripNews",
    froms: ["lastRound"],
    placeholders: ["first name", "course"],
    look: "brand",
    target: "new",
    steps: [
      {
        id: "invite",
        from: "lastRound",
        days: 14,
        on: true,
        words: {
          subject: "Bring your friends next time",
          headline: "Bring your friends next time",
          lines: "Next time, bring the group. Live scores for everyone, a leaderboard for the people at home, and one film of the whole trip.",
          button: "Set up a trip",
        },
      },
    ],
  },
  {
    key: "anniversary",
    name: "A year ago today, for everyone on the trip",
    about: "On the anniversary of the last round, to the players and organisers with the marketing tick. Only for group trips with a film and a clear winner (never a round on your own). The organiser's email also has a small link to set up this year's trip.",
    stream: "marketing",
    pref: "tripNews",
    froms: ["lastRound"],
    placeholders: ["tournament", "winner", "course", "first name"],
    look: "tournament",
    target: "film",
    steps: [
      {
        id: "year",
        from: "lastRound",
        days: 365,
        on: true,
        words: {
          subject: "A year ago today: {tournament}",
          headline: "A year ago today",
          lines: "{winner} lifted the trophy at {course} a year ago today. The film and the final leaderboard are still there. Going again this year?",
          button: "Watch the film",
        },
      },
    ],
  },
  {
    key: "comeback",
    name: "Come back, for people who've gone quiet",
    about: "To an organiser with the marketing tick, 12 months after their last tournament finished, if they haven't started another. Sent once. Write what's new before switching it on: nothing gets made up.",
    stream: "marketing",
    pref: "tripNews",
    froms: ["idle"],
    placeholders: ["first name"],
    look: "brand",
    target: "new",
    mayBeEmpty: true,
    steps: [
      { id: "news", from: "idle", days: 365, on: true, words: { subject: "What's new at MyGolfBroadcast", headline: "What's new at MyGolfBroadcast", lines: "", button: "Start a new tournament" } },
    ],
  },
];

export const seriesDef = (key: string) => SERIES.find((s) => s.key === key) ?? null;

export const stepKey = (series: string, step: string) => `series:${series}:${step}`;

/** The words definition for a step (built-in steps have starting words; added ones start empty). */
export function stepWords(s: SeriesDef, stepId: string): WordsDef {
  const built = s.steps.find((x) => x.id === stepId);
  return {
    key: stepKey(s.key, stepId),
    name: s.name,
    about: s.about,
    group: "series",
    stream: s.stream,
    words: built?.words ?? { subject: "", headline: "", lines: "", button: s.steps[0].words.button },
    placeholders: s.placeholders,
    locked: s.stream === "marketing" ? "Locked: the link and the footer (why it came, the address, change what you get, stop these)." : "Locked: the link and the footer.",
    sample: { tournament: "Kinsale Spring Classic", "first name": "Neil", winner: "Neil Byrne", course: "Old Head" },
    mayBeEmpty: s.mayBeEmpty,
  };
}

/** "Straight after setup", "2 days after setup", "3 days before round 1"… */
export function whenWords(st: Pick<StepCfg, "from" | "days">): string {
  const d = st.days;
  const n = (x: number, unit = "day") => `${x} ${unit}${x === 1 ? "" : "s"}`;
  if (st.from === "setup") return d === 0 ? "Straight after setup" : `${n(d)} after setup`;
  if (st.from === "round1") return d === 0 ? "On the day of round 1" : `${n(d)} before round 1`;
  if (st.from === "lastRound") return d === 365 ? "A year after the last round" : d % 7 === 0 && d < 70 ? `${n(d / 7, "week")} after the last round` : `${n(d)} after the last round`;
  return d % 365 === 0 ? `${n(d / 365, "year")} after their last tournament` : d % 30 === 0 ? `${n(d / 30, "month")} after their last tournament` : `${n(d)} after their last tournament`;
}

export interface SeriesState {
  key: SeriesKey;
  enabled: boolean;
  steps: StepCfg[];
  updated_at: string | null;
  updated_by: string | null;
}

export async function seriesState(key: SeriesKey): Promise<SeriesState> {
  const def = seriesDef(key)!;
  const { data } = await adminClient().from("email_series").select("*").eq("key", key).maybeSingle().then((r) => r, () => ({ data: null }));
  const steps = Array.isArray(data?.steps) && data.steps.length ? (data.steps as StepCfg[]) : def.steps.map(({ words: _w, ...s }) => (void _w, s));
  return { key, enabled: !!data?.enabled, steps, updated_at: data?.updated_at ?? null, updated_by: data?.updated_by ?? null };
}

/** Why a series can't be switched on yet (empty words), or null. */
export async function readyToSwitchOn(key: SeriesKey): Promise<string | null> {
  const def = seriesDef(key)!;
  const st = await seriesState(key);
  for (const step of st.steps.filter((s) => s.on)) {
    const w = await wordsFor(stepWords(def, step.id));
    if (!w.subject.trim() || !w.lines.trim()) return `Write the words for "${whenWords(step)}" first`;
  }
  return null;
}

// ------------------------------------------------------------ who gets each step

interface Candidate {
  email: string;
  name: string | null;
  tournament: Pick<TournamentRow, "id" | "name" | "slug" | "theme" | "custom_colors">;
  vars: Record<string, string>;
  organiser: boolean;
  film?: string | null;
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export async function organisersOf(tids: string[]): Promise<Map<string, { email: string; name: string | null }[]>> {
  const db = adminClient();
  const out = new Map<string, { email: string; name: string | null }[]>();
  if (!tids.length) return out;
  const { data: rows } = await db.from("account_tournaments").select("tournament_id,account_id").in("tournament_id", tids).eq("role", "organiser");
  const ids = [...new Set((rows ?? []).map((r) => r.account_id))];
  const { data: accts } = ids.length ? await db.from("accounts").select("id,email,name").in("id", ids) : { data: [] };
  for (const r of rows ?? []) {
    const a = (accts ?? []).find((x) => x.id === r.account_id);
    if (a?.email) out.set(r.tournament_id, [...(out.get(r.tournament_id) ?? []), { email: String(a.email).toLowerCase(), name: a.name ?? null }]);
  }
  return out;
}

/** Of these emails, the people who organise a group trip (not just rounds on their own) */
async function groupOrganisers(emails: string[]): Promise<Set<string>> {
  const db = adminClient();
  const out = new Set<string>();
  for (let i = 0; i < emails.length; i += 200) {
    const { data: accts } = await db.from("accounts").select("id,email").in("email", emails.slice(i, i + 200));
    const ids = (accts ?? []).map((a) => a.id);
    if (!ids.length) continue;
    const { data: rows } = await db.from("account_tournaments").select("account_id,tournament_id").in("account_id", ids).eq("role", "organiser");
    const tids = [...new Set((rows ?? []).map((r) => r.tournament_id))];
    const { data: ts } = tids.length ? await db.from("tournaments").select("id").in("id", tids).eq("solo", false) : { data: [] };
    const group = new Set((ts ?? []).map((t) => t.id));
    for (const r of rows ?? []) if (group.has(r.tournament_id)) out.add(String((accts ?? []).find((a) => a.id === r.account_id)?.email).toLowerCase());
  }
  return out;
}

const T_COLS = "id,name,slug,theme,custom_colors,created_at,solo";

/** Tournaments by when they were set up, their first round or their last */
async function tournamentsFor(step: StepCfg, today: string) {
  const db = adminClient();
  if (step.from === "setup") {
    // Due today, or up to two days late (an organiser who confirmed their email after setup)
    const from = new Date(`${addDays(today, -step.days - 2)}T00:00:00Z`).toISOString();
    const to = new Date(`${addDays(today, -step.days + 1)}T00:00:00Z`).toISOString();
    const { data } = await db.from("tournaments").select(T_COLS).gte("created_at", from).lt("created_at", to).limit(2000);
    return data ?? [];
  }
  const col = step.from === "round1" ? "first_day" : "last_day";
  const due = step.from === "round1" ? addDays(today, step.days) : addDays(today, -step.days);
  // A day's grace either way: a missed morning run still sends it the next day
  const lo = step.from === "round1" ? due : addDays(due, -1);
  const hi = step.from === "round1" ? addDays(due, 1) : due;
  const { data: stats } = await db.from("tournament_stats").select(`tournament_id,${col}`).gte(col, lo).lte(col, hi).limit(2000);
  const ids = (stats ?? []).map((s) => s.tournament_id);
  if (!ids.length) return [];
  const { data } = await db.from("tournaments").select(T_COLS).in("id", ids);
  return data ?? [];
}

/** The people on a trip: players with an email, followers with a confirmed one, people signed up for its updates */
async function tripPeople(tid: string): Promise<{ email: string; name: string | null }[]> {
  const db = adminClient();
  const [players, fans, subs] = await Promise.all([
    db.from("players").select("email,name").eq("tournament_id", tid).not("email", "is", null),
    db.from("fans").select("email,name").eq("tournament_id", tid).eq("status", "approved").eq("blocked", false).not("email", "is", null).not("verified_at", "is", null),
    db.from("subscribers").select("email,name").eq("tournament_id", tid).is("unsubscribed_at", null),
  ]);
  const out = new Map<string, { email: string; name: string | null }>();
  for (const r of [...(players.data ?? []), ...(fans.data ?? []), ...(subs.data ?? [])]) {
    const e = String(r.email).toLowerCase();
    if (!out.has(e)) out.set(e, { email: e, name: r.name ?? null });
  }
  return [...out.values()];
}

/** The winner's name, when the tournament is over and there's exactly one */
export async function winnerOf(tid: string): Promise<string | null> {
  const s = await loadServerState(tid);
  const cfg = toTournamentCfg(s);
  const summary = tournamentSummary(cfg, toEntries(s.entries));
  if (!summary.complete) return null;
  const wb = winBoard(s, summary, cfg);
  if (wb?.kind === "knockout") return wb.champion;
  const firstOf = (rows: { name: string; pos?: string }[]) => {
    const top = rows.filter((r) => r.pos === "1");
    return top.length === 1 ? top[0].name : null;
  };
  if (wb) return firstOf(wb.rows as { name: string; pos?: string }[]);
  const totals = totalsView(s, summary);
  if (totals) return firstOf(totals.rows);
  const teamMode = cfg.teams.length >= 2;
  const rows = teamMode ? cfg.teams.map((t) => ({ name: t.name, v: summary.teamTotal[t.id] ?? 0 })) : cfg.players.map((p) => ({ name: p.name, v: summary.playerTotal[p.id] ?? 0 }));
  const best = Math.max(...rows.map((r) => r.v));
  const top = rows.filter((r) => r.v === best);
  return top.length === 1 && best > 0 ? top[0].name : null;
}

async function candidates(def: SeriesDef, step: StepCfg, today: string, site: string): Promise<Candidate[]> {
  const db = adminClient();
  const out: Candidate[] = [];
  if (def.key === "comeback") {
    // Organisers whose newest tournament finished this many days ago (a few days' grace), and nothing newer since
    const due = addDays(today, -step.days);
    const { data: stats } = await db.from("tournament_stats").select("tournament_id,last_day").gte("last_day", addDays(due, -3)).lte("last_day", due).limit(2000);
    const ts = (stats ?? []).map((s) => s.tournament_id);
    if (!ts.length) return out;
    const { data: tours } = await db.from("tournaments").select(T_COLS).in("id", ts);
    const orgs = await organisersOf(ts);
    for (const t of tours ?? []) {
      for (const o of orgs.get(t.id) ?? []) {
        // Anything they've organised since?
        const { data: acct } = await db.from("accounts").select("id").eq("email", o.email).maybeSingle();
        if (!acct) continue;
        const { data: mine } = await db.from("account_tournaments").select("tournament_id").eq("account_id", acct.id).eq("role", "organiser");
        const others = (mine ?? []).map((m) => m.tournament_id).filter((id) => id !== t.id);
        if (others.length) {
          const { data: newer } = await db.from("tournaments").select("id").in("id", others).gt("created_at", t.created_at).limit(1);
          if (newer?.length) continue;
        }
        out.push({ email: o.email, name: o.name, tournament: t, vars: { "first name": firstName(o.name) }, organiser: true });
      }
    }
    return out;
  }

  // A round on your own: no setup tips or anniversary (that's for group trips); "Bring your friends" only for these
  const tours = (await tournamentsFor(step, today)).filter((t) => (def.key === "friends" ? !!t.solo : !(t.solo && (def.key === "welcome" || def.key === "anniversary"))));
  if (!tours.length) return out;
  const orgs = await organisersOf(tours.map((t) => t.id));
  for (const t of tours) {
    const organisers = orgs.get(t.id) ?? [];
    if (def.key === "welcome") {
      // Tips for setting up are no use once the trip has started
      if (step.from === "setup") {
        const { data: ts } = await db.from("tournament_stats").select("first_day").eq("tournament_id", t.id).maybeSingle();
        if (ts?.first_day && ts.first_day < today) continue;
      }
      if (step.condition === "noLinks") {
        const { count } = await db.from("players").select("id", { count: "exact", head: true }).eq("tournament_id", t.id).not("link_code", "is", null);
        if ((count ?? 0) > 0) continue;
      }
      for (const o of organisers) out.push({ email: o.email, name: o.name, tournament: t, vars: { tournament: t.name, "first name": firstName(o.name) }, organiser: true });
    } else if (def.key === "friends") {
      const { data: last } = await db.from("rounds").select("course_name").eq("tournament_id", t.id).order("number", { ascending: false }).limit(1).maybeSingle();
      for (const o of organisers) out.push({ email: o.email, name: o.name, tournament: t, vars: { "first name": firstName(o.name), course: last?.course_name ?? "" }, organiser: true });
    } else if (def.key === "owntrip") {
      for (const p of await tripPeople(t.id)) out.push({ email: p.email, name: p.name, tournament: t, vars: { tournament: t.name, "first name": firstName(p.name) }, organiser: false });
    } else if (def.key === "anniversary") {
      const { data: reel } = await db.from("reels").select("id").eq("tournament_id", t.id).eq("status", "done").order("done_at", { ascending: false }).limit(1).maybeSingle();
      if (!reel) continue;
      const winner = await winnerOf(t.id).catch(() => null);
      if (!winner) continue;
      const { data: rounds } = await db.from("rounds").select("course_name,number").eq("tournament_id", t.id).order("number", { ascending: false }).limit(1);
      const course = rounds?.[0]?.course_name ?? "";
      const film = `${site}/t/${t.slug}/film?reel=${reel.id}`;
      const players = (await db.from("players").select("email,name").eq("tournament_id", t.id).not("email", "is", null)).data ?? [];
      const seen = new Set<string>();
      for (const o of organisers) {
        seen.add(o.email);
        out.push({ email: o.email, name: o.name, tournament: t, vars: { tournament: t.name, winner, course, "first name": firstName(o.name) }, organiser: true, film });
      }
      for (const p of players) {
        const e = String(p.email).toLowerCase();
        if (seen.has(e)) continue;
        seen.add(e);
        out.push({ email: e, name: p.name, tournament: t, vars: { tournament: t.name, winner, course, "first name": firstName(p.name) }, organiser: false, film });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------ building and sending

function target(def: SeriesDef, c: Candidate, site: string) {
  if (def.target === "admin") return `${site}/t/${c.tournament.slug}/admin`;
  if (def.target === "invite") return `${site}/invite`;
  if (def.target === "film") return c.film ?? `${site}/t/${c.tournament.slug}`;
  return `${site}/new`;
}

/** One person's email for a step (the words being edited, for a preview) */
export async function stepMail(def: SeriesDef, stepId: string, c: Candidate, site: string, words?: Words): Promise<Outgoing> {
  const wd = stepWords(def, stepId);
  const w = words ?? (await wordsFor(wd));
  const sendId = newSendId();
  const scope = def.pref === "tips" ? ("t" as const) : ("m" as const);
  const go = (url: string) => tapLink(site, sendId, url);
  const body: Piece[] = paragraphs(fill(w.lines, c.vars)).map((text) => ({ type: "p", text }));
  body.push({ type: "button", label: fill(w.button, c.vars), href: go(target(def, c, site)) });
  if (def.key === "anniversary" && c.organiser) body.push({ type: "link", label: "Set up this year's trip", href: go(`${site}/new`) });
  const look: Look = def.look === "tournament" ? tournamentLook(c.tournament) : BRAND_LOOK;
  const footer = await listFooter(site, c.email, def.pref === "tips" ? TIPS_WHY(c.tournament.name) : NEWS_WHY, scope, sendId, def.pref === "tips" ? "Stop tips like this" : "Stop these emails");
  const m = compose({ subject: fill(w.subject, c.vars), look, headline: fill(w.headline, c.vars), body, footer, fallbackLink: false });
  return {
    ...m,
    to: c.email,
    sendId,
    kind: def.pref === "tips" ? "tips" : "trip news",
    stream: def.stream,
    template: wd.key,
    ref: wd.key,
    tournamentId: c.tournament.id,
    fromName: BRAND_FROM,
    replyTo: await supportReplyTo(),
    unsubscribe: oneTap(site, c.email, scope, sendId),
  };
}

export const SAMPLE_CANDIDATE: Candidate = {
  email: "neil@example.com",
  name: "Neil Byrne",
  tournament: { id: "00000000-0000-4000-8000-000000000000", name: "Kinsale Spring Classic", slug: "kinsale-spring-classic", theme: "spring", custom_colors: null },
  vars: { tournament: "Kinsale Spring Classic", "first name": "Neil", winner: "Neil Byrne", course: "Old Head" },
  organiser: true,
  film: null,
};

/** Who may have it: their choice for this series, not had it, the first step had (for later steps) */
async function narrow(def: SeriesDef, step: StepCfg, firstStep: StepCfg | null, list: Candidate[]): Promise<Candidate[]> {
  const db = adminClient();
  const emails = [...new Set(list.map((c) => c.email))];
  if (!emails.length) return [];
  const prefs = new Map<string, { tips: boolean; trip_news: boolean; roles: string[] }>();
  for (let i = 0; i < emails.length; i += 500) {
    const { data } = await db.from("people").select("email,tips,trip_news,roles").in("email", emails.slice(i, i + 500));
    for (const p of data ?? []) prefs.set(p.email, p);
  }
  let out = list.filter((c) => {
    const p = prefs.get(c.email);
    if (def.pref === "tips") return p?.tips !== false;
    if (p?.trip_news === false) return false;
    if (def.key === "owntrip" && (p?.roles ?? []).includes("organiser")) return false;
    return true;
  });
  // Bring your friends: not for someone who already runs a group trip
  if (def.key === "friends" && out.length) {
    const groups = await groupOrganisers([...new Set(out.map((c) => c.email))]);
    out = out.filter((c) => !groups.has(c.email));
  }
  // A later step only for people who had the first one, for that tournament
  if (firstStep && firstStep.id !== step.id) {
    const ref = stepKey(def.key, firstStep.id);
    const had = new Set<string>();
    for (let i = 0; i < emails.length; i += 500) {
      const { data } = await db.from("email_sends").select("email,tournament_id").eq("ref", ref).in("email", emails.slice(i, i + 500)).neq("status", "failed");
      for (const r of data ?? []) had.add(`${r.email}|${r.tournament_id}`);
    }
    out = out.filter((c) => had.has(`${c.email}|${c.tournament.id}`));
  }
  // Your own trip, bring your friends: once a year at most, whatever the trip
  if (def.key === "owntrip" || def.key === "friends") {
    const since = new Date(Date.now() - 365 * 864e5).toISOString();
    const recent = new Set<string>();
    const left = [...new Set(out.map((c) => c.email))];
    for (let i = 0; i < left.length; i += 500) {
      const { data } = await db.from("email_sends").select("email").eq("ref", stepKey(def.key, step.id)).in("email", left.slice(i, i + 500)).gte("at", since).neq("status", "failed");
      for (const r of data ?? []) recent.add(r.email);
    }
    out = out.filter((c) => !recent.has(c.email));
  }
  return out;
}

/** Each series' steps that are due today (the 10am run). Returns what went, by step. */
export async function runSeries(site: string, now = new Date()): Promise<Record<string, number>> {
  const today = dublinToday(now);
  const sent: Record<string, number> = {};
  const gate = await marketingGate();
  for (const def of SERIES) {
    const st = await seriesState(def.key);
    if (!st.enabled) continue;
    const on = st.steps.filter((s) => s.on);
    const first = on[0] ?? null;
    for (const step of on) {
      let list = await candidates(def, step, today, site);
      list = await narrow(def, step, first, list);
      // Marketing: once a week at most, never during a trip they're on, one per run
      if (def.stream === "marketing") list = list.filter((c) => gate.take(c.email));
      if (!list.length) continue;
      const words = await wordsFor(stepWords(def, step.id));
      const mails: Outgoing[] = [];
      for (const c of list) mails.push(await stepMail(def, step.id, c, site, words));
      const r = await deliverMany(mails);
      sent[stepKey(def.key, step.id)] = r.sent;
    }
  }
  return sent;
}

/** Straight after setup: the welcome series' first step to the new tournament's organisers (signed in already). */
export async function startWelcome(site: string, tournamentId: string) {
  const def = seriesDef("welcome")!;
  const st = await seriesState("welcome");
  if (!st.enabled) return 0;
  const first = st.steps.find((s) => s.on);
  if (!first || first.from !== "setup" || first.days !== 0) return 0;
  const { data: t } = await adminClient().from("tournaments").select(T_COLS).eq("id", tournamentId).maybeSingle();
  if (!t || t.solo) return 0;
  const orgs = (await organisersOf([t.id])).get(t.id) ?? [];
  const list = await narrow(
    def,
    first,
    first,
    orgs.map((o) => ({ email: o.email, name: o.name, tournament: t, vars: { tournament: t.name, "first name": firstName(o.name) }, organiser: true })),
  );
  if (!list.length) return 0;
  const mails: Outgoing[] = [];
  for (const c of list) mails.push(await stepMail(def, first.id, c, site));
  return (await deliverMany(mails)).sent;
}
