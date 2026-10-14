import "server-only";
import { randomBytes } from "node:crypto";
import { adminClient } from "./admin";
import { getCourse, validStrokeIndexes } from "./courses";
import { slugify } from "./server-data";
import { hashPin } from "./auth";
import { THEMES, type SetupJob, type ThemeId } from "./types";
import {
  FORMATS,
  MAX_PLAYERS,
  MAX_ROUNDS,
  drawProblems,
  drawRound,
  handicapFor,
  playOf,
  pointsRule,
  standingsFor,
  type CourseRating,
  type Who,
  type Wizard,
} from "./wizard";

export class WizardError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{1,2}:\d{2}$/;
const COLOUR = /^#[0-9a-f]{6}$/i;

/** Tidy and check everything the wizard sent. Throws a WizardError with a plain-words message. */
export function cleanWizard(raw: unknown): Wizard {
  const w = (raw ?? {}) as Partial<Wizard>;
  const who = (["solo", "individuals", "teams"] as Who[]).includes(w.who as Who) ? (w.who as Who) : null;
  if (!who) throw new WizardError("Choose who's playing");
  const name = String(w.name ?? "").trim().slice(0, 80);
  if (!name) throw new WizardError("Give it a name");
  const rounds = Array.isArray(w.rounds) ? w.rounds.slice(0, MAX_ROUNDS) : [];
  if (!rounds.length) throw new WizardError("Add at least one round");
  const formats = FORMATS[who].map((f) => f.id);
  rounds.forEach((r, i) => {
    if (!formats.includes(r.format)) throw new WizardError(`Choose the format for round ${i + 1}`);
    if (!r.courseRef && !r.manualCard?.length) throw new WizardError(`Choose the course for round ${i + 1}`);
    if (!["all", "front", "back"].includes(r.holeSet)) r.holeSet = "all";
    if (r.date && !DATE.test(r.date)) r.date = null;
    if (r.time && !TIME.test(r.time)) r.time = null;
  });
  const players = (Array.isArray(w.players) ? w.players : [])
    .map((p) => ({
      name: String(p.name ?? "").trim().slice(0, 40),
      index: p.index == null || p.index === ("" as unknown) || !Number.isFinite(Number(p.index)) ? null : Math.max(-10, Math.min(54, Number(p.index))),
      team: p.team === 0 || p.team === 1 ? p.team : null,
    }))
    .filter((p) => p.name)
    .slice(0, MAX_PLAYERS);
  if (who === "solo" && players.length !== 1) throw new WizardError("Add your name");
  if (who !== "solo" && players.length < 2) throw new WizardError("Add at least two players");
  const teams =
    who === "teams"
      ? [0, 1].map((i) => ({
          name: String(w.teams?.[i]?.name ?? "").trim().slice(0, 40) || (i === 0 ? "Team 1" : "Team 2"),
          color: COLOUR.test(String(w.teams?.[i]?.color ?? "")) ? String(w.teams![i].color) : i === 0 ? "#c8102e" : "#1d4f91",
        }))
      : [];
  const out: Wizard = {
    who,
    name,
    subtitle: String(w.subtitle ?? "").trim().slice(0, 120) || undefined,
    rounds,
    players,
    organiserPlays: who === "solo" ? true : !!w.organiserPlays,
    teams,
    draw: w.draw === "random" ? "random" : "myself",
    extras: { feed: w.extras?.feed !== false, ai: w.extras?.ai !== false, video: w.extras?.video !== false },
    units: w.units === "metres" ? "metres" : "yards",
    theme: THEMES.some((t) => t.id === w.theme) && w.theme !== "custom" ? (w.theme as ThemeId) : "spring",
  };
  const problems = drawProblems(out);
  if (problems.length) throw new WizardError(problems[0]);
  return out;
}

/** The holes, tee and slope/rating for one round, from the course search or the typed-in card. */
async function roundCourse(r: Wizard["rounds"][number], cache: Map<string, Awaited<ReturnType<typeof getCourse>>>) {
  if (r.courseRef) {
    if (!cache.has(r.courseRef)) cache.set(r.courseRef, await getCourse(r.courseRef));
    const c = cache.get(r.courseRef);
    if (!c) throw new WizardError(`Couldn't load the card for ${r.courseName || "a course"}. Pick it again, or type the card in.`);
    const tee = c.tees.find((t) => t.name === r.tee) ?? c.tees[0];
    if (!tee) throw new WizardError(`${c.name} has no tees listed. Type the card in instead.`);
    const holes = tee.par.map((par, i) => ({ number: i + 1, par, si: tee.si[i], yards: tee.yards[i] || undefined }));
    const course: CourseRating | null =
      tee.slope && tee.rating ? { slope: tee.slope, rating: tee.rating, par: tee.par.reduce((a, b) => a + b, 0) } : null;
    return {
      course_slug: c.ref,
      course_name: r.courseName?.trim() || c.name,
      course_location: r.location || c.location || null,
      course_blurb: c.blurb ?? null,
      course_guide: c.guide ?? null,
      lat: c.lat ?? r.lat ?? null,
      lon: c.lon ?? r.lon ?? null,
      tee: tee.name,
      holes,
      rating: course,
    };
  }
  const card = (r.manualCard ?? []).map((h, i) => ({ number: i + 1, par: Number(h.par), si: Number(h.si) }));
  const name = String(r.courseName ?? "").trim().slice(0, 80);
  if (!name) throw new WizardError("Give the typed-in course a name");
  if (card.length !== 18 && card.length !== 9) throw new WizardError(`The card for ${name} needs 18 holes (or 9)`);
  if (card.some((h) => !(h.par >= 3 && h.par <= 6))) throw new WizardError(`Each par on the ${name} card must be 3 to 6`);
  if (!validStrokeIndexes(card.map((h) => h.si))) throw new WizardError(`The stroke indexes on the ${name} card must each be used once`);
  return {
    course_slug: `manual:${slugify(name) || "course"}`,
    course_name: name,
    course_location: r.location || null,
    course_blurb: null,
    course_guide: null,
    lat: r.lat ?? null,
    lon: r.lon ?? null,
    tee: null,
    holes: card,
    rating: null,
  };
}

export interface Created {
  id: string;
  slug: string;
  organiser: { name: string; playerId?: string };
}

/** Build the whole tournament from the wizard: tournament, players, rounds with their groups or matches. */
export async function createFromWizard(w: Wizard, opts: { pin?: string | null }): Promise<Created> {
  const db = adminClient();
  const cache = new Map<string, Awaited<ReturnType<typeof getCourse>>>();
  // Courses first: nothing is created if a card can't be loaded
  const courses: Awaited<ReturnType<typeof roundCourse>>[] = [];
  for (const r of w.rounds) courses.push(await roundCourse(r, cache));

  const standings = standingsFor(w);
  const dates = w.rounds.map((r) => r.date).filter((d): d is string => !!d).sort();
  let slug = slugify(w.name) || "tournament";
  const { data: clash } = await db.from("tournaments").select("id").eq("slug", slug).maybeSingle();
  if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  const teams = (w.teams ?? []).map((t, i) => ({ id: `team-${i + 1}`, name: t.name, color: t.color }));
  const pin = opts.pin && /^\d{4,8}$/.test(opts.pin) ? opts.pin : randomBytes(12).toString("hex");

  const base: Record<string, unknown> = {
    slug,
    name: w.name,
    subtitle: w.subtitle ?? null,
    organiser_pin_hash: hashPin(pin),
    published: false,
    theme: w.theme,
    teams,
    side_games_by: "player",
    start_date: dates[0] ?? null,
    end_date: dates[dates.length - 1] ?? null,
    video_enabled: w.extras.video,
    auto_bulletins: w.extras.ai,
  };
  const phaseC = { standings, feed_on: w.extras.feed, ai_on: w.extras.ai, units: w.units ?? "yards" };
  let { data: t, error } = await db.from("tournaments").insert({ ...base, ...phaseC }).select("id,slug").single();
  if (error && /units/.test(error.message)) {
    // GPS units need the latest database update; everything else saves
    const { units: _u, ...rest } = phaseC;
    void _u;
    ({ data: t, error } = await db.from("tournaments").insert({ ...base, ...rest }).select("id,slug").single());
  }
  if (error && /standings|feed_on|ai_on/.test(error.message)) {
    // The database hasn't had this update yet: points tournaments still work; totals need it
    if (standings !== "points") throw new WizardError("Running totals need the latest database update. Run supabase/schema.sql in Supabase, then try again.");
    ({ data: t, error } = await db.from("tournaments").insert(base).select("id,slug").single());
  }
  if (error || !t) throw new Error(error?.message ?? "Couldn't create the tournament");

  try {
    // Players, in the wizard's order (the organiser first when playing)
    const ids = w.players.map((p) => `${slugify(p.name) || "player"}-${Math.random().toString(36).slice(2, 6)}`);
    const teamOf: Record<string, string | null> = {};
    const rows = w.players.map((p, i) => {
      teamOf[ids[i]] = w.who === "teams" && p.team != null ? teams[p.team].id : null;
      return { id: ids[i], tournament_id: t!.id, name: p.name, handicap: p.index, sort: i, team_id: teamOf[ids[i]] };
    });
    const { error: pe } = await db.from("players").insert(rows);
    if (pe) throw new Error(pe.message);
    const organiserId = w.organiserPlays ? ids[0] : null;

    const roundRows = w.rounds.map((r, i) => {
      const c = courses[i];
      const { play, scoring } = playOf(r.format);
      const games = drawRound(w, r, i + 1, ids, teamOf) ?? [];
      const points = pointsRule(r.format, r.points, standings, w.players.length);
      const nine = c.holes.length === 9;
      return {
        tournament_id: t!.id,
        number: i + 1,
        course_slug: c.course_slug,
        course_name: c.course_name,
        course_location: c.course_location,
        course_blurb: c.course_blurb,
        course_guide: c.course_guide,
        lat: c.lat,
        lon: c.lon,
        tee: c.tee,
        holes: c.holes,
        hole_set: nine ? "all" : r.holeSet,
        play_date: r.date || null,
        tee_time: r.time || null,
        format: scoring,
        play,
        games,
        scorer_id: games[0]?.scorerId ?? null,
        points_rule: points,
        nine_points: 0,
        full_points: Math.floor(points.full), // legacy whole-number column; points_rule has the real figure
        handicap_rule: handicapFor(r.format, c.rating),
        status: "upcoming",
      };
    });
    const { data: made, error: re } = await db.from("rounds").insert(roundRows).select("id,number,course_slug,course_guide");
    if (re) throw new Error(/hole_set/.test(re.message) ? "Rounds need the latest database update. Run supabase/schema.sql in Supabase, then try again." : re.message);

    // What's left to get ready: a hole-by-hole guide per course (for the AI writer), then the first preview
    const jobs: SetupJob[] = [{ id: "cards", kind: "photo", label: "Course cards loaded", status: "done" }];
    if (w.extras.ai) {
      const seen = new Set<string>();
      for (const r of [...(made ?? [])].sort((a, b) => a.number - b.number)) {
        if (seen.has(r.course_slug)) continue;
        seen.add(r.course_slug);
        const name = roundRows[r.number - 1].course_name;
        jobs.push({ id: `guide-${r.number}`, kind: "guide", roundId: r.id, label: `Hole-by-hole guide: ${name}`, status: r.course_guide ? "done" : "todo" });
      }
      const first = made?.find((r) => r.number === 1);
      if (first) jobs.push({ id: "preview", kind: "preview", roundId: first.id, label: "First preview written", status: "todo" });
    }
    await db.from("tournaments").update({ organiser_player_id: organiserId }).eq("id", t.id);
    // Needs the latest database update; without it there's simply nothing to finish off afterwards
    if (jobs.length > 1) await db.from("tournaments").update({ setup_jobs: jobs }).eq("id", t.id);
    return { id: t.id, slug: t.slug, organiser: { name: w.organiserPlays ? w.players[0].name : "Organiser", playerId: organiserId ?? undefined } };
  } catch (e) {
    // Leave nothing half-made
    await db.from("tournaments").delete().eq("id", t.id);
    throw e instanceof WizardError ? e : new WizardError(e instanceof Error ? e.message : "Couldn't create the tournament");
  }
}
