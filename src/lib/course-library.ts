import "server-only";
import { adminClient } from "./admin";
import { cleanGuide, type CourseGuide } from "./types";

/**
 * The course library: one guide per course, shared by every tournament (keyed by the course reference, or
 * "manual:<name>" for a card typed in by hand). Research fills it once, in the background (research.ts); an
 * organiser's own guide (written or corrected) replaces it and is never overwritten by research.
 */

export async function libraryGuide(ref: string | null | undefined): Promise<CourseGuide | null> {
  if (!ref) return null;
  const { data, error } = await adminClient().from("course_library").select("guide").eq("ref", ref).maybeSingle();
  if (error) return null; // the table isn't there yet: carry on without it
  return cleanGuide(data?.guide);
}

export async function saveToLibrary(ref: string | null | undefined, name: string, guide: CourseGuide | null, by: "research" | "organiser", sources: string[] = []): Promise<void> {
  if (!ref) return;
  const g = cleanGuide(guide);
  const db = adminClient();
  if (!g) {
    // An organiser clearing their guide takes it out of the library; research finding nothing leaves it be
    if (by === "organiser") await db.from("course_library").delete().eq("ref", ref);
    return;
  }
  if (by === "research") {
    const { data } = await db.from("course_library").select("written_by").eq("ref", ref).maybeSingle();
    if (data?.written_by === "organiser") return;
  }
  const { error } = await db.from("course_library").upsert({ ref, name, guide: g, written_by: by, status: "done", sources, updated_at: new Date().toISOString() });
  if (error) console.error("[library]", error.message);
}
