import "server-only";
import { after } from "next/server";
import { adminClient } from "./admin";
import { dropResearch, inputFor, kickResearch, startResearch } from "./research";
import { syncTripDates } from "./trip-dates";
import { slugify } from "./server-data";
import { drawBracket, knockoutGames, type Entrant, type Game, type RoundCfg, type TournamentCfg, type WinRule } from "./engine";
import { normalizeRound, type CourseTee, type PlayerRow, type RoundRow, type TournamentRow } from "./types";
import { moveFiles } from "./files";
import { WizardError, cleanWizard, roundCourse } from "./wizard-server";
import {
  courseRefOf,
  libraryRef,
  drawRound,
  formatOfRound,
  roundHandicap,
  isMatch,
  isPairs,
  knockoutPairs,
  playOf,
  pointsRule,
  standingsOf,
  winRule,
  withTeeTimes,
  type CourseRating,
  type DayFormat,
} from "./wizard";

const SCOPES = /^(name|players|teams|win|points|groups|prizes|extras|watch|look|about|addround|round:\d+|removeround:\d+)$/;
export const validScope = (s: string) => SCOPES.test(s);

/**
 * Tournament setup: one changed answer applied to a tournament that already exists. Only what that screen covers
 * changes. A round with scores keeps its course, holes, format and groups (the scores belong to them); its tees,
 * points and handicaps can change, and its results are then worked out again from the scores.
 */
export async function applySetupEdit(t: TournamentRow, raw: unknown, scope: string, origin?: string): Promise<{ note?: string }> {
  const w = cleanWizard(raw);
  const db = adminClient();
  const [{ data: playerRows }, { data: roundRows }] = await Promise.all([
    db.from("players").select("*").eq("tournament_id", t.id).order("sort"),
    db.from("rounds").select("*").eq("tournament_id", t.id).order("number"),
  ]);
  const rounds = ((roundRows ?? []) as RoundRow[]).map(normalizeRound);
  const players = (playerRows ?? []) as PlayerRow[];
  const { data: scored } = rounds.length ? await db.from("hole_entries").select("round_id").in("round_id", rounds.map((r) => r.id)) : { data: [] };
  const started = new Set((scored ?? []).map((x) => x.round_id as string));
  const anyStarted = started.size > 0;
  const notes: string[] = [];

  // Player keys on the setup page are player ids; anyone new gets an id now
  const idOf: Record<string, string> = {};
  // (from the key, so saving again as you type finds the same player rather than adding another)
  for (const p of w.players) idOf[p.key] = players.find((x) => x.id === p.key || x.id.endsWith(`-${p.key}`))?.id ?? `${slugify(p.name) || "player"}-${p.key}`;
  const ids = w.players.map((p) => idOf[p.key]);
  const teams = w.teams.map((tm, i) => ({ id: `team-${i + 1}`, name: tm.name, color: tm.color }));
  const teamOf: Record<string, string | null> = Object.fromEntries(w.players.map((p) => [idOf[p.key], w.who === "teams" && p.team != null ? (teams[p.team]?.id ?? null) : null]));
  const hcp: Record<string, number | null> = Object.fromEntries(w.players.map((p) => [idOf[p.key], p.index]));
  const info = { hcp, teamOf, idOf };
  const gap = w.teeGap ?? 10;

  const updateT = async (patch: Record<string, unknown>) => {
    const { error } = await db.from("tournaments").update(patch).eq("id", t.id);
    if (error) throw new Error(error.message);
  };
  const updateR = async (id: string, patch: Record<string, unknown>) => {
    const { error } = await db.from("rounds").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
  };
  const formatOf = (r: RoundRow): DayFormat => formatOfRound(r, w.who);
  const ratingOf = (r: Pick<RoundRow, "tees" | "tee" | "handicap_rule">): CourseRating | null => {
    const tee = r.tees?.find((x) => x.name === r.tee);
    if (tee?.slope && tee.rating) return { slope: tee.slope, rating: tee.rating, par: tee.par.reduce((a, b) => a + b, 0) };
    return r.handicap_rule?.mode === "allowance" ? (r.handicap_rule.course ?? null) : null;
  };
  /** A round's format, points and handicaps from the answers. */
  const formatPatch = (r: Pick<RoundRow, "tees" | "tee" | "handicap_rule">, f: DayFormat, i: number) => {
    const { play, scoring } = playOf(f);
    const points = pointsRule(f, w.rounds[i]?.points, w.win, w.players.length);
    return { play, format: scoring, points_rule: points, nine_points: points.front, full_points: Math.floor(points.full), handicap_rule: roundHandicap(f, w.win, ratingOf(r), w.allowance, w.rounds[i] ?? {}, idOf) };
  };
  /** Groups or matches for round i: as picked, or (fresh: the format's changed shape) a new draw. */
  const draw = (i: number, fresh = false) => drawRound(fresh && w.draw === "pick" ? { ...w, draw: "random" } : w, w.rounds[i], i + 1, ids, info);
  const datesFromRounds = () => syncTripDates(t.id);
  // Courses chosen here are read up on in the background; a course replaced here stops being searched if nobody needs it
  const research: { ref: string; name: string; location: string | null; holes: { number: number; par: number; yards?: number }[] }[] = [];
  const replaced: string[] = [];
  /** A new round row from the answers for round k. */
  const newRound = async (k: number, games: Game[]) => {
    const a = w.rounds[k];
    const c = await roundCourse(a, new Map());
    research.push({ ref: libraryRef(c.course_slug), name: c.course_name, location: c.course_location, holes: c.holes });
    const { error } = await db.from("rounds").insert({
      tournament_id: t.id,
      number: k + 1,
      course_slug: c.course_slug,
      course_name: c.course_name,
      course_location: c.course_location,
      course_blurb: c.course_blurb,
      course_guide: c.course_guide,
      lat: c.lat,
      lon: c.lon,
      tee: c.tee,
      tees: c.tees.length ? c.tees : null,
      player_tees: null,
      holes: c.holes,
      hole_set: c.holes.length === 9 ? "all" : a.holeSet,
      play_date: a.date || null,
      tee_time: a.time || null,
      status: "upcoming",
      games,
      scorer_id: games[0]?.scorerId ?? null,
      ...formatPatch({ tees: c.tees, tee: c.tee, handicap_rule: null }, a.format, k),
    });
    if (error) throw new Error(error.message);
  };

  /** The knockout's bracket and first-stage matches, drawn again (only before anything's been played). */
  const rebuildKnockout = async () => {
    if (w.win !== "knockout" || !w.ko) return;
    if (anyStarted) throw new WizardError("The knockout has started, so its draw stays as it is.");
    const pairs = w.ko.pairs ? knockoutPairs(w.players.map((p) => p.key), Object.fromEntries(w.players.map((p) => [p.key, p.index])), w.ko.draw, w.ko.pairsPicked) : w.players.map((p) => [p.key]);
    const entrantOf = (keys: string[]): Entrant => {
      const pids = keys.map((k) => idOf[k]).filter(Boolean);
      return { id: pids.length > 1 ? `pair:${pids.join("+")}` : pids[0], playerIds: pids };
    };
    const entrants = pairs.map(entrantOf);
    const picked = w.ko.draw === "pick" && w.ko.slots?.length ? w.ko.slots.map((s) => (s ? entrantOf(s.split("+")).id : null)) : null;
    const slots = picked ?? drawBracket(entrants, w.ko.draw, w.players.map((p) => ({ id: idOf[p.key], name: p.name, handicap: p.index })));
    const win: WinRule = { kind: "knockout", knockout: { pairs: w.ko.pairs, tie: w.ko.tie, draw: w.ko.draw, entrants, slots } };
    await updateT({ win, standings: "points" });
    // One round for each stage: more players can mean another round, fewer one less
    const f: DayFormat = w.ko.pairs ? "fourball" : "match";
    for (const r of rounds.slice(w.rounds.length)) await db.from("rounds").delete().eq("id", r.id);
    const kept = rounds.slice(0, w.rounds.length);
    const stub = w.rounds.map((_, k) => ({ id: kept[k]?.id ?? `new${k}`, number: k + 1, name: "", holes: [], play: "singles", scoring: "match", games: [], points: { front: 0, back: 0, full: 0 }, handicap: { mode: "manual", shots: {} } }) as RoundCfg);
    const cfg: TournamentCfg = { players: w.players.map((p) => ({ id: idOf[p.key], name: p.name, handicap: p.index })), teams: [], rounds: stub, sideGames: [], sideGamesBy: "player", win };
    const games = knockoutGames(cfg, {}, win.knockout);
    for (const [k] of w.rounds.entries()) {
      const r = kept[k];
      const gs = withTeeTimes(games[stub[k].id] ?? [], w.rounds[k].time ?? r?.tee_time, gap);
      if (r) await updateR(r.id, { ...formatPatch(r, f, k), games: gs, scorer_id: gs[0]?.scorerId ?? null });
      else await newRound(k, gs);
    }
  };

  /** Players added or taken out: the rounds not started yet are drawn again with everyone in them. */
  const redrawUnstarted = async (why: string) => {
    if (w.win === "knockout") return rebuildKnockout();
    let kept = 0;
    for (const [i, r] of rounds.entries()) {
      if (started.has(r.id)) {
        kept++;
        continue;
      }
      const gs = draw(i);
      await updateR(r.id, { games: gs, scorer_id: gs[0]?.scorerId ?? null });
    }
    if (kept) notes.push(`${kept === 1 ? "The round" : `The ${kept} rounds`} already under way keep${kept === 1 ? "s" : ""} ${why}.`);
  };

  const [kind, n] = scope.split(":");
  const i = Number(n ?? 0);
  // Set up before the new set-up screens: how it's won, points and groups stay in Rounds and courses
  const legacy = !t.win;
  if (legacy && (kind === "win" || kind === "points" || kind === "groups")) throw new WizardError("Change this one in Rounds and courses, on the organiser page.");
  switch (kind) {
    case "name":
      await updateT({ name: w.name, subtitle: w.subtitle ?? null });
      break;

    case "players":
    case "teams":
    case "about": {
      // Names, handicaps, teams, the line about each; anyone new added, anyone missing taken out
      const keep = new Set(Object.values(idOf));
      const gone = players.filter((p) => !keep.has(p.id));
      if (gone.length && anyStarted) {
        const blocked = gone.filter((p) => rounds.some((r) => started.has(r.id) && (r.games ?? []).some((g) => g.sides.some((s) => s.playerIds.includes(p.id)))));
        if (blocked.length) throw new WizardError(`${blocked.map((p) => p.name).join(" and ")} ${blocked.length === 1 ? "is" : "are"} in a round that's under way, so ${blocked.length === 1 ? "stays" : "stay"} on the list.`);
      }
      const added = w.players.filter((p) => !players.some((x) => x.id === idOf[p.key]));
      if (added.length && w.win === "knockout" && anyStarted) throw new WizardError("The knockout has started, so nobody new can join it.");
      const teamsChanged = kind !== "about" && players.some((p) => keep.has(p.id) && (p.team_id ?? null) !== (teamOf[p.id] ?? null));
      if (kind === "teams") await updateT({ teams });
      for (const [k, p] of w.players.entries()) {
        const id = idOf[p.key];
        const row = { name: p.name, handicap: p.index, sort: k, team_id: teamOf[id], nickname: p.nickname ?? null, bio: p.line ?? null };
        const { error } = players.some((x) => x.id === id) ? await db.from("players").update(row).eq("id", id).eq("tournament_id", t.id) : await db.from("players").insert({ ...row, id, tournament_id: t.id });
        if (error) throw new Error(error.message);
      }
      for (const p of gone) await db.from("players").delete().eq("id", p.id).eq("tournament_id", t.id);
      await updateT({ organiser_player_id: w.organiserPlays && w.players[0] ? idOf[w.players[0].key] : null });
      if (!legacy && (added.length || gone.length || teamsChanged)) await redrawUnstarted("their groups and matches");
      break;
    }

    case "win": {
      // How it's won: the rounds follow. A round that's been played keeps its format.
      const was = t.win?.kind;
      if (w.win === "knockout" && t.win?.kind === "knockout" && anyStarted) {
        const k = t.win.knockout;
        if (w.ko && (w.ko.pairs !== k.pairs || w.ko.draw !== k.draw)) throw new WizardError("The knockout has started, so its draw stays as it is. What happens when a match is level can still change.");
        await updateT({ win: { kind: "knockout", knockout: { ...k, tie: w.ko?.tie ?? k.tie } } });
        break;
      }
      const changed = w.rounds.map((a, k) => !!rounds[k] && formatOf(rounds[k]) !== a.format);
      if (rounds.some((r, k) => started.has(r.id) && changed[k])) throw new WizardError("A round that's been played can't change format. Its points and handicaps can.");
      if (w.win === "knockout") {
        await rebuildKnockout();
        break;
      }
      await updateT({ win: winRule(w), standings: standingsOf(w.win) });
      for (const [k, r] of rounds.entries()) {
        const f = w.rounds[k]?.format ?? formatOf(r);
        const keepGames = started.has(r.id) || (!changed[k] && !!r.games?.length && was !== "knockout");
        const gs = keepGames ? null : draw(k, changed[k]);
        await updateR(r.id, { ...formatPatch(r, f, k), ...(gs ? { games: gs, scorer_id: gs[0]?.scorerId ?? null } : {}) });
      }
      break;
    }

    case "points": {
      if (t.win) await updateT({ win: winRule(w) });
      for (const [k, r] of rounds.entries()) {
        const p = pointsRule(w.rounds[k]?.format ?? formatOf(r), w.rounds[k]?.points, w.win, w.players.length);
        await updateR(r.id, { points_rule: p, nine_points: p.front, full_points: Math.floor(p.full) });
      }
      break;
    }

    case "groups": {
      if (w.win === "knockout") await rebuildKnockout();
      else await redrawUnstarted("the groups they started with");
      break;
    }

    case "round": {
      const r = rounds[i];
      const a = w.rounds[i];
      if (!r || !a) throw new WizardError("That round isn't there any more.");
      const isStarted = started.has(r.id);
      const patch: Record<string, unknown> = { play_date: a.date || null, tee_time: a.time || null };
      // The course
      const sameCourse =
        (a.courseRef ?? null) === courseRefOf(r.course_slug) &&
        a.courseName.trim() === r.course_name &&
        (!a.manualCard || JSON.stringify(a.manualCard) === JSON.stringify((r.all_holes ?? []).map((h) => ({ par: h.par, si: h.si }))));
      if (!sameCourse) {
        if (isStarted) throw new WizardError("This round has scores, so its course stays as it is.");
        const c = await roundCourse(a, new Map());
        research.push({ ref: libraryRef(c.course_slug), name: c.course_name, location: c.course_location, holes: c.holes });
        replaced.push(libraryRef(r.course_slug));
        Object.assign(patch, { course_slug: c.course_slug, course_name: c.course_name, course_location: c.course_location, course_blurb: c.course_blurb, course_guide: c.course_guide, lat: c.lat, lon: c.lon, tee: c.tee, tees: c.tees.length ? c.tees : null, holes: c.holes, photo_path: null });
        r.tees = c.tees;
        r.tee = c.tee;
        r.all_holes = c.holes;
      }
      // The tees: the round's own, and anyone on different ones
      const tees: CourseTee[] = r.tees ?? [];
      const tee = tees.find((x) => x.name === a.tee);
      if (tee && a.tee !== r.tee) {
        patch.tee = tee.name;
        patch.holes = tee.par.map((par, k) => ({ number: k + 1, par, si: tee.si[k], yards: tee.yards[k] || undefined }));
        r.tee = tee.name;
      }
      const pt = Object.fromEntries(Object.entries(a.playerTees ?? {}).filter(([k, v]) => idOf[k] && v !== r.tee && tees.some((x) => x.name === v)).map(([k, v]) => [idOf[k], v]));
      patch.player_tees = Object.keys(pt).length ? pt : null;
      // The holes
      const holeSet = (r.all_holes?.length ?? 18) === 9 ? "all" : a.holeSet;
      if (holeSet !== (r.hole_set ?? "all")) {
        if (isStarted) throw new WizardError("This round has scores, so its holes stay as they are.");
        patch.hole_set = holeSet;
      }
      // The format
      if (a.format !== formatOf(r)) {
        if (isStarted) throw new WizardError("This round has scores, so its format stays as it is.");
        if (legacy) throw new WizardError("Change this one in Rounds and courses, on the organiser page.");
        if (w.win === "knockout") throw new WizardError("Every round of a knockout is the same format.");
        Object.assign(patch, formatPatch(r, a.format, i));
        const shape = (f: DayFormat) => (f === "scramble" ? "team" : isMatch(f) ? (isPairs(f) ? "pairs" : "singles") : "field");
        if (shape(a.format) !== shape(formatOf(r)) || !r.games?.length) {
          const gs = draw(i, true);
          Object.assign(patch, { games: gs, scorer_id: gs[0]?.scorerId ?? null });
        }
      } else {
        // Handicaps: official, flat or set by hand. An official allowance only follows a change of tee (so an older
        // round's own percentage is left alone); flat and shots by hand are written as asked
        const want = roundHandicap(a.format, w.win, ratingOf(r), w.allowance, a, idOf);
        const shotsOf = (h: unknown) => JSON.stringify(Object.entries((h as { shots?: Record<string, number> })?.shots ?? {}).filter(([, v]) => v > 0).sort());
        const cur = r.handicap_rule;
        if (legacy) {
          // Older tournaments keep their handicaps (changed on the organiser page's Rounds and courses)
          if (patch.tee && cur?.mode === "allowance") patch.handicap_rule = { ...cur, course: ratingOf(r) };
        } else if (want.mode === "manual" || cur?.mode === "manual") {
          if (want.mode !== cur?.mode || shotsOf(want) !== shotsOf(cur)) patch.handicap_rule = want;
        } else if (patch.tee && cur?.mode === "allowance") patch.handicap_rule = { ...cur, course: ratingOf(r) };
      }
      // Tee times follow the first one
      if (!isStarted && !patch.games && (a.time || null) !== (r.tee_time || null) && r.games?.length) patch.games = withTeeTimes(r.games, a.time, gap);
      await updateR(r.id, patch);
      await datesFromRounds();
      break;
    }

    case "addround": {
      if (w.win === "knockout") throw new WizardError("A knockout has one round for each stage.");
      const k = rounds.length;
      if (!w.rounds[k]) throw new WizardError("Choose the course for the new round.");
      await newRound(k, draw(k));
      await datesFromRounds();
      break;
    }

    case "removeround": {
      const r = rounds[i];
      if (!r) break;
      if (w.win === "knockout") throw new WizardError("A knockout has one round for each stage.");
      if (started.has(r.id)) throw new WizardError("This round has scores, so it stays.");
      if (rounds.length < 2) throw new WizardError("A tournament needs at least one round.");
      const { error } = await db.from("rounds").delete().eq("id", r.id);
      if (error) throw new Error(error.message);
      for (const later of rounds.slice(i + 1)) await updateR(later.id, { number: later.number - 1 });
      await datesFromRounds();
      break;
    }

    case "prizes":
      await updateT({ prizes: w.prizes });
      break;

    case "extras":
      await updateT({ feed_on: w.extras.feed, ai_on: w.extras.ai, auto_bulletins: w.extras.ai, video_enabled: w.extras.video, tone: w.tone, units: w.units, share_shape: w.share });
      break;

    case "watch": {
      // Private (or back to Friends and family): the files move to the locked store (or out of it) first
      const toPrivate = w.privacy === "private";
      if (toPrivate !== (t.privacy === "private")) {
        await updateT({ privacy: w.privacy, players_need_email: !!w.playersNeedEmail });
        await moveFiles(t.slug, toPrivate);
        notes.push(toPrivate ? "It's private now: only the players and the people they let in can see it." : "Anyone with the link can watch it now.");
      } else await updateT({ players_need_email: toPrivate && !!w.playersNeedEmail });
      break;
    }

    case "look": {
      // Their own colours stay until another look is picked
      const asked = (raw as { theme?: string } | null)?.theme;
      await updateT({ theme: asked === "custom" && t.theme === "custom" ? "custom" : w.theme });
      break;
    }

    default:
      throw new WizardError("Unknown change");
  }
  for (const ref of replaced) await dropResearch(ref);
  for (const c of research) if (await startResearch(await inputFor(c.ref, c.name, c.location, c.holes)) && origin) after(() => kickResearch(origin, c.ref));
  return notes.length ? { note: notes.join(" ") } : {};
}
