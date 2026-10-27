import { adminClient } from "@/lib/admin";
import { json, siteOrigin } from "@/lib/server-data";
import { getSetting, setSetting } from "@/lib/site";
import { mailConfigured } from "@/lib/mail/send";
import { postmarkOn, postmarkSetup, setUpPostmark } from "@/lib/mail/postmark";
import { dublinHour, dublinToday } from "@/lib/mail/limits";
import { runSeries } from "@/lib/mail/series";
import { runCampaigns } from "@/lib/mail/campaigns";
import { runEvening } from "@/lib/mail/evening";
import { runDateChanges } from "@/lib/mail/dates";
import { recordError } from "@/lib/incidents";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * The email runs. Vercel calls this at 9 and 10 UTC and at 19 and 20 UTC (with the CRON_SECRET setting), so one of each
 * pair lands on 10am and 8pm Irish time whatever the season. Each runs once a day.
 *  - 10am: Postmark set up if it isn't yet, the dates-changed emails, the series, scheduled campaigns
 *  - 8pm: the dates-changed emails, the evening email, any campaign still part-way
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: "Not set up" }, 503);
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return json({ error: "Not allowed" }, 401);
  const u = new URL(req.url);
  const force = u.searchParams.get("force");
  const hour = dublinHour();
  const slot = force === "morning" || force === "evening" ? force : hour === 10 ? "morning" : hour === 20 ? "evening" : null;
  if (!slot) return json({ ok: true, ran: null });
  const today = dublinToday();
  const runs = await getSetting<Record<string, string>>("email-runs", {});
  if (!force && runs[slot] === today) return json({ ok: true, ran: null, already: true });
  await setSetting("email-runs", { ...runs, [slot]: today, [`${slot}At`]: new Date().toISOString() });
  if (!mailConfigured()) return json({ ok: true, ran: slot, sent: 0 });
  const site = siteOrigin(req);
  const did: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      did[name] = await fn();
    } catch (e) {
      did[name] = "failed";
      await recordError(`email run: ${name}`, e);
    }
  };
  if (slot === "morning") {
    if (postmarkOn() && !(await postmarkSetup())) await step("postmark", async () => (await setUpPostmark(site)).streams);
    await step("stats", async () => (await adminClient().rpc("refresh_stats_due")).data);
    await step("dates", () => runDateChanges(site));
    await step("series", () => runSeries(site));
    await step("campaigns", () => runCampaigns(site, { start: true }));
    // The send record is kept for 13 months
    await step("tidy", async () => (await adminClient().from("email_sends").delete().lt("at", new Date(Date.now() - 400 * 864e5).toISOString())).error?.message ?? "done");
  } else {
    await step("stats", async () => (await adminClient().rpc("refresh_stats_due")).data);
    await step("dates", () => runDateChanges(site));
    await step("evening", () => runEvening(site));
    await step("campaigns", () => runCampaigns(site, { start: false }));
  }
  await setSetting("email-runs", { ...(await getSetting<Record<string, unknown>>("email-runs", {})), [`${slot}Did`]: did });
  return json({ ok: true, ran: slot, did });
}
