import { adminClient } from "@/lib/admin";
import { getSession, hashPin, isOrganiser } from "@/lib/auth";
import { bad, json, loadServerState } from "@/lib/server-data";
import { generatePiece, type PieceKind } from "@/lib/ai";
import { courseBySlug } from "@/data/courses";

export const maxDuration = 60;

const PLAYER_FIELDS = ["name", "nickname", "handicap", "home_club", "bio", "best_club", "worst_club", "weakness", "quote", "photo_path"];
const ROUND_FIELDS = ["play_date", "tee_time", "tee", "shots", "scorer_id", "status", "holes", "format", "full_points"];

export async function POST(req: Request) {
  const s = await getSession();
  if (!isOrganiser(s)) return bad("Organiser only", 403);
  const b = await req.json().catch(() => ({}));
  const db = adminClient();

  switch (b.action) {
    case "state": {
      const state = await loadServerState();
      const { data: pins } = await db.from("players").select("id,pin_hash");
      return json({
        state,
        pinSet: Object.fromEntries((pins ?? []).map((p) => [p.id, !!p.pin_hash])),
        env: {
          ai: !!process.env.ANTHROPIC_API_KEY,
          contributorPin: !!process.env.CONTRIBUTOR_PIN,
        },
      });
    }

    case "updateRound": {
      const patch: Record<string, unknown> = {};
      for (const k of ROUND_FIELDS) if (k in (b.patch ?? {})) patch[k] = b.patch[k];
      if (typeof patch.tee === "string" && !("holes" in patch)) {
        const { data: r } = await db.from("rounds").select("course_slug,holes").eq("id", b.roundId).single();
        const yards = r && courseBySlug(r.course_slug)?.tees[patch.tee as string];
        if (r && yards) {
          patch.holes = (r.holes as { number: number }[]).map((h, i) => ({ ...h, yards: yards[i] }));
        }
      }
      if (patch.play_date === "") patch.play_date = null;
      const { error } = await db.from("rounds").update(patch).eq("id", b.roundId);
      if (error) return bad(error.message, 500);
      return json({ ok: true });
    }

    case "updatePlayer": {
      const patch: Record<string, unknown> = {};
      for (const k of PLAYER_FIELDS) if (k in (b.patch ?? {})) patch[k] = b.patch[k] === "" ? null : b.patch[k];
      if (b.pin) {
        const pin = String(b.pin).trim();
        if (!/^\d{4,8}$/.test(pin)) return bad("PIN must be 4–8 digits");
        patch.pin_hash = hashPin(pin);
      }
      const { error } = await db.from("players").update(patch).eq("id", b.playerId);
      if (error) return bad(error.message, 500);
      return json({ ok: true });
    }

    case "hide": {
      const table = ["posts", "comments"].includes(b.table) ? b.table : null;
      if (!table) return bad("Bad table");
      const { error } = await db.from(table).update({ hidden: !!b.hidden }).eq("id", b.id);
      if (error) return bad(error.message, 500);
      return json({ ok: true });
    }

    case "deleteHole": {
      const { error } = await db.from("hole_entries").delete().eq("round_id", b.roundId).eq("hole", b.hole);
      if (error) return bad(error.message, 500);
      return json({ ok: true });
    }

    case "aiGenerate": {
      if (!process.env.ANTHROPIC_API_KEY) return bad("ANTHROPIC_API_KEY not set in Vercel", 500);
      const kind = b.kind as PieceKind;
      if (!["preview", "bulletin", "report", "tournament"].includes(kind)) return bad("Bad kind");
      try {
        const piece = await generatePiece(kind, b.roundId ?? null, {
          extra: b.extra ? String(b.extra).slice(0, 500) : undefined,
          trigger: kind === "bulletin" ? `manual-${Date.now()}` : "manual",
          reason: kind === "bulletin" ? "organiser asked for an update on the state of play" : undefined,
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
      const { error } = await db.from("ai_pieces").update(patch).eq("id", b.id);
      if (error) return bad(error.message, 500);
      return json({ ok: true });
    }

    default:
      return bad("Unknown action");
  }
}
