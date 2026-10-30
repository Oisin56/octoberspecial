import { after } from "next/server";
import { adminClient } from "@/lib/admin";
import { forgetSignout, getAccount, ownerClaimed, setSession } from "@/lib/auth";
import { ConsoleDenied, consoleEmail, requireConsole, type ConsoleUser } from "@/lib/console-auth";
import { SignInError, organiserSession, sendSignIn } from "@/lib/accounts";
import { logActivity } from "@/lib/activity";
import { settle } from "@/lib/queue";
import { activityList, health, money, needsCount, needsList, overview, peopleList, personDetail, search, tournamentDetail, tournamentList } from "@/lib/console-data";
import { sendPersonData } from "@/lib/console-jobs";
import { bad, crossSite, CROSS_SITE, json, siteOrigin } from "@/lib/server-data";
import { budgets, forgetSpent, DEFAULT_BUDGETS, type Budgets } from "@/lib/usage";
import { getSetting, setSetting } from "@/lib/site";
import { approveInvite } from "@/lib/invites";
import { EMAIL_RE, mailConfigured } from "@/lib/email";
import { deliver } from "@/lib/mail/send";
import { filmFailedMail, followWaitingMail, inviteApprovedMail } from "@/lib/mail/emails";
import { forgetBlocked } from "@/lib/email-log";
import { kick } from "@/lib/filmJob";
import { kickResearch, startResearch } from "@/lib/research";
import { passkeyCount } from "@/lib/owner-check";
import { BRAND } from "@/lib/brand";
import type { TournamentRow } from "@/lib/types";

export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store, private" };
const ok = (data: unknown) => Response.json(data, { headers: NO_STORE });

function denied(e: unknown) {
  if (e instanceof ConsoleDenied || e instanceof SignInError) return bad(e.message, e.status);
  console.error("[console]", e);
  return Response.json({ error: "That didn't work just now. Try again." }, { status: 500 });
}

const num = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : 0);

/** The console's pages: what each one shows. */
export async function GET(req: Request) {
  // Only the console's own pages ask (a link on another site can't add this, so can't look at a person in your name)
  if (req.headers.get("x-console") !== "1") return bad("Open this from the console", 400);
  const u = new URL(req.url);
  const view = u.searchParams.get("view") ?? "overview";
  const p = (k: string) => u.searchParams.get(k) ?? undefined;
  try {
    if (view === "me") {
      // Not in yet: who's signed in, and whether this email may open the console
      const a = await getAccount();
      const user = await requireConsole().catch(() => null);
      if (!user) {
        const role = a ? await consoleEmail(a.email) : null;
        return ok({ user: null, email: a?.email ?? null, allowed: !!role, passkeys: role && a ? await passkeyCount(a.id) : 0, pin: !(await ownerClaimed()) && !!process.env.ORGANISER_PIN });
      }
      return ok({ user, needs: await needsCount() });
    }
    const user = await requireConsole();
    switch (view) {
      case "overview": {
        const o = await overview();
        // Support never see money
        return ok(user.role === "owner" ? o : { ...o, figures: o.figures.filter((f) => !f.money) });
      }
      case "needs": {
        const l = await needsList({ page: num(p("page") ?? null), kind: p("kind"), snoozed: p("snoozed") === "1", mine: p("mine") === "1" ? user.email : undefined });
        return ok(user.role === "owner" ? l : { ...l, items: l.items.map((i) => (i.kind === "spend" ? { ...i, detail: null } : i)) });
      }
      case "tournaments": {
        const owner = user.role === "owner";
        const l = await tournamentList({ q: p("q"), status: p("status"), privacy: p("privacy"), month: p("month"), sort: owner || p("sort") !== "cost_cents" ? p("sort") : undefined, dir: p("dir"), page: num(p("page") ?? null) });
        return ok(owner ? l : { ...l, rows: (l.rows as Record<string, unknown>[]).map(({ cost_cents: _c, ...r }) => (void _c, r)) });
      }
      case "tournament": {
        const d = await tournamentDetail(String(p("id") ?? ""));
        if (!d) return bad("Tournament not found", 404);
        // Support don't see what tournaments cost, or their limits
        if (user.role === "owner") return ok(d);
        const { ai_cap_cents: _a, broadcast_cap_cents: _b, ...tournament } = d.tournament;
        const stats = d.stats ? (({ cost_cents: _c, ...rest }) => rest)(d.stats as Record<string, unknown>) : null;
        return ok({ ...d, tournament, stats, money: null });
      }
      case "people":
        return ok(await peopleList({ q: p("q"), role: p("role"), marketing: p("marketing"), active: p("active"), month: p("month"), sort: p("sort"), dir: p("dir"), page: num(p("page") ?? null) }));
      case "person": {
        const d = await personDetail(String(p("id") ?? ""));
        if (!d) return bad("Nobody with that email", 404);
        await logActivity(user, "person.view", { person: d.email });
        return ok(d);
      }
      case "money":
        await requireConsole("owner");
        return ok(await money());
      case "health":
        return ok(await health());
      case "activity": {
        const l = await activityList({ q: p("q"), who: p("who"), action: p("action"), from: p("from"), to: p("to"), page: num(p("page") ?? null) });
        return ok(user.role === "owner" ? l : { ...l, rows: l.rows.map((r) => ({ ...r, detail: null })) });
      }
      case "search":
        return ok(await search(String(p("q") ?? "")));
      case "settings": {
        const [staff, c] = await Promise.all([adminClient().from("staff").select("*").order("added_at"), getSetting<{ email?: string }>("console", {})]);
        return ok({ staff: staff.data ?? [], consoleEmail: c.email ?? null, ownerEmail: (process.env.OWNER_EMAIL ?? "").toLowerCase() || null, role: user.role });
      }
      default:
        return bad("Unknown view");
    }
  } catch (e) {
    return denied(e);
  }
}

/** Everything done in the console: each action is written into the activity record. */
export async function POST(req: Request) {
  if (crossSite(req)) return bad(CROSS_SITE, 403);
  const b = await req.json().catch(() => ({}));
  try {
    const user = await requireConsole();
    const a = String(b.action ?? "");
    const area = a.split(".")[0];
    if (area === "needs") return await needs(user, b, req);
    if (area === "tournament") return await tournament(user, b, req);
    if (area === "person") return await person(user, b);
    if (area === "money") return await moneyAction(user, b);
    if (area === "settings") return await settings(user, b);
    return bad("Unknown action");
  } catch (e) {
    return denied(e);
  }
}

// ------------------------------------------------------------ Needs you

async function needs(user: ConsoleUser, b: Record<string, unknown>, req: Request) {
  const db = adminClient();
  const { data: item } = await db.from("queue").select("*").eq("id", String(b.id ?? "")).maybeSingle();
  if (!item) return bad("That item is gone", 404);
  if (item.resolved_at) return bad("That's been cleared already", 409);
  const { data: t } = item.tournament_id ? await db.from("tournaments").select("*").eq("id", item.tournament_id).maybeSingle() : { data: null };
  const on = { tournamentId: item.tournament_id, tournamentName: t?.name ?? null, person: item.person, detail: { item: item.title } };
  const done = async (resolution: string, action = "queue.done") => {
    await db.from("queue").update({ resolved_at: new Date().toISOString(), resolved_by: user.email, resolution }).eq("id", item.id);
    await logActivity(user, action, { ...on, detail: { item: item.title, resolution } });
    return json({ ok: true });
  };
  // Each button belongs to its kind of item
  const KIND: Record<string, string[]> = {
    "needs.hide": ["report"],
    "needs.keep": ["report"],
    "needs.mute": ["report"],
    "needs.retry": ["film"],
    "needs.tell": ["film"],
    "needs.approve": ["invite"],
    "needs.decline": ["invite"],
    "needs.remind": ["follow_wait"],
    "needs.block": ["email_failing"],
    "needs.research": ["research"],
    "needs.sendcopy": ["data_request"],
    "needs.requestdone": ["data_request"],
  };
  const want = KIND[String(b.action)];
  if (want && !want.includes(item.kind)) return bad("That button isn't for this item");
  const ownerOnly = async () => {
    if (user.role !== "owner") throw new ConsoleDenied("Only the owner can do that", 403);
  };

  switch (b.action) {
    case "needs.snooze": {
      await db.from("queue").update({ snoozed_until: new Date(Date.now() + 864e5).toISOString() }).eq("id", item.id);
      await logActivity(user, "queue.snooze", on);
      return json({ ok: true });
    }
    case "needs.assign": {
      const to = String(b.to ?? "").toLowerCase();
      if (to && !(await consoleEmail(to))) return bad("That isn't a member of staff");
      await db.from("queue").update({ assigned_to: to || null }).eq("id", item.id);
      await logActivity(user, "queue.assign", { ...on, detail: { item: item.title, to: to || null } });
      return json({ ok: true });
    }
    case "needs.done":
      return done(String(b.resolution ?? "Done"));

    // A reported post or comment
    case "needs.hide":
    case "needs.keep":
    case "needs.mute": {
      const table = (item.detail?.table as string) === "comments" ? "comments" : "posts";
      const { data: row } = await db.from(table).select("id,fan_id,author_name").eq("id", item.subject).maybeSingle();
      if (!row) return done("It was deleted");
      if (b.action === "needs.hide") {
        await db.from(table).update({ hidden: true, hidden_by_reports: false }).eq("id", row.id);
        return done("Hidden", "report.hide");
      }
      if (b.action === "needs.keep") {
        await db.from(table).update({ hidden: false, hidden_by_reports: false }).eq("id", row.id);
        await db.from("reports").delete().eq(table === "posts" ? "post_id" : "comment_id", row.id);
        return done("Kept", "report.keep");
      }
      if (!row.fan_id) return bad("This was posted by a player. Players can't be stopped from posting, but the post can be hidden.");
      await db.from("fans").update({ blocked: true }).eq("id", row.fan_id);
      await db.from(table).update({ hidden: true, hidden_by_reports: false }).eq("id", row.id);
      return done(`Hid it and stopped ${row.author_name} posting`, "report.mute");
    }

    // A film
    case "needs.retry": {
      const { data: r } = await db.from("reels").select("*").eq("id", item.subject).maybeSingle();
      if (!r) return done("The film was deleted");
      await db
        .from("reels")
        .update({ status: "planning", error: null, stage_at: null, stage: r.stage && r.stage !== "done" && r.stage !== "rendering" ? r.stage : r.plan ? "render" : "plan" })
        .eq("id", r.id);
      const origin = siteOrigin(req);
      after(() => kick(origin, r.id));
      return done("Tried again", "film.retry");
    }
    case "needs.tell": {
      if (!t || !mailConfigured()) return bad("Email isn't set up, or the tournament is gone");
      const emails = await organiserEmails(t.id);
      const link = `${siteOrigin(req)}/t/${t.slug}/admin`;
      for (const e of emails) await deliver(await filmFailedMail(t, link, e)).catch(() => null);
      await logActivity(user, "film.tell", on);
      return json({ ok: true, told: emails.length });
    }

    // An invite request
    case "needs.approve": {
      if (!mailConfigured()) return bad("Email isn't set up, so the invite can't be sent", 500);
      const r = await approveInvite(item.subject);
      if (!r) return done("It had been answered already");
      await deliver(await inviteApprovedMail(r.invite.name, r.invite.email, `${siteOrigin(req)}/new?invite=${r.token}`));
      return done("Approved", "invite.approve");
    }
    case "needs.decline": {
      await db.from("invite_requests").update({ status: "declined", token_hash: null }).eq("id", item.subject).is("used_at", null);
      return done("Declined", "invite.decline");
    }

    // Follow requests waiting
    case "needs.remind": {
      if (!t || !mailConfigured()) return bad("Email isn't set up, or the tournament is gone");
      const { data: waiting } = await db.from("fans").select("name").eq("tournament_id", t.id).eq("status", "asking");
      const emails = await organiserEmails(t.id);
      for (const e of emails) await deliver(await followWaitingMail(t, (waiting ?? []).map((w) => w.name), `${siteOrigin(req)}/t/${t.slug}/following`, e)).catch(() => null);
      await db.from("queue").update({ snoozed_until: new Date(Date.now() + 3 * 864e5).toISOString() }).eq("id", item.id);
      await logActivity(user, "queue.done", { ...on, detail: { item: item.title, resolution: "Reminded the organisers" } });
      return json({ ok: true, told: emails.length });
    }

    // Emails not getting through
    case "needs.block": {
      await ownerOnly();
      await db.from("email_blocks").upsert({ email: item.subject, by_who: user.email, reason: "Emails kept failing" });
      forgetBlocked(item.subject);
      return done("Stopped emailing it", "email.block");
    }

    // Course research
    case "needs.research": {
      const { data: row } = await db.from("course_library").select("ref,name,work").eq("ref", item.subject).maybeSingle();
      if (!row) return done("The course is gone");
      const w = (row.work ?? {}) as { name?: string; location?: string | null; card?: unknown[] };
      const go = await startResearch({ ref: row.ref, name: w.name ?? row.name, location: w.location ?? null, card: (w.card ?? []) as never }, true);
      if (go) {
        const origin = siteOrigin(req);
        after(() => kickResearch(origin, row.ref));
      }
      return done(go ? "Researching again" : "Couldn't start it (today's research limit, or an organiser wrote the guide)", "research.retry");
    }

    // A data request
    case "needs.sendcopy": {
      await ownerOnly();
      const { data: r } = await db.from("data_requests").select("*").eq("id", item.subject).maybeSingle();
      if (!r) return done("The request is gone");
      await sendPersonData(r.email);
      await db.from("data_requests").update({ done_at: new Date().toISOString(), done_by: user.email }).eq("id", r.id);
      await logActivity(user, "person.copy", { person: r.email });
      return done("Sent them their copy");
    }
    case "needs.requestdone": {
      await ownerOnly();
      await db.from("data_requests").update({ done_at: new Date().toISOString(), done_by: user.email }).eq("id", item.subject);
      return done("Done");
    }
  }
  return bad("Unknown action");
}

async function organiserEmails(tid: string): Promise<string[]> {
  const db = adminClient();
  const { data: rows } = await db.from("account_tournaments").select("account_id").eq("tournament_id", tid).eq("role", "organiser");
  const ids = (rows ?? []).map((r) => r.account_id);
  const { data: accts } = ids.length ? await db.from("accounts").select("email").in("id", ids) : { data: [] };
  return (accts ?? []).map((x) => x.email);
}

// ------------------------------------------------------------ a tournament

async function tournament(user: ConsoleUser, b: Record<string, unknown>, req: Request) {
  const db = adminClient();
  const { data: t } = await db.from("tournaments").select("*").eq("id", String(b.id ?? "")).maybeSingle();
  if (!t) return bad("Tournament not found", 404);
  const on = { tournamentId: t.id, tournamentName: t.name };
  switch (b.action) {
    case "tournament.open": {
      // In as its organiser, to help (marked as the owner's or support's visit)
      const s = await organiserSession(t.id, user.role === "owner" ? "owner" : "staff");
      await setSession(t.id, { ...s, name: user.role === "owner" ? s.name : "Support" });
      await logActivity(user, "tournament.open", on);
      return json({ slug: t.slug });
    }
    case "tournament.link": {
      const emails = await organiserEmails(t.id);
      if (!emails.length) return bad("Nobody organises this one with an email yet");
      for (const e of emails) await sendSignIn(siteOrigin(req), e, { next: `/t/${t.slug}/admin`, intro: `Here's a new link to sign in to ${t.name}.` });
      await logActivity(user, "tournament.link", { ...on, detail: { to: emails } });
      return json({ ok: true, sent: emails.length });
    }
    case "tournament.pause": {
      if (t.console_paused) return json({ ok: true });
      // What the organiser had on, kept to put back
      const was = { ai_on: t.ai_on, auto_bulletins: t.auto_bulletins, video_enabled: t.video_enabled, broadcast_on: t.broadcast_on };
      await db.from("tournaments").update({ ai_on: false, auto_bulletins: false, video_enabled: false, broadcast_on: false, console_paused: was }).eq("id", t.id);
      await logActivity(user, b.action, on);
      return json({ ok: true });
    }
    case "tournament.resume": {
      const was = t.console_paused as Record<string, boolean> | null;
      if (!was) return json({ ok: true });
      await db.from("tournaments").update({ ai_on: !!was.ai_on, auto_bulletins: !!was.auto_bulletins, video_enabled: !!was.video_enabled, broadcast_on: !!was.broadcast_on, console_paused: null }).eq("id", t.id);
      await logActivity(user, b.action, on);
      return json({ ok: true });
    }
    case "tournament.limits": {
      if (user.role !== "owner") return bad("Only the owner can do that", 403);
      const ai = Math.round(Number(b.aiDollars) * 100);
      const clips = Math.round(Number(b.clipDollars) * 100);
      if (!(ai >= 0 && ai <= 100000) || !(clips >= 0 && clips <= 100000)) return bad("Check the numbers");
      await db.from("tournaments").update({ ai_cap_cents: ai, broadcast_cap_cents: clips }).eq("id", t.id);
      await logActivity(user, "tournament.limits", { ...on, detail: { writing: ai, clips } });
      return json({ ok: true });
    }
  }
  return bad("Unknown action");
}

// ------------------------------------------------------------ a person

async function person(user: ConsoleUser, b: Record<string, unknown>) {
  const db = adminClient();
  const email = String(b.email ?? "").trim().toLowerCase();
  const { data: p } = await db.from("people").select("*").eq("email", email).maybeSingle();
  if (!p) return bad("Nobody with that email", 404);
  // Where their page is (its address carries an id, not the email)
  if (b.action === "person.find") return json({ id: p.id });
  const owner = async () => {
    if (user.role !== "owner") throw new ConsoleDenied("Only the owner can do that", 403);
  };
  switch (b.action) {
    case "person.copy": {
      await owner();
      if (!mailConfigured()) return bad("Email isn't set up", 500);
      await sendPersonData(email);
      await logActivity(user, "person.copy", { person: email });
      return json({ ok: true });
    }
    case "person.signout": {
      // The owner's and staff's own accounts: only the owner signs those out
      if (user.role !== "owner" && (await consoleEmail(email))) return bad("Only the owner can sign out a console account", 403);
      const { data: acct } = await db.from("accounts").select("id").eq("email", email).maybeSingle();
      if (!acct) return bad("They've never signed in with their email, so there's nothing to sign out");
      await db.from("accounts").update({ signout_at: new Date().toISOString() }).eq("id", acct.id);
      forgetSignout(acct.id);
      await logActivity(user, "person.signout", { person: email });
      return json({ ok: true });
    }
    case "person.nomarketing": {
      await db.from("people").update({ marketing_stopped_at: new Date().toISOString() }).eq("email", email);
      await logActivity(user, "person.nomarketing", { person: email });
      return json({ ok: true });
    }
    case "person.unblock": {
      await owner();
      await db.from("email_blocks").delete().eq("email", email);
      forgetBlocked(email);
      await logActivity(user, "email.unblock", { person: email });
      return json({ ok: true });
    }
    case "person.email": {
      await owner();
      const to = String(b.to ?? "").trim().toLowerCase();
      if (!EMAIL_RE.test(to)) return bad("That email address doesn't look right");
      if (to === email) return json({ ok: true, email });
      const [{ data: taken }, { data: takenP }] = await Promise.all([db.from("accounts").select("id").eq("email", to).maybeSingle(), db.from("people").select("email").eq("email", to).maybeSingle()]);
      if (taken || takenP) return bad("That email belongs to someone else already");
      // Everywhere the address is kept: their record first (so it moves, consent and all), then the rest
      const { error: moved } = await db.from("people").update({ email: to }).eq("email", email);
      if (moved) return bad("Couldn't change it just now. Try again.", 500);
      await db.from("accounts").update({ email: to }).eq("email", email);
      await db.from("players").update({ email: to }).eq("email", email);
      await db.from("fans").update({ email: to }).eq("email", email);
      await db.from("subscribers").update({ email: to }).eq("email", email);
      await db.from("email_failures").delete().eq("email", email);
      await settle("email_failing", email, user.email, "The address was corrected");
      await logActivity(user, "person.email", { person: to, detail: { was: email } });
      return json({ ok: true, email: to });
    }
    case "person.delete": {
      await owner();
      const { data: r } = await db.from("data_requests").insert({ email, kind: "delete" }).select("id").single();
      if (r) {
        const { raise } = await import("@/lib/queue");
        await raise({ kind: "data_request", subject: r.id, person: email, title: `Delete ${email}`, dueAt: new Date(Date.now() + 30 * 864e5).toISOString(), detail: { kind: "delete" } });
      }
      await logActivity(user, "person.delete", { person: email });
      return json({ ok: true });
    }
  }
  return bad("Unknown action");
}

// ------------------------------------------------------------ money

async function moneyAction(user: ConsoleUser, b: Record<string, unknown>) {
  if (user.role !== "owner") return bad("Only the owner can do that", 403);
  if (b.action === "money.budgets") {
    const now = await budgets();
    const next: Budgets = { ...now };
    for (const k of Object.keys(DEFAULT_BUDGETS) as (keyof Budgets)[]) {
      const v = (b.budgets as Record<string, unknown> | undefined)?.[k];
      if (v === undefined) continue;
      const cents = Math.round(Number(v) * 100);
      if (!(cents >= 0 && cents <= 10_000_000)) return bad("Check the numbers");
      next[k] = cents;
    }
    await setSetting("budgets", next);
    forgetSpent();
    await logActivity(user, "money.budgets", { detail: { from: now, to: next } });
    return json({ ok: true, budgets: next });
  }
  if (b.action === "money.bill") {
    const month = String(b.month ?? "");
    const service = String(b.service ?? "");
    const cents = Math.round(Number(b.dollars) * 100);
    if (!/^\d{4}-\d{2}$/.test(month) || !(service in DEFAULT_BUDGETS) || !(cents >= 0 && cents <= 10_000_000)) return bad("Check the numbers");
    const bills = await getSetting<Record<string, Record<string, number>>>("bills", {});
    bills[month] = { ...(bills[month] ?? {}), [service]: cents };
    await setSetting("bills", bills);
    await logActivity(user, "money.bill", { detail: { month, service, cents } });
    return json({ ok: true });
  }
  return bad("Unknown action");
}

// ------------------------------------------------------------ settings

async function settings(user: ConsoleUser, b: Record<string, unknown>) {
  if (user.role !== "owner") return bad("Only the owner can change settings", 403);
  const db = adminClient();
  if (b.action === "settings.console-email") {
    const email = String(b.email ?? "").trim().toLowerCase();
    if (email && !EMAIL_RE.test(email)) return bad("That email address doesn't look right");
    await setSetting("console", { email: email || null });
    await logActivity(user, "settings.console-email", { detail: { email: email || null } });
    return json({ ok: true });
  }
  if (b.action === "settings.staff-add") {
    const email = String(b.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return bad("That email address doesn't look right");
    if (email === (process.env.OWNER_EMAIL ?? "").toLowerCase()) return bad("That's the owner's email");
    await db.from("staff").upsert({ email, role: "support", added_by: user.email, added_at: new Date().toISOString(), removed_at: null });
    await logActivity(user, "settings.staff-add", { person: email });
    return json({ ok: true });
  }
  if (b.action === "settings.staff-remove") {
    const email = String(b.email ?? "").trim().toLowerCase();
    await db.from("staff").update({ removed_at: new Date().toISOString() }).eq("email", email);
    await logActivity(user, "settings.staff-remove", { person: email });
    return json({ ok: true });
  }
  return bad("Unknown action");
}
