import { adminClient } from "@/lib/admin";
import { hashPin, isOrganiser } from "@/lib/auth";
import { bad, context, json, loadServerState, slugify } from "@/lib/server-data";
import { draftGuide, generatePiece, type PieceKind } from "@/lib/ai";
import { cleanGuide } from "@/lib/types";
import { getCourse } from "@/lib/courses";
import type { Game, HandicapRule, PointsRule } from "@/lib/engine";

export const maxDuration = 60;

const TOURNAMENT_FIELDS = [
  "name", "subtitle", "start_date", "end_date", "theme", "custom_colors", "logo_path", "hero_path", "tone",
  "side_games", "side_games_by", "teams", "auto_bulletins", "video_enabled", "organiser_player_id", "published",
];
const PLAYER_FIELDS = [
  "name", "nickname", "handicap", "home_club", "bio", "best_club", "worst_club", "weakness", "quote", "photo_path", "team_id", "sort",
];
const PLAY = ["singles", "fourball", "foursomes", "greensomes", "scramble"];
const SCORING = ["stableford", "stroke", "match", "skins"];

function courseRef(slug: string) {
  return slug.includes(":") ? slug : `local:${slug}`;
}

function cleanGames(games: unknown, playerIds: Set<string>, teamIds: Set<string>): Game[] | string {
  if (!Array.isArray(games) || !games.length) return "Add at least one match or group";
  const seenSide = new Set<string>();
  const out: Game[] = [];
  for (const [gi, g] of (games as Game[]).entries()) {
    const gid = slugify(String(g.id || `g${gi + 1}`)) || `g${gi + 1}`;
    if (!Array.isArray(g.sides) || g.sides.length < 2) return `Match ${gi + 1} needs at least two sides`;
    const sides = [];
    for (const [si, s] of g.sides.entries()) {
      const pids = (s.playerIds ?? []).filter((p) => playerIds.has(p));
      if (!pids.length) return `Match ${gi + 1}, side ${si + 1} has no players`;
      const sid = s.id && !playerIds.has(s.id) ? slugify(s.id) : pids.length === 1 ? pids[0] : `${gid}-s${si + 1}`;
      if (seenSide.has(`${gid}/${sid}`)) return `Duplicate side in match ${gi + 1}`;
      seenSide.add(`${gid}/${sid}`);
      sides.push({
        id: sid,
        name: s.name ? String(s.name).slice(0, 60) : undefined,
        playerIds: pids,
        teamId: s.teamId && teamIds.has(s.teamId) ? s.teamId : null,
      });
    }
    out.push({
      id: gid,
      name: g.name ? String(g.name).slice(0, 60) : undefined,
      sides,
      scorerId: g.scorerId && playerIds.has(g.scorerId) ? g.scorerId : null,
    });
  }
  if (new Set(out.map((g) => g.id)).size !== out.length) return "Two matches have the same id";
  return out;
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const { t, session } = await context(req, b);
  if (!t) return bad("Tournament not found", 404);
  if (!isOrganiser(session)) return bad("Organiser only", 403);
  const db = adminClient();

  switch (b.action) {
    case "state": {
      const state = await loadServerState(t.id);
      const { data: pins } = await db.from("players").select("id,pin_hash").eq("tournament_id", t.id);
      return json({
        state,
        pinSet: Object.fromEntries((pins ?? []).map((p) => [p.id, !!p.pin_hash])),
        organiserPinSet: !!t.organiser_pin_hash,
        contributorPinSet: !!t.contributor_pin_hash || !!process.env.CONTRIBUTOR_PIN,
        env: { ai: !!process.env.ANTHROPIC_API_KEY, courses: !!process.env.GOLFCOURSEAPI_KEY },
      });
    }

    case "updateTournament": {
      const patch: Record<string, unknown> = {};
      for (const k of TOURNAMENT_FIELDS) if (k in (b.patch ?? {})) patch[k] = b.patch[k] === "" ? null : b.patch[k];
      if (b.organiserPin) {
        if (!/^\d{4,8}$/.test(String(b.organiserPin))) return bad("Organiser PIN must be 4–8 digits");
        patch.organiser_pin_hash = hashPin(String(b.organiserPin));
      }
      if (b.contributorPin) {
        if (!/^\d{4,8}$/.test(String(b.contributorPin))) return bad("Caddie PIN must be 4–8 digits");
        patch.contributor_pin_hash = hashPin(String(b.contributorPin));
      }
      if (Array.isArray(patch.teams)) {
        patch.teams = (patch.teams as { id?: string; name: string; color?: string }[]).map((tm, i) => ({
          id: tm.id || slugify(tm.name) || `team${i + 1}`,
          name: String(tm.name).slice(0, 40),
          color: tm.color,
        }));
      }
      const { error } = await db.from("tournaments").update(patch).eq("id", t.id);
      if (error) return bad(error.message, 500);
      return json({ ok: true });
    }

    case "savePlayer": {
      const p = b.player ?? {};
      const patch: Record<string, unknown> = {};
      for (const k of PLAYER_FIELDS) if (k in p) patch[k] = p[k] === "" ? null : p[k];
      if ("handicap" in patch && patch.handicap != null) patch.handicap = Number(patch.handicap);
      if (b.pin) {
        if (!/^\d{4,8}$/.test(String(b.pin).trim())) return bad("PIN must be 4–8 digits");
        patch.pin_hash = hashPin(String(b.pin));
      }
      if (p.id) {
        const { error } = await db.from("players").update(patch).eq("id", p.id).eq("tournament_id", t.id);
        if (error) return bad(error.message, 500);
        return json({ ok: true, id: p.id });
      }
      if (!patch.name) return bad("Player needs a name");
      const id = `${slugify(String(patch.name)) || "player"}-${Math.random().toString(36).slice(2, 6)}`;
      const { error } = await db.from("players").insert({ ...patch, id, tournament_id: t.id });
      if (error) return bad(error.message, 500);
      return json({ ok: true, id });
    }

    case "deletePlayer": {
      const { error } = await db.from("players").delete().eq("id", b.playerId).eq("tournament_id", t.id);
      if (error) return bad("Can't delete a player who has scores or signed cards. Remove them from matches instead.", 400);
      return json({ ok: true });
    }

    case "saveRound": {
      const r = b.round ?? {};
      const patch: Record<string, unknown> = {};
      for (const k of ["play_date", "tee_time", "status", "course_blurb"]) if (k in r) patch[k] = r[k] === "" ? null : r[k];
      if ("course_guide" in r) patch.course_guide = cleanGuide(r.course_guide);
      if ("play" in r) {
        if (!PLAY.includes(r.play)) return bad("Unknown play type");
        patch.play = r.play;
      }
      if ("format" in r) {
        if (!SCORING.includes(r.format)) return bad("Unknown scoring type");
        patch.format = r.format;
      }
      if ("points_rule" in r) {
        const pr = r.points_rule as PointsRule;
        patch.points_rule = {
          front: Number(pr.front) || 0,
          back: Number(pr.back) || 0,
          full: Number(pr.full) || 0,
          positions: Array.isArray(pr.positions) ? pr.positions.map(Number).filter((n) => n >= 0) : undefined,
          skin: pr.skin != null ? Number(pr.skin) : undefined,
        };
        // keep legacy columns in step for older views
        patch.nine_points = Number(pr.front) || 0;
        patch.full_points = Number(pr.full) || 0;
      }
      if ("handicap_rule" in r) {
        const hr = r.handicap_rule as HandicapRule;
        patch.handicap_rule =
          hr.mode === "allowance"
            ? { mode: "allowance", pct: Math.max(0, Math.min(150, Number(hr.pct) || 0)), relative: !!hr.relative }
            : {
                mode: "manual",
                shots: Object.fromEntries(Object.entries(hr.shots ?? {}).map(([k, v]) => [k, Math.max(0, Math.round(Number(v) || 0))])),
              };
      }
      if ("games" in r) {
        const { data: ps } = await db.from("players").select("id").eq("tournament_id", t.id);
        const g = cleanGames(r.games, new Set((ps ?? []).map((x) => x.id)), new Set((t.teams ?? []).map((x) => x.id)));
        if (typeof g === "string") return bad(g);
        patch.games = g;
        patch.scorer_id = g[0]?.scorerId ?? null;
      }
      if ("holes" in r && Array.isArray(r.holes)) {
        const holes = r.holes.map((h: { number: number; par: number; si: number; yards?: number }, i: number) => ({
          number: i + 1,
          par: Number(h.par),
          si: Number(h.si),
          yards: h.yards ? Number(h.yards) : undefined,
        }));
        if (holes.length !== 18) return bad("A card needs 18 holes");
        if (holes.some((h: { par: number }) => h.par < 3 || h.par > 6)) return bad("Each par must be 3 to 6");
        const ok = [...holes.map((h: { si: number }) => h.si)].sort((a, b) => a - b).every((v, i) => v === i + 1);
        if (!ok) return bad("Stroke indexes must be 1 to 18, each used once");
        patch.holes = holes;
      }

      // Course or tee chosen: pull the card
      let existing: { course_slug: string } | null = null;
      if (r.id) {
        const { data } = await db.from("rounds").select("course_slug").eq("id", r.id).eq("tournament_id", t.id).single();
        existing = data;
        if (!existing) return bad("Round not found", 404);
      }
      const existingRef = existing && !existing.course_slug.startsWith("manual:") ? courseRef(existing.course_slug) : null;
      const useRef = r.courseRef || (r.tee ? existingRef : null);
      if (useRef && !("holes" in r)) {
        const c = await getCourse(useRef);
        if (!c) return bad("Couldn't load that course's scorecard");
        const tee = c.tees.find((x) => x.name === r.tee) ?? c.tees[0];
        if (!tee) return bad("That course has no 18-hole tees listed. Enter the card by hand.");
        patch.course_slug = c.ref;
        patch.course_name = c.name;
        patch.course_location = c.location || null;
        patch.lat = c.lat;
        patch.lon = c.lon;
        if (c.blurb && !("course_blurb" in r)) patch.course_blurb = c.blurb;
        // A different course: its own guide (or none, to be filled in)
        if (!("course_guide" in r) && c.ref !== existing?.course_slug) patch.course_guide = c.guide ?? null;
        patch.tee = tee.name;
        patch.holes = tee.par.map((par, i) => ({ number: i + 1, par, si: tee.si[i], yards: tee.yards[i] || undefined }));
      } else if (r.tee && existing && !existingRef) {
        patch.tee = r.tee;
      } else if (r.manualCourse) {
        patch.course_slug = `manual:${slugify(r.manualCourse.name) || "course"}`;
        patch.course_name = String(r.manualCourse.name).slice(0, 80);
        patch.course_location = r.manualCourse.location || null;
        patch.tee = r.tee || null;
      }

      if (r.id) {
        const { error } = await db.from("rounds").update(patch).eq("id", r.id).eq("tournament_id", t.id);
        if (error) return bad(error.message, 500);
        return json({ ok: true, id: r.id });
      }
      if (!patch.course_name || !patch.holes) return bad("Choose a course (or enter the card) for the new round");
      const { data: last } = await db
        .from("rounds")
        .select("number")
        .eq("tournament_id", t.id)
        .order("number", { ascending: false })
        .limit(1)
        .maybeSingle();
      const insert: Record<string, unknown> = {
        tournament_id: t.id,
        number: (last?.number ?? 0) + 1,
        play: "singles",
        format: "stableford",
        points_rule: { front: 10, back: 10, full: 20 },
        handicap_rule: { mode: "manual", shots: {} },
        ...patch,
      };
      if (!insert.games) {
        // Default: everyone in one game as singles (head-to-head for two players)
        const { data: ps } = await db.from("players").select("id,team_id").eq("tournament_id", t.id).order("sort");
        insert.games = [
          { id: "main", sides: (ps ?? []).map((p) => ({ id: p.id, playerIds: [p.id], teamId: p.team_id })), scorerId: t.organiser_player_id ?? null },
        ];
      }
      const { data, error } = await db.from("rounds").insert(insert).select("id").single();
      if (error) return bad(error.message, 500);
      return json({ ok: true, id: data.id });
    }

    case "draftGuide": {
      const { data: round } = await db.from("rounds").select("*").eq("id", b.roundId).eq("tournament_id", t.id).maybeSingle();
      if (!round) return bad("Round not found", 404);
      if (!process.env.ANTHROPIC_API_KEY) return bad("ANTHROPIC_API_KEY isn't set", 500);
      try {
        return json(await draftGuide(round));
      } catch (e) {
        return bad(e instanceof Error ? e.message : "Couldn't draft the guide", 500);
      }
    }

    case "deleteRound": {
      const { count } = await db.from("hole_entries").select("id", { count: "exact", head: true }).eq("round_id", b.roundId);
      if ((count ?? 0) > 0 && !b.force) return bad("This round has scores. Delete anyway?", 409);
      const { error } = await db.from("rounds").delete().eq("id", b.roundId).eq("tournament_id", t.id);
      if (error) return bad(error.message, 500);
      // Renumber remaining rounds 1..n
      const { data: rs } = await db.from("rounds").select("id,number").eq("tournament_id", t.id).order("number");
      for (const [i, r] of (rs ?? []).entries()) if (r.number !== i + 1) await db.from("rounds").update({ number: -(i + 1) }).eq("id", r.id);
      for (const [i, r] of (rs ?? []).entries()) if (r.number !== i + 1) await db.from("rounds").update({ number: i + 1 }).eq("id", r.id);
      return json({ ok: true });
    }

    case "hide": {
      const table = ["posts", "comments"].includes(b.table) ? b.table : null;
      if (!table) return bad("Bad table");
      const { error } = await db.from(table).update({ hidden: !!b.hidden }).eq("id", b.id).eq("tournament_id", t.id);
      if (error) return bad(error.message, 500);
      return json({ ok: true });
    }

    case "deleteHole": {
      const { data: round } = await db.from("rounds").select("id").eq("id", b.roundId).eq("tournament_id", t.id).maybeSingle();
      if (!round) return bad("Round not found", 404);
      const { error } = await db
        .from("hole_entries")
        .delete()
        .eq("round_id", b.roundId)
        .eq("game", b.game ?? "main")
        .eq("hole", b.hole);
      if (error) return bad(error.message, 500);
      return json({ ok: true });
    }

    case "aiGenerate": {
      if (!process.env.ANTHROPIC_API_KEY) return bad("ANTHROPIC_API_KEY isn't set in Vercel", 500);
      const kind = b.kind as PieceKind;
      if (!["preview", "bulletin", "report", "tournament"].includes(kind)) return bad("Bad kind");
      try {
        const piece = await generatePiece(t.id, kind, b.roundId ?? null, {
          extra: b.extra ? String(b.extra).slice(0, 500) : undefined,
          trigger: kind === "bulletin" ? `manual-${Date.now()}` : "manual",
          reason: kind === "bulletin" ? "the organiser asked for an update on the state of play" : undefined,
        });
        return json({ piece });
      } catch (e) {
        return bad(e instanceof Error ? e.message : "AI failed", 500);
      }
    }

    case "aiUpdate": {
      const patch: Record<string, unknown> = {};
      if (typeof b.title === "string") patch.title = b.title;
      if (typeof b.body === "string") patch.body = b.body;
      if (["draft", "published", "hidden"].includes(b.status)) {
        patch.status = b.status;
        if (b.status === "published") patch.published_at = new Date().toISOString();
      }
      const { error } = await db.from("ai_pieces").update(patch).eq("id", b.id).eq("tournament_id", t.id);
      if (error) return bad(error.message, 500);
      return json({ ok: true });
    }

    default:
      return bad("Unknown action");
  }
}
