import { after } from "next/server";
import { adminClient } from "@/lib/admin";
import { bad, context, json, loadServerState, type TournamentPrivate, DEMO_READONLY } from "@/lib/server-data";
import { isOrganiser, type Session } from "@/lib/auth";
import { cardInfo, roundStage } from "@/lib/scorecards";
import { roundFinal } from "@/lib/ai";
import { toRoundCfg } from "@/lib/types";
import { FINISHED_PLAYER, finishedAsk } from "@/lib/finish";

export const maxDuration = 60;

/**
 * A match's card at the end of the round.
 *   submit   the scorer hands the card in (final straight away, or once every player signs)
 *   sign     a player agrees with it: on their own phone, or with a tap on the scorer's
 *   flag     "something's not right": the scorer is told who and why
 *   reopen   take the card back to change it (signatures are cleared)
 *   finalise the organiser makes it final without every signature
 */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const { t, session, demo } = await context(req, b);
  if (!t) return bad("Tournament not found", 404);
  if (demo) return bad(DEMO_READONLY, 403);
  if (!session) return bad("Log in first", 401);
  const db = adminClient();
  const roundId = String(b.roundId ?? "");
  const gameId = String(b.game ?? "main");
  const s = await loadServerState(t.id);
  const round = s.rounds.find((r) => r.id === roundId);
  if (!round) return bad("Round not found", 404);
  const cfg = toRoundCfg(round, s.players);
  const game = cfg.games.find((g) => g.id === gameId);
  if (!game) return bad("Match not found", 404);
  const info = cardInfo(s, roundId, gameId);
  const org = isOrganiser(session);
  const scorer = org || (!!session.playerId && session.playerId === game.scorerId);
  const key = { round_id: roundId, game: gameId };
  const now = () => new Date().toISOString();

  const log = (action: string, before: unknown = null, after_: unknown = null) =>
    db.from("score_changes").insert({ tournament_id: t.id, ...key, action, before, after: after_, by_name: session.name });

  async function makeFinal(by: string) {
    await db.from("cards").upsert({ ...key, status: "final", final_at: now(), finalised_by: by, submitted_at: info.card?.submitted_at ?? now(), submitted_by: info.card?.submitted_by ?? by }, { onConflict: "round_id,game" });
    const fresh = await loadServerState(t!.id);
    if (roundStage(fresh, roundId) === "final" || allFinal(fresh, roundId)) {
      after(async () => {
        try {
          await roundFinal(t!.id, roundId);
        } catch (e) {
          console.error("round final", e);
        }
      });
    }
  }

  // Finished: the cards are settled. The organiser can still take one back after saying yes; on your own, always
  if (t.finished_at && !t.solo) {
    if (!org) return bad(FINISHED_PLAYER, 409);
    if (b.confirmFinished !== true) return finishedAsk();
  }

  switch (b.action) {
    case "submit": {
      if (!scorer) return bad("Only this match's scorer can submit the card", 403);
      if (info.stage === "final") return bad("This card is already final");
      if (info.stage === "open") return bad("There are still holes to enter before the card can be submitted");
      if (!t.require_attestation) {
        await makeFinal(session.name);
        return json({ ok: true, stage: "final" });
      }
      await db.from("card_signatures").delete().match(key);
      const { error } = await db.from("cards").upsert({ ...key, status: "submitted", submitted_by: session.name, submitted_at: now(), flag_by: null, flag_note: null, flag_at: null, final_at: null, finalised_by: null }, { onConflict: "round_id,game" });
      if (error) return bad(error.message, 500);
      // Handing in the card is the scorer's own signature
      if (session.playerId && info.players.includes(session.playerId)) await db.from("card_signatures").insert({ ...key, player_id: session.playerId });
      if (info.players.every((p) => p === session.playerId)) {
        await makeFinal(session.name);
        return json({ ok: true, stage: "final" });
      }
      return json({ ok: true, stage: "submitted" });
    }

    case "sign":
    case "flag": {
      if (info.stage !== "submitted") return bad(info.stage === "final" ? "This card is already final" : "The card hasn't been submitted yet");
      const playerId = String(b.playerId ?? "");
      if (!info.players.includes(playerId)) return bad("That player isn't in this match", 400);
      const who = await mayActFor(t, session, playerId, scorer);
      if (who !== true) return who;
      const name = s.players.find((p) => p.id === playerId)?.name ?? playerId;
      if (b.action === "flag") {
        const note = String(b.note ?? "").trim().slice(0, 300);
        await db.from("cards").update({ flag_by: name, flag_note: note || null, flag_at: now() }).match(key);
        await db.from("card_signatures").delete().match({ ...key, player_id: playerId });
        return json({ ok: true, stage: "submitted" });
      }
      await db.from("card_signatures").upsert({ ...key, player_id: playerId }, { onConflict: "round_id,game,player_id" });
      // Signing settles a flag that player raised
      if (info.flag?.by === name) await db.from("cards").update({ flag_by: null, flag_note: null, flag_at: null }).match(key);
      const signed = new Set([...info.signed, playerId]);
      if (info.players.every((p) => signed.has(p))) {
        await makeFinal("Signed by every player");
        return json({ ok: true, stage: "final" });
      }
      return json({ ok: true, stage: "submitted" });
    }

    case "reopen": {
      if (info.stage === "final" && !org) return bad("Only the organiser can reopen a final card", 403);
      if (!scorer) return bad("Only this match's scorer can take the card back", 403);
      if (info.stage === "final") {
        await log("reopened", { status: "final" }, null);
        if (round.status === "complete" && !t.finished_at) await db.from("rounds").update({ status: "live" }).eq("id", roundId);
      }
      await db.from("card_signatures").delete().match(key);
      await db.from("cards").delete().match(key);
      return json({ ok: true, stage: "finished" });
    }

    case "finalise": {
      if (!org) return bad("Only the organiser can finalise a card without every signature", 403);
      if (info.stage === "final") return json({ ok: true, stage: "final" });
      if (info.stage === "open") return bad("There are still holes to enter on this card");
      const missing = info.players.filter((p) => !info.signed.includes(p)).map((p) => s.players.find((x) => x.id === p)?.name ?? p);
      await log("finalised by the organiser", { stage: info.stage, unsigned: missing }, { status: "final" });
      await makeFinal(`${session.name} (organiser)`);
      return json({ ok: true, stage: "final" });
    }
  }
  return bad("Unknown action");
}

function allFinal(s: Parameters<typeof roundStage>[0], roundId: string) {
  const round = s.rounds.find((r) => r.id === roundId);
  if (!round) return false;
  return toRoundCfg(round, s.players).games.every((g) => cardInfo(s, roundId, g.id).stage === "final");
}

/** Signing or flagging for a player: that player on their own phone, or with a tap on the scorer's phone. */
async function mayActFor(t: TournamentPrivate, session: Session, playerId: string, scorer: boolean): Promise<true | Response> {
  if (session.playerId === playerId) return true;
  const { data: p } = await adminClient().from("players").select("id").eq("id", playerId).eq("tournament_id", t.id).maybeSingle();
  if (!p) return bad("Player not found", 404);
  return scorer ? true : bad("Sign on the scorer's phone", 403);
}
