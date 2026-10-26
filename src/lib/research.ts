import { canSpend, claude } from "./usage";
import "server-only";
import { createHmac } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { adminClient } from "./admin";
import { getCourse } from "./courses";
import { cleanGuide, type CourseGuide } from "./types";
import { holeMatches, type CardHole } from "./research-check";
export { holeMatches, type CardHole };

/**
 * Course research: everything the web says about a course, its holes and its history, found in the background as
 * soon as the course is picked in the wizard, and kept in the course library for every tournament there.
 *
 * Like a person would do it, a step at a time (each step its own request, starting the next):
 *   find  — search for the club's own website and its course pages, and reputable pages about the course
 *   map   — read the club's site to list its course tour, a page per hole, the scorecard and the history
 *   read  — read those pages, the club's own first (a batch of hole pages at a time); every hole note is checked
 *           against the card (par must match; length must match one of the course's tees)
 *   more  — still short of holes or history: one more search, for pages not yet tried
 *   done  — a guide (overview, history, signature holes, hole notes), or nothing found
 * Only what the pages say is kept: nothing from memory. Why any page was left out is kept for the site owner.
 */

const MODEL = process.env.AI_MODEL || "claude-sonnet-5-5";
/** Each step's time on the AI (the request may run 300 seconds) */
const STEP_MS = 200_000;
/** A step that started longer ago than this has died: it's picked up again */
const STALE_MS = 6 * 60e3;
const MAX_STEPS = 24;
const MAX_PAGES = 40;
/** New courses researched a day, across the site (a safeguard on cost) */
const DAILY_LIMIT = Number(process.env.RESEARCH_DAILY_LIMIT || 80);

export interface ResearchPage {
  url: string;
  kind: "holes" | "hole" | "course" | "history" | "review";
  official: boolean;
  hole?: number;
  status: "todo" | "used" | "rejected" | "failed";
  why?: string;
}

export interface ResearchWork {
  v: 2;
  stage: "find" | "map" | "read" | "more" | "done";
  name: string;
  location: string | null;
  card: CardHole[];
  official?: string | null;
  pages: ResearchPage[];
  overview?: string;
  history?: string;
  signature?: string;
  holes: Record<string, string>;
  from: string[];
  searchedMore?: boolean;
  steps: number;
  /** What happened, step by step (for the site owner) */
  log: string[];
}

export interface CourseInput {
  ref: string;
  name: string;
  location?: string | null;
  card: CardHole[];
}

// ------------------------------------------------------------ the course to research

/** A course from the search: its card, with each hole's length from every tee. */
export async function courseInput(ref: string): Promise<CourseInput | null> {
  const c = await getCourse(ref);
  const first = c?.tees[0];
  if (!c || !first) return null;
  const card = first.par.map((par, i) => ({ number: i + 1, par, yards: c.tees.map((t) => t.yards[i] || 0) }));
  return { ref, name: c.name, location: c.location || null, card };
}

// ------------------------------------------------------------ starting and running

const secret = () => process.env.FILM_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "mgs-research";
export const researchKey = (ref: string) => createHmac("sha256", secret()).update(`research:${ref}`).digest("hex").slice(0, 40);

/** This deployment's own address (a preview talks to itself, not to the live site). */
export function selfOrigin(req: Request) {
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? u.host;
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** Start the next step in a fresh request (it answers straight away and carries on by itself). */
export async function kickResearch(origin: string, ref: string) {
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) headers["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    await fetch(`${origin}/api/research/run`, { method: "POST", headers, body: JSON.stringify({ ref, k: researchKey(ref) }), signal: AbortSignal.timeout(15000) });
  } catch {
    // a nudge from the wizard or the organiser's page picks it up
  }
}

type Row = { ref: string; status: "researching" | "done" | "none"; guide: unknown; written_by: string; work: ResearchWork | null; step_at: string | null; started_at: string | null };

async function rowOf(ref: string): Promise<Row | null> {
  const { data, error } = await adminClient().from("course_library").select("ref,status,guide,written_by,work,step_at,started_at").eq("ref", ref).maybeSingle();
  if (error) return null;
  return (data as Row) ?? null;
}

const stale = (r: Row) => r.status === "researching" && (!r.step_at || Date.now() - Date.parse(r.step_at) > STALE_MS);

/**
 * Make sure a course is being (or has been) researched. Returns true when a step should be started now.
 * `again`: search once more (the organiser's "Try again"), unless an organiser wrote the guide.
 */
export async function startResearch(input: CourseInput, again = false): Promise<boolean> {
  const db = adminClient();
  const row = await rowOf(input.ref);
  if (row) {
    if (row.status === "researching") return stale(row);
    if (row.written_by === "organiser" && cleanGuide(row.guide)) return false;
    // A guide found the old way (before this research) gets the fuller search once
    const oldWay = row.status === "done" && row.written_by === "research" && !row.work;
    if (!again && !oldWay && (row.status === "done" || (row.status === "none" && row.started_at && Date.now() - Date.parse(row.started_at) < 3 * 86400e3))) return false;
  }
  const { count } = await db.from("course_library").select("ref", { count: "exact", head: true }).gte("started_at", new Date(Date.now() - 86400e3).toISOString());
  if ((count ?? 0) >= DAILY_LIMIT) return false;
  const work: ResearchWork = { v: 2, stage: "find", name: input.name, location: input.location ?? null, card: input.card, pages: [], holes: {}, from: [], steps: 0, log: [] };
  const now = new Date().toISOString();
  const { error } = await db.from("course_library").upsert({
    ref: input.ref,
    name: input.name,
    status: "researching",
    work,
    step_at: null,
    started_at: now,
    updated_at: now,
    ...(row ? {} : { guide: null, written_by: "research" }),
  });
  if (error) {
    console.error("[research] start", error.message);
    return false;
  }
  return true;
}

/**
 * A course no longer wanted (picked by mistake, then changed): its search stops at the next step. Only while it's
 * still searching, and only if no tournament has a round there; anything already found is kept.
 */
export async function dropResearch(ref: string): Promise<boolean> {
  const db = adminClient();
  const row = await rowOf(ref);
  if (!row || row.status !== "researching") return false;
  const { count } = await db.from("rounds").select("id", { count: "exact", head: true }).in("course_slug", [...new Set([ref, ref.replace(/^local:/, "")])]);
  if ((count ?? 0) > 0) return false;
  await db.from("course_library").delete().eq("ref", ref).eq("status", "researching");
  return true;
}

/** The course to research for a round's course reference (or a card typed in by hand). */
export async function inputFor(ref: string, name: string, location: string | null, holes: { number: number; par: number; yards?: number }[]): Promise<CourseInput> {
  const card = holes.map((h) => ({ number: h.number, par: h.par, yards: h.yards ? [h.yards] : [] }));
  return (!ref.startsWith("manual:") && (await courseInput(ref))) || { ref, name, location, card };
}

/** A stalled course gets going again (from a page someone has open). */
export async function nudgeResearch(ref: string): Promise<boolean> {
  const row = await rowOf(ref);
  return !!row && stale(row);
}

export async function researchStatus(ref: string): Promise<{ status: Row["status"] | null; guide: CourseGuide | null }> {
  const row = await rowOf(ref);
  return { status: row?.status ?? null, guide: cleanGuide(row?.guide) };
}

/** One step. Returns true when there's another to do. */
export async function runResearchStep(ref: string): Promise<boolean> {
  const db = adminClient();
  const row = await rowOf(ref);
  if (!row || row.status !== "researching" || !row.work) return false;
  // Someone else is on this step
  if (row.step_at && Date.now() - Date.parse(row.step_at) < STALE_MS) return false;
  await db.from("course_library").update({ step_at: new Date().toISOString() }).eq("ref", ref);
  let work = row.work;
  // The month's writing budget is used up: the research waits (picked up again later)
  if (!(await canSpend("writing", null)).ok) {
    await db.from("course_library").update({ step_at: null }).eq("ref", ref);
    return false;
  }
  try {
    work = await step({ ...work, steps: work.steps + 1 });
  } catch (e) {
    work = { ...work, stage: "done", log: [...work.log, `stopped: ${errText(e)}`] };
  }
  if (work.steps >= MAX_STEPS && work.stage !== "done") work = { ...work, stage: "done", log: [...work.log, "stopped: step limit"] };
  if (work.stage !== "done") {
    await db.from("course_library").update({ work, step_at: null, updated_at: new Date().toISOString() }).eq("ref", ref);
    return true;
  }
  await finish(ref, work);
  return false;
}

/** The guide goes in the library and on every round at this course that hasn't one yet. */
async function finish(ref: string, work: ResearchWork) {
  const db = adminClient();
  const found = cleanGuide({ overview: work.overview ?? "", history: work.history ?? "", signature: work.signature ?? "", holes: work.holes });
  // Never worse than what was there before
  const before = cleanGuide((await rowOf(ref))?.guide);
  const size = (g: CourseGuide | null) => (g ? Object.keys(g.holes).length * 10 + (g.overview ? 5 : 0) + (g.history ? 5 : 0) : -1);
  const guide = size(before) > size(found) ? before : found;
  const n = Object.keys(work.holes).length;
  const log = [...work.log, guide ? `done: ${n} hole notes${work.overview ? ", overview" : ""}${work.history ? ", history" : ""}` : "done: nothing found"];
  await db
    .from("course_library")
    .update({ status: guide ? "done" : "none", guide, work: { ...work, log }, sources: work.from, step_at: null, updated_at: new Date().toISOString() })
    .eq("ref", ref);
  if (guide) await db.from("rounds").update({ course_guide: guide }).in("course_slug", [...new Set([ref, ref.replace(/^local:/, "")])]).is("course_guide", null);
  // Nothing found: the console's Needs you, to try again or fill it in by hand
  const { raise, settle } = await import("./queue");
  if (guide) await settle("research", ref, "system", "Research found the course");
  else await raise({ kind: "research", subject: ref, title: `Couldn't research ${work.name ?? ref}`, detail: { log: log.slice(-6) } });
}

// ------------------------------------------------------------ the steps

async function step(w: ResearchWork): Promise<ResearchWork> {
  if (w.stage === "find") return find(w);
  if (w.stage === "map") return map(w);
  if (w.stage === "more") return more(w);
  if (w.stage === "read") return read(w);
  return w;
}

const client = () => claude("course research");

const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/\s+/g, " ").slice(0, 160);

/** Ask with the web tools, carrying on if the API pauses a long tool turn; the final text. */
async function ask(prompt: string, tools: Anthropic.Messages.ToolUnion[]): Promise<string> {
  const c = client();
  const started = Date.now();
  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: prompt }];
  let text = "";
  for (let turn = 0; turn < 5; turn++) {
    const left = STEP_MS - (Date.now() - started);
    if (left < 15_000) break;
    const msg = await c.messages.create({ model: MODEL, max_tokens: 6000, tools, messages }, { timeout: left, maxRetries: 1 });
    text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");
    if (msg.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: msg.content });
  }
  return text;
}

function jsonIn(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

export const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

const cardLine = (card: CardHole[]) => card.map((h) => `${h.number}: par ${h.par}${h.yards.some(Boolean) ? `, ${h.yards.filter(Boolean).join("/")} yds` : ""}`).join("; ");
const where = (w: ResearchWork) => `${w.name}${w.location ? `, ${w.location}` : ""}`;
const KINDS = ["holes", "hole", "course", "history", "review"] as const;

/** Pages found, tidied: real web addresses, no repeats, the club's own first. */
function addPages(w: ResearchWork, raw: unknown, officialHost: string | null): ResearchPage[] {
  const seen = new Set(w.pages.map((p) => p.url.replace(/\/$/, "")));
  const out = [...w.pages];
  for (const p of (Array.isArray(raw) ? raw : []) as Record<string, unknown>[]) {
    const url = String(p.url ?? "").trim();
    if (!/^https?:\/\//.test(url) || url.length > 250 || seen.has(url.replace(/\/$/, ""))) continue;
    if (/\.(jpe?g|png|gif|webp)(\?|$)/i.test(url)) continue;
    seen.add(url.replace(/\/$/, ""));
    const kind = KINDS.includes(p.kind as (typeof KINDS)[number]) ? (p.kind as ResearchPage["kind"]) : "review";
    const hole = Number(p.hole);
    out.push({ url, kind, official: (!!officialHost && host(url) === officialHost) || (!officialHost && !!p.official), hole: Number.isInteger(hole) && hole > 0 && hole <= 27 ? hole : undefined, status: "todo" });
  }
  const rank = (p: ResearchPage) => (p.official ? 0 : 10) + { hole: 0, holes: 1, course: 2, history: 3, review: 4 }[p.kind];
  return out.sort((a, b) => Number(a.status !== "todo") - Number(b.status !== "todo") || rank(a) - rank(b)).slice(0, MAX_PAGES);
}

async function find(w: ResearchWork): Promise<ResearchWork> {
  const prompt = `Find the web pages that describe this golf course: its holes and its history.

COURSE: ${where(w)}
OUR SCORECARD (hole: par, lengths from each tee): ${cardLine(w.card)}

Search for:
1. The club's own website: its home page, and any pages on it for the course, a course tour, hole by hole (or a page for each hole), the scorecard, and the history of the club.
2. Other reputable pages that describe this course hole by hole, or tell its story: golf course directories, rankings and reviews (for example Top 100 Golf Courses, Leading Courses, Golf Ireland, Golf Digest), Wikipedia.
Only pages about this exact course: not a sister course at the same club or resort, not a different club with a similar name.
Don't read the pages, just find them. Output ONLY a JSON object:
{"official": "the club's home page, or empty", "pages": [{"url": "https://…", "kind": "holes | hole | course | history | review", "hole": 7, "official": true}]}
"hole" only for a page about one hole. At most 15 pages, the club's own first.`;
  const raw = jsonIn(await ask(prompt, [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }]));
  const official = typeof raw?.official === "string" && /^https?:\/\//.test(raw.official) ? raw.official : null;
  const officialHost = official ? host(official) : null;
  const pages = addPages({ ...w, pages: [] }, raw?.pages, officialHost);
  const log = [...w.log, `find: ${pages.length} pages${official ? `, club site ${officialHost}` : ", no club site"}`];
  const next: ResearchWork = { ...w, official, pages, log };
  if (official) return { ...next, stage: "map" };
  return pages.length ? { ...next, stage: "read" } : { ...next, stage: "more" };
}

async function map(w: ResearchWork): Promise<ResearchWork> {
  const site = host(w.official!);
  const prompt = `Find the course pages on the website of ${where(w)}.

START HERE: ${w.official}

Use web_fetch to read that page, then follow its menu or links to the course section (it may be called The Course, Course Tour, Hole by Hole, Scorecard or similar). List every page on this site that describes the course: a course tour or hole-by-hole page, a page for each hole, the scorecard, and the history of the club. Don't describe them yet.
Output ONLY a JSON object:
{"pages": [{"url": "https://…", "kind": "holes | hole | course | history", "hole": 7}]}
"hole" only for a page about one hole. If the site has no such pages, output {"pages": []}.`;
  let raw: Record<string, unknown> | null = null;
  try {
    raw = jsonIn(await ask(prompt, [{ type: "web_fetch_20250910", name: "web_fetch", max_uses: 6, allowed_domains: [site], max_content_tokens: 20000 }]));
  } catch (e) {
    return { ...w, stage: "read", log: [...w.log, `map ${site}: couldn't read it (${errText(e)})`] };
  }
  const found = ((raw?.pages as unknown[]) ?? []).filter((p) => host(String((p as Record<string, unknown>)?.url ?? "")) === site);
  const pages = addPages(w, found.map((p) => ({ ...(p as object), official: true })), site);
  return { ...w, pages, stage: "read", log: [...w.log, `map ${site}: ${pages.length - w.pages.length} more pages`] };
}

async function more(w: ResearchWork): Promise<ResearchWork> {
  const n = Object.keys(w.holes).length;
  const tried = [...new Set(w.pages.map((p) => host(p.url)))].join(", ");
  const missing = w.card.filter((h) => !w.holes[String(h.number)]).map((h) => h.number);
  const prompt = `Find more web pages about the golf course ${where(w)}.

We still need: ${[missing.length ? `descriptions of holes ${missing.join(", ")}` : "", !w.history ? "the history of the club and course (founded, designer, championships, famous moments)" : "", !w.overview ? "a description of the course" : ""].filter(Boolean).join("; ")}.
${tried ? `Already tried: ${tried}. Look elsewhere.` : ""}
OUR SCORECARD (hole: par): ${w.card.map((h) => `${h.number}: par ${h.par}`).join("; ")}
Only pages about this exact course. Don't read the pages, just find them. Output ONLY a JSON object:
{"pages": [{"url": "https://…", "kind": "holes | hole | course | history | review", "hole": 7}]}
At most 8 pages. If there's nothing new, output {"pages": []}.`;
  const raw = jsonIn(await ask(prompt, [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }]));
  const pages = addPages(w, raw?.pages, w.official ? host(w.official) : null);
  const added = pages.length - w.pages.length;
  const log = [...w.log, `more (${n} holes so far): ${added} new pages`];
  return { ...w, pages, searchedMore: true, stage: added ? "read" : "done", log };
}

/** Keep what a page says that agrees with our card; leave the page out if its pars clearly don't line up. */
export function mergeFindings(w: ResearchWork, page: Record<string, unknown>, url: string): { work: ResearchWork; kept: number; why?: string } {
  if (page.sameCourse === false) return { work: w, kept: 0, why: "about a different course" };
  const holes = (page.holes && typeof page.holes === "object" ? page.holes : {}) as Record<string, Record<string, unknown>>;
  const reported = Object.entries(holes).filter(([n, h]) => w.card.some((c) => c.number === Number(n)) && h && typeof h.note === "string" && h.note.trim());
  let wrong = 0;
  const good: [string, string][] = [];
  for (const [n, h] of reported) {
    const c = w.card.find((x) => x.number === Number(n))!;
    // A page that doesn't give the par is trusted on the hole number alone. A wrong par says the page may be about
    // something else; a length that's out just leaves that one hole out
    if (h.par != null && Number(h.par) !== c.par) wrong++;
    else if (h.par == null || holeMatches(c, h.par, h.length, h.unit)) good.push([n, String(h.note).trim().slice(0, 300)]);
  }
  // Pars that don't line up: different numbering, a different course, or a page we can't trust
  if (wrong >= 3 || (reported.length >= 4 && wrong / reported.length > 0.25)) return { work: w, kept: 0, why: `${wrong} holes didn't match the card` };
  const next: ResearchWork = { ...w, holes: { ...w.holes } };
  let kept = 0;
  for (const [n, note] of good) {
    // A longer note (the club's own hole page) beats a shorter one
    if (next.holes[n] && next.holes[n].length >= note.length) continue;
    if (!next.holes[n]) kept++;
    next.holes[n] = note;
  }
  const text = (k: string, max: number) => (typeof page[k] === "string" ? String(page[k]).trim().slice(0, max) : "");
  const overview = text("overview", 1500);
  const history = text("history", 1500);
  const signature = text("signature", 800);
  let added = kept;
  if (overview && (!next.overview || (url.includes(host(w.official ?? "#")) && overview.length > next.overview.length))) {
    next.overview = overview;
    added++;
  }
  if (history && (!next.history || history.length > next.history.length * 1.5)) {
    next.history = history;
    added++;
  }
  if (signature && !next.signature) {
    next.signature = signature;
    added++;
  }
  if (added) next.from = [...new Set([...w.from, url])];
  return { work: next, kept: added, why: added ? undefined : good.length ? "nothing new" : "nothing we could use" };
}

async function read(w: ResearchWork): Promise<ResearchWork> {
  const todo = w.pages.filter((p) => p.status === "todo");
  const covered = Object.keys(w.holes).length;
  const complete = covered >= w.card.length && w.overview && w.history;
  if (!todo.length || complete) {
    if (!complete && !w.searchedMore && (covered < w.card.length * 0.8 || !w.history)) return { ...w, stage: "more" };
    return { ...w, stage: "done" };
  }
  // A batch of one site's single-hole pages (for holes still missing), or one page
  const first = todo[0];
  const batch =
    first.kind === "hole"
      ? todo.filter((p) => p.kind === "hole" && host(p.url) === host(first.url) && !(p.hole && w.holes[String(p.hole)] && !p.official)).slice(0, 6)
      : [first];
  if (!batch.length) return { ...w, pages: w.pages.map((p) => (p === first ? { ...p, status: "rejected" as const, why: "not needed" } : p)) };
  const site = host(batch[0].url);
  const prompt = `Read ${batch.length > 1 ? "these pages" : "this page"} and report what ${batch.length > 1 ? "they say" : "it says"} about the golf course ${where(w)}.

${batch.map((p) => `PAGE: ${p.url}`).join("\n")}

Use web_fetch to read ${batch.length > 1 ? "each one" : "it"}.${batch.length === 1 && batch[0].kind !== "history" ? " If the holes are described on separate linked pages of the same site, read those too (as many as you can)." : ""}
OUR SCORECARD (hole: par, lengths from each tee): ${cardLine(w.card)}
Report ONLY what the pages say: never add anything from memory, and leave out any hole they don't describe.
For each hole: the par and length the page states (null if it doesn't), and a note of up to 35 words on its shape, hazards, elevation, green and how to play it.
Output ONLY a JSON object:
{"sameCourse": true,
 "overview": "2 to 4 sentences: the course's setting, character and style (empty if not stated)",
 "history": "2 to 4 sentences: when the club was founded, who designed the course, championships held, famous moments or members (empty if not stated)",
 "signature": "1 or 2 sentences on the holes the pages single out (empty if none)",
 "holes": {"1": {"par": 4, "length": 380, "unit": "yards", "note": "…"}}}
Set "sameCourse": false if the pages are about a different course. Plain British and Irish English, no marketing language.`;
  let text = "";
  try {
    text = await ask(prompt, [{ type: "web_fetch_20250910", name: "web_fetch", max_uses: batch.length > 1 ? batch.length + 2 : 10, allowed_domains: [site], max_content_tokens: 20000 }]);
  } catch (e) {
    const why = errText(e);
    return { ...w, pages: w.pages.map((p) => (batch.includes(p) ? { ...p, status: "failed" as const, why } : p)), log: [...w.log, `read ${site}: failed (${why})`] };
  }
  const page = jsonIn(text);
  if (!page) return { ...w, pages: w.pages.map((p) => (batch.includes(p) ? { ...p, status: "failed" as const, why: "couldn't read it" } : p)), log: [...w.log, `read ${site}: couldn't read it`] };
  const m = mergeFindings(w, page, batch[0].url);
  const status = m.kept ? ("used" as const) : ("rejected" as const);
  return {
    ...m.work,
    pages: m.work.pages.map((p) => (batch.includes(p) ? { ...p, status, why: m.why } : p)),
    log: [...m.work.log, `read ${batch.length > 1 ? `${batch.length} pages on ${site}` : batch[0].url}: ${m.kept ? `kept ${m.kept}` : m.why}, ${Object.keys(m.work.holes).length} holes so far`],
  };
}
