import { RESERVED_SLUGS } from "./files";
import "server-only";
import { adminClient } from "./admin";
import { getCourse, validStrokeIndexes } from "./courses";
import { slugify } from "./server-data";
import { THEMES, TONE_LABEL, type SetupJob, type ThemeId, type Tone } from "./types";
import { drawBracket, knockoutGames, type Entrant, type Knockout, type PrizeKind, type RoundCfg, type TournamentCfg, type WinRule } from "./engine";
import {
  MAX_PLAYERS,
  MAX_ROUNDS,
  MAX_TEAMS,
  drawRound,
  roundHandicap,
  knockoutEntrants,
  knockoutPairs,
  knockoutStages,
  playOf,
  pointsRule,
  problems,
  roundFormats,
  standingsOf,
  teeTimeAt,
  winRule,
  winsFor,
  type CourseRating,
  type DayFormat,
  type WinChoice,
  type Who,
  type Wizard,
} from "./wizard";

export class WizardError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{1,2}:\d{2}$/;
const COLOUR = /^#[0-9a-f]{6}$/i;
const DEFAULT_COLOURS = ["#c8102e", "#1d4f91", "#2e7d4f", "#a8741f", "#5b3f8c", "#1b1b1b"];
const PRIZES: PrizeKind[] = ["ctp", "ld", "nines", "birdies", "gir", "skins", "bestround"];
const BONUS = ["birdies", "eagles", "gir", "ctp", "ld"] as const;

const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const num = (v: unknown, lo: number, hi: number) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.max(lo, Math.min(hi, Number(v))));

/** Tidy and check everything the wizard sent. Throws a WizardError with a plain-words message. */
export function cleanWizard(raw: unknown): Wizard {
  const w = (raw ?? {}) as Partial<Wizard>;
  const who = (["solo", "individuals", "teams"] as Who[]).includes(w.who as Who) ? (w.who as Who) : null;
  if (!who) throw new WizardError("Choose who's playing");
  const name = clip(w.name, 80);
  if (!name) throw new WizardError("Give it a name");

  const teams =
    who === "teams"
      ? (Array.isArray(w.teams) ? w.teams : []).slice(0, MAX_TEAMS).map((t, i) => ({
          name: clip(t?.name, 40) || `Team ${i + 1}`,
          color: COLOUR.test(String(t?.color ?? "")) ? String(t.color) : DEFAULT_COLOURS[i % DEFAULT_COLOURS.length],
        }))
      : [];
  if (who === "teams" && teams.length < 2) throw new WizardError("Add at least two teams");

  const seen = new Set<string>();
  const players = (Array.isArray(w.players) ? w.players : [])
    .map((p, i) => ({
      key: clip(p?.key, 40) || `p${i}`,
      name: clip(p?.name, 40),
      index: num(p?.index, -10, 54),
      team: who === "teams" && Number.isInteger(p?.team) && p!.team! >= 0 && p!.team! < teams.length ? p!.team! : null,
      nickname: clip(p?.nickname, 40) || null,
      line: clip(p?.line, 200) || null,
    }))
    .filter((p) => p.name && !seen.has(p.key) && seen.add(p.key))
    .slice(0, MAX_PLAYERS);
  if (who === "solo" && players.length !== 1) throw new WizardError("Add your name");

  const sizes = teams.map((_, i) => players.filter((p) => p.team === i).length);
  const offered = winsFor(who, teams.length, sizes).filter((x) => !x.off).map((x) => x.id);
  const win: WinChoice = who === "solo" ? (w.rounds?.[0]?.format === "stroke" ? "stroke" : "stableford") : offered.includes(w.win as WinChoice) ? (w.win as WinChoice) : (() => {
    throw new WizardError("Choose how the winner is decided");
  })();
  const ko =
    win === "knockout"
      ? {
          pairs: !!w.ko?.pairs,
          draw: (["random", "seeded", "pick"] as const).includes(w.ko?.draw as "random") ? w.ko!.draw : "random",
          tie: w.ko?.tie === "extra" ? ("extra" as const) : ("backnine" as const),
          slots: Array.isArray(w.ko?.slots) ? w.ko!.slots!.map((x) => (x == null ? null : clip(x, 90))) : null,
          pairsPicked: Array.isArray(w.ko?.pairsPicked) ? w.ko!.pairsPicked!.map((p) => (Array.isArray(p) ? p.map((k) => clip(k, 40)) : [])) : null,
        }
      : null;

  const keys = new Set(players.map((p) => p.key));
  const rounds = (Array.isArray(w.rounds) ? w.rounds : []).slice(0, MAX_ROUNDS);
  if (!rounds.length) throw new WizardError("Add at least one round");
  const formats = roundFormats(who, win, !!ko?.pairs);
  rounds.forEach((r, i) => {
    if (who === "solo" ? !formats.includes(r.format) : formats.length === 1) r.format = formats[0];
    if (!formats.includes(r.format as DayFormat)) throw new WizardError(`Choose the format for round ${i + 1}`);
    if (!r.courseRef && !r.manualCard?.length) throw new WizardError(`Choose the course for round ${i + 1}`);
    if (!["all", "front", "back"].includes(r.holeSet)) r.holeSet = "all";
    if (r.date && !DATE.test(r.date)) r.date = null;
    if (r.time && !TIME.test(r.time)) r.time = null;
    r.playerTees = Object.fromEntries(Object.entries(r.playerTees ?? {}).filter(([k, v]) => keys.has(k) && typeof v === "string" && v).map(([k, v]) => [k, clip(v, 40)]));
    r.hcp = r.hcp === "flat" || r.hcp === "manual" ? r.hcp : "official";
    r.shots = r.hcp === "manual" ? Object.fromEntries(Object.entries(r.shots ?? {}).filter(([k]) => keys.has(k)).map(([k, v]) => [k, Math.max(0, Math.min(54, Math.round(Number(v) || 0)))])) : undefined;
    r.picks = Array.isArray(r.picks) ? r.picks.map((g) => (Array.isArray(g) ? g.map((s) => (Array.isArray(s) ? s.filter((k) => keys.has(k)) : [])) : [])) : null;
  });
  if (win === "knockout") {
    const stages = knockoutStages(knockoutEntrants({ players, ko }).length);
    if (rounds.length !== stages) throw new WizardError(`A knockout of ${players.length} needs ${stages} round${stages === 1 ? "" : "s"}, one for each stage.`);
  }

  const prizes = (Array.isArray(w.prizes) ? w.prizes : [])
    .filter((p) => PRIZES.includes(p?.kind))
    .filter((p, i, all) => all.findIndex((q) => q.kind === p.kind) === i)
    .map((p) => ({
      kind: p.kind,
      per: p.kind === "nines" || p.per === "round" ? ("round" as const) : ("trip" as const),
      holes: Array.isArray(p.holes) && p.holes.length ? p.holes.map(Number).filter((n) => n >= 1 && n <= 18) : null,
      holesByRound:
        (p.kind === "ctp" || p.kind === "ld") && p.holesByRound && typeof p.holesByRound === "object"
          ? Object.fromEntries(
              Object.entries(p.holesByRound)
                .filter(([k, v]) => /^\d{1,2}$/.test(k) && Array.isArray(v))
                .map(([k, v]) => [k, (v as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 18)])
                .filter(([, v]) => (v as number[]).length),
            )
          : null,
      points: win === "points" ? num(p.points, 0, 100) : null,
    }));
  const bonus = win === "points" ? Object.fromEntries(BONUS.map((k) => [k, num(w.bonus?.[k], 0, 100) ?? 0]).filter(([, v]) => (v as number) > 0)) : {};

  const out: Wizard = {
    who,
    name,
    subtitle: clip(w.subtitle, 120) || undefined,
    players,
    organiserPlays: who === "solo" ? true : !!w.organiserPlays,
    teams,
    win,
    ko,
    skinsCarry: w.skinsCarry !== false,
    teamCount: [0, 1, 2, 3, 4].includes(Number(w.teamCount)) ? Number(w.teamCount) : 2,
    allowance: num(w.allowance, 0, 100),
    rounds,
    bonus,
    draw: w.draw === "balanced" ? "balanced" : w.draw === "pick" ? "pick" : "random",
    teeGap: num(w.teeGap, 5, 20) ?? 10,
    prizes,
    extras: { feed: w.extras?.feed !== false, ai: w.extras?.ai !== false, video: w.extras?.video !== false },
    tone: (Object.keys(TONE_LABEL) as Tone[]).includes(w.tone as Tone) ? w.tone : "broadsheet",
    units: w.units === "metres" ? "metres" : "yards",
    share: w.share === "landscape" ? "landscape" : "portrait",
    privacy: w.privacy === "private" ? "private" : "friends",
    playersNeedEmail: w.privacy === "private" && w.playersNeedEmail === true,
    theme: THEMES.some((t) => t.id === w.theme) && w.theme !== "custom" ? (w.theme as ThemeId) : "spring",
  };
  const p = problems(out);
  if (p.length) throw new WizardError(p[0]);
  return out;
}

type Tee = { name: string; par: number[]; si: number[]; yards: number[]; rating?: number; slope?: number };

/** The holes, tees and slope/rating for one round, from the course search or the typed-in card. */
export async function roundCourse(r: Wizard["rounds"][number], cache: Map<string, Awaited<ReturnType<typeof getCourse>>>) {
  if (r.courseRef) {
    if (!cache.has(r.courseRef)) cache.set(r.courseRef, await getCourse(r.courseRef));
    const c = cache.get(r.courseRef);
    if (!c) throw new WizardError(`Couldn't load the card for ${r.courseName || "a course"}. Pick it again, or type the card in.`);
    const tee = c.tees.find((t) => t.name === r.tee) ?? c.tees[0];
    if (!tee) throw new WizardError(`${c.name} has no tees listed. Type the card in instead.`);
    const holes = tee.par.map((par, i) => ({ number: i + 1, par, si: tee.si[i], yards: tee.yards[i] || undefined }));
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
      tees: c.tees as Tee[],
      rating: ratingOf(tee),
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
    tees: [] as Tee[],
    rating: null as CourseRating | null,
  };
}

const ratingOf = (t: Tee): CourseRating | null => (t.slope && t.rating ? { slope: t.slope, rating: t.rating, par: t.par.reduce((a, b) => a + b, 0) } : null);

export interface Created {
  id: string;
  slug: string;
  name: string;
  organiser: { name: string; playerId?: string };
}

/** Build the whole tournament from the wizard: tournament, players, rounds with their groups or matches. */
export async function createFromWizard(w: Wizard): Promise<Created> {
  const db = adminClient();
  const cache = new Map<string, Awaited<ReturnType<typeof getCourse>>>();
  // Courses first: nothing is created if a card can't be loaded
  const courses: Awaited<ReturnType<typeof roundCourse>>[] = [];
  for (const r of w.rounds) courses.push(await roundCourse(r, cache));

  const dates = w.rounds.map((r) => r.date).filter((d): d is string => !!d).sort();
  let slug = slugify(w.name) || "tournament";
  const { data: clash } = await db.from("tournaments").select("id").eq("slug", slug).maybeSingle();
  if (clash || RESERVED_SLUGS.has(slug)) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  const teams = w.teams.map((t, i) => ({ id: `team-${i + 1}`, name: t.name, color: t.color }));

  // Players' ids now, so the knockout's bracket can name them
  const ids = w.players.map((p) => `${slugify(p.name) || "player"}-${Math.random().toString(36).slice(2, 6)}`);
  const idOf = Object.fromEntries(w.players.map((p, i) => [p.key, ids[i]]));
  const teamOf: Record<string, string | null> = Object.fromEntries(w.players.map((p, i) => [ids[i], w.who === "teams" && p.team != null ? teams[p.team].id : null]));
  const hcp: Record<string, number | null> = Object.fromEntries(w.players.map((p, i) => [ids[i], p.index]));

  let win: WinRule;
  if (w.win === "knockout" && w.ko) {
    const pairs = w.ko.pairs ? knockoutPairs(w.players.map((p) => p.key), Object.fromEntries(w.players.map((p) => [p.key, p.index])), w.ko.draw, w.ko.pairsPicked) : w.players.map((p) => [p.key]);
    const entrantOf = (keys: string[]): Entrant => {
      const pids = keys.map((k) => idOf[k]).filter(Boolean);
      return { id: pids.length > 1 ? `pair:${pids.join("+")}` : pids[0], playerIds: pids };
    };
    const entrants = pairs.map(entrantOf);
    const picked = w.ko.draw === "pick" && w.ko.slots?.length ? w.ko.slots.map((s) => (s ? entrantOf(s.split("+")).id : null)) : null;
    const slots = picked ?? drawBracket(entrants, w.ko.draw, w.players.map((p, i) => ({ id: ids[i], name: p.name, handicap: p.index })));
    const knockout: Knockout = { pairs: w.ko.pairs, tie: w.ko.tie, draw: w.ko.draw, entrants, slots };
    win = { kind: "knockout", knockout };
  } else win = winRule(w) ?? { kind: "stableford" };

  const base: Record<string, unknown> = {
    slug,
    name: w.name,
    subtitle: w.subtitle ?? null,
    organiser_pin_hash: null,
    published: false,
    theme: w.theme,
    teams,
    tone: w.tone ?? "broadsheet",
    side_games: [],
    side_games_by: "player",
    start_date: dates[0] ?? null,
    end_date: dates[dates.length - 1] ?? null,
    video_enabled: w.extras.video,
    auto_bulletins: w.extras.ai,
    standings: standingsOf(w.win),
    feed_on: w.extras.feed,
    privacy: w.privacy ?? "friends",
    players_need_email: !!w.playersNeedEmail,
    ai_on: w.extras.ai,
    units: w.units ?? "yards",
    share_shape: w.share ?? "portrait",
    win,
    prizes: w.prizes,
  };
  const { data: t, error } = await db.from("tournaments").insert(base).select("id,slug,name").single();
  if (error && /win|prizes|tees|standings|feed_on|share_shape|units/.test(error.message))
    throw new WizardError("This needs the latest database update. Run supabase/schema.sql in Supabase, then try again.");
  if (error || !t) throw new Error(error?.message ?? "Couldn't create the tournament");

  try {
    // Players, in the wizard's order (the organiser first when playing)
    const rows = w.players.map((p, i) => ({
      id: ids[i],
      tournament_id: t.id,
      name: p.name,
      handicap: p.index,
      sort: i,
      team_id: teamOf[ids[i]],
      nickname: p.nickname ?? null,
      bio: p.line ?? null,
    }));
    const { error: pe } = await db.from("players").insert(rows);
    if (pe) throw new Error(pe.message);
    const organiserId = w.organiserPlays ? ids[0] : null;

    // A knockout's first stage comes from the bracket; later stages fill in as matches finish
    let koFirst: RoundCfg["games"] | null = null;
    if (win.kind === "knockout") {
      const stub = w.rounds.map((_, i) => ({ id: `r${i + 1}`, number: i + 1, name: "", holes: [], play: "singles", scoring: "match", games: [], points: { front: 0, back: 0, full: 0 }, handicap: { mode: "manual", shots: {} } }) as RoundCfg);
      const cfg: TournamentCfg = { players: w.players.map((p, i) => ({ id: ids[i], name: p.name, handicap: p.index })), teams: [], rounds: stub, sideGames: [], sideGamesBy: "player", win };
      koFirst = (knockoutGames(cfg, {}, win.knockout).r1 ?? []).map((g, i) => ({ ...g, teeTime: teeTimeAt(w.rounds[0].time, Math.floor(i / (win.knockout.pairs ? 1 : 2)), w.teeGap ?? 10) }));
    }

    const roundRows = w.rounds.map((r, i) => {
      const c = courses[i];
      const { play, scoring } = playOf(r.format);
      const games = win.kind === "knockout" ? (i === 0 ? koFirst ?? [] : []) : drawRound(w, r, i + 1, ids, { hcp, teamOf, idOf });
      const points = pointsRule(r.format, r.points, w.win, w.players.length);
      const nine = c.holes.length === 9;
      const playerTees = Object.fromEntries(
        Object.entries(r.playerTees ?? {})
          .filter(([k, tee]) => idOf[k] && tee !== c.tee && c.tees.some((x) => x.name === tee))
          .map(([k, tee]) => [idOf[k], tee]),
      );
      return {
        tournament_id: t.id,
        number: i + 1,
        course_slug: c.course_slug,
        course_name: c.course_name,
        course_location: c.course_location,
        course_blurb: c.course_blurb,
        course_guide: c.course_guide,
        lat: c.lat,
        lon: c.lon,
        tee: c.tee,
        tees: c.tees.length ? c.tees : null,
        player_tees: Object.keys(playerTees).length ? playerTees : null,
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
        handicap_rule: roundHandicap(r.format, w.win, c.rating, w.allowance, r, idOf),
        status: "upcoming",
      };
    });
    const { data: made, error: re } = await db.from("rounds").insert(roundRows).select("id,number,course_slug,course_guide");
    if (re) throw new Error(/hole_set|tees/.test(re.message) ? "Rounds need the latest database update. Run supabase/schema.sql in Supabase, then try again." : re.message);

    // What's left to get ready: a hole-by-hole guide per course (for the AI writer), then the first preview
    const jobs: SetupJob[] = [{ id: "cards", kind: "photo", label: "Course cards loaded", status: "done" }];
    if (w.extras.ai) {
      const seen = new Set<string>();
      for (const r of [...(made ?? [])].sort((a, b) => a.number - b.number)) {
        if (seen.has(r.course_slug)) continue;
        seen.add(r.course_slug);
        const name = roundRows[r.number - 1].course_name;
        jobs.push({ id: `guide-${r.number}`, kind: "guide", roundId: r.id, label: `Hole-by-hole guide: ${name}`, status: r.course_guide ? "done" : "todo", note: r.course_guide ? "Already in the course library" : undefined });
      }
      const first = made?.find((r) => r.number === 1);
      if (first) jobs.push({ id: "preview", kind: "preview", roundId: first.id, label: "First preview written", status: "todo" });
    }
    await db.from("tournaments").update({ organiser_player_id: organiserId }).eq("id", t.id);
    if (jobs.length > 1) await db.from("tournaments").update({ setup_jobs: jobs }).eq("id", t.id);
    return { id: t.id, slug: t.slug, name: t.name, organiser: { name: w.organiserPlays ? w.players[0].name : "Organiser", playerId: organiserId ?? undefined } };
  } catch (e) {
    // Leave nothing half-made
    await db.from("tournaments").delete().eq("id", t.id);
    throw e instanceof WizardError ? e : new WizardError(e instanceof Error ? e.message : "Couldn't create the tournament");
  }
}
