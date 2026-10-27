import "server-only";
import { adminClient } from "./admin";
import { storeFor } from "./files";
import { NotSent, deliver } from "./mail/send";
import { filmReminderMail, type TLike } from "./mail/emails";
import { organisersOf } from "./mail/series";
import { recordError } from "./incidents";
import { logActivity, SYSTEM } from "./activity";

/**
 * Films are kept for 12 months from the day they're made. Everyone on the trip with an email hears a month before;
 * then the film goes from every page (its post and its file). Photos and clips from the feed stay.
 */
export const FILM_MONTHS = 12;
const DAY = 864e5;

export function filmExpiry(made: string | Date): string {
  const d = new Date(made);
  d.setUTCMonth(d.getUTCMonth() + FILM_MONTHS);
  return d.toISOString();
}

/** "14 June" */
export const dayMonth = (iso: string) => {
  const d = new Date(iso);
  const part = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-IE", { ...o, timeZone: "Europe/Dublin" });
  return `${part({ day: "numeric" })} ${part({ month: "long" })}`;
};

/** Remove a stored photo or video and its still frame (a link to somewhere else is left alone). */
export async function removeStored(path: string | null | undefined) {
  if (!path || /^https?:/i.test(path)) return;
  try {
    await (await storeFor(path)).remove([path, `${path}.jpg`]);
  } catch (e) {
    console.warn("[files] not removed", path, e);
  }
}

interface Reel {
  id: string;
  tournament_id: string;
  post_id: string | null;
  video_path: string | null;
  expires_at: string | null;
  done_at: string | null;
}

const dueOf = (r: Reel) => r.expires_at ?? (r.done_at ? filmExpiry(r.done_at) : null);

/** Who hears about a trip's film: organisers and players with an email (service), followers (with the trip's updates) */
async function filmPeople(tid: string): Promise<{ email: string; name: string | null; follower: boolean }[]> {
  const db = adminClient();
  const [orgs, players, fans, subs] = await Promise.all([
    organisersOf([tid]),
    db.from("players").select("email,name").eq("tournament_id", tid).not("email", "is", null),
    db.from("fans").select("email,name").eq("tournament_id", tid).eq("status", "approved").eq("blocked", false).not("email", "is", null).not("verified_at", "is", null),
    db.from("subscribers").select("email,name").eq("tournament_id", tid).is("unsubscribed_at", null),
  ]);
  const out = new Map<string, { email: string; name: string | null; follower: boolean }>();
  const add = (email: string, name: string | null, follower: boolean) => {
    const e = email.toLowerCase();
    if (!out.has(e)) out.set(e, { email: e, name, follower });
  };
  for (const o of orgs.get(tid) ?? []) add(o.email, o.name, false);
  for (const p of players.data ?? []) add(String(p.email), p.name ?? null, false);
  for (const f of [...(fans.data ?? []), ...(subs.data ?? [])]) add(String(f.email), f.name ?? null, true);
  return [...out.values()];
}

/** The hourly film work: remove films past 12 months, and (in the daytime) send the reminders due. */
export async function runFilms(site: string, opts: { remind: boolean }): Promise<{ removed: number; reminded: number }> {
  const db = adminClient();
  const now = Date.now();
  let removed = 0;
  let reminded = 0;
  const { data } = await db.from("reels").select("id,tournament_id,post_id,video_path,expires_at,done_at,reminded_at").eq("status", "done").is("removed_at", null).order("done_at").limit(2000);
  const reels = (data ?? []) as (Reel & { reminded_at: string | null })[];

  for (const r of reels) {
    const due = dueOf(r);
    if (!due || Date.parse(due) > now) continue;
    try {
      if (r.post_id) await db.from("posts").delete().eq("id", r.post_id).eq("tournament_id", r.tournament_id);
      await removeStored(r.video_path);
      await db.from("reels").update({ removed_at: new Date().toISOString(), post_id: null }).eq("id", r.id);
      await db.from("tournaments").update({ film_removed_at: new Date().toISOString() }).eq("id", r.tournament_id);
      await logActivity(SYSTEM, "film.removed", { tournamentId: r.tournament_id, detail: { reel: r.id, after: `${FILM_MONTHS} months` } });
      removed++;
    } catch (e) {
      await recordError("films: removing", e, { tid: r.tournament_id });
    }
  }

  if (!opts.remind) return { removed, reminded };
  // A month before: one email per trip, whichever of its films is due first
  const byTrip = new Map<string, (Reel & { reminded_at: string | null })[]>();
  for (const r of reels) {
    const due = dueOf(r);
    if (!due || r.reminded_at || Date.parse(due) <= now || Date.parse(due) - now > 30 * DAY) continue;
    byTrip.set(r.tournament_id, [...(byTrip.get(r.tournament_id) ?? []), r]);
  }
  for (const [tid, list] of byTrip) {
    // Marked first, so a slow run can't send it twice
    const { data: mine } = await db.from("reels").update({ reminded_at: new Date().toISOString() }).in("id", list.map((r) => r.id)).is("reminded_at", null).select("id");
    if (!mine?.length) continue;
    const { data: t } = await db.from("tournaments").select("id,name,slug,theme,custom_colors").eq("id", tid).maybeSingle();
    if (!t) continue;
    const first = list.map(dueOf).filter(Boolean).sort()[0]!;
    const film = { href: `${site}/t/${t.slug}#film`, removeOn: dayMonth(first) };
    for (const p of await filmPeople(tid)) {
      try {
        await deliver(await filmReminderMail(t as TLike, site, p, film));
        reminded++;
      } catch (e) {
        if (!(e instanceof NotSent)) await recordError("films: reminder", e, { tid });
      }
    }
  }
  return { removed, reminded };
}
