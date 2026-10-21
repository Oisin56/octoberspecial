import "server-only";
import { adminClient } from "./admin";

/** The trip's first and last days, worked out from its rounds' dates (dates live on the rounds only). */
export async function syncTripDates(tournamentId: string): Promise<void> {
  const db = adminClient();
  const { data } = await db.from("rounds").select("play_date").eq("tournament_id", tournamentId);
  const dates = (data ?? []).map((x) => x.play_date as string | null).filter((x): x is string => !!x).sort();
  await db.from("tournaments").update({ start_date: dates[0] ?? null, end_date: dates[dates.length - 1] ?? null }).eq("id", tournamentId);
}
