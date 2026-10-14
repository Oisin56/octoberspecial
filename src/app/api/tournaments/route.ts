import { BRAND } from "@/lib/brand";
import { adminClient } from "@/lib/admin";
import { checkOwnerPin, getAccount, hashPin, isOwner, setOwner, setSession } from "@/lib/auth";
import { linkTournament } from "@/lib/accounts";
import { inviteFor, spendInvite } from "@/lib/invites";
import { bad, json, siteOrigin, slugify } from "@/lib/server-data";
import { WizardError, cleanWizard, createFromWizard } from "@/lib/wizard-server";
import { LINK_MINUTES, newToken, tokenHash } from "@/lib/accounts";
import { EMAIL_RE, accountLinkEmail, mailConfigured, sendOne } from "@/lib/email";

export const maxDuration = 60;

/** Create a new tournament. Only the site owner can (owner PIN = ORGANISER_PIN env). */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  // Invitation-only: the site owner, or someone with an approved invite link (good for one tournament)
  const invite = !(await isOwner()) && b.invite && b.wizard ? await inviteFor(String(b.invite)) : null;
  if (!(await isOwner()) && !invite) {
    if (b.invite) return bad("That invite link has been used or has expired. Ask for a new one.", 410);
    if (!b.ownerPin || !checkOwnerPin(String(b.ownerPin))) return bad("Site owner PIN needed to create a tournament", 401);
    await setOwner();
  }
  if (b.wizard) return fromWizard(req, b, invite?.id ?? null);
  const name = String(b.name ?? "").trim().slice(0, 80);
  if (!name) return bad("Give the tournament a name");
  const organiserPin = String(b.organiserPin ?? "").trim();
  if (!/^\d{4,8}$/.test(organiserPin)) return bad("Organiser PIN must be 4–8 digits");
  let slug = slugify(b.slug || name) || "tournament";
  const db = adminClient();
  const { data: clash } = await db.from("tournaments").select("id").eq("slug", slug).maybeSingle();
  if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

  const { data, error } = await db
    .from("tournaments")
    .insert({
      slug,
      name,
      subtitle: b.subtitle ? String(b.subtitle).slice(0, 120) : null,
      organiser_pin_hash: hashPin(organiserPin),
      published: false,
    })
    .select("id,slug")
    .single();
  if (error) return bad(error.message, 500);
  await setSession(data.id, { role: "organiser", name: "Organiser" });
  // Signed in by email: it goes straight into My tournaments
  const account = await getAccount();
  if (account) await linkTournament(account.id, data.id).catch(() => {});
  return json({ slug: data.slug });
}

/** Published tournaments, newest first; ?q= finds them by name (Join my tournament on the front page). */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 60);
  let query = adminClient().from("public_tournaments").select("slug,name,subtitle,start_date,end_date").eq("published", true);
  if (q) query = query.or(`name.ilike.%${q.replace(/[%_,().*\\]/g, " ").trim()}%,subtitle.ilike.%${q.replace(/[%_,().*\\]/g, " ").trim()}%`);
  const { data } = await query.order("created_at", { ascending: false }).limit(q ? 8 : 50);
  return json({ tournaments: data ?? [] });
}

/**
 * The setup wizard's "Create my tournament". Keeping it safe: the organiser's email (it goes into My tournaments,
 * with a sign-in link emailed) or an organiser PIN. Signed in already: it simply joins My tournaments.
 */
async function fromWizard(req: Request, b: Record<string, unknown>, inviteId: string | null) {
  const email = String(b.email ?? "").trim().toLowerCase().slice(0, 200);
  const pin = String(b.pin ?? "").trim();
  const account = await getAccount();
  if (!account && !email && !pin) return bad("Add your email or choose a PIN, so you can get back in");
  if (email && !EMAIL_RE.test(email)) return bad("That email address doesn't look right");
  if (pin && !/^\d{4,8}$/.test(pin)) return bad("The PIN must be 4 to 8 numbers");
  let created;
  try {
    created = await createFromWizard(cleanWizard(b.wizard), { pin: pin || null });
  } catch (e) {
    if (e instanceof WizardError) return bad(e.message);
    console.error("[wizard]", e);
    return bad("Couldn't create the tournament just now. Try again.", 500);
  }
  const db = adminClient();
  if (inviteId) await spendInvite(inviteId, created.id).catch(() => {});
  await setSession(created.id, { role: "organiser", name: created.organiser.name, playerId: created.organiser.playerId });
  let emailed = false;
  if (account) await linkTournament(account.id, created.id).catch(() => {});
  else if (email) {
    // Into My tournaments under that email, with a link to sign in on any phone
    let { data: acct } = await db.from("accounts").select("id").ilike("email", email).maybeSingle();
    if (!acct) ({ data: acct } = await db.from("accounts").insert({ email }).select("id").single());
    if (acct) await linkTournament(acct.id, created.id).catch(() => {});
    if (acct && mailConfigured()) {
      const token = newToken();
      const { error } = await db.from("account_tokens").insert({ token_hash: tokenHash(token), email, expires_at: new Date(Date.now() + LINK_MINUTES * 60e3).toISOString() });
      if (!error)
        emailed = await sendOne({ name: BRAND.name }, email, accountLinkEmail(`${siteOrigin(req)}/account/in?token=${token}`))
          .then(() => true)
          .catch(() => false);
    }
  }
  return json({ slug: created.slug, emailed });
}
