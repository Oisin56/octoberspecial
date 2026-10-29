import { after } from "next/server";
import { adminClient } from "@/lib/admin";
import { bad, context, json, siteOrigin, DEMO_READONLY } from "@/lib/server-data";
import { sweep } from "@/lib/broadcast";
import { ballsOfGame, cardHole, type BallHole } from "@/lib/engine";
import { toRoundCfg, type PlayerRow, type RoundRow } from "@/lib/types";
import { maybeBulletin } from "@/lib/ai";
import { syncKnockout } from "@/lib/knockout-server";
import { FINISHED_PLAYER, finishedAsk, maybeFinishSolo } from "@/lib/finish";
import { mayScore, oneScorer } from "@/lib/scoring-access";

export const maxDuration = 120;

/**
 * Save one hole for one game. Anyone in the group can (or only its scorer, with One scorer per group). Only the
 * scores sent are changed: they're laid over what's there, so two phones never wipe each other's. Closest to the
 * pin, long drive and a concession change only when they're sent. `final: false` = still being entered.
 */
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

  // Anyone in the group (or the organiser); with One scorer per group, only its scorer. The organiser corrects any match from Admin
  const allowed = correcting || mayScore(t, round as RoundRow, game, session);
  if (!allowed) {
    if (oneScorer(t, round as RoundRow))
      return bad(session.role === "organiser" ? "Only this group's scorer enters its scores. To correct one, use Organiser, Scorecards, Correct a score." : "Only this group's scorer can enter scores", 403);
    return bad("Only players in this group can enter its scores", 403);
  }

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
    scores[ball] = { gross, pickedUp, gir: !!v?.gir, by: session.name };
  }
  const pick = (w: unknown) => (typeof w === "string" && balls.includes(w) ? w : null);
  const ctp = h.par === 3 ? pick(body.ctpWinner) : null;
  const ld = h.par === 5 ? pick(body.ldWinner) : null;
  // Match play: one side concedes the hole
  const conceded =
    cfg.scoring === "match" && game.sides.length === 2 && typeof body.conceded === "string" && game.sides.some((sd) => sd.id === body.conceded) ? (body.conceded as string) : null;
  // Only what this phone sent changes (another phone may have set the rest)
  const sent = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  const fields: Record<string, string | null> = {};
  if (sent("ctpWinner")) fields.ctp_winner = ctp;
  if (sent("ldWinner")) fields.ld_winner = ld;
  if (sent("conceded")) fields.conceded = conceded;

  // Finished: players can't change scores; the organiser can, once they've said yes (and it's logged). On your own,
  // you can always fix your own card.
  const afterFinish = !!t.finished_at && !t.solo;
  if (afterFinish && session.role !== "organiser") return bad(FINISHED_PLAYER, 409);
  if (afterFinish && body.confirmFinished !== true) return finishedAsk();

  // A submitted card is taken back by any change (signatures cleared); a final one only the organiser can change, and it's logged
  const cardKey = { round_id: roundId, game: gameId };
  const { data: card, error: cardErr } = await db.from("cards").select("status").match(cardKey).maybeSingle();
  const final = card?.status === "final" || (!card && !cardErr && round.status === "complete");
  if (final && session.role !== "organiser") return bad("This card is final. Only the organiser can change it now.", 409);
  const { data: before } = await db.from("hole_entries").select("scores,ctp_winner,ld_winner,conceded").match({ ...cardKey, hole }).maybeSingle();

  // Nothing sent: nothing to save (a phone that only looked)
  if (!Object.keys(scores).length && !Object.keys(fields).length && body.final === false) return json({ ok: true });
  if (!Object.keys(scores).length && !Object.keys(fields).length && !before) return json({ ok: true });

  // Laid over what's there, in one step on the database
  let saved: { scores: Record<string, BallHole>; ctp_winner: string | null; ld_winner: string | null; conceded: string | null } | null = null;
  const rpc = await db.rpc("save_hole_scores", { p_round: roundId, p_game: gameId, p_hole: hole, p_scores: scores, p_fields: fields, p_by: session.name });
  if (!rpc.error) saved = rpc.data as typeof saved;
  else {
    // Database not updated yet (schema.sql not re-run): merge here instead
    const merged = { ...((before?.scores as Record<string, BallHole>) ?? {}), ...scores };
    const row: Record<string, unknown> = {
      round_id: roundId,
      game: gameId,
      hole,
      scores: merged,
      ctp_winner: sent("ctpWinner") ? ctp : (before?.ctp_winner ?? null),
      ld_winner: sent("ldWinner") ? ld : (before?.ld_winner ?? null),
      conceded: sent("conceded") ? conceded : (before?.conceded ?? null),
      updated_by: session.name,
      updated_at: new Date().toISOString(),
    };
    let { error } = await db.from("hole_entries").upsert(row, { onConflict: "round_id,game,hole" });
    if (error && /conceded/.test(error.message)) {
      delete row.conceded;
      ({ error } = await db.from("hole_entries").upsert(row, { onConflict: "round_id,game,hole" }));
    }
    if (error) return bad(error.message, 500);
    saved = { scores: merged, ctp_winner: row.ctp_winner as string | null, ld_winner: row.ld_winner as string | null, conceded: (row.conceded as string | null) ?? null };
  }

  // What changed, for the log (who entered a score isn't a change to it)
  const plain = (x: { scores?: Record<string, BallHole> | null } & Record<string, unknown> | null | undefined) =>
    x ? { scores: Object.fromEntries(Object.entries(x.scores ?? {}).map(([k, v]) => [k, { gross: v?.gross ?? null, pickedUp: !!v?.pickedUp, gir: !!v?.gir }])), ctp_winner: x.ctp_winner ?? null, ld_winner: x.ld_winner ?? null, conceded: x.conceded ?? null } : null;
  const after_ = plain(saved);
  const changed = JSON.stringify(plain(before)) !== JSON.stringify(after_);
  if (correcting && changed && !final) {
    await db.from("score_changes").insert({ tournament_id: t.id, ...cardKey, hole, action: "score corrected by the organiser", before: before ?? null, after: after_, by_name: session.name });
  }
  if (afterFinish && changed && !final) {
    await db.from("score_changes").insert({ tournament_id: t.id, ...cardKey, hole, action: "score changed after the finish", before: before ?? null, after: after_, by_name: session.name });
  }
  if (final && changed) {
    await db.from("score_changes").insert({ tournament_id: t.id, ...cardKey, hole, action: afterFinish ? "score changed after the finish" : "score changed on a final card", before: before ?? null, after: after_, by_name: session.name });
    if (card) await db.from("cards").update({ amended: true }).match(cardKey);
    else await db.from("cards").upsert({ ...cardKey, status: "final", final_at: new Date().toISOString(), finalised_by: "Closed round", amended: true }, { onConflict: "round_id,game" });
  } else if (card?.status === "submitted" && changed) {
    await db.from("card_signatures").delete().match(cardKey);
    await db.from("cards").delete().match(cardKey);
  }

  if (round.status === "upcoming" && !t.finished_at) await db.from("rounds").update({ status: "live" }).eq("id", roundId);

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
    // On your own: the last hole of the last round finishes it
    if (t.solo && !t.finished_at) {
      try {
        await maybeFinishSolo(t.id);
      } catch (e) {
        console.error("[finish] solo", e);
      }
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
