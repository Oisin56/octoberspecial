import "server-only";
import { adminClient } from "../admin";
import { emailProof } from "../accounts";
import { datesSignature, type IcsRound } from "./ics";
import { datesChangedMail } from "./emails";
import { deliver } from "./send";
import { allRows } from "./pages";

/**
 * Players who were emailed their link have the rounds in their calendar. When the organiser changes a date or tee time,
 * they get "The dates have changed" with a fresh calendar file. Checked at 10am and 8pm, so a morning of changes makes
 * one email, not five.
 */
export async function runDateChanges(site: string): Promise<number> {
  const db = adminClient();
  // Only trips not over yet: tournaments with a round today or later
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = await allRows<{ tournament_id: string }>((a, b) => db.from("tournament_stats").select("tournament_id").gte("last_day", today).order("tournament_id").range(a, b));
  type P = { id: string; name: string; email: string | null; link_code: string | null; dates_sent: string | null; tournament_id: string };
  const players: P[] = [];
  const ids = upcoming.map((u) => u.tournament_id);
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    players.push(
      ...(await allRows<P>((a, b) =>
        db.from("players").select("id,name,email,link_code,dates_sent,tournament_id").in("tournament_id", chunk).not("link_emailed_at", "is", null).not("email", "is", null).not("link_code", "is", null).order("tournament_id").order("id").range(a, b),
      )),
    );
  }
  const byT = new Map<string, P[]>();
  for (const p of players) byT.set(p.tournament_id, [...(byT.get(p.tournament_id) ?? []), p]);
  let sent = 0;
  for (const [tid, list] of byT) {
    const { data: rounds } = await db.from("rounds").select("id,number,course_name,play_date,tee_time").eq("tournament_id", tid).order("number");
    const sig = datesSignature((rounds ?? []) as IcsRound[]);
    const due = list.filter((p) => p.dates_sent !== sig);
    if (!due.length) continue;
    // Not once the trip is over
    if (!(rounds ?? []).some((r) => r.play_date && r.play_date >= today)) {
      await db.from("players").update({ dates_sent: sig }).in("id", due.map((p) => p.id)).eq("tournament_id", tid);
      continue;
    }
    const { data: t } = await db.from("tournaments").select("*").eq("id", tid).maybeSingle();
    if (!t) continue;
    for (const p of due) {
      const link = `${site}/t/${t.slug}/in/${p.link_code}?e=${emailProof(p.link_code!, p.email!)}`;
      const ok = await deliver(await datesChangedMail(t, { name: p.name, email: p.email! }, link, (rounds ?? []) as IcsRound[], null)).then(
        () => true,
        () => false,
      );
      if (ok) sent++;
      // Marked either way: a stopped or failing address isn't tried at every run
      await db.from("players").update({ dates_sent: sig }).eq("id", p.id).eq("tournament_id", tid);
    }
  }
  return sent;
}
