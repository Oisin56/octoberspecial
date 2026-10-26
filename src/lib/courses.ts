import { paidFetch } from "./usage";
import "server-only";
import { COURSES, type CourseData } from "@/data/courses";
import { GUIDES } from "@/data/course-guides";
import { validStrokeIndexes } from "./holes";
export { validStrokeIndexes };
import type { CourseGuide } from "./types";
import { courseDetails, golfApiConfigured, searchClubs } from "./golfapi";
import { libraryGuide } from "./course-library";

/** A course ready to drop into a round: par/SI/yards per tee. */
export interface CourseOption {
  ref: string; // "local:<slug>" | "gca:<id>" | "golfapi:<id>:<country>"
  name: string;
  location: string;
  lat: number | null;
  lon: number | null;
  blurb?: string;
  guide?: CourseGuide | null;
  tees: { name: string; par: number[]; si: number[]; yards: number[]; rating?: number; slope?: number }[];
}

export interface CourseHit {
  ref: string;
  name: string;
  location: string;
  /** 9 or 18, when known */
  holes?: number;
  lat?: number;
  lon?: number;
}

const GCA = "https://api.golfcourseapi.com/v1";



function gcaHeaders() {
  const key = process.env.GOLFCOURSEAPI_KEY;
  return key ? { Authorization: `Key ${key}`, Accept: "application/json" } : null;
}

function localOption(c: CourseData): CourseOption {
  return {
    ref: `local:${c.slug}`,
    name: c.name,
    location: c.location,
    lat: c.lat,
    lon: c.lon,
    blurb: c.blurb,
    guide: GUIDES[c.slug] ? { overview: GUIDES[c.slug].overview, signature: GUIDES[c.slug].signature, holes: GUIDES[c.slug].holes } : null,
    tees: Object.entries(c.tees).map(([name, yards]) => ({ name, par: c.par, si: c.si, yards })),
  };
}

const UK_US = /united kingdom|england|scotland|wales|northern ireland|united states|usa/i;
const YARDS_PER_METRE = 1.0936;

/** GolfAPI first: every tee, pars, stroke indexes and (where they have them) ratings and slopes. */
async function searchGolfApi(q: string): Promise<CourseHit[]> {
  const { data } = await searchClubs(q);
  const hits: CourseHit[] = [];
  for (const club of (data.clubs ?? []) as Record<string, unknown>[]) {
    const clubName = String(club.clubName ?? "");
    const location = [club.city, club.state, club.country].filter(Boolean).map(String).join(", ");
    for (const c of (club.courses ?? []) as Record<string, unknown>[]) {
      const course = String(c.courseName ?? "");
      const same = !course || clubName.toLowerCase().includes(course.toLowerCase());
      hits.push({
        // The country rides along: it decides yards or metres (GolfAPI's own unit label isn't reliable)
        ref: `golfapi:${c.courseID}:${encodeURIComponent(String(club.country ?? ""))}`,
        name: same ? clubName : `${clubName} – ${course}`,
        location,
        holes: Number(c.numHoles) || undefined,
        lat: num(club.latitude ?? club.lat),
        lon: num(club.longitude ?? club.lng ?? club.lon),
      });
    }
  }
  return hits;
}

function num(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : undefined;
}

/** A tee's rating or slope, whatever GolfAPI calls it (men's first). */
function teeFigure(t: Record<string, unknown>, what: "rating" | "slope"): number | undefined {
  const keys = Object.keys(t).filter((k) => (what === "rating" ? /rating/i : /slope/i).test(k));
  const pick = keys.find((k) => /men/i.test(k) && !/women/i.test(k)) ?? keys.find((k) => !/women/i.test(k));
  const v = pick ? num(t[pick]) : undefined;
  if (v == null) return undefined;
  if (what === "slope") return v >= 55 && v <= 155 ? Math.round(v) : undefined;
  return v >= 25 && v <= 85 ? v : undefined;
}

const list = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number) : typeof v === "string" ? v.split(/[,; ]+/).map(Number) : []);

async function golfApiCourse(id: string, country: string): Promise<CourseOption | null> {
  const { data: c } = await courseDetails(id);
  const n = Number(c.numHoles) === 9 ? 9 : 18;
  const parsRaw = list(c.parsMen ?? c.parsWomen).slice(0, n);
  const par = parsRaw.length === n && parsRaw.every((p) => p >= 3 && p <= 6) ? parsRaw : null;
  if (!par) return null;
  let si = list(c.indexesMen ?? c.indexesWomen).slice(0, n);
  if (!validStrokeIndexes(si)) si = par.map((_, i) => i + 1);
  // Metres in Ireland and Europe, yards in the UK and US, whatever the label says; the site shows yards
  const unit = UK_US.test(country) ? "yards" : /^m/i.test(String(c.lengthUnit ?? c.measure ?? "m")) ? "metres" : "yards";
  const tees: CourseOption["tees"] = [];
  for (const t of (Array.isArray(c.tees) ? c.tees : []) as Record<string, unknown>[]) {
    const lengths = Array.from({ length: n }, (_, i) => Number(t[`length${i + 1}`]) || 0);
    if (lengths.filter(Boolean).length < n / 2) continue;
    tees.push({
      name: String(t.teeName ?? t.teeColor ?? "Tee"),
      par,
      si,
      yards: lengths.map((l) => Math.round(unit === "metres" ? l * YARDS_PER_METRE : l)),
      rating: teeFigure(t, "rating"),
      slope: teeFigure(t, "slope"),
    });
  }
  if (!tees.length) tees.push({ name: "Standard", par, si, yards: par.map(() => 0) });
  const name = String(c.clubName ?? c.courseName ?? "Course");
  return { ref: `golfapi:${id}:${encodeURIComponent(country)}`, name, location: country, lat: num(c.latitude) ?? null, lon: num(c.longitude) ?? null, tees };
}

export async function searchCourses(q: string): Promise<{ hits: CourseHit[]; remote: boolean; error?: string }> {
  const needle = q.trim().toLowerCase();
  const hits: CourseHit[] = COURSES.filter((c) => c.name.toLowerCase().includes(needle) || c.location.toLowerCase().includes(needle)).map(
    (c) => ({ ref: `local:${c.slug}`, name: c.name, location: c.location, holes: c.par.length }),
  );
  // GolfAPI first; GolfCourseAPI only when it has nothing (or isn't set up)
  if (golfApiConfigured() && needle.length >= 3) {
    try {
      const found = await searchGolfApi(q);
      if (found.length) return { hits: [...hits, ...found], remote: true };
    } catch (e) {
      console.error("[courses] GolfAPI search", e);
    }
  }
  const headers = gcaHeaders();
  if (!headers || needle.length < 3) return { hits, remote: false };
  try {
    const r = await paidFetch("courses", "course search", `${GCA}/search?search_query=${encodeURIComponent(q.trim())}`, { headers, cache: "no-store" });
    if (!r.ok) return { hits, remote: false, error: `Course search returned ${r.status}` };
    const j = await r.json();
    for (const c of (j.courses ?? []) as Record<string, unknown>[]) {
      const loc = (c.location ?? {}) as Record<string, string>;
      const club = String(c.club_name ?? "");
      const course = String(c.course_name ?? "");
      hits.push({
        ref: `gca:${c.id}`,
        name: club && course && club !== course ? `${club} – ${course}` : club || course,
        location: [loc.city, loc.state, loc.country].filter(Boolean).join(", "),
      });
    }
    return { hits, remote: true };
  } catch {
    return { hits, remote: false, error: "Course search unavailable" };
  }
}

/** A course's card and tees, with its guide from the course library when one's been written. */
export async function getCourse(ref: string): Promise<CourseOption | null> {
  const [c, guide] = await Promise.all([fetchCourse(ref), libraryGuide(ref)]);
  return c && guide ? { ...c, guide } : c;
}

async function fetchCourse(ref: string): Promise<CourseOption | null> {
  const [kind, id, country] = ref.split(":");
  if (kind === "golfapi") {
    try {
      return await golfApiCourse(id, decodeURIComponent(country ?? ""));
    } catch (e) {
      console.error("[courses] GolfAPI course", e);
      return null;
    }
  }
  if (kind === "local") {
    const c = COURSES.find((x) => x.slug === id);
    return c ? localOption(c) : null;
  }
  if (kind !== "gca") return null;
  const headers = gcaHeaders();
  if (!headers) return null;
  const r = await paidFetch("courses", "course card", `${GCA}/courses/${encodeURIComponent(id)}`, { headers, cache: "no-store" });
  if (!r.ok) return null;
  const j = await r.json();
  const c = (j.course ?? j) as Record<string, unknown>;
  const loc = (c.location ?? {}) as Record<string, unknown>;
  const teesRaw = (c.tees ?? {}) as Record<string, unknown>;
  // Tees are grouped by gender: { male: [...], female: [...] } — flatten, men's first
  const groups: [string, unknown][] = Array.isArray(teesRaw) ? [["", teesRaw]] : Object.entries(teesRaw);
  const tees: CourseOption["tees"] = [];
  for (const [gender, list] of groups) {
    for (const t of (Array.isArray(list) ? list : []) as Record<string, unknown>[]) {
      const holes = (Array.isArray(t.holes) ? t.holes : []) as Record<string, unknown>[];
      // 18 holes, or a 9-hole course
      const n = holes.length >= 18 ? 18 : holes.length === 9 ? 9 : 0;
      if (!n) continue;
      const h18 = holes.slice(0, n);
      const par = h18.map((h) => Number(h.par) || 4);
      let si = h18.map((h) => Number(h.handicap) || 0);
      // Repair stroke indexes if missing or muddled
      if (!validStrokeIndexes(si)) si = h18.map((_, i) => i + 1);
      const label = String(t.tee_name ?? "Tee");
      tees.push({
        name: gender === "female" ? `${label} (ladies)` : label,
        par,
        si,
        yards: h18.map((h) => Number(h.yardage) || 0),
        rating: t.course_rating ? Number(t.course_rating) : undefined,
        slope: t.slope_rating ? Number(t.slope_rating) : undefined,
      });
    }
  }
  const club = String(c.club_name ?? "");
  const course = String(c.course_name ?? "");
  return {
    ref,
    name: club && course && club !== course ? `${club} – ${course}` : club || course,
    location: [loc.city, loc.state, loc.country].filter(Boolean).join(", "),
    lat: loc.latitude != null ? Number(loc.latitude) : null,
    lon: loc.longitude != null ? Number(loc.longitude) : null,
    tees,
  };
}
