import { RESERVED_SLUGS } from "@/lib/files";
import { checkOwnerPin, getAccount, isOwner, setOwner, setSession } from "@/lib/auth";
import { SignInError, cleanEmail, linkRole, linkTournament, makeOffer, organiserSession, sendSignIn } from "@/lib/accounts";
import { inviteFor, spendInvite } from "@/lib/invites";
import { adminClient } from "@/lib/admin";
import { bad, json, siteOrigin, slugify, crossSite, CROSS_SITE } from "@/lib/server-data";
import { WizardError, cleanWizard, createFromWizard } from "@/lib/wizard-server";
import { EMAIL_RE } from "@/lib/email-re";
import { recordMarketing } from "@/lib/mail/prefs";
import { MARKETING_WORDING } from "@/lib/consent";
import { startWelcome } from "@/lib/mail/series";
import { after } from "next/server";

export const maxDuration = 60;

/**
 * Create a new tournament with the setup wizard. Invitation-only: the site owner, someone with an approved invite link
 * (good for one tournament), or someone signed in who has run one before (the "same time next year" emails send them
 * back here).
 */
export async function POST(req: Request) {
  if (crossSite(req)) return bad(CROSS_SITE, 403);
  const b = await req.json().catch(() => ({}));
  const owner = await isOwner();
  const invite = !owner && b.invite ? await inviteFor(String(b.invite)) : null;
  const returning = !owner && !invite && b.wizard ? await ranOneBefore((b.wizard as { who?: string })?.who === "solo") : false;
  if (!owner && !invite && !returning) {
    if (b.invite) return bad("That invite link has been used or has expired. Ask for a new one.", 410);
    // The old owner PIN, only until the owner has signed in with their email
    if (!b.ownerPin || !(await checkOwnerPin(String(b.ownerPin)))) return bad("New tournaments are invitation-only for now. Ask for an invite.", 401);
    await setOwner();
  }
  if (b.wizard) return fromWizard(req, b, invite?.id ?? null);
  if (invite) return bad("Use the setup wizard to make your tournament");
  return bare(b);
}

/**
 * Signed in, and an organiser of a tournament that's been played; and not more than two new group trips a month this
 * way. Rounds on your own are counted separately and allowed more often (a weekly golfer): up to 12 a month.
 */
async function ranOneBefore(solo: boolean): Promise<boolean> {
  const a = await getAccount();
  if (!a) return false;
  const db = adminClient();
  const { data: mine } = await db.from("account_tournaments").select("tournament_id,created_at").eq("account_id", a.id).eq("role", "organiser").limit(500);
  const ids = (mine ?? []).map((m) => m.tournament_id);
  if (!ids.length) return false;
  const today = new Date().toISOString().slice(0, 10);
  // (a round with its date gone by, or one with scores in: a round on your own is played the day it's set up)
  const { data: played } = await db.from("rounds").select("id").in("tournament_id", ids).or(`play_date.lt.${today},status.neq.upcoming`).limit(1);
  if (!played?.length) return false;
  const month = Date.now() - 30 * 864e5;
  const recent = (mine ?? []).filter((m) => Date.parse(m.created_at) > month).map((m) => m.tournament_id);
  if (!recent.length) return true;
  const { data: kinds } = await db.from("tournaments").select("id,solo").in("id", recent);
  const soloCount = (kinds ?? []).filter((k) => k.solo).length;
  return solo ? soloCount < 12 : recent.length - soloCount < 2;
}

/** The site owner only: an empty tournament with just a name, set up by hand from the organiser home. */
async function bare(b: Record<string, unknown>) {
  const name = String(b.name ?? "").trim().slice(0, 80);
  if (!name) return bad("Give the tournament a name");
  const db = adminClient();
  let slug = slugify(String(b.slug || name)) || "tournament";
  const { data: clash } = await db.from("tournaments").select("id").eq("slug", slug).maybeSingle();
  if (clash || RESERVED_SLUGS.has(slug)) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  const { data, error } = await db
    .from("tournaments")
    .insert({ slug, name, subtitle: b.subtitle ? String(b.subtitle).slice(0, 120) : null, published: false })
    .select("id,slug")
    .single();
  if (error) return bad(error.message, 500);
  await setSession(data.id, { role: "organiser", name: "Organiser", via: "create", at: Date.now() });
  const account = await getAccount();
  if (account) await linkTournament(account.id, data.id).catch(() => {});
  return json({ slug: data.slug });
}

/**
 * The setup wizard's "Create my tournament". The organiser's email keeps it safe: it goes into their My golf, and
 * we email a link and code so they can get back in on any phone. Signed in already: it simply joins My golf.
 */
async function fromWizard(req: Request, b: Record<string, unknown>, inviteId: string | null) {
  const email = cleanEmail(b.email);
  const account = await getAccount();
  if (!account && !email) return bad("Add your email, so you can get back in on any phone");
  if (!account && !EMAIL_RE.test(email)) return bad("That email address doesn't look right");
  let created;
  try {
    created = await createFromWizard(cleanWizard(b.wizard));
  } catch (e) {
    if (e instanceof WizardError) return bad(e.message);
    console.error("[wizard]", e);
    return bad("Couldn't create the tournament just now. Try again.", 500);
  }
  if (inviteId) await spendInvite(inviteId, created.id).catch(() => {});
  let emailed = false;
  const news = b.marketing === true;
  if (account) {
    await linkRole(account.id, created.id, "organiser", created.organiser.playerId ?? null).catch(() => {});
    await setSession(created.id, await organiserSession(created.id, "account", created.organiser.playerId));
    if (news) await recordMarketing(account.email, created.id, MARKETING_WORDING).catch(() => {});
  } else {
    // This phone runs it now. It joins that email's My golf when they confirm it (the link or the code we send)
    await setSession(created.id, { role: "organiser", name: created.organiser.name, playerId: created.organiser.playerId, via: "create", at: Date.now() });
    await makeOffer(created.id, email, "organiser", created.organiser.playerId ?? null, null).catch(() => {});
    // Their tick is kept with the offer, and counts once they confirm the email is theirs
    if (news)
      await adminClient()
        .from("account_offers")
        .update({ marketing_at: new Date().toISOString(), marketing_wording: MARKETING_WORDING })
        .eq("tournament_id", created.id)
        .eq("role", "organiser")
        .eq("email", email)
        .is("answered_at", null);
    emailed = await sendSignIn(siteOrigin(req), email, { next: `/t/${created.slug}/admin`, intro: `Your tournament ${created.name} is ready. Tap the button to confirm your email, so you can get back in to run it on any phone.` })
      .then(() => true)
      .catch((e) => (e instanceof SignInError ? false : Promise.reject(e)));
  }
  // The first of the welcome tips (when that series is switched on)
  const origin = siteOrigin(req);
  after(() => startWelcome(origin, created.id).catch((e) => console.error("[welcome]", e)));
  return json({ slug: created.slug, emailed });
}
