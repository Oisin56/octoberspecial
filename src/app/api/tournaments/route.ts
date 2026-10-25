import { checkOwnerPin, getAccount, isOwner, setOwner, setSession } from "@/lib/auth";
import { SignInError, cleanEmail, linkRole, linkTournament, makeOffer, organiserSession, sendSignIn } from "@/lib/accounts";
import { inviteFor, spendInvite } from "@/lib/invites";
import { adminClient } from "@/lib/admin";
import { bad, json, siteOrigin, slugify, crossSite, CROSS_SITE } from "@/lib/server-data";
import { WizardError, cleanWizard, createFromWizard } from "@/lib/wizard-server";
import { EMAIL_RE } from "@/lib/email";

export const maxDuration = 60;

/**
 * Create a new tournament with the setup wizard. Invitation-only: the site owner, or someone with an approved invite
 * link (good for one tournament).
 */
export async function POST(req: Request) {
  if (crossSite(req)) return bad(CROSS_SITE, 403);
  const b = await req.json().catch(() => ({}));
  const owner = await isOwner();
  const invite = !owner && b.invite ? await inviteFor(String(b.invite)) : null;
  if (!owner && !invite) {
    if (b.invite) return bad("That invite link has been used or has expired. Ask for a new one.", 410);
    // The old owner PIN, only until the owner has signed in with their email
    if (!b.ownerPin || !(await checkOwnerPin(String(b.ownerPin)))) return bad("New tournaments are invitation-only for now. Ask for an invite.", 401);
    await setOwner();
  }
  if (b.wizard) return fromWizard(req, b, invite?.id ?? null);
  if (invite) return bad("Use the setup wizard to make your tournament");
  return bare(b);
}

/** The site owner only: an empty tournament with just a name, set up by hand from the organiser home. */
async function bare(b: Record<string, unknown>) {
  const name = String(b.name ?? "").trim().slice(0, 80);
  if (!name) return bad("Give the tournament a name");
  const db = adminClient();
  let slug = slugify(String(b.slug || name)) || "tournament";
  const { data: clash } = await db.from("tournaments").select("id").eq("slug", slug).maybeSingle();
  if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
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
  if (account) {
    await linkRole(account.id, created.id, "organiser", created.organiser.playerId ?? null).catch(() => {});
    await setSession(created.id, await organiserSession(created.id, "account", created.organiser.playerId));
  } else {
    // This phone runs it now. It joins that email's My golf when they confirm it (the link or the code we send)
    await setSession(created.id, { role: "organiser", name: created.organiser.name, playerId: created.organiser.playerId, via: "create", at: Date.now() });
    await makeOffer(created.id, email, "organiser", created.organiser.playerId ?? null, null).catch(() => {});
    emailed = await sendSignIn(siteOrigin(req), email, { next: `/t/${created.slug}/admin`, intro: `Your tournament ${created.name} is ready. Tap the button to confirm your email, so you can get back in to run it on any phone.` })
      .then(() => true)
      .catch((e) => (e instanceof SignInError ? false : Promise.reject(e)));
  }
  return json({ slug: created.slug, emailed });
}
