import "server-only";
import { after } from "next/server";
import { adminClient } from "./admin";
import { SERVICES, budgets, monthStartIso, type Service } from "./usage";
import { KIND_WORDS, type QueueKind } from "./queue";
import { consoleAddress } from "./console-mail";
import { getSetting } from "./site";

/**
 * What the console shows. Lists come 50 at a time; figures come from indexed counts and each tournament's stored
 * figures (refreshed each night, and in the background when more than an hour old), never by counting everything.
 */

export const PAGE = 50;
const DAY = 864e5;
const iso = (ms: number) => new Date(ms).toISOString();
const todayDublin = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Dublin" });

async function count(q: PromiseLike<{ count: number | null }>): Promise<number> {
  const r = await q;
  return r.count ?? 0;
}

let lastFreshen = 0;
/** Each tournament's stored figures: new tournaments' straight away, everything once an hour, in the background. */
export async function freshenStats() {
  // Remembered here for a minute; the database decides (one refresh an hour across every server)
  if (Date.now() - lastFreshen < 60e3) return;
  lastFreshen = Date.now();
  const run = async () => {
    await adminClient().rpc("refresh_stats_due");
  };
  try {
    after(run);
  } catch {
    await run();
  }
}

// ------------------------------------------------------------ the front page

export interface Figure {
  key: string;
  label: string;
  value: number;
  prev: number | null;
  money?: boolean;
  of?: number;
  note?: string;
}

export async function overview() {
  const db = adminClient();
  const now = Date.now();
  const a = iso(now - 30 * DAY);
  const b = iso(now - 60 * DAY);
  const today = todayDublin();
  void freshenStats();

  const [liveRounds, tNow, tPrev, pNow, pPrev, fNow, fPrev, mNow, mPrev, spend, budget, needs, coming, health, growth] = await Promise.all([
    db.from("rounds").select("id,number,tournament_id,status,play_date").or(`status.eq.live,play_date.eq.${today}`).limit(200),
    count(db.from("tournaments").select("id", { count: "exact", head: true }).gte("created_at", a)),
    count(db.from("tournaments").select("id", { count: "exact", head: true }).gte("created_at", b).lt("created_at", a)),
    count(db.from("people").select("email", { count: "exact", head: true }).gte("last_at", a)),
    count(db.from("people").select("email", { count: "exact", head: true }).gte("last_at", b).lt("last_at", a)),
    count(db.from("fans").select("id", { count: "exact", head: true }).eq("status", "approved").gte("created_at", a)),
    count(db.from("fans").select("id", { count: "exact", head: true }).eq("status", "approved").gte("created_at", b).lt("created_at", a)),
    count(db.from("people").select("email", { count: "exact", head: true }).gte("marketing_at", a)),
    count(db.from("people").select("email", { count: "exact", head: true }).gte("marketing_at", b).lt("marketing_at", a)),
    db.rpc("usage_sum", { svc: null, since: monthStartIso(), tid: null }),
    budgets(),
    needsList({ limit: 5 }),
    db.from("console_tournaments").select("id,slug,name,first_day,players,status").eq("status", "coming up").lte("first_day", iso(now + 14 * DAY).slice(0, 10)).order("first_day").limit(20),
    healthLine(),
    growthWeeks(),
  ]);

  // Live now: the tournaments playing today
  const rounds = (liveRounds.data ?? []) as { id: string; number: number; tournament_id: string; status: string }[];
  const tids = [...new Set(rounds.map((r) => r.tournament_id))];
  const [ts, last, watching, players] = await Promise.all([
    tids.length ? db.from("tournaments").select("id,slug,name").in("id", tids) : Promise.resolve({ data: [] }),
    rounds.length ? db.from("hole_entries").select("round_id,updated_at").in("round_id", rounds.map((r) => r.id)).order("updated_at", { ascending: false }).limit(2000) : Promise.resolve({ data: [] }),
    tids.length ? db.from("viewers").select("tournament_id").in("tournament_id", tids).gte("last_seen", iso(now - 15 * 60e3)).limit(10000) : Promise.resolve({ data: [] }),
    tids.length ? db.from("players").select("tournament_id").in("tournament_id", tids).limit(10000) : Promise.resolve({ data: [] }),
  ]);
  const lastBy = new Map<string, string>();
  for (const e of (last.data ?? []) as { round_id: string; updated_at: string }[]) if (!lastBy.has(e.round_id)) lastBy.set(e.round_id, e.updated_at);
  const tally = (rows: { tournament_id: string }[] | null) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.tournament_id, (m.get(r.tournament_id) ?? 0) + 1);
    return m;
  };
  const watchers = tally(watching.data as { tournament_id: string }[]);
  const playing = tally(players.data as { tournament_id: string }[]);
  const live = ((ts.data ?? []) as { id: string; slug: string; name: string }[])
    .map((t) => {
      const mine = rounds.filter((r) => r.tournament_id === t.id).sort((x, y) => (x.status === "live" ? -1 : 0) - (y.status === "live" ? -1 : 0) || y.number - x.number);
      const r = mine[0];
      const lastScore = mine.map((x) => lastBy.get(x.id)).filter(Boolean).sort().pop() ?? null;
      const quiet = r.status === "live" && (!lastScore || now - Date.parse(lastScore) > 45 * 60e3);
      return { id: t.id, slug: t.slug, name: t.name, round: r.number, started: r.status === "live", playing: playing.get(t.id) ?? 0, watching: watchers.get(t.id) ?? 0, lastScore, quiet };
    })
    .sort((x, y) => Number(y.quiet) - Number(x.quiet) || x.name.localeCompare(y.name));

  const totalBudget = Object.values(budget).reduce((s, c) => s + (c > 0 ? c : 0), 0);
  const figures: Figure[] = [
    { key: "live", label: "Live now", value: live.length, prev: null, note: tomorrowNote(coming.data?.filter((t) => t.first_day === iso(now + DAY).slice(0, 10)).length ?? 0) },
    { key: "tournaments", label: "Tournaments", value: tNow, prev: tPrev },
    { key: "active", label: "Active people", value: pNow, prev: pPrev },
    { key: "followers", label: "Followers", value: fNow, prev: fPrev },
    { key: "optins", label: "Marketing opt-ins", value: mNow, prev: mPrev },
    { key: "spend", label: "Spend this month", value: Number(spend.data ?? 0), prev: null, money: true, of: totalBudget },
  ];
  return { figures, needs, live, coming: coming.data ?? [], health, growth };
}

const tomorrowNote = (k: number) => (k ? `${k} more start${k === 1 ? "s" : ""} tomorrow` : "None start tomorrow");

/** Tournaments and active people each week for the last 12 weeks. */
async function growthWeeks() {
  const db = adminClient();
  const since = Date.now() - 12 * 7 * DAY;
  const [{ data: ts }, { data: days }] = await Promise.all([
    db.from("tournaments").select("created_at").gte("created_at", iso(since)).limit(50000),
    db.from("daily_stats").select("day,figures").gte("day", iso(since).slice(0, 10)).order("day"),
  ]);
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const start = since + i * 7 * DAY;
    const end = start + 7 * DAY;
    const newT = (ts ?? []).filter((t) => {
      const at = Date.parse(t.created_at);
      return at >= start && at < end;
    }).length;
    const snap = (days ?? []).filter((d) => {
      const at = Date.parse(d.day);
      return at >= start && at < end;
    });
    const active = snap.length ? Number((snap[snap.length - 1].figures as { active7?: number }).active7 ?? 0) : null;
    return { week: iso(start).slice(0, 10), tournaments: newT, active };
  });
  return weeks;
}

// ------------------------------------------------------------ Needs you

export interface NeedRow {
  id: string;
  kind: QueueKind;
  kindWords: string;
  title: string;
  subject: string;
  tournament: { id: string; slug: string; name: string } | null;
  person: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
  dueAt: string | null;
  snoozedUntil: string | null;
  assignedTo: string | null;
}

export async function needsList(opts: { limit?: number; page?: number; kind?: string; snoozed?: boolean; mine?: string } = {}) {
  const db = adminClient();
  const nowIso = new Date().toISOString();
  const size = opts.limit ?? PAGE;
  const from = (opts.page ?? 0) * size;
  let q = db.from("queue").select("*", { count: "exact" }).is("resolved_at", null);
  q = opts.snoozed ? q.gt("snoozed_until", nowIso) : q.or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`);
  if (opts.kind) q = q.eq("kind", opts.kind);
  if (opts.mine) q = q.eq("assigned_to", opts.mine);
  const { data, count: total } = await q.order("created_at", { ascending: true }).range(from, from + size - 1);
  const rows = data ?? [];
  const tids = [...new Set(rows.map((r) => r.tournament_id).filter(Boolean))] as string[];
  const { data: ts } = tids.length ? await db.from("tournaments").select("id,slug,name").in("id", tids) : { data: [] };
  const byId = new Map((ts ?? []).map((t) => [t.id, t]));
  const items: NeedRow[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    kindWords: KIND_WORDS[r.kind as QueueKind] ?? r.kind,
    title: r.title,
    subject: r.subject,
    tournament: r.tournament_id ? (byId.get(r.tournament_id) ?? { id: r.tournament_id, slug: "", name: "A deleted tournament" }) : null,
    person: r.person,
    detail: r.detail,
    createdAt: r.created_at,
    dueAt: r.due_at,
    snoozedUntil: r.snoozed_until,
    assignedTo: r.assigned_to,
  }));
  const { count: snoozed } = await db.from("queue").select("id", { count: "exact", head: true }).is("resolved_at", null).gt("snoozed_until", nowIso);
  return { items, total: total ?? 0, snoozed: snoozed ?? 0 };
}

export async function needsCount(): Promise<number> {
  const nowIso = new Date().toISOString();
  return count(adminClient().from("queue").select("id", { count: "exact", head: true }).is("resolved_at", null).or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`));
}

// ------------------------------------------------------------ Tournaments

export const STATUSES = ["setting up", "coming up", "live", "finished"] as const;
const T_SORT = new Set(["name", "organiser", "status", "first_day", "players", "followers", "posts", "films", "cost_cents", "created_at"]);

export async function tournamentList(o: { q?: string; status?: string; privacy?: string; month?: string; sort?: string; dir?: string; page?: number }) {
  const db = adminClient();
  void freshenStats();
  const from = Math.max(0, o.page ?? 0) * PAGE;
  let q = db.from("console_tournaments").select("*", { count: "exact" });
  const term = (o.q ?? "").trim().replace(/[%,()]/g, " ").slice(0, 80);
  if (term) q = q.or(`name.ilike.%${term}%,slug.ilike.%${term}%,organiser.ilike.%${term}%`);
  if (o.status && (STATUSES as readonly string[]).includes(o.status)) q = q.eq("status", o.status);
  if (o.privacy === "private" || o.privacy === "friends") q = q.eq("privacy", o.privacy);
  if (o.month && /^\d{4}-\d{2}$/.test(o.month)) {
    const [y, m] = o.month.split("-").map(Number);
    q = q.gte("first_day", `${o.month}-01`).lt("first_day", new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10));
  }
  const sort = o.sort && T_SORT.has(o.sort) ? o.sort : "created_at";
  const { data, count: total } = await q.order(sort, { ascending: o.dir === "asc", nullsFirst: false }).range(from, from + PAGE - 1);
  return { rows: data ?? [], total: total ?? 0, page: o.page ?? 0, size: PAGE };
}

export async function tournamentDetail(id: string) {
  const db = adminClient();
  const { data: t } = await db.from("tournaments").select("*").eq("id", id).maybeSingle();
  if (!t) return null;
  await db.rpc("refresh_tournament_stats", { only_id: id });
  const monthStart = monthStartIso();
  const [stats, rounds, organisers, players, fans, activity, money, monthMoney, problems, films, emailFails] = await Promise.all([
    db.from("console_tournaments").select("*").eq("id", id).maybeSingle(),
    db.from("rounds").select("number,course_name,play_date,status,format").eq("tournament_id", id).order("number"),
    db.from("account_tournaments").select("role,created_at,player_id,accounts(email,name,last_seen_at)").eq("tournament_id", id),
    db.from("players").select("id,name,email,link_used_at,sort").eq("tournament_id", id).order("sort"),
    db.from("fans").select("id,name,email,how_known,status,verified_at,created_at,marketing_at").eq("tournament_id", id).order("created_at", { ascending: false }).limit(500),
    db.from("activity").select("*").eq("tournament_id", id).order("at", { ascending: false }).limit(100),
    db.rpc("usage_breakdown", { since: "2000-01-01T00:00:00Z", tid: id }),
    db.rpc("usage_breakdown", { since: monthStart, tid: id }),
    db.from("incidents").select("key,place,message,count,last_at").contains("tournaments", [id]).order("last_at", { ascending: false }).limit(20),
    db.from("reels").select("id,status,error,updated_at").eq("tournament_id", id).order("updated_at", { ascending: false }).limit(20),
    db.from("email_failures").select("email,kind,error,at").eq("tournament_id", id).order("at", { ascending: false }).limit(20),
  ]);
  // Its timeline: what happened, from the tournament's own records, with the console's actions marked
  const [posts, joins] = await Promise.all([
    db.from("posts").select("created_at,kind,author_name").eq("tournament_id", id).order("created_at", { ascending: false }).limit(30),
    db.from("account_tournaments").select("created_at,role").eq("tournament_id", id).order("created_at", { ascending: false }).limit(30),
  ]);
  const timeline = [
    { at: t.created_at, what: "Set up", by: null as string | null, console: false },
    ...(rounds.data ?? []).filter((r) => r.status !== "upcoming" && r.play_date).map((r) => ({ at: `${r.play_date}T08:00:00Z`, what: `Round ${r.number} ${r.status === "live" ? "started" : "played"} at ${r.course_name}`, by: null, console: false })),
    ...(joins.data ?? []).map((j) => ({ at: j.created_at, what: j.role === "organiser" ? "An organiser joined" : "A player signed in with their email", by: null, console: false })),
    ...(posts.data ?? []).map((p) => ({ at: p.created_at, what: p.kind === "video" ? "A clip was posted" : p.kind === "photo" ? "A photo was posted" : "A note was posted", by: p.author_name, console: false })),
    ...(films.data ?? []).filter((f) => f.status === "done" || f.status === "failed").map((f) => ({ at: f.updated_at, what: f.status === "done" ? "A film was made" : "A film failed", by: null, console: false })),
    ...(activity.data ?? []).map((a) => ({ at: a.at, what: a.action, by: a.actor, console: true, role: a.actor_role })),
  ]
    .sort((x, y) => Date.parse(y.at) - Date.parse(x.at))
    .slice(0, 80);
  const people = [
    ...((organisers.data ?? []) as unknown as { role: string; created_at: string; player_id: string | null; accounts: { email: string; name: string | null; last_seen_at: string | null } | null }[]).map((o) => ({
      kind: o.role === "organiser" ? "Organiser" : "Player",
      name: o.accounts?.name ?? (players.data ?? []).find((p) => p.id === o.player_id)?.name ?? null,
      email: o.accounts?.email ?? null,
      joined: o.created_at,
      lastSeen: o.accounts?.last_seen_at ?? null,
    })),
    ...(players.data ?? [])
      .filter((p) => !((organisers.data ?? []) as { player_id: string | null }[]).some((o) => o.player_id === p.id))
      .map((p) => ({ kind: "Player", name: p.name, email: p.email ?? null, joined: p.link_used_at ?? null, lastSeen: null })),
    ...(fans.data ?? []).map((f) => ({
      kind: f.status === "approved" ? "Follower" : f.status === "asking" ? "Asking to follow" : f.status === "declined" ? "Turned down" : "Removed",
      name: f.name,
      email: f.verified_at ? f.email : null,
      joined: f.created_at,
      lastSeen: null,
      how: f.how_known,
    })),
  ];
  const { data: caps } = await db.from("site_settings").select("value").eq("key", "films").maybeSingle();
  return {
    tournament: { id: t.id, slug: t.slug, name: t.name, privacy: t.privacy, created_at: t.created_at, ai_on: t.ai_on, video_enabled: t.video_enabled, broadcast_on: t.broadcast_on, broadcast_cap_cents: t.broadcast_cap_cents, ai_cap_cents: t.ai_cap_cents, paused: !!t.console_paused },
    stats: stats.data,
    rounds: rounds.data ?? [],
    people,
    timeline,
    money: { all: money.data ?? [], month: monthMoney.data ?? [], filmsPerTournament: (caps?.value as { perTournament?: number } | null)?.perTournament ?? null },
    problems: { errors: problems.data ?? [], films: (films.data ?? []).filter((f) => f.status === "failed"), emails: emailFails.data ?? [] },
  };
}

// ------------------------------------------------------------ People

const P_SORT = new Set(["email", "name", "first_at", "last_at", "marketing_at"]);

export async function peopleList(o: { q?: string; role?: string; marketing?: string; active?: string; month?: string; sort?: string; dir?: string; page?: number }) {
  const db = adminClient();
  const from = Math.max(0, o.page ?? 0) * PAGE;
  let q = db.from("people").select("*", { count: "exact" });
  const term = (o.q ?? "").trim().replace(/[%,()]/g, " ").slice(0, 80);
  if (term) q = q.or(`email.ilike.%${term}%,name.ilike.%${term}%`);
  if (o.role && ["organiser", "player", "follower", "subscriber"].includes(o.role)) q = q.contains("roles", [o.role]);
  if (o.marketing === "yes") q = q.not("marketing_at", "is", null).is("marketing_stopped_at", null);
  if (o.marketing === "no") q = q.or("marketing_at.is.null,marketing_stopped_at.not.is.null");
  if (o.active === "30") q = q.gte("last_at", iso(Date.now() - 30 * DAY));
  if (o.month && /^\d{4}-\d{2}$/.test(o.month)) {
    const [y, m] = o.month.split("-").map(Number);
    q = q.gte("first_at", `${o.month}-01`).lt("first_at", new Date(Date.UTC(y, m, 1)).toISOString());
  }
  const sort = o.sort && P_SORT.has(o.sort) ? o.sort : "first_at";
  const { data, count: total } = await q.order(sort, { ascending: o.dir === "asc", nullsFirst: false }).range(from, from + PAGE - 1);
  return { rows: data ?? [], total: total ?? 0, page: o.page ?? 0, size: PAGE };
}

export async function personDetail(id: string) {
  const db = adminClient();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data: p } = await db.from("people").select("*").eq("id", id).maybeSingle();
  if (!p) return null;
  const e = String(p.email);
  const { data: acct } = await db.from("accounts").select("id,email,name,created_at,last_seen_at").eq("email", e).maybeSingle();
  const [joins, players, fans, subs, block, fails, activity, requests] = await Promise.all([
    acct ? db.from("account_tournaments").select("tournament_id,role,created_at").eq("account_id", acct.id) : Promise.resolve({ data: [] }),
    db.from("players").select("tournament_id,name").eq("email", e),
    db.from("fans").select("tournament_id,name,status,how_known,created_at,marketing_at,marketing_wording").eq("email", e).not("verified_at", "is", null),
    db.from("subscribers").select("tournament_id,created_at,unsubscribed_at").eq("email", e),
    db.from("email_blocks").select("*").eq("email", e).maybeSingle(),
    db.from("email_failures").select("kind,error,at").eq("email", e).order("at", { ascending: false }).limit(10),
    db.from("activity").select("*").eq("person", e).order("at", { ascending: false }).limit(50),
    db.from("data_requests").select("*").eq("email", e).order("created_at", { ascending: false }),
  ]);
  const roles: { tid: string; role: string; at: string | null; how?: string | null }[] = [
    ...((joins.data ?? []) as { tournament_id: string; role: string; created_at: string }[]).map((j) => ({ tid: j.tournament_id, role: j.role === "organiser" ? "Organiser" : "Player", at: j.created_at })),
    ...((players.data ?? []) as { tournament_id: string }[]).map((x) => ({ tid: x.tournament_id, role: "Player", at: null })),
    ...((fans.data ?? []) as { tournament_id: string; status: string; how_known: string | null; created_at: string }[]).map((f) => ({ tid: f.tournament_id, role: f.status === "approved" ? "Follower" : f.status === "asking" ? "Asking to follow" : "Follower (not let in)", at: f.created_at, how: f.how_known })),
    ...((subs.data ?? []) as { tournament_id: string; created_at: string; unsubscribed_at: string | null }[]).map((s) => ({ tid: s.tournament_id, role: s.unsubscribed_at ? "Report emails (stopped)" : "Report emails", at: s.created_at })),
  ];
  const tids = [...new Set(roles.map((r) => r.tid))];
  const { data: ts } = tids.length ? await db.from("tournaments").select("id,slug,name").in("id", tids) : { data: [] };
  const byId = new Map((ts ?? []).map((t) => [t.id, t]));
  // One line per tournament, the strongest role first
  const order = ["Organiser", "Player", "Follower", "Asking to follow", "Follower (not let in)", "Report emails", "Report emails (stopped)"];
  const seen = new Map<string, (typeof roles)[number]>();
  for (const r of roles.sort((x, y) => order.indexOf(x.role) - order.indexOf(y.role))) if (!seen.has(r.tid)) seen.set(r.tid, r);
  const tournaments = [...seen.values()].map((r) => ({ ...r, tournament: byId.get(r.tid) ?? null }));
  const names = [...new Set([p.name, acct?.name, ...((players.data ?? []) as { name: string }[]).map((x) => x.name), ...((fans.data ?? []) as { name: string }[]).map((f) => f.name)].filter(Boolean))];
  const mTournament = p.marketing_tournament ? (await db.from("tournaments").select("name").eq("id", p.marketing_tournament).maybeSingle()).data?.name ?? "A deleted tournament" : null;
  return {
    id: p.id,
    email: p.email,
    names,
    firstAt: p.first_at,
    lastAt: p.last_at ?? acct?.last_seen_at ?? null,
    signedIn: !!acct,
    roles: p.roles,
    tournaments,
    consent: p.marketing_at ? { at: p.marketing_at, wording: p.marketing_wording, tournament: mTournament, stoppedAt: p.marketing_stopped_at } : p.marketing_stopped_at ? { at: null, wording: null, tournament: null, stoppedAt: p.marketing_stopped_at } : null,
    blocked: block.data ?? null,
    emailFailures: fails.data ?? [],
    activity: activity.data ?? [],
    requests: requests.data ?? [],
  };
}

// ------------------------------------------------------------ Money

export async function money() {
  const db = adminClient();
  const now = new Date();
  const month = monthStartIso();
  const yearAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)).toISOString();
  const [b, breakdown, months, top, spenders, bills, films] = await Promise.all([
    budgets(),
    db.rpc("usage_breakdown", { since: month, tid: null }),
    db.rpc("usage_months", { since: yearAgo }),
    db.rpc("usage_top", { since: month, n: 10 }),
    db.rpc("usage_tournaments", { since: month }),
    getSetting<Record<string, Record<string, number>>>("bills", {}),
    getSetting<{ monthlyCents?: number; perTournament?: number }>("films", {}),
  ]);
  const day = now.getUTCDate();
  const daysIn = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const by = new Map(((breakdown.data ?? []) as { service: string; cents: number; calls: number; fails: number }[]).map((r) => [r.service, r]));
  const services = SERVICES.filter((s) => s.paid).map((s) => {
    const r = by.get(s.id);
    const spent = Number(r?.cents ?? 0);
    return { id: s.id, name: s.name, spent, calls: Number(r?.calls ?? 0), budget: b[s.id as Exclude<Service, "email">] ?? 0, projected: Math.round((spent / day) * daysIn * 100) / 100 };
  });
  const total = services.reduce((s, x) => s + x.spent, 0);
  const topRows = (top.data ?? []) as { tournament_id: string; cents: number }[];
  const { data: ts } = topRows.length ? await db.from("tournaments").select("id,slug,name").in("id", topRows.map((r) => r.tournament_id)) : { data: [] };
  const names = new Map((ts ?? []).map((t) => [t.id, t]));
  // The average tournament: everything spent on tournaments this month, over the tournaments that spent anything
  const tournamentSpend = Number((await db.rpc("usage_sum_tournaments", { since: month })).data ?? 0);
  return {
    month: month.slice(0, 7),
    day,
    daysIn,
    services,
    total,
    projected: Math.round((total / day) * daysIn * 100) / 100,
    perTournament: { tournaments: Number(spenders.data ?? 0), average: Number(spenders.data ?? 0) ? tournamentSpend / Number(spenders.data) : 0, top: topRows.map((r) => ({ ...r, cents: Number(r.cents), tournament: names.get(r.tournament_id) ?? null })) },
    months: (months.data ?? []) as { month: string; service: string; cents: number }[],
    bills,
    filmLimits: films,
  };
}

// ------------------------------------------------------------ Health

export type Light = "green" | "amber" | "red" | "idle";

/** The AI writers' fact check over the last 30 days: pieces and film scripts checked, lines fixed and dropped */
export async function factCheckSummary() {
  const { data, error } = await adminClient()
    .from("fact_checks")
    .select("*")
    .gte("at", iso(Date.now() - 30 * 864e5))
    .order("at", { ascending: false })
    .limit(2000);
  if (error) return null;
  const rows = (data ?? []) as { at: string; tournament_id: string | null; what: string; kind: string | null; label: string | null; checked: number; first_problems: number; fixed: number; dropped: number; lines: { text: string; why: string }[] }[];
  const ids = [...new Set(rows.filter((r) => r.dropped && r.tournament_id).map((r) => r.tournament_id!))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: ts } = await adminClient().from("tournaments").select("id,name,slug").in("id", ids);
    for (const t of (ts ?? []) as { id: string; name: string }[]) names.set(t.id, t.name);
  }
  const lines = rows.reduce((a, r) => a + r.checked, 0);
  const dropped = rows.reduce((a, r) => a + r.dropped, 0);
  return {
    pieces: rows.filter((r) => r.what === "piece").length,
    films: rows.filter((r) => r.what === "film").length,
    lines,
    fixed: rows.reduce((a, r) => a + r.fixed, 0),
    dropped,
    // More than one line in twenty dropped: it stands out
    amber: lines > 0 && dropped * 20 > lines,
    list: rows
      .filter((r) => r.dropped)
      .flatMap((r) => (r.lines ?? []).map((l) => ({ at: r.at, tournament: (r.tournament_id && names.get(r.tournament_id)) || "A tournament", piece: r.label ?? r.kind ?? "", text: l.text, why: l.why })))
      .slice(0, 60),
  };
}

export async function health() {
  const db = adminClient();
  const today = todayDublin();
  const [svc, counts, incidents, room, cron, failsToday, factCheck] = await Promise.all([
    db.from("services").select("*"),
    db.from("day_counts").select("name,n").eq("day", today),
    db.from("incidents").select("*").order("last_at", { ascending: false }).limit(50),
    db.rpc("console_room"),
    getSetting<{ at?: string; did?: string[] }>("cron", {}),
    db.from("usage").select("service", { count: "exact", head: false }).eq("ok", false).gte("at", iso(Date.now() - 3600e3)).limit(1000),
    factCheckSummary(),
  ]);
  const recentFails = new Map<string, number>();
  for (const r of (failsToday.data ?? []) as { service: string }[]) recentFails.set(r.service, (recentFails.get(r.service) ?? 0) + 1);
  const rows = (svc.data ?? []) as { service: string; last_ok_at: string | null; last_fail_at: string | null; failing_since: string | null; fails_day: string | null; fails: number; last_error: string | null }[];
  const lights = SERVICES.map((s) => {
    const r = rows.find((x) => x.service === s.id);
    let light: Light = "idle";
    if (r) {
      if (r.failing_since && Date.now() - Date.parse(r.failing_since) >= 15 * 60e3) light = "red";
      else if ((recentFails.get(s.id) ?? 0) > 0) light = "amber";
      else light = "green";
    }
    return { id: s.id, name: s.name, light, lastOk: r?.last_ok_at ?? null, lastFail: r?.last_fail_at ?? null, failsToday: r?.fails_day === today ? r.fails : 0, lastError: r?.last_error ?? null };
  });
  const c = Object.fromEntries(((counts.data ?? []) as { name: string; n: number }[]).map((x) => [x.name, x.n]));
  const emails = Object.entries(c)
    .filter(([k]) => k.startsWith("email:"))
    .map(([k, n]) => ({ kind: k.slice(6), n }))
    .sort((x, y) => y.n - x.n);
  return {
    lights,
    emails: { sent: emails.reduce((s, x) => s + x.n, 0), failed: c["email-failed"] ?? 0, byKind: emails },
    signins: { codes: c["signin:code-sent"] ?? 0, wrong: c["signin:wrong-code"] ?? 0, blocked: c["signin:blocked"] ?? 0, tooMany: c["signin:too-many"] ?? 0 },
    errors: incidents.data ?? [],
    room: { ...((room.data as { db: number; files: number | null; fileBytes: number | null }) ?? { db: 0, files: null, fileBytes: null }), dbLimit: Number(process.env.DB_LIMIT_BYTES || 8 * 1024 ** 3), fileLimit: Number(process.env.FILES_LIMIT_BYTES || 100 * 1024 ** 3) },
    cron,
    factCheck,
    consoleEmail: await consoleAddress(),
  };
}

/** The front page's one line: green, or what isn't working. */
async function healthLine(): Promise<{ light: Light; words: string }> {
  const h = await health();
  const red = h.lights.find((l) => l.light === "red");
  if (red) return { light: "red", words: `${red.name} is down since ${new Date(red.lastFail ?? Date.now()).toLocaleTimeString("en-IE", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit" })}` };
  const amber = h.lights.filter((l) => l.light === "amber");
  if (amber.length) return { light: "amber", words: `${amber.map((a) => a.name).join(", ")}: some calls failed in the last hour` };
  const full = (used: number | null, limit: number) => used != null && used >= limit * 0.8;
  if (full(h.room.db, h.room.dbLimit) || full(h.room.fileBytes, h.room.fileLimit)) return { light: "amber", words: "Storage is over 80% of the plan" };
  return { light: "green", words: "All services working" };
}

// ------------------------------------------------------------ Activity

export async function activityList(o: { q?: string; who?: string; action?: string; from?: string; to?: string; page?: number }) {
  const db = adminClient();
  const start = Math.max(0, o.page ?? 0) * PAGE;
  let q = db.from("activity").select("*", { count: "exact" });
  const term = (o.q ?? "").trim().replace(/[%,()]/g, " ").slice(0, 80);
  if (term) q = q.or(`actor.ilike.%${term}%,person.ilike.%${term}%,tournament_name.ilike.%${term}%`);
  if (o.who) q = q.eq("actor_role", o.who);
  if (o.action) q = q.like("action", `${o.action.replace(/[%_]/g, "")}%`);
  if (o.from && /^\d{4}-\d{2}-\d{2}$/.test(o.from)) q = q.gte("at", o.from);
  if (o.to && /^\d{4}-\d{2}-\d{2}$/.test(o.to)) q = q.lt("at", iso(Date.parse(o.to) + DAY));
  const { data, count: total } = await q.order("at", { ascending: false }).range(start, start + PAGE - 1);
  return { rows: data ?? [], total: total ?? 0, page: o.page ?? 0, size: PAGE };
}

// ------------------------------------------------------------ Search (the box at the top)

export async function search(term: string) {
  const db = adminClient();
  const t = term.trim().replace(/[%,()]/g, " ").slice(0, 80);
  if (t.length < 2) return { tournaments: [], people: [] };
  const [ts, ps] = await Promise.all([
    db.from("console_tournaments").select("id,slug,name,status,organiser").or(`name.ilike.%${t}%,slug.ilike.%${t}%,organiser.ilike.%${t}%`).order("created_at", { ascending: false }).limit(6),
    db.from("people").select("id,email,name,roles").or(`email.ilike.%${t}%,name.ilike.%${t}%`).order("last_at", { ascending: false, nullsFirst: false }).limit(6),
  ]);
  return { tournaments: ts.data ?? [], people: ps.data ?? [] };
}
