import { after } from "next/server";
import { adminClient } from "@/lib/admin";
import { bad, context, json, siteOrigin, DEMO_READONLY } from "@/lib/server-data";
import { sweep } from "@/lib/broadcast";
import { ballsOfGame, cardHole, type BallHole } from "@/lib/engine";
import { toRoundCfg, type PlayerRow, type RoundRow } from "@/lib/types";
import { maybeBulletin } from "@/lib/ai";
import { syncKnockout } from "@/lib/knockout-server";

export const maxDuration = 60;

/** The scorer saves one hole for one game. Re-sending a hole overwrites it. `final: false` = still being entered (no bulletin yet). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return bad("Bad request");
  const { t, session, demo } = await context(req, body);
  if (!t) return bad("Tournament not found", 404);
  if (demo) return bad(DEMO_READONLY, 403);
  if (!session) return bad("Log in to score", 401);

  const roundId = String(body.roundId ?? "");
  const gameId = String(body.game ?? "main");
  const hole = Number(body.hole);
  // A knockout match level after 18 can go on to extra holes (the 19th is played as the 1st)
  const maxHole = (t as { win?: { kind?: string } | null }).win?.kind === "knockout" ? 27 : 18;
  if (!roundId || !(hole >= 1 && hole <= maxHole)) return bad("Bad hole");
  // The organiser correcting another match's score (from Admin, Scorecards): always logged
  const correcting = body.correct === true && session.role === "organiser";

  const db = adminClient();
  const [{ data: round }, { data: players }] = await Promise.all([
    db.from("rounds").select("*").eq("id", roundId).eq("tournament_id", t.id).single(),
    db.from("public_players").select("*").eq("tournament_id", t.id),
  ]);
  if (!round) return bad("Round not found", 404);
  const cfg = toRoundCfg(round as RoundRow, (players ?? []) as PlayerRow[]);
  const game = cfg.games.find((g) => g.id === gameId);
  if (!game) return bad("Match not found in this round", 404);

  // Only the match's scorer enters scores (the organiser too when nobody's been chosen); the organiser corrects any match from Admin
  const isScorer = (!!session.playerId && session.playerId === game.scorerId) || (session.role === "organiser" && !game.scorerId) || correcting;
  if (!isScorer)
    return bad(
      session.role === "organiser" ? "Only this match's scorer enters its scores. To correct one, use Admin, Scorecards, Correct a score." : "Only this match's scorer can enter scores",
      403,
    );

  // Extra holes are played as the card again from the 1st (cardHole)
  const h = hole > 18 ? cardHole(cfg.holes, hole) : cfg.holes.find((x) => x.number === hole);
  if (!h) return bad("Hole not on card");

  const balls = ballsOfGame(game, cfg.play);
  const scores: Record<string, BallHole> = {};
  for (const [ball, v] of Object.entries((body.scores ?? {}) as Record<string, BallHole>)) {
    if (!balls.includes(ball)) return bad(`${ball} isn't in this match`);
    const pickedUp = !!v?.pickedUp;
    if (pickedUp && cfg.scoring === "stroke" && cfg.play !== "fourball") return bad("You can't pick up in stroke play. Enter the score.");
    const gross = pickedUp || v?.gross == null ? null : Math.round(Number(v.gross));
    if (gross != null && !(gross >= 1 && gross <= 15)) return bad("That score looks wrong (1–15 allowed)");
    scores[ball] = { gross, pickedUp, gir: !!v?.gir };
  }
  const pick = (w: unknown) => (typeof w === "string" && balls.includes(w) ? w : null);
  const ctp = h.par === 3 ? pick(body.ctpWinner) : null;
  const ld = h.par === 5 ? pick(body.ldWinner) : null;
  // Match play: one side concedes the hole
  const conceded =
    cfg.scoring === "match" && game.sides.length === 2 && typeof body.conceded === "string" && game.sides.some((sd) => sd.id === body.conceded) ? (body.conceded as string) : null;

  // A submitted card is taken back by any change (signatures cleared); a final one only the organiser can change, and it's logged
  const cardKey = { round_id: roundId, game: gameId };
  const { data: card, error: cardErr } = await db.from("cards").select("status").match(cardKey).maybeSingle();
  const final = card?.status === "final" || (!card && !cardErr && round.status === "complete");
  if (final && session.role !== "organiser") return bad("This card is final. Only the organiser can change it now.", 409);
  const { data: before } = await db.from("hole_entries").select("scores,ctp_winner,ld_winner,conceded").match({ ...cardKey, hole }).maybeSingle();

  const row = {
    round_id: roundId,
    game: gameId,
    hole,
    scores,
    ctp_winner: ctp,
    ld_winner: ld,
    conceded,
    updated_by: session.name,
    updated_at: new Date().toISOString(),
  };
  let { error } = await db.from("hole_entries").upsert(row, { onConflict: "round_id,game,hole" });
  // Database not updated yet (schema.sql not re-run): save the scores without the concession
  if (error && /conceded/.test(error.message)) {
    const { conceded: _c, ...rest } = row;
    void _c;
    ({ error } = await db.from("hole_entries").upsert(rest, { onConflict: "round_id,game,hole" }));
  }
  if (error) return bad(error.message, 500);

  const after_ = { scores, ctp_winner: ctp, ld_winner: ld, conceded };
  const changed = JSON.stringify(before ?? null) !== JSON.stringify(after_);
  if (correcting && changed && !final) {
    await db.from("score_changes").insert({ tournament_id: t.id, ...cardKey, hole, action: "score corrected by the organiser", before: before ?? null, after: after_, by_name: session.name });
  }
  if (final && changed) {
    await db.from("score_changes").insert({ tournament_id: t.id, ...cardKey, hole, action: "score changed on a final card", before: before ?? null, after: after_, by_name: session.name });
    if (card) await db.from("cards").update({ amended: true }).match(cardKey);
    else await db.from("cards").upsert({ ...cardKey, status: "final", final_at: new Date().toISOString(), finalised_by: "Closed round", amended: true }, { onConflict: "round_id,game" });
  } else if (card?.status === "submitted" && changed) {
    await db.from("card_signatures").delete().match(cardKey);
    await db.from("cards").delete().match(cardKey);
  }

  if (round.status === "upcoming") await db.from("rounds").update({ status: "live" }).eq("id", roundId);

  // Scores are saved as they're tapped in; news of the hole waits until the scorer has finished with it
  if (body.final === false) return json({ ok: true });
  const origin = siteOrigin(req);
  after(async () => {
    // A knockout match decided: its winner goes through to the next round
    try {
      await syncKnockout(t.id);
    } catch (e) {
      console.error("[knockout] sync", e);
    }
    try {
      await maybeBulletin(t.id, roundId, gameId, hole);
    } catch (e) {
      console.error("bulletin failed", e);
    }
    // Clips of this hole can now get their broadcast version (the score is known)
    try {
      await sweep(t.id, origin, true);
    } catch (e) {
      console.error("[broadcast] sweep after score", e);
    }
  });

  return json({ ok: true });
}
