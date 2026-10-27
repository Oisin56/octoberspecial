import "server-only";
import { adminClient } from "../admin";
import { getSetting } from "../site";
import { mediaUrl } from "../supabase";
import { SERVICE, versionsOf, wordsFor, type WordsDef } from "./words";
import { SERIES, seriesState, stepKey, stepWords, whenWords, type SeriesKey } from "./series";
import { postmarkOn, postmarkSetup } from "./postmark";
import { emailSettings } from "./settings";
import { ref as campaignRef, type Campaign } from "./campaigns";

/** What the console's Email section shows. */

const DAY = 864e5;

export interface RefStats {
  sent: number;
  clicked: number;
  bounced: number;
  complained: number;
  stopped: number;
}
const ZERO: RefStats = { sent: 0, clicked: 0, bounced: 0, complained: 0, stopped: 0 };

export async function refStats(refs: string[]): Promise<Record<string, RefStats>> {
  if (!refs.length) return {};
  const { data } = await adminClient().rpc("email_ref_stats", { refs });
  const out: Record<string, RefStats> = {};
  for (const r of refs) out[r] = { ...ZERO };
  for (const r of (data ?? []) as (RefStats & { ref: string })[]) out[r.ref] = { sent: Number(r.sent), clicked: Number(r.clicked), bounced: Number(r.bounced), complained: Number(r.complained), stopped: Number(r.stopped) };
  return out;
}

/** The emails to the owner and staff: listed, not edited */
export const INTERNAL = [
  { name: "Invite request", about: "To the console's address, when someone asks to run a tournament." },
  { name: "Alerts", about: "To the console's address, once, when something goes red." },
  { name: "The morning summary", about: "To the console's address at 7am: what needs you, what's live, anything amber or red." },
  { name: "Export ready", about: "To whoever asked, with a link for 24 hours." },
];

export async function everyEmail() {
  const { data: counts } = await adminClient().rpc("email_template_counts", { since: new Date(Date.now() - 30 * DAY).toISOString() });
  const n = new Map(((counts ?? []) as { template: string; sent: number }[]).map((r) => [r.template, Number(r.sent)]));
  const { data: saved } = await adminClient().from("email_words").select("key,saved_at,saved_by,version").order("version", { ascending: false });
  const last = new Map<string, { saved_at: string; saved_by: string }>();
  for (const r of saved ?? []) if (!last.has(r.key)) last.set(r.key, r);
  return {
    emails: SERVICE.map((d) => ({ key: d.key, name: d.name, about: d.about, group: d.group, sent30: n.get(d.key) ?? 0, changed: last.get(d.key) ?? null })),
    internal: INTERNAL,
  };
}

export async function oneEmail(def: WordsDef) {
  const [words, versions, { data: counts }] = await Promise.all([wordsFor(def), versionsOf(def.key), adminClient().rpc("email_template_counts", { since: new Date(Date.now() - 30 * DAY).toISOString() })]);
  const sent30 = Number(((counts ?? []) as { template: string; sent: number }[]).find((r) => r.template === def.key)?.sent ?? 0);
  return {
    key: def.key,
    name: def.name,
    about: def.about,
    group: def.group,
    fields: { subject: true, headline: def.words.headline !== null, lines: def.words.lines !== null, button: def.words.button !== null },
    placeholders: def.placeholders,
    locked: def.locked,
    starting: def.words,
    words,
    versions,
    sent30,
  };
}

export async function seriesList() {
  const out = [];
  for (const def of SERIES) {
    const st = await seriesState(def.key);
    const stats = await refStats(st.steps.map((s) => stepKey(def.key, s.id)));
    out.push({
      key: def.key,
      name: def.name,
      about: def.about,
      enabled: st.enabled,
      updated_at: st.updated_at,
      updated_by: st.updated_by,
      steps: st.steps.map((s) => ({ ...s, when: whenWords(s), stats: stats[stepKey(def.key, s.id)] })),
    });
  }
  return out;
}

export async function seriesOne(key: SeriesKey) {
  const def = SERIES.find((s) => s.key === key)!;
  const st = await seriesState(key);
  const stats = await refStats(st.steps.map((s) => stepKey(key, s.id)));
  const steps = [];
  for (const s of st.steps) {
    const wd = stepWords(def, s.id);
    steps.push({ ...s, when: whenWords(s), builtIn: def.steps.some((x) => x.id === s.id), key: wd.key, words: await wordsFor(wd), versions: await versionsOf(wd.key), stats: stats[wd.key] });
  }
  return { key, name: def.name, about: def.about, enabled: st.enabled, froms: def.froms, placeholders: def.placeholders, stream: def.stream, updated_at: st.updated_at, updated_by: st.updated_by, steps };
}

export async function campaignList() {
  const { data } = await adminClient().from("email_campaigns").select("*").order("created_at", { ascending: false }).limit(200);
  const list = (data ?? []) as Campaign[];
  const stats = await refStats(list.map((c) => campaignRef(c.id)));
  return list.map((c) => ({ ...c, stats: stats[campaignRef(c.id)] }));
}

/** Everyone the site won't email, and why. A search, and pages of 50. */
export async function stoppedList(q: string, page: number) {
  const db = adminClient();
  const term = q.trim().toLowerCase().replace(/[%,()]/g, " ").slice(0, 80);
  const size = 50;
  let b = db.from("email_blocks").select("*", { count: "exact" }).order("at", { ascending: false });
  if (term) b = b.ilike("email", `%${term}%`);
  let p = db.from("people").select("email,marketing_stopped_at,marketing_stopped_reason,updates_stopped_at", { count: "exact" }).or("marketing_stopped_at.not.is.null,updates_stopped_at.not.is.null").order("marketing_stopped_at", { ascending: false, nullsFirst: false });
  if (term) p = p.ilike("email", `%${term}%`);
  const [blocks, people] = await Promise.all([b.range(0, (page + 1) * size - 1), p.range(0, (page + 1) * size - 1)]);
  type Row = { email: string; at: string; what: string; why: string; lift: boolean };
  const rows: Row[] = [];
  for (const r of blocks.data ?? [])
    rows.push({ email: r.email, at: r.at, what: "Everything", why: /^Bounced/i.test(r.reason ?? "") ? "Bounced" : r.reason === "Emails kept failing" ? "Kept failing" : r.by_who === "postmark" ? (r.reason ?? "Stopped in Postmark") : "Stopped by you", lift: true });
  for (const r of people.data ?? []) {
    if (rows.some((x) => x.email === r.email)) continue;
    const reason = r.marketing_stopped_reason;
    rows.push({
      email: r.email,
      at: r.marketing_stopped_at ?? r.updates_stopped_at,
      what: r.updates_stopped_at ? "Marketing and updates" : "Marketing",
      why: reason === "spam" ? "Marked as spam" : reason === "unsubscribed" ? "Unsubscribed" : "Stopped by you",
      lift: reason !== "spam" && reason !== "unsubscribed" && !r.updates_stopped_at,
    });
  }
  rows.sort((a, b2) => (b2.at ?? "").localeCompare(a.at ?? ""));
  const total = (blocks.count ?? 0) + (people.count ?? 0);
  return { rows: rows.slice(page * size, (page + 1) * size), total, page, size };
}

/** This month's bounce and complaint rates (updates and marketing), against the lines Gmail and Yahoo hold senders to */
export async function emailHealth() {
  const d = new Date();
  const month = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
  const { data } = await adminClient().rpc("email_health", { since: month });
  const rows = (data ?? []) as { stream: string; sent: number; bounced: number; complained: number }[];
  const sum = (k: "sent" | "bounced" | "complained", streams: string[]) => rows.filter((r) => streams.includes(r.stream)).reduce((t, r) => t + Number(r[k]), 0);
  const lists = ["updates", "marketing"];
  const sent = sum("sent", lists);
  const bounced = sum("bounced", [...lists, "service"]);
  const all = sum("sent", [...lists, "service"]);
  const complained = sum("complained", lists);
  const pm = postmarkOn() ? await postmarkSetup() : null;
  const runs = await getSetting<Record<string, unknown>>("email-runs", {});
  return {
    sending: postmarkOn() ? (pm ? "postmark" : "postmark-not-set-up") : process.env.SMTP_USER ? "mailbox" : "none",
    postmark: pm ? { at: pm.at, server: pm.server, customUnsub: pm.customUnsub } : null,
    month: { sent, all, bounced, complained, bounceRate: all ? bounced / all : 0, complaintRate: sent ? complained / sent : 0 },
    lines: { complaintsWarn: 0.001, complaintsLimit: 0.003, bouncesWarn: 0.02, bouncesLimit: 0.04 },
    runs,
    settings: await emailSettings(),
  };
}

export async function photoList() {
  const { data } = await adminClient().from("email_photos").select("*").order("added_at", { ascending: false }).limit(60);
  return (data ?? []).map((p) => ({ id: p.id, name: p.name, src: mediaUrl(p.path), added_at: p.added_at }));
}

/** Finished films from tournaments anyone can watch, newest first, for a campaign's film block */
export async function filmList() {
  const db = adminClient();
  const { data: reels } = await db.from("reels").select("id,tournament_id,plan,done_at").eq("status", "done").order("done_at", { ascending: false }).limit(60);
  const ids = [...new Set((reels ?? []).map((r) => r.tournament_id))];
  const { data: ts } = ids.length ? await db.from("tournaments").select("id,name,privacy").in("id", ids) : { data: [] };
  const open = new Map((ts ?? []).filter((t) => t.privacy !== "private").map((t) => [t.id, t.name]));
  return (reels ?? []).filter((r) => open.has(r.tournament_id)).map((r) => ({ id: r.id, title: `${(r.plan as { title?: string } | null)?.title ?? "Highlights"}: ${open.get(r.tournament_id)}`, done_at: r.done_at }));
}
