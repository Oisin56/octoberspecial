import { isOwner } from "@/lib/auth";
import { courseCoordinates, courseDetails, GolfApiError, golfApiConfigured, searchClubs } from "@/lib/golfapi";
import { bad, json } from "@/lib/server-data";

/** Site owner only: try GolfAPI's course coordinates before building anything on them. */
export async function GET(req: Request) {
  if (!(await isOwner())) return bad("Site owner only", 401);
  if (!golfApiConfigured()) return bad("GOLFAPI_KEY isn't set in Vercel (or the site hasn't redeployed since)", 500);
  const u = new URL(req.url);
  const q = u.searchParams.get("q");
  const course = u.searchParams.get("course");
  try {
    if (q) {
      if (q.trim().length < 3) return bad("Type at least 3 letters");
      return json(await searchClubs(q));
    }
    if (course) {
      const [details, coords] = await Promise.all([courseDetails(course), courseCoordinates(course)]);
      return json({ details: details.data, coords: coords.data, fromStore: details.fromStore && coords.fromStore });
    }
    return bad("Nothing asked");
  } catch (e) {
    if (e instanceof GolfApiError) return bad(e.message, e.status);
    console.error("[lab/gps]", e);
    return bad("Something went wrong", 500);
  }
}
