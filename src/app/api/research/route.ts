import { after } from "next/server";
import { bad, json, slugify } from "@/lib/server-data";
import { courseInput, kickResearch, nudgeResearch, researchStatus, selfOrigin, startResearch, type CourseInput } from "@/lib/research";

export const maxDuration = 30;

/**
 * Course research, started as soon as a course is picked in the wizard (or by "Try again" on a course guide),
 * then carried on in the background by itself. Pages that are open nudge it along if a step has stalled.
 *   { action: "start", ref } or { action: "start", manual: { name, location, card: [{ par }] } }
 *   { action: "nudge", refs: [...] }
 *   { action: "status", ref }
 */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const origin = selfOrigin(req);
  const okRef = (r: unknown): r is string => typeof r === "string" && r.length <= 200 && /^[\w-]+:[^\s]+$/.test(r);

  if (b.action === "start") {
    let input: CourseInput | null = null;
    if (okRef(b.ref) && !b.ref.startsWith("manual:")) input = await courseInput(b.ref);
    else if (b.manual && typeof b.manual.name === "string" && b.manual.name.trim()) {
      const card = (Array.isArray(b.manual.card) ? b.manual.card : []).map((h: { par?: unknown }, i: number) => ({ number: i + 1, par: Number(h?.par), yards: [] as number[] }));
      if ((card.length !== 18 && card.length !== 9) || card.some((h: { par: number }) => !(h.par >= 3 && h.par <= 6))) return bad("A card needs 9 or 18 holes");
      const name = String(b.manual.name).trim().slice(0, 80);
      input = { ref: `manual:${slugify(name) || "course"}`, name, location: typeof b.manual.location === "string" ? b.manual.location.slice(0, 120) : null, card };
    }
    if (!input) return bad("Course not found", 404);
    // "Try again" is for a course nothing was found for
    const again = !!b.again && (await researchStatus(input.ref)).status !== "done";
    if (await startResearch(input, again)) after(() => kickResearch(origin, input.ref));
    return json({ ok: true, ref: input.ref });
  }

  if (b.action === "nudge") {
    const refs = (Array.isArray(b.refs) ? b.refs : []).filter(okRef).slice(0, 10) as string[];
    const go: string[] = [];
    for (const ref of refs) if (await nudgeResearch(ref)) go.push(ref);
    if (go.length) after(() => Promise.all(go.map((ref) => kickResearch(origin, ref))));
    return json({ ok: true });
  }

  if (b.action === "status" && okRef(b.ref)) {
    const s = await researchStatus(b.ref);
    if (s.status === "researching" && (await nudgeResearch(b.ref))) after(() => kickResearch(origin, b.ref));
    return json({ status: s.status, found: !!s.guide });
  }
  return bad("Unknown action");
}
