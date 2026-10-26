import "server-only";
import { adminClient } from "./admin";
import { raise, settle } from "./queue";
import { monthStartIso, SERVICES } from "./usage";
import { brandEmail, sendOne } from "./email";
import { BRAND } from "./brand";
import { consoleMail } from "./console-mail";
import { getSetting, setSetting } from "./site";
import { health, needsList, overview } from "./console-data";

/**
 * The console's daily work (with the 8am job): each tournament's figures, the day's snapshot for the growth chart,
 * and the Needs you sweep: things that have waited too long go in, things sorted elsewhere come out.
 */

const DAY = 864e5;
const iso = (ms: number) => new Date(ms).toISOString();
const dublinDate = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Dublin" });
const dublinHour = () => Number(new Date().toLocaleTimeString("en-GB", { timeZone: "Europe/Dublin", hour: "2-digit", hour12: false }).slice(0, 2));

export async function refreshStats() {
  await adminClient().rpc("refresh_tournament_stats", { only_id: null });
}

export async function snapshot() {
  const db = adminClient();
  const c = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
  const now = Date.now();
  const figures = {
    tournaments: await c(db.from("tournaments").select("id", { count: "exact", head: true })),
    people: await c(db.from("people").select("email", { count: "exact", head: true })),
    active7: await c(db.from("people").select("email", { count: "exact", head: true }).gte("last_at", iso(now - 7 * DAY))),
    active30: await c(db.from("people").select("email", { count: "exact", head: true }).gte("last_at", iso(now - 30 * DAY))),
    followers: await c(db.from("fans").select("id", { count: "exact", head: true }).eq("status", "approved")),
    optins: await c(db.from("people").select("email", { count: "exact", head: true }).not("marketing_at", "is", null).is("marketing_stopped_at", null)),
    spendMonth: Number((await db.rpc("usage_sum", { svc: null, since: monthStartIso(), tid: null })).data ?? 0),
  };
  await db.from("daily_stats").upsert({ day: dublinDate(), figures, made_at: new Date().toISOString() });
}

/** Needs you: in with what's waited too long, out with what's sorted. Returns how many came in. */
export async function sweep(): Promise<number> {
  const db = adminClient();
  const now = Date.now();
  let raised = 0;
  const up = async (...a: Parameters<typeof raise>) => {
    if (await raise(...a)) raised++;
  };

  // Films stuck: a step running for more than half an hour
  const { data: stuck } = await db
    .from("reels")
    .select("id,tournament_id,status,stage,stage_at,updated_at")
    .in("status", ["planning", "rendering"])
    .lt("updated_at", iso(now - 30 * 60e3))
    .limit(200);
  for (const r of stuck ?? []) await up({ kind: "film", subject: r.id, tournamentId: r.tournament_id, title: "A film is stuck", detail: { stage: r.stage ?? r.status } });

  // Reports the organiser hasn't dealt with in a day
  const { data: reports } = await db.from("reports").select("tournament_id,post_id,comment_id,created_at").lt("created_at", iso(now - DAY)).order("created_at").limit(500);
  const items = new Map<string, { tid: string; table: "posts" | "comments" }>();
  for (const r of reports ?? []) {
    const id = r.post_id ?? r.comment_id;
    if (id) items.set(id, { tid: r.tournament_id, table: r.post_id ? "posts" : "comments" });
  }
  for (const [id, it] of items) {
    const { data: row } = await db.from(it.table).select("hidden,hidden_by_reports").eq("id", id).maybeSingle();
    if (!row) {
      await settle("report", id, "system", "It was deleted");
      continue;
    }
    // Hidden by the organiser (not just by the reports): dealt with
    if (row.hidden && !row.hidden_by_reports) continue;
    await up({ kind: "report", subject: id, tournamentId: it.tid, title: `A reported ${it.table === "posts" ? "post" : "comment"}, waiting over a day`, detail: { table: it.table } });
  }

  // Follow requests still waiting three days after the organiser's reminder
  const { data: waiting } = await db.from("fans").select("tournament_id").eq("status", "asking").lt("reminded_at", iso(now - 3 * DAY)).limit(2000);
  const byT = new Map<string, number>();
  for (const f of waiting ?? []) byT.set(f.tournament_id, (byT.get(f.tournament_id) ?? 0) + 1);
  for (const [tid, n] of byT) {
    const { data: t } = await db.from("tournaments").select("name").eq("id", tid).maybeSingle();
    await up({ kind: "follow_wait", subject: `follow:${tid}`, tournamentId: tid, title: `${n} waiting to follow ${t?.name ?? "a tournament"}`, detail: { n } });
  }

  // A tournament at 80% of its own limits this month (films, clips, writing)
  const month = monthStartIso().slice(0, 7);
  const films = await getSetting<{ perTournament?: number }>("films", {});
  const per = films.perTournament ?? 0;
  if (per > 0) {
    const { data: made } = await db.from("reels").select("tournament_id").eq("status", "done").limit(20000);
    const n = new Map<string, number>();
    for (const r of made ?? []) n.set(r.tournament_id, (n.get(r.tournament_id) ?? 0) + 1);
    for (const [tid, k] of n) if (k >= per * 0.8) await up({ kind: "spend", subject: `t:${tid}:films:${month}`, tournamentId: tid, title: `${k} of ${per} films made`, detail: { what: "films", used: k, limit: per } }, { once: true });
  }
  const { data: writing } = await db.rpc("usage_by_tournament", { svc: "writing", since: monthStartIso() });
  const wr = (writing ?? []) as { tournament_id: string; cents: number }[];
  if (wr.length) {
    const { data: caps } = await db.from("tournaments").select("id,ai_cap_cents").in("id", wr.map((r) => r.tournament_id));
    const cap = new Map((caps ?? []).map((c) => [c.id, Number(c.ai_cap_cents ?? 0)]));
    for (const r of wr) {
      const c = cap.get(r.tournament_id) ?? 0;
      if (c > 0 && Number(r.cents) >= c * 0.8) await up({ kind: "spend", subject: `t:${r.tournament_id}:writing:${month}`, tournamentId: r.tournament_id, title: `Writing at ${Math.floor((Number(r.cents) / c) * 100)}% of its monthly allowance`, detail: { what: "writing", used: Number(r.cents), limit: c } }, { once: true });
    }
  }
  const { data: clips } = await db.from("posts").select("tournament_id,broadcast_seconds").gte("broadcast_at", monthStartIso()).not("broadcast_seconds", "is", null).limit(20000);
  const secs = new Map<string, number>();
  for (const c of clips ?? []) secs.set(c.tournament_id, (secs.get(c.tournament_id) ?? 0) + Number(c.broadcast_seconds ?? 0));
  if (secs.size) {
    const { data: caps } = await db.from("tournaments").select("id,broadcast_cap_cents").in("id", [...secs.keys()]);
    for (const t of caps ?? []) {
      const cents = ((secs.get(t.id) ?? 0) / 60) * 20;
      const c = Number(t.broadcast_cap_cents ?? 0);
      if (c > 0 && cents >= c * 0.8) await up({ kind: "spend", subject: `t:${t.id}:clips:${month}`, tournamentId: t.id, title: `Clips at ${Math.floor((cents / c) * 100)}% of the monthly limit`, detail: { what: "clips", used: cents, limit: c } }, { once: true });
    }
  }

  // Out: open items that have sorted themselves
  const { data: open } = await db.from("queue").select("id,kind,subject").is("resolved_at", null).limit(2000);
  for (const q of open ?? []) {
    if (q.kind === "film") {
      const { data: r } = await db.from("reels").select("status,updated_at").eq("id", q.subject).maybeSingle();
      if (!r || r.status === "done" || r.status === "draft") await settle("film", q.subject, "system", r ? "The film is sorted" : "The film was deleted");
    } else if (q.kind === "invite") {
      const { data: r } = await db.from("invite_requests").select("status").eq("id", q.subject).maybeSingle();
      if (!r || r.status !== "new") await settle("invite", q.subject, "system", r ? `It was ${r.status}` : "It was deleted");
    } else if (q.kind === "follow_wait") {
      const tid = q.subject.replace(/^follow:/, "");
      const { count } = await db.from("fans").select("id", { count: "exact", head: true }).eq("tournament_id", tid).eq("status", "asking");
      if (!count) await settle("follow_wait", q.subject, "system", "Nobody's waiting now");
    } else if (q.kind === "research") {
      const { data: r } = await db.from("course_library").select("status").eq("ref", q.subject).maybeSingle();
      if (r?.status === "done") await settle("research", q.subject, "system", "Research found the course");
    } else if (q.kind === "email_failing") {
      const { count } = await db.from("email_failures").select("id", { count: "exact", head: true }).eq("email", q.subject).gte("at", iso(now - 14 * DAY));
      if (!count) await settle("email_failing", q.subject, "system", "No failures for a fortnight");
    } else if (q.kind === "data_request") {
      const { data: r } = await db.from("data_requests").select("done_at").eq("id", q.subject).maybeSingle();
      if (!r || r.done_at) await settle("data_request", q.subject, "system", "Done");
    } else if (q.kind === "spend" && !q.subject.includes(`:${month}`)) {
      await settle("spend", q.subject, "system", "A new month");
    }
  }
  return raised;
}

// ------------------------------------------------------------ the morning email

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** At 7am Irish time, once a day, weekends too: what needs you, today's live tournaments, anything amber or red. */
export async function morningEmail(force = false): Promise<boolean> {
  const today = dublinDate();
  const cron = await getSetting<{ morning?: string }>("cron", {});
  if (!force && (dublinHour() !== 7 || cron.morning === today)) return false;
  const [o, h, n] = await Promise.all([overview(), health(), needsList({ limit: 5 })]);
  const site = (process.env.SITE_URL || "https://mygolfbroadcast.com").replace(/\/$/, "");
  const lines: string[] = [];
  const text: string[] = [];
  if (!n.total) {
    lines.push("<strong>Nothing needs you today.</strong>");
    text.push("Nothing needs you today.");
  } else {
    lines.push(`<strong>${n.total} ${n.total === 1 ? "thing needs" : "things need"} you.</strong> The oldest:`);
    text.push(`${n.total} ${n.total === 1 ? "thing needs" : "things need"} you. The oldest:`);
    for (const i of n.items) {
      lines.push(`&nbsp;&nbsp;${esc(i.title)}${i.tournament ? `, ${esc(i.tournament.name)}` : ""}`);
      text.push(`  ${i.title}${i.tournament ? `, ${i.tournament.name}` : ""}`);
    }
  }
  if (o.live.length) {
    lines.push(`<strong>Live today:</strong> ${o.live.map((l) => `${esc(l.name)} (round ${l.round})`).join(", ")}.`);
    text.push(`Live today: ${o.live.map((l) => `${l.name} (round ${l.round})`).join(", ")}.`);
  }
  const bad = h.lights.filter((l) => l.light === "red" || l.light === "amber");
  if (bad.length) {
    lines.push(`<strong>Health:</strong> ${bad.map((l) => `${esc(l.name)} ${l.light === "red" ? "is down" : "had failures"}`).join("; ")}.`);
    text.push(`Health: ${bad.map((l) => `${l.name} ${l.light === "red" ? "is down" : "had failures"}`).join("; ")}.`);
  }
  const subject = n.total ? `${n.total} ${n.total === 1 ? "thing needs" : "things need"} you` : "Nothing needs you today";
  const sent = await consoleMail(`${BRAND.name}: ${subject}`, brandEmail(lines, { label: "Open the console", href: `${site}/console` }), `${text.join("\n")}\n\n${site}/console\n`);
  if (sent) await setSetting("cron", { ...(await getSetting<Record<string, unknown>>("cron", {})), morning: today });
  return sent;
}

/** Big exports are kept two days, then deleted. */
async function clearExports(): Promise<number> {
  const store = adminClient().storage.from("media-private");
  const cutoff = new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10);
  const { data: days } = await store.list("exports", { limit: 1000 });
  let n = 0;
  for (const d of days ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.name) || d.name >= cutoff) continue;
    const { data: files } = await store.list(`exports/${d.name}`, { limit: 1000 });
    const paths = (files ?? []).map((f) => `exports/${d.name}/${f.name}`);
    if (paths.length) await store.remove(paths);
    n += paths.length;
  }
  return n;
}

/** The daily jobs, in order; what each did, for the Health page. */
export async function consoleDaily(): Promise<string[]> {
  const did: string[] = [];
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      const r = await fn();
      did.push(typeof r === "number" || typeof r === "string" ? `${name}: ${r}` : name);
    } catch (e) {
      did.push(`${name}: failed (${e instanceof Error ? e.message : String(e)})`);
      console.error(`[console] ${name}`, e);
    }
  };
  await step("tournament figures", refreshStats);
  await step("snapshot", snapshot);
  await step("Needs you", sweep);
  await step("morning email", async () => ((await morningEmail()) ? "sent" : "not due"));
  await step("old exports cleared", clearExports);
  await setSetting("cron", { ...(await getSetting<Record<string, unknown>>("cron", {})), at: new Date().toISOString(), did });
  return did;
}

// ------------------------------------------------------------ a person's data

/** Everything held about one email, as one file. */
export async function personData(email: string) {
  const db = adminClient();
  const e = email.trim().toLowerCase();
  const { data: acct } = await db.from("accounts").select("id,email,name,created_at,last_seen_at").eq("email", e).maybeSingle();
  const [person, joins, players, fans, subs, requests] = await Promise.all([
    db.from("people").select("*").eq("email", e).maybeSingle(),
    acct ? db.from("account_tournaments").select("tournament_id,role,created_at").eq("account_id", acct.id) : Promise.resolve({ data: [] }),
    db.from("players").select("id,tournament_id,name,nickname,handicap,home_club,bio,best_club,worst_club,weakness,quote").eq("email", e),
    db.from("fans").select("id,tournament_id,name,how_known,status,created_at,verified_at,marketing_at,marketing_wording").eq("email", e),
    db.from("subscribers").select("tournament_id,name,created_at,unsubscribed_at").eq("email", e),
    db.from("data_requests").select("kind,created_at,done_at").eq("email", e),
  ]);
  const playerIds = ((players.data ?? []) as { id: string }[]).map((p) => p.id);
  const fanIds = ((fans.data ?? []) as { id: string }[]).map((f) => f.id);
  const [posts, comments] = await Promise.all([
    playerIds.length || fanIds.length
      ? db
          .from("posts")
          .select("tournament_id,kind,body,media_path,created_at")
          .or([playerIds.length ? `author_player_id.in.(${playerIds.join(",")})` : "", fanIds.length ? `fan_id.in.(${fanIds.join(",")})` : ""].filter(Boolean).join(","))
          .limit(5000)
      : Promise.resolve({ data: [] }),
    playerIds.length || fanIds.length
      ? db
          .from("comments")
          .select("tournament_id,body,created_at")
          .or([playerIds.length ? `author_player_id.in.(${playerIds.join(",")})` : "", fanIds.length ? `fan_id.in.(${fanIds.join(",")})` : ""].filter(Boolean).join(","))
          .limit(5000)
      : Promise.resolve({ data: [] }),
  ]);
  const tids = [
    ...new Set(
      [joins.data, players.data, fans.data, subs.data, posts.data, comments.data]
        .flat()
        .map((r) => (r as { tournament_id?: string } | null)?.tournament_id)
        .filter(Boolean),
    ),
  ] as string[];
  const { data: ts } = tids.length ? await db.from("tournaments").select("id,name").in("id", tids) : { data: [] };
  return {
    about: `Everything ${BRAND.name} holds about ${e}, as of ${new Date().toISOString()}`,
    tournaments: Object.fromEntries((ts ?? []).map((t) => [t.id, t.name])),
    account: acct,
    person: person.data,
    tournamentRoles: joins.data,
    playerProfiles: players.data,
    following: fans.data,
    reportEmails: subs.data,
    posts: posts.data,
    comments: comments.data,
    requests: requests.data,
  };
}

/** Email the person their file (to their own address, and nowhere else). */
export async function sendPersonData(email: string) {
  const data = await personData(email);
  const e = email.trim().toLowerCase();
  const paras = ["Here's a copy of everything we hold about you, attached as a file you can open with any text editor.", "If anything in it is wrong, or you'd like it deleted, reply to this email."];
  await sendOne({ name: BRAND.name }, e, {
    subject: `Your data from ${BRAND.name}`,
    html: brandEmail(paras, null),
    text: paras.join("\n\n"),
    kind: "data copy",
    attachments: [{ filename: "my-data.json", content: JSON.stringify(data, null, 2), contentType: "application/json" }],
  });
}

export const SERVICE_NAMES = Object.fromEntries(SERVICES.map((s) => [s.id, s.name]));
