import { after } from "next/server";
import { kickResearch, researchKey, runResearchStep, selfOrigin } from "@/lib/research";
import { bad, json } from "@/lib/server-data";

export const maxDuration = 300;

/** One step of researching a course (started by the step before, or a nudge). Answers at once; works on. */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const ref = String(b.ref ?? "");
  if (!ref || ref.length > 200 || b.k !== researchKey(ref)) return bad("Not allowed", 403);
  const origin = selfOrigin(req);
  after(async () => {
    try {
      if (await runResearchStep(ref)) await kickResearch(origin, ref);
    } catch (e) {
      console.error("[research] step failed:", e);
    }
  });
  return json({ ok: true }, 202);
}
