import { adminClient } from "@/lib/admin";
import { isOrganiser } from "@/lib/auth";
import { generatePiece } from "@/lib/ai";
import { guideFrom, guideStep, newGuideWork, type GuideWork } from "@/lib/guide";
import { bad, context, json, DEMO_READONLY } from "@/lib/server-data";
import type { RoundRow, SetupJob } from "@/lib/types";
import { normalizeRound } from "@/lib/types";

export const maxDuration = 60;

const LOCK_MS = 70_000;

/**
 * Getting a new tournament ready, one step per call (each well inside the time limit):
 * the hole-by-hole guide for each course, then the first preview. The waiting screen calls this until
 * nothing's left; if everyone leaves, Admin picks it up again.
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
    // "Don't wait": anything unfinished is left (the guide can be written in Fine-tune)
    return json({ jobs: await save(jobs.map((j) => (j.status === "todo" ? { ...j, status: "none" as const, note: "Skipped" } : j))) });
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

  if (job.kind === "guide") {
    const { data: row } = await db.from("rounds").select("*").eq("id", job.roundId).eq("tournament_id", t.id).maybeSingle();
    if (!row) return finish({ status: "none", note: "The round has gone" });
    const round = normalizeRound(row as RoundRow);
    let work = (job.data as GuideWork) ?? newGuideWork();
    try {
      work = await guideStep(round, work);
    } catch (e) {
      console.error("[setup] guide", e);
      // The search itself failed (or web search isn't available): nothing reliable to go on
      work = { ...work, stage: "done", result: "No hole-by-hole info found" };
    }
    if (work.stage !== "done") return finish({ data: work, status: "todo" });
    const guide = guideFrom(work);
    if (guide) {
      // Every round at this course gets it, unless the organiser has written one
      const { data: same } = await db.from("rounds").select("id,course_guide").eq("tournament_id", t.id).eq("course_slug", round.course_slug);
      for (const r of same ?? []) if (!r.course_guide) await db.from("rounds").update({ course_guide: guide }).eq("id", r.id);
    }
    return finish({ data: work, status: guide ? "done" : "none", note: work.result });
  }

  if (job.kind === "preview") {
    if (t.ai_on === false) return finish({ status: "none", note: "AI writing is off" });
    try {
      await generatePiece(t.id, "preview", job.roundId ?? null, { trigger: "setup" });
      return finish({ status: "done", note: "Waiting for you to read it in Admin" });
    } catch (e) {
      console.error("[setup] preview", e);
      return finish({ status: "failed", note: "Couldn't write it just now: write it from Admin when you're ready" });
    }
  }
  return finish({ status: "done" });
}
