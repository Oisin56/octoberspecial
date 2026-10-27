import { bad, context, json, loadServerState } from "@/lib/server-data";
import { isOrganiser } from "@/lib/auth";
import { fromState } from "@/components/setup/fromState";
import { fresh, newKey } from "@/components/setup/model";

/**
 * "Set up next year's trip" and "Record another round": the set-up wizard's answers from a tournament the organiser
 * ran, to start the next one from. Same players (fresh spots), same look and extras; the courses and dates are new.
 * A group trip's name moves on a year; a round on your own is named afresh.
 */
export async function GET(req: Request) {
  const { t, session } = await context(req);
  if (!t) return bad("Tournament not found", 404);
  if (!session || !isOrganiser(session)) return bad("Only its organisers can start the next one from it", 403);
  const s = await loadServerState(t.id);
  const d = fromState(s);
  const solo = d.who === "solo";
  const nextYear = (name: string) => {
    const bumped = name.replace(/\b(20\d\d)\b/, (y) => String(Number(y) + 1));
    return bumped;
  };
  const draft = {
    ...fresh(),
    ...d,
    step: "name",
    name: solo ? "" : nextYear(d.name),
    players: d.players.map((p) => ({ ...p, key: newKey() })),
    rounds: [],
    count: null,
    ko: fresh().ko,
    prizes: (d.prizes ?? []).map((p) => ({ ...p, holesByRound: undefined })),
    keep: null,
    email: "",
    pin: "",
  };
  return json({ draft });
}
