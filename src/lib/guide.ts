import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { CourseGuide, HoleRowData, RoundRow } from "./types";

/**
 * The hole-by-hole course guide, found on the web a step at a time (each step well inside the 60-second limit):
 *   1. search: find the club's own hole-by-hole pages, then reputable directories and reviews
 *   2. read:   one page per step; every hole note is checked against our card (par, and length where given)
 *   3. done:   enough holes found, or nothing left to try. Nothing reliable: "No hole-by-hole info found".
 * Only what the pages say is kept: nothing from memory.
 */

const MODEL = process.env.AI_MODEL || "claude-sonnet-5-5";
const MAX_SOURCES = 5;
const STEP_MS = 48_000;

export interface GuideSource {
  url: string;
  official: boolean;
  status: "todo" | "used" | "rejected" | "failed";
  why?: string;
}

export interface GuideWork {
  stage: "search" | "read" | "done";
  sources: GuideSource[];
  overview?: string;
  signature?: string;
  holes: Record<string, string>;
  /** Pages the kept notes came from */
  from: string[];
  /** How it ended, in plain words */
  result?: string;
}

export const newGuideWork = (): GuideWork => ({ stage: "search", sources: [], holes: {}, from: [] });

function client() {
  return new Anthropic({ baseURL: process.env.ANTHROPIC_BASE_URL || undefined });
}

const cardLine = (holes: HoleRowData[]) => holes.map((h) => `${h.number}: par ${h.par}${h.yards ? `, ${h.yards} yds` : ""}`).join("; ");

function jsonIn(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

/** Ask with server tools, carrying on if the API pauses a long tool turn, and return the final text. */
async function ask(prompt: string, tools: Anthropic.Messages.ToolUnion[]): Promise<string> {
  const c = client();
  const started = Date.now();
  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: prompt }];
  let text = "";
  for (let turn = 0; turn < 3; turn++) {
    const left = STEP_MS - (Date.now() - started);
    if (left < 8_000) break;
    const msg = await c.messages.create({ model: MODEL, max_tokens: 3000, tools, messages }, { timeout: left, maxRetries: 0 });
    text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");
    if (msg.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: msg.content });
  }
  return text;
}

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

async function search(r: RoundRow, work: GuideWork): Promise<GuideWork> {
  const holes = r.all_holes ?? r.holes;
  const prompt = `Find web pages that describe this golf course HOLE BY HOLE.

COURSE: ${r.course_name}${r.course_location ? `, ${r.course_location}` : ""}
OUR SCORECARD (hole: par): ${cardLine(holes)}

Search for, in this order of preference:
1. The club's own website: its course guide, course tour or hole-by-hole pages.
2. Reputable golf directories, guides or reviews that describe the holes one by one.
Only pages about this exact course (not a sister course at the same resort, not a different course with a similar name).
Don't read the pages, just find them. Output ONLY a JSON object:
{"pages": [{"url": "https://…", "official": true, "why": "a few words"}]}
with at most ${MAX_SOURCES} pages, best first. If you find nothing suitable, output {"pages": []}.`;
  const text = await ask(prompt, [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }]);
  const raw = jsonIn(text);
  const pages = (Array.isArray(raw?.pages) ? raw!.pages : []) as Record<string, unknown>[];
  const seen = new Set<string>();
  const sources: GuideSource[] = [];
  for (const p of pages) {
    const url = String(p.url ?? "");
    if (!/^https?:\/\//.test(url) || seen.has(url)) continue;
    seen.add(url);
    sources.push({ url, official: !!p.official, status: "todo", why: typeof p.why === "string" ? p.why.slice(0, 120) : undefined });
  }
  // The club's own pages first
  sources.sort((a, b) => Number(b.official) - Number(a.official));
  const out = { ...work, sources: sources.slice(0, MAX_SOURCES), stage: "read" as const };
  return out.sources.length ? out : finish(out);
}

/** A source's hole matches our card: same par, and a length within 15% where both are known. */
export function holeMatches(card: HoleRowData, par: unknown, length: unknown, unit: unknown): boolean {
  if (Number(par) !== card.par) return false;
  const len = Number(length);
  if (!card.yards || !Number.isFinite(len) || len <= 0) return true;
  const yards = /^m/i.test(String(unit ?? "")) ? len * 1.0936 : len;
  return Math.abs(yards - card.yards) / card.yards <= 0.15;
}

/** Keep what a page says that agrees with our card; reject the page if it's clearly a different layout. */
export function mergePage(card: HoleRowData[], work: GuideWork, page: Record<string, unknown>, url: string): { work: GuideWork; kept: number; why?: string } {
  if (page.sameCourse === false) return { work, kept: 0, why: "about a different course" };
  const holes = (page.holes && typeof page.holes === "object" ? page.holes : {}) as Record<string, Record<string, unknown>>;
  const reported = Object.entries(holes).filter(([n, h]) => card.some((c) => c.number === Number(n)) && h && typeof h.note === "string" && h.note.trim());
  let wrong = 0;
  const good: [string, string][] = [];
  for (const [n, h] of reported) {
    const c = card.find((x) => x.number === Number(n))!;
    if (holeMatches(c, h.par, h.length, h.unit)) good.push([n, String(h.note).trim().slice(0, 300)]);
    else wrong++;
  }
  // Pars that don't line up: different numbering, a different course, or a page we can't trust
  if (wrong >= 3 || (reported.length >= 4 && wrong / reported.length > 0.25)) return { work, kept: 0, why: `${wrong} holes didn't match our card` };
  const next = { ...work, holes: { ...work.holes } };
  let kept = 0;
  for (const [n, note] of good) {
    if (next.holes[n]) continue;
    next.holes[n] = note;
    kept++;
  }
  const overview = typeof page.overview === "string" ? page.overview.trim() : "";
  const signature = typeof page.signature === "string" ? page.signature.trim() : "";
  if (!next.overview && overview && (kept > 0 || reported.length === 0)) next.overview = overview.slice(0, 1500);
  if (!next.signature && signature && (kept > 0 || reported.length === 0)) next.signature = signature.slice(0, 800);
  if (kept || (overview && !work.overview)) next.from = [...new Set([...work.from, url])];
  return { work: next, kept, why: kept ? undefined : good.length ? "nothing new" : "no hole notes we could check" };
}

async function read(r: RoundRow, work: GuideWork): Promise<GuideWork> {
  const card = r.all_holes ?? r.holes;
  const i = work.sources.findIndex((s) => s.status === "todo");
  if (i < 0) return finish(work);
  const src = work.sources[i];
  const prompt = `Read this page and report what it says about the golf course ${r.course_name}${r.course_location ? ` (${r.course_location})` : ""}, hole by hole.

PAGE: ${src.url}

Use the web_fetch tool to read it. If the holes are described on separate linked pages of the same site, you may read up to two of those as well.
Report ONLY what the page says. Never add anything from memory, and leave out any hole the page doesn't describe.
For each hole give the par and length the page states (null if it doesn't), and a note of at most 30 words: shape, hazards, elevation, green, strategy.
Output ONLY a JSON object:
{"sameCourse": true, "overview": "2-4 sentences from the page: designer and year, terrain and style (empty if not stated)", "signature": "1-2 sentences on the holes the page singles out (empty if none)", "holes": {"1": {"par": 4, "length": 380, "unit": "yards", "note": "…"}}}
Set "sameCourse": false if the page is about a different course. Plain British/Irish English, no marketing language.`;
  let text = "";
  try {
    text = await ask(prompt, [{ type: "web_fetch_20250910", name: "web_fetch", max_uses: 3, allowed_domains: [host(src.url)].filter(Boolean) }]);
  } catch (e) {
    const sources = work.sources.map((s, k) => (k === i ? { ...s, status: "failed" as const, why: String((e as Error).message ?? e).slice(0, 120) } : s));
    return next({ ...work, sources }, card);
  }
  const page = jsonIn(text);
  if (!page) {
    const sources = work.sources.map((s, k) => (k === i ? { ...s, status: "failed" as const, why: "couldn't read it" } : s));
    return next({ ...work, sources }, card);
  }
  const m = mergePage(card, work, page, src.url);
  const sources = m.work.sources.map((s, k) => (k === i ? { ...s, status: m.kept || (m.work.overview && !work.overview) ? ("used" as const) : ("rejected" as const), why: m.why ?? s.why } : s));
  return next({ ...m.work, sources }, card);
}

/** Carry on with the next page, or stop: most holes covered, or nothing left to try. */
function next(work: GuideWork, card: HoleRowData[]): GuideWork {
  const covered = Object.keys(work.holes).length / card.length;
  if (covered >= 0.8 || !work.sources.some((s) => s.status === "todo")) return finish(work);
  return work;
}

function finish(work: GuideWork): GuideWork {
  const n = Object.keys(work.holes).length;
  const result = n ? `Notes on ${n} hole${n === 1 ? "" : "s"}, checked against your card` : work.overview ? "An overview of the course; no hole-by-hole notes found" : "No hole-by-hole info found";
  return { ...work, stage: "done", result };
}

/** One step of the work. */
export async function guideStep(r: RoundRow, work: GuideWork): Promise<GuideWork> {
  if (work.stage === "search") return search(r, work);
  if (work.stage === "read") return read(r, work);
  return work;
}

/** The finished guide to save, or null when nothing reliable was found. */
export function guideFrom(work: GuideWork): CourseGuide | null {
  if (!work.overview && !Object.keys(work.holes).length) return null;
  return { overview: work.overview ?? "", signature: work.signature ?? "", holes: work.holes };
}
