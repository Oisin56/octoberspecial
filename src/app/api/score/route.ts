import { after } from "next/server";
import { adminClient } from "@/lib/admin";
import { bad, context, json } from "@/lib/server-data";
import { ballsOfGame, type BallHole } from "@/lib/engine";
import { toRoundCfg, type PlayerRow, type RoundRow } from "@/lib/types";
import { maybeBulletin } from "@/lib/ai";

export const maxDuration = 60;

/** The scorer saves one hole for one game. Re-sending a hole overwrites it. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return bad("Bad request");
  const { t, session } = await context(req, body);
  if (!t) return bad("Tournament not found", 404);
  if (!session) return bad("Log in to score", 401);

  const roundId = String(body.roundId ?? "");
  const gameId = String(body.game ?? "main");
  const hole = Number(body.hole);
  if (!roundId || !(hole >= 1 && hole <= 18)) return bad("Bad hole");

  const db = adminClient();
  const [{ data: round }, { data: players }] = await Promise.all([
    db.from("rounds").select("*").eq("id", roundId).eq("tournament_id", t.id).single(),
    db.from("public_players").select("*").eq("tournament_id", t.id),
  ]);
  if (!round) return bad("Round not found", 404);
  const cfg = toRoundCfg(round as RoundRow, (players ?? []) as PlayerRow[]);
  const game = cfg.games.find((g) => g.id === gameId);
  if (!game) return bad("Match not found in this round", 404);

  const isScorer = session.role === "organiser" || (!!session.playerId && session.playerId === game.scorerId);
  if (!isScorer) return bad("Only this match's scorer can enter scores", 403);

  const h = cfg.holes.find((x) => x.number === hole);
  if (!h) return bad("Hole not on card");

  const balls = ballsOfGame(game, cfg.play);
  const scores: Record<string, BallHole> = {};
  for (const [ball, v] of Object.entries((body.scores ?? {}) as Record<string, BallHole>)) {
    if (!balls.includes(ball)) return bad(`${ball} isn't in this match`);
    const gross = v?.gross == null ? null : Math.round(Number(v.gross));
    if (gross != null && !(gross >= 1 && gross <= 15)) return bad("That score looks wrong (1–15 allowed)");
    scores[ball] = { gross, pickedUp: !!v?.pickedUp, gir: !!v?.gir };
  }
  const pick = (w: unknown) => (typeof w === "string" && balls.includes(w) ? w : null);
  const ctp = h.par === 3 ? pick(body.ctpWinner) : null;
  const ld = h.par === 5 ? pick(body.ldWinner) : null;

  const { error } = await db.from("hole_entries").upsert(
    {
      round_id: roundId,
      game: gameId,
      hole,
      scores,
      ctp_winner: ctp,
      ld_winner: ld,
      updated_by: session.name,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "round_id,game,hole" },
  );
  if (error) return bad(error.message, 500);

  if (round.status === "upcoming") await db.from("rounds").update({ status: "live" }).eq("id", roundId);

  after(async () => {
    try {
      await maybeBulletin(t.id, roundId, gameId, hole);
    } catch (e) {
      console.error("bulletin failed", e);
    }
  });

  return json({ ok: true });
}
