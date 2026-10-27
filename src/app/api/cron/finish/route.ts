import { adminClient } from "@/lib/admin";
import { json, siteOrigin } from "@/lib/server-data";
import { mailConfigured } from "@/lib/mail/send";
import { deliver } from "@/lib/mail/send";
import { finishTomorrowMail, type TLike } from "@/lib/mail/emails";
import { dublinHour, dublinToday } from "@/lib/mail/limits";
import { organisersOf } from "@/lib/mail/series";
import { autoFinishDay, runFinishing, unfinishedPast } from "@/lib/finish";
import { runFilms } from "@/lib/films";
import { recordError } from "@/lib/incidents";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * The end-of-trip work, twice a day (Vercel calls it at 00:20 and 10:20 UTC with the CRON_SECRET setting; the site's
 * plan allows each job once a day, so it's listed twice):
 *  - tournaments due to finish by themselves are finished, and their final report or write-up written
 *  - between 10am and 8pm Irish time: organisers hear the day before a trip finishes by itself, and films due to be
 *    removed in a month send their reminder
 *  - films past 12 months are removed
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: "Not set up" }, 503);
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return json({ error: "Not allowed" }, 401);
  const started = Date.now();
  const site = siteOrigin(req);
  const force = new URL(req.url).searchParams.get("force") === "1";
  const did: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      did[name] = await fn();
    } catch (e) {
      did[name] = "failed";
      await recordError(`end of trip: ${name}`, e);
    }
  };
  const daytime = force || (dublinHour() >= 10 && dublinHour() < 20);
  if (daytime && mailConfigured()) await step("warned", () => warnOrganisers(site));
  await step("films", () => runFilms(site, { remind: daytime && mailConfigured() }));
  await step("finishing", () => runFinishing(started + 240e3));
  return json({ ok: true, ...did });
}

/** The day before a group trip finishes by itself: "Anything to fix?" Once per trip (again if scoring was opened again). */
async function warnOrganisers(site: string) {
  const today = dublinToday();
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
  const due = (await unfinishedPast(today)).filter((c) => !c.solo && !c.finish_warned_at && autoFinishDay(c, c.last_day) === tomorrow);
  if (!due.length) return 0;
  const orgs = await organisersOf(due.map((c) => c.id));
  const db = adminClient();
  let sent = 0;
  for (const c of due) {
    // Marked first, so a slow run can't send it twice
    const { data: mine } = await db.from("tournaments").update({ finish_warned_at: new Date().toISOString() }).eq("id", c.id).is("finish_warned_at", null).select("id").maybeSingle();
    if (!mine) continue;
    for (const o of orgs.get(c.id) ?? []) {
      try {
        await deliver(await finishTomorrowMail(c as unknown as TLike, site, o.email, o.name));
        sent++;
      } catch (e) {
        await recordError("end of trip: finishes tomorrow email", e, { tid: c.id });
      }
    }
  }
  return sent;
}
