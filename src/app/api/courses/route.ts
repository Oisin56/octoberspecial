import { getCourse, searchCourses } from "@/lib/courses";
import { bad, json } from "@/lib/server-data";

/** GET ?q=name → search; GET ?ref=gca:123 → full scorecard */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ref = url.searchParams.get("ref");
  if (ref) {
    const c = await getCourse(ref);
    return c ? json({ course: c }) : bad("Course not found", 404);
  }
  const q = url.searchParams.get("q") ?? "";
  return json(await searchCourses(q));
}
