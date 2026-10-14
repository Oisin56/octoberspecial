import "server-only";
import { courseCoordinates, golfApiConfigured } from "./golfapi";
import { parseCoordinates, type CourseGeo } from "./gps";

/** The course's green and tee positions (GolfAPI courses only): 1 call the first time, then kept. */
export async function geoFor(courseSlug: string): Promise<CourseGeo | null> {
  const [kind, id] = courseSlug.split(":");
  if (kind !== "golfapi" || !id || !golfApiConfigured()) return null;
  const { data } = await courseCoordinates(id);
  const geo = parseCoordinates(data);
  return Object.keys(geo).length ? geo : null;
}
