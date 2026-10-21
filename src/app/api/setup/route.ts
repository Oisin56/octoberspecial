import { adminClient } from "@/lib/admin";
import { isOrganiser } from "@/lib/auth";
import { generatePiece } from "@/lib/ai";
import { after } from "next/server";
import { courseInput, kickResearch, nudgeResearch, researchStatus, selfOrigin, startResearch, type CourseInput } from "@/lib/research";
import { libraryRef } from "@/lib/wizard";
import { bad, context, json, DEMO_READONLY } from "@/lib/server-data";
import type { RoundRow, SetupJob } from "@/lib/types";
import { normalizeRound } from "@/lib/types";

export const maxDuration = 60;

const LOCK_MS = 70_000;

/**
 * Getting a new tournament ready, one step per call (each well inside the time limit):
 * the hole-by-hole guide for each course, then the first preview. The waiting screen calls this until
 * nothing's left; if everyone leaves, the organiser page picks it up again.
 */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const { t, session, demo } = await context(req, b);
  if (!t) return bad("Tournament not found", 404);
  if (demo) return bad(DEMO_READONLY, 403);
  if (!isOrganiser(session)) return bad("Organiser only", 403);
  const db = adminClient();
  const jobs: SetupJob[] = Array.isArray(t.setup_jobs) ? t.setup_jobs : [];
  const save = async (list: SetupJob[]) => {
    await db.from("tournaments").update({ setup_jobs: list }).eq("id", t.id);
    return list;
  };
  if (b.action === "skip") {
    // "Don't wait": anything unfinished is left (the guide can be written in Tournament setup)
    return json({ jobs: await save(jobs.map((j) => (j.status === "todo" ? { ...j, status: "none" as const, note: "Skipped" } : j))) });
  }

  // The course guides: each course is researched in the background (started when it was picked in the wizard), so
  // this only looks at how each is getting on, all at once
  const origin = selfOrigin(req);
  const guideJobs = jobs.filter((j) => j.kind === "guide" && j.status === "todo");
  if (guideJobs.length) {
    const patches = await Promise.all(guideJobs.map((j) => checkGuide(t.id, j, origin)));
    const { data: fresh } = await db.from("tournaments").select("setup_jobs").eq("id", t.id).single();
    const list = ((fresh?.setup_jobs as SetupJob[]) ?? jobs).map((j) => {
      const k = guideJobs.findIndex((g) => g.id === j.id);
      return k >= 0 && patches[k] ? { ...j, ...patches[k] } : j;
    });
    await save(list);
    if (list.some((j) => j.kind === "guide" && j.status === "todo")) return json({ jobs: list, busy: true });
    jobs.splice(0, jobs.length, ...list);
  }

  const now = Date.now();
  const i = jobs.findIndex((j) => j.status === "todo" && (!j.startedAt || now - j.startedAt > LOCK_MS));
  if (i < 0) return json({ jobs, busy: jobs.some((j) => j.status === "todo") });
  // The preview waits for the guides (it uses them)
  if (jobs[i].kind === "preview" && jobs.some((j) => j.kind === "guide" && j.status === "todo")) return json({ jobs, busy: true });
  const job = { ...jobs[i], startedAt: now };
  await save(jobs.map((j, k) => (k === i ? job : j)));

  const finish = async (patch: Partial<SetupJob>) => {
    const { data: fresh } = await db.from("tournaments").select("setup_jobs").eq("id", t.id).single();
    const list = ((fresh?.setup_jobs as SetupJob[]) ?? jobs).map((j) => (j.id === job.id ? { ...j, ...patch, startedAt: undefined } : j));
    return json({ jobs: await save(list) });
  };

  if (job.kind === "preview") {
    if (t.ai_on === false) return finish({ status: "none", note: "AI writing is off" });
    try {
      await generatePiece(t.id, "preview", job.roundId ?? null, { trigger: "setup" });
      return finish({ status: "done", note: "Ready to read on the organiser page" });
    } catch (e) {
      console.error("[setup] preview", e);
      return finish({ status: "failed", note: "Couldn't write it just now: write it from the organiser page when you're ready" });
    }
  }
  return finish({ status: "done" });
}

/** How one course's research is getting on: a patch for its job, or null while it's still going. */
async function checkGuide(tournamentId: string, job: SetupJob, origin: string): Promise<Partial<SetupJob> | null> {
  const db = adminClient();
  const { data: row } = await db.from("rounds").select("*").eq("id", job.roundId).eq("tournament_id", tournamentId).maybeSingle();
  if (!row) return { status: "none", note: "The round has gone" };
  const round = normalizeRound(row as RoundRow);
  if (round.course_guide) return { status: "done", note: undefined };
  const ref = libraryRef(round.course_slug);
  const lib = await researchStatus(ref);
  if (lib.status === "done" && lib.guide) {
    await db.from("rounds").update({ course_guide: lib.guide }).eq("tournament_id", tournamentId).eq("course_slug", round.course_slug).is("course_guide", null);
    return { status: "done", note: undefined };
  }
  if (lib.status === "none") return { status: "none", note: NOT_FOUND };
  if (lib.status === "researching") {
    if (await nudgeResearch(ref)) after(() => kickResearch(origin, ref));
    return null;
  }
  // Never started (an older tournament, or the course was changed later): start it now
  const card = (round.all_holes ?? round.holes).map((h) => ({ number: h.number, par: h.par, yards: h.yards ? [h.yards] : [] }));
  const input: CourseInput = (!ref.startsWith("manual:") && (await courseInput(ref))) || { ref, name: round.course_name, location: round.course_location, card };
  if (await startResearch(input)) {
    after(() => kickResearch(origin, ref));
    return null;
  }
  // It can't be researched just now (the daily limit): not waited on
  return { status: "none", note: NOT_FOUND };
}

const NOT_FOUND = "Couldn't find information about this course online";
