import "server-only";
import { COURSES, type CourseData } from "@/data/courses";

/** A course ready to drop into a round: par/SI/yards per tee. */
export interface CourseOption {
  ref: string; // "local:<slug>" | "gca:<id>"
  name: string;
  location: string;
  lat: number | null;
  lon: number | null;
  blurb?: string;
  tees: { name: string; par: number[]; si: number[]; yards: number[]; rating?: number; slope?: number }[];
}

export interface CourseHit {
  ref: string;
  name: string;
  location: string;
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
    tees: Object.entries(c.tees).map(([name, yards]) => ({ name, par: c.par, si: c.si, yards })),
  };
}

export async function searchCourses(q: string): Promise<{ hits: CourseHit[]; remote: boolean; error?: string }> {
  const needle = q.trim().toLowerCase();
  const hits: CourseHit[] = COURSES.filter((c) => c.name.toLowerCase().includes(needle) || c.location.toLowerCase().includes(needle)).map(
    (c) => ({ ref: `local:${c.slug}`, name: c.name, location: c.location }),
  );
  const headers = gcaHeaders();
  if (!headers || needle.length < 3) return { hits, remote: false };
  try {
    const r = await fetch(`${GCA}/search?search_query=${encodeURIComponent(q.trim())}`, { headers, cache: "no-store" });
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

export async function getCourse(ref: string): Promise<CourseOption | null> {
  const [kind, id] = ref.split(":");
  if (kind === "local") {
    const c = COURSES.find((x) => x.slug === id);
    return c ? localOption(c) : null;
  }
  if (kind !== "gca") return null;
  const headers = gcaHeaders();
  if (!headers) return null;
  const r = await fetch(`${GCA}/courses/${encodeURIComponent(id)}`, { headers, cache: "no-store" });
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
      if (holes.length < 18) continue;
      const h18 = holes.slice(0, 18);
      const par = h18.map((h) => Number(h.par) || 4);
      let si = h18.map((h) => Number(h.handicap) || 0);
      // Repair stroke indexes if missing or not 1..18
      const valid = [...si].sort((a, b) => a - b).every((v, i) => v === i + 1);
      if (!valid) si = h18.map((_, i) => i + 1);
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
