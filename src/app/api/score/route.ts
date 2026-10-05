import { after } from "next/server";
import { adminClient } from "@/lib/admin";
import { getSession } from "@/lib/auth";
import { bad, json } from "@/lib/server-data";
import type { PlayerHole } from "@/lib/scoring";
import { maybeBulletin } from "@/lib/ai";

export const maxDuration = 60;

/** Scorer saves one hole. Idempotent: re-sending the same hole overwrites it. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return bad("Log in to score", 401);

  const body = await req.json().catch(() => null);
  if (!body) return bad("Bad request");
  const roundId = String(body.roundId ?? "");
  const hole = Number(body.hole);
  if (!roundId || !(hole >= 1 && hole <= 18)) return bad("Bad hole");

  const db = adminClient();
  const { data: round } = await db
    .from("rounds")
    .select("id,scorer_id,holes,status,tournament_id")
    .eq("id", roundId)
    .single();
  if (!round) return bad("Round not found", 404);

  const isScorer = s.role === "organiser" || (s.playerId && s.playerId === round.scorer_id);
  if (!isScorer) return bad("Only this round's scorer can enter scores", 403);

  const holeInfo = (round.holes as { number: number; par: number }[]).find((h) => h.number === hole);
  if (!holeInfo) return bad("Hole not on card");

  // Sanitise scores
  const scores: Record<string, PlayerHole> = {};
  for (const [pid, v] of Object.entries((body.scores ?? {}) as Record<string, PlayerHole>)) {
    const gross = v?.gross == null ? null : Math.round(Number(v.gross));
    if (gross != null && !(gross >= 1 && gross <= 15)) return bad(`Odd score for ${pid}`);
    scores[pid] = { gross, pickedUp: !!v?.pickedUp, gir: !!v?.gir };
  }
  const ctp = holeInfo.par === 3 ? (body.ctpWinner ?? null) : null;
  const ld = holeInfo.par === 5 ? (body.ldWinner ?? null) : null;

  const { error } = await db.from("hole_entries").upsert(
    {
      round_id: roundId,
      hole,
      scores,
      ctp_winner: ctp,
      ld_winner: ld,
      updated_by: s.name,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "round_id,hole" },
  );
  if (error) return bad(error.message, 500);

  if (round.status === "upcoming") {
    await db.from("rounds").update({ status: "live" }).eq("id", roundId);
  }

  // Live bulletin at key moments — runs after the scorer gets their response.
  after(async () => {
    try {
      await maybeBulletin(roundId, hole);
    } catch (e) {
      console.error("bulletin failed", e);
    }
  });

  return json({ ok: true });
}
