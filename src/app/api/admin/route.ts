import { randomBytes } from "node:crypto";
import { adminClient } from "@/lib/admin";
import { hashPin, isOrganiser } from "@/lib/auth";
import { bad, context, json, loadServerState, siteOrigin, slugify } from "@/lib/server-data";
import { EMAIL_RE, emailPiece, mailConfigured } from "@/lib/email";
import { draftGuide, generatePiece, type PieceKind } from "@/lib/ai";
import { cleanGuide, normalizeRound, type RoundRow, type Tone } from "@/lib/types";
import { guideFrom, guideStep, newGuideWork, type GuideWork } from "@/lib/guide";
const TONE_IDS: Tone[] = ["broadsheet", "tabloid", "commentator", "dry"];
import { getCourse, validStrokeIndexes } from "@/lib/courses";
import type { Game, HandicapRule, PointsRule } from "@/lib/engine";

export const maxDuration = 60;

const TOURNAMENT_FIELDS = [
  "name", "subtitle", "start_date", "end_date", "theme", "custom_colors", "logo_path", "hero_path", "tone",
  "side_games", "side_games_by", "teams", "auto_bulletins", "video_enabled", "organiser_player_id", "published",
  "require_attestation", "feed_on", "ai_on", "standings",
];
const PLAYER_FIELDS = [
  "name", "nickname", "handicap", "home_club", "bio", "best_club", "worst_club", "weakness", "quote", "photo_path", "team_id", "sort",
];
const PLAY = ["singles", "fourball", "foursomes", "greensomes", "scramble"];
const SCORING = ["stableford", "stroke", "match", "skins"];

function courseRef(slug: string) {
  return slug.includes(":") ? slug : `local:${slug}`;
}

function cleanGames(games: unknown, playerIds: Set<string>, teamIds: Set<string>, oneSideOk = false): Game[] | string {
  if (!Array.isArray(games) || !games.length) return "Add at least one match or group";
  const seenSide = new Set<string>();
  const out: Game[] = [];
  for (const [gi, g] of (games as Game[]).entries()) {
    const gid = slugify(String(g.id || `g${gi + 1}`)) || `g${gi + 1}`;
    // A player on their own (Stableford or stroke play) is fine; a match needs two sides
    if (!Array.isArray(g.sides) || g.sides.length < (oneSideOk ? 1 : 2)) return `Match ${gi + 1} needs at least two sides`;
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
      const fans = await db.from("fans").select("id,name,blocked,created_at").eq("tournament_id", t.id).order("created_at");
      return json({
        state,
        fans: fans.error ? [] : (fans.data ?? []),
        pinSet: Object.fromEntries((pins ?? []).map((p) => [p.id, !!p.pin_hash])),
        organiserPinSet: !!t.organiser_pin_hash,
        env: { ai: !!process.env.ANTHROPIC_API_KEY, courses: !!process.env.GOLFCOURSEAPI_KEY || !!process.env.GOLFAPI_KEY, mail: mailConfigured() },
      });
    }

    case "updateTournament": {
      const patch: Record<string, unknown> = {};
      for (const k of TOURNAMENT_FIELDS) if (k in (b.patch ?? {})) patch[k] = b.patch[k] === "" ? null : b.patch[k];
      if (b.organiserPin) {
        if (!/^\d{4,8}$/.test(String(b.organiserPin))) return bad("Organiser PIN must be 4–8 digits");
        patch.organiser_pin_hash = hashPin(String(b.organiserPin));
      }
      if ("standings" in patch && !["points", "stableford", "stroke"].includes(String(patch.standings))) return bad("Unknown way of winning");
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

    // A player's personal sign-in link: made the first time it's asked for; "reset" makes a new one (the old stops working)
    case "playerLink": {
      const pid = String(b.playerId ?? "");
      const { data: p } = await db.from("players").select("id,link_code").eq("tournament_id", t.id).eq("id", pid).maybeSingle();
      if (!p) return bad("Player not found", 404);
      let code = p.link_code as string | null;
      if (!code || b.reset) {
        code = randomBytes(15).toString("base64url");
        const { error } = await db.from("players").update({ link_code: code }).eq("id", p.id).eq("tournament_id", t.id);
        if (error) return bad(/link_code/.test(error.message) ? "Player links need the latest database update (schema.sql)" : error.message, 500);
      }
      return json({ url: `${siteOrigin(req)}/t/${t.slug}/in/${code}` });
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
      if ("photo_path" in r) {
        const pp = r.photo_path;
        if (pp !== null && !(typeof pp === "string" && /^photo\/[a-z0-9-]+\/[0-9a-f-]+\.[a-z0-9]{2,5}$/i.test(pp))) return bad("Bad photo");
        patch.photo_path = pp;
      }
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
          across: pr.across ? true : undefined,
        };
        // keep legacy columns in step for older views
        patch.nine_points = Number(pr.front) || 0;
        patch.full_points = Number(pr.full) || 0;
      }
      if ("handicap_rule" in r) {
        const hr = r.handicap_rule as HandicapRule;
        patch.handicap_rule =
          hr.mode === "allowance"
            ? {
                mode: "allowance",
                pct: Math.max(0, Math.min(150, Number(hr.pct) || 0)),
                relative: !!hr.relative,
                // Course handicaps from the index (set from the tee's slope and rating): kept unless sent
                course: "course" in hr ? cleanCourseRating(hr.course) : await currentCourseRating(db, r.id, t.id),
              }
            : {
                mode: "manual",
                shots: Object.fromEntries(Object.entries(hr.shots ?? {}).map(([k, v]) => [k, Math.max(0, Math.round(Number(v) || 0))])),
              };
      }
      if ("games" in r) {
        const { data: ps } = await db.from("players").select("id").eq("tournament_id", t.id);
        const fmt = r.format ?? (r.id ? (await db.from("rounds").select("format").eq("id", r.id).maybeSingle()).data?.format : null);
        const g = cleanGames(r.games, new Set((ps ?? []).map((x) => x.id)), new Set((t.teams ?? []).map((x) => x.id)), fmt === "stableford" || fmt === "stroke");
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
        if (holes.length !== 18 && holes.length !== 9) return bad("A card needs 18 holes (or 9 for a 9-hole course)");
        if (holes.some((h: { par: number }) => h.par < 3 || h.par > 6)) return bad("Each par must be 3 to 6");
        if (!validStrokeIndexes(holes.map((h: { si: number }) => h.si)))
          return bad(holes.length === 18 ? "Stroke indexes must be 1 to 18, each used once" : "Each hole needs a different stroke index");
        patch.holes = holes;
        if (holes.length === 9) patch.hole_set = "all";
      }
      // Which holes are played: the whole card, or the front or back nine of an 18
      if ("hole_set" in r) {
        if (!["all", "front", "back"].includes(r.hole_set)) return bad("Unknown choice of holes");
        patch.hole_set = r.hole_set;
      }

      // Course or tee chosen: pull the card
      let existing: { course_slug: string } | null = null;
      if (r.id) {
        const { data } = await db.from("rounds").select("course_slug").eq("id", r.id).eq("tournament_id", t.id).single();
        existing = data;
        if (!existing) return bad("Round not found", 404);
      }
      const existingRef = existing && !existing.course_slug.startsWith("manual:") ? courseRef(existing.course_slug) : null;
      let teeRating: { slope: number; rating: number; par: number } | null = null;
      const useRef = r.courseRef || (r.tee ? existingRef : null);
      if (useRef && !("holes" in r)) {
        const c = await getCourse(useRef);
        if (!c) return bad("Couldn't load that course's scorecard");
        const tee = c.tees.find((x) => x.name === r.tee) ?? c.tees[0];
        if (!tee) return bad("That course has no tees listed. Enter the card by hand.");
        patch.course_slug = c.ref;
        patch.course_name = c.name;
        patch.course_location = c.location || null;
        patch.lat = c.lat;
        patch.lon = c.lon;
        if (c.blurb && !("course_blurb" in r)) patch.course_blurb = c.blurb;
        // A different course: its own guide (or none, to be filled in)
        if (!("course_guide" in r) && c.ref !== existing?.course_slug) patch.course_guide = c.guide ?? null;
        patch.tee = tee.name;
        teeRating = tee.slope && tee.rating ? { slope: tee.slope, rating: tee.rating, par: tee.par.reduce((a, b) => a + b, 0) } : null;
        patch.holes = tee.par.map((par, i) => ({ number: i + 1, par, si: tee.si[i], yards: tee.yards[i] || undefined }));
        // Course handicaps in use: follow the new tee's slope and rating
        const rule = (patch.handicap_rule ?? (r.id ? (await db.from("rounds").select("handicap_rule").eq("id", r.id).single()).data?.handicap_rule : null)) as HandicapRule | null;
        if (rule?.mode === "allowance" && rule.course)
          patch.handicap_rule = { ...rule, course: tee.slope && tee.rating ? { slope: tee.slope, rating: tee.rating, par: tee.par.reduce((a, b) => a + b, 0) } : null };
        if (tee.par.length === 9) patch.hole_set = "all";
      } else if (r.tee && existing && !existingRef) {
        patch.tee = r.tee;
      } else if (r.manualCourse) {
        patch.course_slug = `manual:${slugify(r.manualCourse.name) || "course"}`;
        patch.course_name = String(r.manualCourse.name).slice(0, 80);
        patch.course_location = r.manualCourse.location || null;
        patch.tee = r.tee || null;
      }

      // Database not updated yet (schema.sql not re-run): rounds can't play a nine yet, everything else saves
      const noHoleSet = (e: { message: string } | null) => !!e && /hole_set/.test(e.message);
      const nineNeedsSchema = () => bad("To play nine holes, run the latest supabase/schema.sql in Supabase first.", 500);
      if (r.id) {
        let { error } = await db.from("rounds").update(patch).eq("id", r.id).eq("tournament_id", t.id);
        if (noHoleSet(error)) {
          if (patch.hole_set !== "all") return nineNeedsSchema();
          delete patch.hole_set;
          ({ error } = await db.from("rounds").update(patch).eq("id", r.id).eq("tournament_id", t.id));
        }
        if (error) return bad(error.message, 500);
        return json({ ok: true, id: r.id });
      }
      if (!patch.course_name || !patch.holes) return bad("Choose a course (or enter the card) for the new round");
      const { data: last } = await db
        .from("rounds")
        .select("number,format,play,points_rule,handicap_rule")
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
      // Made with the setup wizard (course handicaps from the index): a new round follows the last one's format,
      // allowance and points, with this tee's slope and rating; who plays with whom goes on the to-do list
      const lastRule = last?.handicap_rule as HandicapRule | null;
      if (last && lastRule?.mode === "allowance" && "course" in lastRule && !("handicap_rule" in r)) {
        insert.format = last.format;
        insert.play = last.play;
        if (last.points_rule) insert.points_rule = last.points_rule;
        insert.handicap_rule = { ...lastRule, course: teeRating };
        insert.nine_points = 0;
        insert.full_points = Math.floor(Number((last.points_rule as PointsRule | null)?.full ?? 0));
        if (!insert.games) insert.games = [];
      }
      if (!insert.games) {
        // Default: everyone in one game as singles (head-to-head for two players)
        const { data: ps } = await db.from("players").select("id,team_id").eq("tournament_id", t.id).order("sort");
        insert.games = [
          { id: "main", sides: (ps ?? []).map((p) => ({ id: p.id, playerIds: [p.id], teamId: p.team_id })), scorerId: t.organiser_player_id ?? null },
        ];
      }
      let { data, error } = await db.from("rounds").insert(insert).select("id").single();
      if (noHoleSet(error)) {
        if (insert.hole_set !== "all") return nineNeedsSchema();
        delete insert.hole_set;
        ({ data, error } = await db.from("rounds").insert(insert).select("id").single());
      }
      if (error || !data) return bad(error?.message ?? "Couldn't add the round", 500);
      return json({ ok: true, id: data.id });
    }

    // The course guide, found a step at a time (the same careful search as after the setup wizard)
    case "guideStep": {
      const { data: round } = await db.from("rounds").select("*").eq("id", b.roundId).eq("tournament_id", t.id).maybeSingle();
      if (!round) return bad("Round not found", 404);
      if (!process.env.ANTHROPIC_API_KEY) return bad("ANTHROPIC_API_KEY isn't set", 500);
      const w = (b.work ?? null) as GuideWork | null;
      const work: GuideWork = w && ["search", "read", "done"].includes(w.stage)
        ? {
            stage: w.stage,
            sources: (Array.isArray(w.sources) ? w.sources : []).filter((x) => /^https?:\/\//.test(String(x?.url))).slice(0, 5),
            overview: typeof w.overview === "string" ? w.overview.slice(0, 1500) : undefined,
            signature: typeof w.signature === "string" ? w.signature.slice(0, 800) : undefined,
            holes: Object.fromEntries(Object.entries(w.holes ?? {}).filter(([k, v]) => /^\d{1,2}$/.test(k) && typeof v === "string").map(([k, v]) => [k, String(v).slice(0, 300)])),
            from: (Array.isArray(w.from) ? w.from : []).map(String).slice(0, 8),
          }
        : newGuideWork();
      try {
        const next = await guideStep(normalizeRound(round as RoundRow), work);
        return json({ work: next, guide: next.stage === "done" ? guideFrom(next) : null });
      } catch {
        const done = { ...work, stage: "done" as const, result: "No hole-by-hole info found" };
        return json({ work: done, guide: guideFrom(done) });
      }
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
      // Looked at by the organiser: no longer waiting for review. Put back = the reports are cleared
      await db.from(table).update({ hidden_by_reports: false }).eq("id", b.id);
      if (!b.hidden) await db.from("reports").delete().eq(table === "posts" ? "post_id" : "comment_id", b.id);
      return json({ ok: true });
    }

    case "scoreChanges": {
      const { data, error } = await db.from("score_changes").select("*").eq("tournament_id", t.id).order("at", { ascending: false }).limit(200);
      return json({ changes: error ? [] : (data ?? []) });
    }

    case "blockFan": {
      const { error } = await db.from("fans").update({ blocked: !!b.blocked }).eq("id", b.fanId).eq("tournament_id", t.id);
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
          tone: TONE_IDS.includes(b.tone) ? b.tone : undefined,
          length: ["short", "standard", "long"].includes(b.length) ? b.length : undefined,
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
      // Publishing a preview/report/review with "Email it" ticked: send once
      if (b.status === "published" && b.email && mailConfigured()) {
        const { data: pc } = await db.from("ai_pieces").select("kind,emailed_at").eq("id", b.id).single();
        if (pc && pc.kind !== "bulletin" && !pc.emailed_at) {
          try {
            const r = await emailPiece(t, String(b.id), siteOrigin(req));
            return json({ ok: true, emailed: r.sent, failed: r.failed.length });
          } catch (e) {
            return json({ ok: true, emailError: e instanceof Error ? e.message : "Email failed" });
          }
        }
      }
      return json({ ok: true });
    }

    case "aiRewrite": {
      if (!process.env.ANTHROPIC_API_KEY) return bad("ANTHROPIC_API_KEY isn't set in Vercel", 500);
      const { data: pc } = await db.from("ai_pieces").select("*").eq("id", b.id).eq("tournament_id", t.id).maybeSingle();
      if (!pc) return bad("Not found", 404);
      try {
        const piece = await generatePiece(t.id, pc.kind, pc.round_id, {
          tone: TONE_IDS.includes(b.tone) ? b.tone : undefined,
          rewrite: {
            id: pc.id,
            title: String(b.title ?? pc.title ?? ""),
            body: String(b.body ?? pc.body ?? ""),
            instruction: b.instruction ? String(b.instruction).slice(0, 600) : undefined,
            change: b.change === "shorter" || b.change === "longer" ? b.change : undefined,
          },
          reason: pc.kind === "bulletin" ? "a rewrite of the bulletin below" : undefined,
        });
        return json({ piece });
      } catch (e) {
        return bad(e instanceof Error ? e.message : "AI failed", 500);
      }
    }

    case "aiUndo": {
      const { data: pc } = await db.from("ai_pieces").select("title,body,prev_title,prev_body").eq("id", b.id).eq("tournament_id", t.id).maybeSingle();
      if (!pc?.prev_body) return bad("Nothing to undo");
      await db.from("ai_pieces").update({ title: pc.prev_title, body: pc.prev_body, prev_title: pc.title, prev_body: pc.body }).eq("id", b.id);
      return json({ ok: true });
    }

    case "aiDelete": {
      await db.from("ai_pieces").delete().eq("id", b.id).eq("tournament_id", t.id);
      return json({ ok: true });
    }

    case "emailPiece": {
      if (!mailConfigured()) return bad("Email isn't set up yet: add SMTP_USER and SMTP_PASS in Vercel (see SETUP.md)", 500);
      const { data: pc } = await db.from("ai_pieces").select("status").eq("id", b.id).eq("tournament_id", t.id).maybeSingle();
      if (!pc) return bad("Not found", 404);
      try {
        if (b.test) {
          const r = await emailPiece(t, String(b.id), siteOrigin(req), process.env.SMTP_USER!);
          if (r.failed.length) return bad("The test email didn't send. Check SMTP_USER and SMTP_PASS (an app-specific password).", 500);
          return json({ ok: true, sent: 1, test: true });
        }
        if (pc.status !== "published") return bad("Publish it first");
        const r = await emailPiece(t, String(b.id), siteOrigin(req));
        return json({ ok: true, sent: r.sent, failed: r.failed });
      } catch (e) {
        return bad(e instanceof Error ? e.message : "Email failed", 500);
      }
    }

    case "subscribers": {
      const { data } = await db.from("subscribers").select("id,name,email,added_by,created_at,unsubscribed_at").eq("tournament_id", t.id).order("created_at");
      return json({ subscribers: data ?? [], configured: mailConfigured() });
    }

    case "addSubscribers": {
      // One per line: "email" or "Name <email>" or "Name, email"
      const lines = String(b.text ?? "").split(/\n|;/).map((l) => l.trim()).filter(Boolean).slice(0, 200);
      const rows: { tournament_id: string; name: string | null; email: string; added_by: string }[] = [];
      const bad_: string[] = [];
      for (const l of lines) {
        const m = l.match(/^(.*?)[\s,]*<?([^\s<>,]+@[^\s<>,]+)>?$/);
        const email = m?.[2]?.toLowerCase();
        if (!email || !EMAIL_RE.test(email)) bad_.push(l);
        else rows.push({ tournament_id: t.id, name: m![1].replace(/[",]/g, "").trim() || null, email, added_by: "organiser" });
      }
      let added = 0;
      for (const r of rows) {
        const { data: ex } = await db.from("subscribers").select("id").eq("tournament_id", t.id).ilike("email", r.email).maybeSingle();
        if (ex) await db.from("subscribers").update({ unsubscribed_at: null, ...(r.name ? { name: r.name } : {}) }).eq("id", ex.id);
        else await db.from("subscribers").insert(r);
        added++;
      }
      return json({ ok: true, added, invalid: bad_ });
    }

    case "resetTestData": {
      // Clears play and content; keeps players, PINs, rounds set-up, course guides, photos and the email list
      if (b.confirm !== "RESET") return bad("Type RESET to confirm");
      const { data: rs } = await db.from("rounds").select("id").eq("tournament_id", t.id);
      const ids = (rs ?? []).map((r) => r.id);
      if (ids.length) {
        for (const table of ["hole_entries", "attestations"]) {
          const { error } = await db.from(table).delete().in("round_id", ids);
          if (error) return bad(error.message, 500);
        }
      }
      for (const table of ["votes", "comments", "posts", "ai_pieces", "reels"]) {
        const { error } = await db.from(table).delete().eq("tournament_id", t.id);
        if (error) return bad(error.message, 500);
      }
      await db.from("rounds").update({ status: "upcoming" }).eq("tournament_id", t.id);
      return json({ ok: true });
    }

    case "removeSubscriber": {
      await db.from("subscribers").delete().eq("id", b.id).eq("tournament_id", t.id);
      return json({ ok: true });
    }

    default:
      return bad("Unknown action");
  }
}

/** A tee's slope and rating for course handicaps, or null. */
function cleanCourseRating(c: unknown): { slope: number; rating: number; par: number } | null {
  if (!c || typeof c !== "object") return null;
  const x = c as Record<string, unknown>;
  const slope = Number(x.slope);
  const rating = Number(x.rating);
  const par = Number(x.par);
  if (!(slope >= 55 && slope <= 155) || !(rating >= 25 && rating <= 85) || !(par >= 27 && par <= 80)) return null;
  return { slope: Math.round(slope), rating, par };
}

async function currentCourseRating(db: ReturnType<typeof adminClient>, roundId: unknown, tournamentId: string) {
  if (!roundId) return null;
  const { data } = await db.from("rounds").select("handicap_rule").eq("id", String(roundId)).eq("tournament_id", tournamentId).maybeSingle();
  const rule = data?.handicap_rule as HandicapRule | null;
  return rule?.mode === "allowance" ? cleanCourseRating(rule.course) : null;
}
