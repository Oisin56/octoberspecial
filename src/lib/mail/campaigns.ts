import "server-only";
import { adminClient } from "../admin";
import { mediaUrl } from "../supabase";
import { claude, canSpend } from "../usage";
import { alert } from "../console-mail";
import { logActivity, SYSTEM } from "../activity";
import { compose, type Piece } from "./design";
import { BRAND_LOOK, BRAND_FROM, firstName, listFooter, oneTap, supportReplyTo } from "./emails";
import { deliverMany, newSendId, type Outgoing } from "./send";
import { tapLink } from "./tokens";
import { fill, placeholdersIn } from "./words";
import { dublinToday, marketingGate } from "./limits";
import { allRows } from "./pages";

/**
 * Campaigns: one-off emails written in the console from a few blocks. Only people with the marketing tick (and news
 * and offers on) can get one, at most one marketing email a week, never during their trip, and they go at 10am Irish
 * time (or now, when the owner says so) in batches. Support can write and test; only the owner sends.
 */

export type Block =
  | { type: "headline"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "photo"; photo: string; alt: string; href?: string }
  | { type: "button"; label: string; href: string }
  | { type: "film"; reel: string }
  | { type: "quote"; text: string; by: string };

export interface Audience {
  roles?: string[];
  /** "30" | "90" | "365": took part in that many days; "idle": not for a year */
  active?: string;
  /** "1" | "2" (two or more) */
  trips?: string;
}

export interface Campaign {
  id: string;
  name: string;
  subject: string;
  blocks: Block[];
  audience: Audience;
  status: "draft" | "scheduled" | "sending" | "paused" | "sent" | "stopped";
  send_on: string | null;
  created_by: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  sent_by: string | null;
  planned: number | null;
  note: string | null;
}

export const PLACEHOLDERS = ["first name", "tournament"];
export const ref = (id: string) => `campaign:${id}`;

const UUID = /^[0-9a-f-]{36}$/i;
const clean = (s: unknown, n: number) => String(s ?? "").replace(/\r/g, "").trim().slice(0, n);
const urlOk = (u: string) => /^https:\/\/[^\s<>"]+$/i.test(u) || /^\/[\w/?=&%.#-]*$/.test(u);

/** Tidy blocks from the console: known kinds only, sensible lengths, links that are links. An error in words, or null. */
export function cleanBlocks(raw: unknown): { blocks: Block[]; error: string | null } {
  const out: Block[] = [];
  if (!Array.isArray(raw)) return { blocks: out, error: null };
  for (const b of raw.slice(0, 40) as Record<string, unknown>[]) {
    switch (b?.type) {
      case "headline":
        out.push({ type: "headline", text: clean(b.text, 150) });
        break;
      case "paragraph":
        out.push({ type: "paragraph", text: clean(b.text, 2000) });
        break;
      case "photo":
        if (typeof b.photo === "string" && UUID.test(b.photo)) out.push({ type: "photo", photo: b.photo, alt: clean(b.alt, 200), ...(b.href ? { href: clean(b.href, 500) } : {}) });
        break;
      case "button":
        out.push({ type: "button", label: clean(b.label, 40), href: clean(b.href, 500) });
        break;
      case "film":
        if (typeof b.reel === "string" && UUID.test(b.reel)) out.push({ type: "film", reel: b.reel });
        break;
      case "quote":
        out.push({ type: "quote", text: clean(b.text, 400), by: clean(b.by, 80) });
        break;
    }
  }
  for (const b of out) {
    const words = b.type === "headline" || b.type === "paragraph" ? b.text : b.type === "button" ? b.label : b.type === "quote" ? `${b.text} ${b.by}` : "";
    const bad = placeholdersIn(words).find((p) => !PLACEHOLDERS.includes(p));
    if (bad) return { blocks: out, error: `{${bad}} isn't something a campaign can fill in. It can use {first name} and {tournament}.` };
    if (/[<>]/.test(words)) return { blocks: out, error: "Leave out < and > (the email's look takes care of the styling)" };
    if ((b.type === "button" || (b.type === "photo" && b.href)) && !urlOk(b.type === "button" ? b.href : b.href!)) return { blocks: out, error: "A link needs to start with https:// (or / for a page on this site)" };
  }
  return { blocks: out, error: null };
}

export function cleanAudience(raw: unknown): Audience {
  const a = (raw ?? {}) as Record<string, unknown>;
  const roles = Array.isArray(a.roles) ? (a.roles as unknown[]).filter((r): r is string => typeof r === "string" && ["organiser", "player", "follower", "subscriber"].includes(r)) : [];
  return { roles, active: ["30", "90", "365", "idle"].includes(String(a.active)) ? String(a.active) : "", trips: ["1", "2"].includes(String(a.trips)) ? String(a.trips) : "" };
}

/** Everyone a campaign would go to now (before this week's limit and trips) */
export async function audience(a: Audience): Promise<{ email: string; name: string | null; tournament: string | null }[]> {
  const args = {
    want_roles: a.roles?.length ? a.roles : null,
    active_days: a.active && a.active !== "idle" ? Number(a.active) : null,
    idle_days: a.active === "idle" ? 365 : null,
    min_trips: a.trips === "2" ? 2 : a.trips === "1" ? 1 : null,
    max_trips: a.trips === "1" ? 1 : null,
  };
  const db = adminClient();
  try {
    // A page at a time (the database hands back 1,000 rows a request); the function sorts by email
    return await allRows<{ email: string; name: string | null; tournament: string | null }>((from, to) => db.rpc("campaign_audience", args).range(from, to));
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    throw new Error(/campaign_audience/.test(m) ? "This needs the latest database update (run supabase/schema.sql)" : m);
  }
}

export async function audienceCount(a: Audience) {
  const list = await audience(a);
  const gate = await marketingGate();
  let ready = 0;
  let held = 0;
  for (const p of list) (gate.why(p.email) ? held++ : ready++);
  return { total: list.length, ready, held };
}

// ------------------------------------------------------------ the email

/** The photos and films a campaign shows, looked up once (not once per person) */
export interface Resolved {
  photos: Map<string, string>;
  films: Map<string, { still: string | null; title: string; href: string }>;
}
export async function resolveBlocks(blocks: Block[], site: string): Promise<Resolved> {
  const db = adminClient();
  const photos = new Map<string, string>();
  const films = new Map<string, { still: string | null; title: string; href: string }>();
  const ids = blocks.filter((b): b is Extract<Block, { type: "photo" }> => b.type === "photo").map((b) => b.photo);
  if (ids.length) {
    const { data } = await db.from("email_photos").select("id,path").in("id", ids);
    for (const p of data ?? []) {
      const src = mediaUrl(p.path);
      if (src) photos.set(p.id, src.startsWith("/") ? `${site}${src}` : src);
    }
  }
  for (const b of blocks) if (b.type === "film" && !films.has(b.reel)) {
    const f = await filmInfo(b.reel, site);
    if (f) films.set(b.reel, f);
  }
  return { photos, films };
}

function blockPieces(blocks: Block[], vars: Record<string, string>, go: (url: string) => string, site: string, r: Resolved): Piece[] {
  const abs = (u: string) => (u.startsWith("/") ? `${site}${u}` : u);
  const out: Piece[] = [];
  for (const b of blocks) {
    if (b.type === "headline" && b.text) out.push({ type: "h", text: fill(b.text, vars) });
    if (b.type === "paragraph" && b.text) for (const p of b.text.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean)) out.push({ type: "p", text: fill(p, vars) });
    if (b.type === "quote" && b.text) out.push({ type: "quote", text: fill(b.text, vars), by: fill(b.by, vars) });
    if (b.type === "button" && b.label && b.href) out.push({ type: "button", label: fill(b.label, vars), href: go(abs(b.href)) });
    if (b.type === "photo") {
      const src = r.photos.get(b.photo);
      if (src) out.push({ type: "photo", src, alt: b.alt || "Photo", href: b.href ? go(abs(b.href)) : null });
    }
    if (b.type === "film") {
      const f = r.films.get(b.reel);
      if (f) out.push({ type: "film", src: f.still, alt: f.title, href: go(f.href), caption: f.title });
    }
  }
  return out;
}

/** A finished film from a tournament anyone can watch: its still, its title, its page */
export async function filmInfo(reelId: string, site: string): Promise<{ still: string | null; title: string; href: string } | null> {
  const db = adminClient();
  const { data: r } = await db.from("reels").select("id,tournament_id,video_path,plan,status").eq("id", reelId).maybeSingle();
  if (!r || r.status !== "done") return null;
  const { data: t } = await db.from("tournaments").select("name,slug,privacy").eq("id", r.tournament_id).maybeSingle();
  if (!t || t.privacy === "private") return null;
  const still = r.video_path && !String(r.video_path).startsWith("http") ? mediaUrl(`${r.video_path}.jpg`) : null;
  return { still, title: `${(r.plan as { title?: string } | null)?.title ?? "Highlights"}: ${t.name}`, href: `${site}/t/${t.slug}/film?reel=${r.id}` };
}

export async function campaignMail(c: Pick<Campaign, "id" | "subject" | "blocks">, p: { email: string; name: string | null; tournament: string | null }, site: string, resolved?: Resolved, replyTo?: string | null): Promise<Outgoing> {
  const r = resolved ?? (await resolveBlocks(c.blocks, site));
  const sendId = newSendId();
  const vars = { "first name": firstName(p.name), tournament: p.tournament ?? "" };
  // A headline first is the email's headline
  const lead = c.blocks[0]?.type === "headline" && c.blocks[0].text ? fill(c.blocks[0].text, vars) : null;
  const body = blockPieces(lead ? c.blocks.slice(1) : c.blocks, vars, (url) => tapLink(site, sendId, url), site, r);
  const m = compose({
    subject: fill(c.subject, vars),
    look: BRAND_LOOK,
    headline: lead,
    body,
    footer: await listFooter(site, p.email, "You're getting this because you asked for news from MyGolfBroadcast.", "m", sendId),
    fallbackLink: false,
  });
  return {
    ...m,
    to: p.email,
    sendId,
    kind: "campaign",
    stream: "marketing",
    template: null,
    ref: ref(c.id),
    fromName: BRAND_FROM,
    replyTo: replyTo === undefined ? await supportReplyTo() : replyTo,
    unsubscribe: oneTap(site, p.email, "m", sendId),
  };
}

// ------------------------------------------------------------ sending

const WARN = { complaints: 0.003, bounces: 0.05, after: 100 };

/** Send (or carry on sending) one campaign. Stops when it's stopped; pauses itself if complaints or bounces climb. */
export async function sendCampaign(id: string, site: string): Promise<{ sent: number; status: string }> {
  const db = adminClient();
  const { data: c } = await db.from("email_campaigns").select("*").eq("id", id).maybeSingle();
  if (!c || c.status !== "sending") return { sent: 0, status: c?.status ?? "gone" };
  // A run that died part-way leaves people "queued": after a quarter of an hour they're tried again
  await db.from("email_sends").update({ status: "failed", error: "Never sent (the run stopped)" }).eq("ref", ref(id)).eq("status", "queued").lt("at", new Date(Date.now() - 15 * 60e3).toISOString());
  const list = await audience(c.audience as Audience);
  const gate = await marketingGate();
  // Those who have it already (an earlier run) are skipped; the rest pass this week's limit and trips
  const had = await allRows<{ email: string }>((a, b) => db.from("email_sends").select("email").eq("ref", ref(id)).neq("status", "failed").order("id").range(a, b));
  const already = new Set(had.map((r) => r.email));
  const go = list.filter((p) => !already.has(p.email) && gate.take(p.email));
  const resolved = await resolveBlocks((c as Campaign).blocks, site);
  const replyTo = await supportReplyTo();
  const mails: Outgoing[] = [];
  for (const p of go) mails.push(await campaignMail(c as Campaign, p, site, resolved, replyTo));
  let paused: string | null = null;
  const r = await deliverMany(mails, {
    between: async () => {
      const { data: now } = await db.from("email_campaigns").select("status").eq("id", id).maybeSingle();
      if (now?.status !== "sending") return false;
      const { data: s } = await db.rpc("email_ref_stats", { refs: [ref(id)] });
      const row = (s ?? [])[0] as { sent: number; bounced: number; complained: number } | undefined;
      if (row && row.sent >= WARN.after) {
        if (row.complained / row.sent >= WARN.complaints) paused = `${row.complained} people marked it as spam`;
        else if (row.bounced / row.sent >= WARN.bounces) paused = `${row.bounced} emails bounced`;
      }
      return !paused;
    },
  });
  if (paused) {
    await db.from("email_campaigns").update({ status: "paused", note: `Paused itself: ${paused}` }).eq("id", id);
    await logActivity(SYSTEM, "campaign.paused", { detail: { campaign: c.name, why: paused } });
    await alert(`The campaign "${c.name}" paused itself`, [`${paused}, so it stopped part-way to protect the site's name with Gmail.`, "Look at Email, Campaigns before sending the rest."], "/console/email/campaigns");
    return { sent: r.sent, status: "paused" };
  }
  if (r.stopped) return { sent: r.sent, status: "stopped" };
  await db.from("email_campaigns").update({ status: "sent", finished_at: new Date().toISOString() }).eq("id", id).eq("status", "sending");
  return { sent: r.sent, status: "sent" };
}

/** The 10am run: scheduled campaigns due today start; any left part-way carry on (at 8pm too). */
export async function runCampaigns(site: string, opts: { start: boolean }, now = new Date()): Promise<Record<string, number>> {
  const db = adminClient();
  const out: Record<string, number> = {};
  const today = dublinToday(now);
  if (opts.start) {
    const { data: due } = await db.from("email_campaigns").select("id").eq("status", "scheduled").lte("send_on", today);
    for (const c of due ?? []) await db.from("email_campaigns").update({ status: "sending", started_at: now.toISOString() }).eq("id", c.id).eq("status", "scheduled");
  }
  const { data: going } = await db.from("email_campaigns").select("id,name").eq("status", "sending");
  for (const c of going ?? []) out[c.name] = (await sendCampaign(c.id, site)).sent;
  return out;
}

// ------------------------------------------------------------ Draft it for me

export async function draftCampaign(brief: string): Promise<{ subject: string; blocks: Block[] }> {
  const go = await canSpend("writing", null);
  if (!go.ok) throw new Error(go.why);
  const client = claude("email draft");
  const msg = await client.messages.create(
    {
      model: process.env.AI_MODEL || "claude-sonnet-5-5",
      max_tokens: 1200,
      system:
        "You write short marketing emails for MyGolfBroadcast, a website that covers amateur golf trips and society days like a televised tournament (live scores, a leaderboard for people at home, written previews and reports, a highlights film). The readers are golfers, mostly over 50, in Ireland and the UK. Write in plain, warm, confident Irish and British English, sentence case, short sentences, no hype, no exclamation marks, no dashes as punctuation, no emojis. Never invent facts, prices, dates, numbers, quotes or features beyond what the brief says. You may use the placeholder {first name}. Reply with JSON only: {\"subject\": \"...\", \"headline\": \"...\", \"paragraphs\": [\"...\", \"...\"], \"button\": \"a few words\"}. Two or three short paragraphs.",
      messages: [{ role: "user", content: `The brief: ${brief.slice(0, 1000)}` }],
    },
    { timeout: 60_000, maxRetries: 1 },
  );
  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");
  const j = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as { subject?: string; headline?: string; paragraphs?: string[]; button?: string };
  const tidy = (s: unknown) => String(s ?? "").replace(/[<>]/g, "").replace(/\s[–—-]\s/g, ", ").trim();
  const blocks: Block[] = [];
  if (j.headline) blocks.push({ type: "headline", text: tidy(j.headline).slice(0, 150) });
  for (const p of (j.paragraphs ?? []).slice(0, 4)) if (tidy(p)) blocks.push({ type: "paragraph", text: tidy(p).slice(0, 2000) });
  if (j.button) blocks.push({ type: "button", label: tidy(j.button).slice(0, 40), href: "/" });
  if (!blocks.length) throw new Error("The draft didn't come back. Try again.");
  return { subject: tidy(j.subject).slice(0, 150) || "News from MyGolfBroadcast", blocks };
}
