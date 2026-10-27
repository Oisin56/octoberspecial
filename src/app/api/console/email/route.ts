import { after } from "next/server";
import { randomUUID } from "node:crypto";
import { adminClient } from "@/lib/admin";
import { ConsoleDenied, requireConsole, type ConsoleUser } from "@/lib/console-auth";
import { SignInError } from "@/lib/accounts";
import { logActivity } from "@/lib/activity";
import { bad, crossSite, CROSS_SITE, json, siteOrigin } from "@/lib/server-data";
import { setSetting } from "@/lib/site";
import { EMAIL_RE } from "@/lib/email-re";
import { forgetBlocked } from "@/lib/email-log";
import { SERVICE, checkWords, fill, saveWords, versionsOf, type Words, type WordsDef } from "@/lib/mail/words";
import { previewService, SAMPLE_T } from "@/lib/mail/emails";
import { deliver, mailConfigured } from "@/lib/mail/send";
import { SAMPLE_CANDIDATE, readyToSwitchOn, seriesDef, seriesState, stepMail, stepWords, type SeriesKey, type StepCfg } from "@/lib/mail/series";
import { audience, audienceCount, campaignMail, cleanAudience, cleanBlocks, draftCampaign, sendCampaign, type Campaign } from "@/lib/mail/campaigns";
import { campaignList, emailHealth, everyEmail, filmList, oneEmail, photoList, refStats, seriesList, seriesOne, stoppedList } from "@/lib/mail/console";
import { eveningMail, sampleDay } from "@/lib/mail/evening";
import { newsletterEmail } from "@/lib/newsletter";
import { paletteFor } from "@/lib/themes";
import { postmarkOn, reactivate, setUpPostmark } from "@/lib/mail/postmark";
import { emailSettings, forgetEmailSettings } from "@/lib/mail/settings";
import { dublinToday } from "@/lib/mail/limits";
import { ref as campaignRef } from "@/lib/mail/campaigns";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const NO_STORE = { "cache-control": "no-store, private" };
const ok = (data: unknown) => Response.json(data, { headers: NO_STORE });

function denied(e: unknown) {
  if (e instanceof ConsoleDenied || e instanceof SignInError) return bad(e.message, e.status);
  console.error("[console email]", e);
  return Response.json({ error: e instanceof Error && e.message.length < 200 ? e.message : "That didn't work just now. Try again." }, { status: 500 });
}

const UUID = /^[0-9a-f-]{36}$/i;
const ownerOnly = (u: ConsoleUser) => {
  if (u.role !== "owner") throw new ConsoleDenied("Only the owner can do that", 403);
};

/** A words definition by key: a service email, or a series step */
function defFor(key: string): WordsDef | null {
  const s = SERVICE.find((d) => d.key === key);
  if (s) return s;
  const m = key.match(/^series:(\w+):([\w-]+)$/);
  const def = m ? seriesDef(m[1]) : null;
  return def ? stepWords(def, m![2]) : null;
}

const wordsIn = (w: unknown): Words => {
  const x = (w ?? {}) as Record<string, unknown>;
  return { subject: String(x.subject ?? ""), headline: String(x.headline ?? ""), lines: String(x.lines ?? ""), button: String(x.button ?? "") };
};

export async function GET(req: Request) {
  if (req.headers.get("x-console") !== "1") return bad("Open this from the console", 400);
  const u = new URL(req.url);
  const p = (k: string) => u.searchParams.get(k) ?? "";
  try {
    const user = await requireConsole();
    switch (p("view")) {
      case "every":
        return ok({ ...(await everyEmail()), health: await emailHealth(), role: user.role });
      case "email": {
        const def = defFor(p("key"));
        if (!def) return bad("No email called that", 404);
        return ok({ ...(await oneEmail(def)), role: user.role });
      }
      case "series":
        return ok({ series: await seriesList(), role: user.role });
      case "seriesOne": {
        if (!seriesDef(p("key"))) return bad("No series called that", 404);
        return ok({ ...(await seriesOne(p("key") as SeriesKey)), role: user.role });
      }
      case "campaigns":
        return ok({ campaigns: await campaignList(), role: user.role });
      case "campaign": {
        if (!UUID.test(p("id"))) return bad("Not found", 404);
        const { data: c } = await adminClient().from("email_campaigns").select("*").eq("id", p("id")).maybeSingle();
        if (!c) return bad("Not found", 404);
        const stats = (await refStats([campaignRef(c.id)]))[campaignRef(c.id)];
        return ok({ campaign: c, stats, count: c.status === "draft" || c.status === "scheduled" ? await audienceCount(c.audience) : null, photos: await photoList(), films: await filmList(), role: user.role, today: dublinToday() });
      }
      case "stopped":
        return ok({ ...(await stoppedList(p("q"), Math.max(0, Number(p("page")) || 0))), health: await emailHealth(), role: user.role });
      case "settings":
        return ok({ settings: await emailSettings(), health: await emailHealth(), role: user.role });
    }
    return bad("Unknown view");
  } catch (e) {
    return denied(e);
  }
}

export async function POST(req: Request) {
  if (crossSite(req)) return bad(CROSS_SITE, 403);
  const b = await req.json().catch(() => ({}));
  try {
    const user = await requireConsole();
    const site = siteOrigin(req);
    const a = String(b.action ?? "");
    const db = adminClient();

    // ---------------------------------------------------------- the words of one email
    if (a === "words.save" || a === "words.restore") {
      ownerOnly(user);
      const def = defFor(String(b.key ?? ""));
      if (!def) return bad("No email called that", 404);
      let w: Words;
      let from: number | null = null;
      if (a === "words.restore") {
        const v = (await versionsOf(def.key)).find((x) => x.version === Number(b.version));
        if (!v) return bad("That version is gone", 404);
        w = { subject: v.subject ?? "", headline: v.headline ?? "", lines: v.lines ?? "", button: v.button ?? "" };
        from = v.version;
      } else if (b.starting) {
        w = { subject: def.words.subject, headline: def.words.headline ?? "", lines: def.words.lines ?? "", button: def.words.button ?? "" };
        from = 0;
      } else w = wordsIn(b.words);
      const err = checkWords(def, w);
      if (err) return bad(err);
      const version = await saveWords(def, w, user.email, from);
      await logActivity(user, a === "words.restore" ? "email.restore" : "email.words", { detail: { email: def.name, key: def.key, version, ...(from !== null ? { from } : {}) } });
      return json({ ok: true, version });
    }

    if (a === "preview" || a === "test") {
      const key = String(b.key ?? "");
      let m: { subject: string; html: string; text: string };
      if (key === "campaign") {
        const { blocks, error } = cleanBlocks(b.blocks);
        if (error) return bad(error);
        const c = { id: randomUUID(), subject: String(b.subject ?? "").slice(0, 150) || "(no subject yet)", blocks };
        // Filled in with the first person's name and tournament, but its links are for the person looking (never a
        // real person's own stop and preferences links)
        const sample = b.audience ? (await audience(cleanAudience(b.audience)))[0] : null;
        m = await campaignMail(c, { email: user.email, name: sample?.name ?? "Neil Byrne", tournament: sample?.tournament ?? SAMPLE_T.name }, site);
      } else {
        const def = defFor(key);
        if (!def) return bad("No email called that", 404);
        const w = b.words ? wordsIn(b.words) : undefined;
        if (w) {
          const err = checkWords(def, w);
          if (err && !/can't be empty|Write at least|needs words/.test(err)) return bad(err);
        }
        if (def.group === "series") {
          const sd = seriesDef(key.split(":")[1])!;
          m = await stepMail(sd, key.split(":")[2], SAMPLE_CANDIDATE, site, w);
        } else if (key === "evening") m = await eveningMail(site, sampleDay(SAMPLE_T), user.email, "Clodagh Byrne", w);
        else if (key === "piece") m = await previewPiece(site, w);
        else m = await previewService(key, site, w);
      }
      if (a === "preview") return json({ subject: m.subject, html: m.html, text: m.text });
      if (!mailConfigured()) return bad("Email isn't set up yet", 503);
      await deliver({ ...m, subject: `Test: ${m.subject}`, to: user.email, kind: "test", stream: "service", template: null, ref: null, fromName: "MyGolfBroadcast", unsubscribe: null, sendId: undefined });
      await logActivity(user, "email.test", { detail: { email: key } });
      return json({ ok: true, to: user.email });
    }

    // ---------------------------------------------------------- series
    if (a.startsWith("series.")) {
      ownerOnly(user);
      const def = seriesDef(String(b.key ?? ""));
      if (!def) return bad("No series called that", 404);
      const st = await seriesState(def.key);
      const save = async (patch: { enabled?: boolean; steps?: StepCfg[] }) => {
        const row = { key: def.key, enabled: patch.enabled ?? st.enabled, steps: patch.steps ?? st.steps, updated_at: new Date().toISOString(), updated_by: user.email };
        const { error } = await db.from("email_series").upsert(row);
        if (error) throw new Error(/email_series/.test(error.message) ? "This needs the latest database update (run supabase/schema.sql)" : error.message);
      };
      if (a === "series.switch") {
        const on = b.on === true;
        if (on) {
          const why = await readyToSwitchOn(def.key);
          if (why) return bad(why);
        }
        await save({ enabled: on });
        await logActivity(user, on ? "email.series.on" : "email.series.off", { detail: { series: def.name } });
        return json({ ok: true });
      }
      if (a === "series.step") {
        const id = String(b.step ?? "");
        const steps = st.steps.map((s) => ({ ...s }));
        const s = steps.find((x) => x.id === id);
        if (!s) return bad("No step called that", 404);
        if (typeof b.on === "boolean") s.on = b.on;
        if (b.days !== undefined) {
          const d = Number(b.days);
          if (!Number.isInteger(d) || d < 0 || d > 730) return bad("Pick a number of days between 0 and 730");
          s.days = d;
        }
        if (b.from !== undefined) {
          if (!def.froms.includes(b.from)) return bad("That timing isn't one this series can use");
          s.from = b.from;
        }
        await save({ steps });
        await logActivity(user, "email.series.step", { detail: { series: def.name, step: id, on: s.on, from: s.from, days: s.days } });
        return json({ ok: true });
      }
      if (a === "series.add") {
        const from = String(b.from ?? def.froms[0]);
        const d = Number(b.days);
        if (!def.froms.includes(from as StepCfg["from"])) return bad("That timing isn't one this series can use");
        if (!Number.isInteger(d) || d < 0 || d > 730) return bad("Pick a number of days between 0 and 730");
        if (st.steps.length >= 8) return bad("A series can have 8 steps at most");
        const id = `s${randomUUID().slice(0, 8)}`;
        await save({ steps: [...st.steps, { id, from: from as StepCfg["from"], days: d, on: false }] });
        await logActivity(user, "email.series.add", { detail: { series: def.name, step: id } });
        return json({ ok: true, step: id });
      }
      if (a === "series.remove") {
        const id = String(b.step ?? "");
        if (def.steps.some((x) => x.id === id)) return bad("The starting steps can be switched off, not removed");
        await save({ steps: st.steps.filter((s) => s.id !== id) });
        await logActivity(user, "email.series.remove", { detail: { series: def.name, step: id } });
        return json({ ok: true });
      }
      return bad("Unknown action");
    }

    // ---------------------------------------------------------- campaigns
    if (a.startsWith("campaign.")) {
      if (a === "campaign.draft") {
        const brief = String(b.brief ?? "").trim();
        if (brief.length < 8) return bad("Say a little more about it: what it's about, and anything it must include");
        const d = await draftCampaign(brief);
        await logActivity(user, "email.campaign.draft", { detail: { brief: brief.slice(0, 200) } });
        return json(d);
      }
      if (a === "campaign.count") return json(await audienceCount(cleanAudience(b.audience)));
      if (a === "campaign.create") {
        const name = String(b.name ?? "").trim().slice(0, 80) || "New campaign";
        const { data, error } = await db.from("email_campaigns").insert({ name, created_by: user.email, updated_by: user.email }).select("id").single();
        if (error) return bad(/email_campaigns/.test(error.message) ? "This needs the latest database update (run supabase/schema.sql)" : error.message, 500);
        await logActivity(user, "email.campaign.create", { detail: { campaign: name } });
        return json({ id: data.id });
      }
      const id = String(b.id ?? "");
      if (!UUID.test(id)) return bad("Not found", 404);
      const { data: c } = await db.from("email_campaigns").select("*").eq("id", id).maybeSingle();
      if (!c) return bad("Not found", 404);
      const on = { detail: { campaign: c.name } };
      switch (a) {
        case "campaign.save": {
          if (c.status !== "draft") return bad("Only a draft can be changed. Take it off the schedule first.");
          const patch: Record<string, unknown> = { updated_by: user.email, updated_at: new Date().toISOString() };
          if (b.name !== undefined) patch.name = String(b.name).trim().slice(0, 80) || c.name;
          if (b.subject !== undefined) {
            const s = String(b.subject).replace(/[\r\n<>]/g, "").trim().slice(0, 150);
            const bad1 = (s.match(/\{([a-z ]{1,20})\}/gi) ?? []).map((x) => x.slice(1, -1).toLowerCase()).find((x) => x !== "first name" && x !== "tournament");
            if (bad1) return bad(`{${bad1}} isn't something a campaign can fill in. It can use {first name} and {tournament}.`);
            patch.subject = s;
          }
          if (b.blocks !== undefined) {
            const { blocks, error } = cleanBlocks(b.blocks);
            if (error) return bad(error);
            patch.blocks = blocks;
          }
          if (b.audience !== undefined) patch.audience = cleanAudience(b.audience);
          await db.from("email_campaigns").update(patch).eq("id", id);
          return json({ ok: true });
        }
        case "campaign.delete": {
          if (c.status !== "draft") return bad("Only a draft can be deleted");
          if (user.role !== "owner" && c.created_by !== user.email) return bad("Only the owner can delete someone else's draft", 403);
          await db.from("email_campaigns").delete().eq("id", id);
          await logActivity(user, "email.campaign.delete", on);
          return json({ ok: true });
        }
        case "campaign.schedule":
        case "campaign.send": {
          ownerOnly(user);
          if (c.status !== "draft") return bad("It isn't a draft any more");
          if (!c.subject?.trim()) return bad("Give it a subject first");
          if (!(c.blocks as unknown[]).length) return bad("Write something in it first");
          const n = await audienceCount(c.audience);
          if (!n.total) return bad("Nobody matches who it's for. Change the choices under Who gets it.");
          if (n.total > 500 && Number(b.confirm) !== n.total) return bad(`Type ${n.total} to confirm`);
          if (a === "campaign.schedule") {
            const day = String(b.send_on ?? "");
            if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < dublinToday()) return bad("Pick today or a day after it");
            await db.from("email_campaigns").update({ status: "scheduled", send_on: day, planned: n.total, sent_by: user.email }).eq("id", id);
            await logActivity(user, "email.campaign.schedule", { detail: { campaign: c.name, day, people: n.total } });
            return json({ ok: true });
          }
          await db.from("email_campaigns").update({ status: "sending", started_at: new Date().toISOString(), planned: n.total, sent_by: user.email }).eq("id", id);
          await logActivity(user, "email.campaign.send", { detail: { campaign: c.name, people: n.total } });
          after(() => sendCampaign(id, site).catch((e) => console.error("[campaign]", e)));
          return json({ ok: true });
        }
        case "campaign.unschedule": {
          ownerOnly(user);
          if (c.status !== "scheduled") return bad("It isn't scheduled");
          await db.from("email_campaigns").update({ status: "draft", send_on: null }).eq("id", id).eq("status", "scheduled");
          await logActivity(user, "email.campaign.unschedule", on);
          return json({ ok: true });
        }
        case "campaign.stop": {
          ownerOnly(user);
          if (!["sending", "paused", "scheduled"].includes(c.status)) return bad("It isn't going out");
          await db.from("email_campaigns").update({ status: "stopped", finished_at: new Date().toISOString() }).eq("id", id);
          await logActivity(user, "email.campaign.stop", on);
          return json({ ok: true });
        }
        case "campaign.resume": {
          ownerOnly(user);
          if (c.status !== "paused") return bad("It isn't paused");
          await db.from("email_campaigns").update({ status: "sending", note: null }).eq("id", id);
          await logActivity(user, "email.campaign.resume", on);
          after(() => sendCampaign(id, site).catch((e) => console.error("[campaign]", e)));
          return json({ ok: true });
        }
        case "campaign.copy": {
          const { data } = await db
            .from("email_campaigns")
            .insert({ name: `${c.name} (copy)`.slice(0, 80), subject: c.subject, blocks: c.blocks, audience: c.audience, created_by: user.email, updated_by: user.email })
            .select("id")
            .single();
          await logActivity(user, "email.campaign.create", { detail: { campaign: `${c.name} (copy)` } });
          return json({ id: data?.id });
        }
      }
      return bad("Unknown action");
    }

    // ---------------------------------------------------------- photos for campaigns
    if (a === "photo") {
      const m = String(b.data ?? "").match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (!m) return bad("Choose a JPEG, PNG or WebP photo");
      const buf = Buffer.from(m[2], "base64");
      if (buf.length > 3 * 1024 * 1024) return bad("That photo is too big. 3 MB at most (a phone photo saved for the web is usually well under).");
      const ext = m[1].split("/")[1].replace("jpeg", "jpg");
      const path = `site/email/${randomUUID()}.${ext}`;
      const { error } = await db.storage.from("media").upload(path, buf, { contentType: m[1], upsert: false });
      if (error) return bad("Couldn't keep that photo just now. Try again.", 500);
      const { data } = await db.from("email_photos").insert({ path, name: String(b.name ?? "").slice(0, 120) || null, added_by: user.email }).select("id").single();
      return json({ id: data?.id, photos: await photoList() });
    }

    // ---------------------------------------------------------- stopped addresses
    if (a === "stopped.lift") {
      ownerOnly(user);
      const email = String(b.email ?? "").trim().toLowerCase();
      const { data: block } = await db.from("email_blocks").select("*").eq("email", email).maybeSingle();
      const { data: person } = await db.from("people").select("marketing_stopped_reason,marketing_stopped_at,updates_stopped_at").eq("email", email).maybeSingle();
      if (person?.marketing_stopped_reason === "spam") return bad("They marked an email as spam. Only they can undo that, by ticking the box again.");
      if (block) {
        await db.from("email_blocks").delete().eq("email", email);
        forgetBlocked(email);
        if (postmarkOn()) await reactivate(email);
      } else if (person?.marketing_stopped_at && !person.marketing_stopped_reason) {
        await db.from("people").update({ marketing_stopped_at: null }).eq("email", email);
      } else return bad("They stopped these themselves. Only they can turn them back on, from the link in any email.");
      await logActivity(user, "email.unblock", { person: email });
      return json({ ok: true });
    }
    if (a === "stopped.add") {
      ownerOnly(user);
      const email = String(b.email ?? "").trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return bad("That email address doesn't look right");
      await db.from("email_blocks").upsert({ email, by_who: user.email, reason: "Stopped by the owner" });
      forgetBlocked(email);
      await logActivity(user, "email.block", { person: email });
      return json({ ok: true });
    }

    // ---------------------------------------------------------- set-up
    if (a === "setup.postmark") {
      ownerOnly(user);
      if (!postmarkOn()) return bad("Add POSTMARK_TOKEN in Vercel first (never in chat), then redeploy.");
      const r = await setUpPostmark(site);
      await logActivity(user, "email.setup", { detail: { streams: r.streams, customUnsub: r.customUnsub } });
      return json({ ok: true, setup: r });
    }
    if (a === "settings.save") {
      ownerOnly(user);
      const address = String(b.address ?? "").replace(/[\r\n<>]/g, " ").trim().slice(0, 200);
      const support = String(b.support ?? "").trim().toLowerCase();
      if (support && !EMAIL_RE.test(support)) return bad("The support mailbox doesn't look like an email address");
      await setSetting("email", { address, support: support || null });
      forgetEmailSettings();
      await logActivity(user, "settings.email", { detail: { address: !!address, support: support || null } });
      return json({ ok: true });
    }
    return bad("Unknown action");
  } catch (e) {
    return denied(e);
  }
}

/** Previews and reports: the newsletter, filled with a made-up round */
async function previewPiece(site: string, w?: Words) {
  const t = SAMPLE_T;
  const m = newsletterEmail({
    tournamentName: t.name,
    palette: paletteFor(t.theme, t.custom_colors),
    logo: null,
    issue: 3,
    dateLabel: "13 June 2026",
    label: "Match report · Round 1",
    kind: "report",
    title: "Byrne holds his nerve at the Old Head",
    body: "Neil Byrne birdied the 17th to take a one-shot lead into the final round, as the wind picked up on the cliffs above the Atlantic.\n\nCiarán Walsh had the round of the day, a 38-point effort built on three birdies on the back nine.\n\nThe second round is at Farrangalway, where the greens are quicker and the wind is forecast to drop.",
    hero: null,
    standings: [
      { name: "Neil Byrne", value: "74", lead: true },
      { name: "Ciarán Walsh", value: "73", lead: false },
    ],
    standingsTitle: "Overall points",
    leadLine: "leads by 1",
    tug: null,
    awards: [],
    roundCard: null,
    results: null,
    highlight: null,
    links: { primary: { label: "Full scorecard", href: `${site}/preview-link` }, secondary: { label: "Leaderboard", href: `${site}/preview-link` } },
    siteHref: `${site}/t/${t.slug}`,
    siteLabel: `${site.replace(/^https?:\/\//, "")}/t/${t.slug}`,
    prefs: `${site}/email`,
    stop: `${site}/email`,
    address: (await emailSettings()).address,
  });
  const words = w ?? { subject: SERVICE.find((d) => d.key === "piece")!.words.subject, headline: "", lines: "", button: "" };
  return { ...m, subject: fill(words.subject, { headline: "Byrne holds his nerve at the Old Head", tournament: t.name }) };
}

