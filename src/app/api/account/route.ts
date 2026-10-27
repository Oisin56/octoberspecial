import { adminClient } from "@/lib/admin";
import { clearAccount, getAccount, getSession, isOwnerEmail, setSession, touch } from "@/lib/auth";
import { SignInError, answerOffer, claim, onThisPhone, peekToken, cleanEmail, myGolf, organiserSession, playerSession, redeemCode, redeemToken, sendSignIn, signIn } from "@/lib/accounts";
import { bad, json, siteOrigin, crossSite, CROSS_SITE } from "@/lib/server-data";
import { clientIp, tooFast } from "@/lib/social";
import { consoleEmail } from "@/lib/console-auth";
import { raise } from "@/lib/queue";
import { deleteAccount, soleOrganiserOf } from "@/lib/deleting";
import { accountDeletedMail } from "@/lib/mail/emails";
import { deliver, mailConfigured } from "@/lib/mail/send";

/** Who's signed in, and My golf: the tournaments they run, play in and follow, and anything asking "Is this you?" */
export async function GET() {
  const account = (await touch()) && (await getAccount());
  if (!account) return json({ account: null });
  const golf = await myGolf(account);
  const { data: requests } = await adminClient().from("data_requests").select("kind,created_at,done_at").eq("email", account.email.toLowerCase()).is("done_at", null);
  return json({ account, owner: isOwnerEmail(account.email), console: !!(await consoleEmail(account.email)), ...golf, here: await onThisPhone(account), requests: requests ?? [] });
}

/**
 *   send     {email, next?}   email a sign-in link and a 6-digit code
 *   verify   {token}          sign in from the link (works once, for 30 minutes)
 *   code     {email, code}    sign in with the code from the same email
 *   peek     {token}          who the link is for (the page asks "Sign in as …?" before using it)
 *   answer   {offer, yes}     "Is this you?" on a tournament someone added you to
 *   claim    {tournament}     "Add to My golf": this phone's own role in a tournament joins the signed-in person
 *   signout
 */
export async function POST(req: Request) {
  if (crossSite(req)) return bad(CROSS_SITE, 403);
  const b = await req.json().catch(() => ({}));
  try {
    if (b.action === "send") {
      const email = cleanEmail(b.email);
      if (tooFast(`acct:${clientIp(req)}`, 40, 3600e3) || tooFast(`acct:${email}`, 5, 3600e3)) return bad("Too many sign-in emails. Try again in a while.", 429);
      await sendSignIn(siteOrigin(req), email, { next: b.next });
      return json({ ok: true, sent: true });
    }

    if (b.action === "peek") return json({ email: await peekToken(String(b.token ?? "")) });

    if (b.action === "verify") {
      const { email, next } = await redeemToken(String(b.token ?? ""));
      await signIn(email);
      return json({ ok: true, next });
    }

    if (b.action === "code") {
      const email = cleanEmail(b.email);
      if (tooFast(`code:${clientIp(req)}`, 60, 3600e3)) return bad("Too many tries. Wait a while and ask for a new email.", 429);
      const { next } = await redeemCode(email, String(b.code ?? ""));
      await signIn(email);
      return json({ ok: true, next });
    }

    if (b.action === "signout") {
      await clearAccount();
      return json({ ok: true });
    }

    const account = await getAccount();
    if (!account) return bad("Sign in with your email first", 401);

    if (b.action === "answer") {
      const tid = await answerOffer(account, String(b.offer ?? ""), b.yes === true);
      if (tid) {
        // That's me: this phone gets the role straight away
        const { data: row } = await adminClient().from("account_tournaments").select("role,player_id").eq("account_id", account.id).eq("tournament_id", tid).maybeSingle();
        const here = await getSession(tid);
        const s = row?.role === "organiser" ? await organiserSession(tid, "account", row.player_id) : row?.player_id ? await playerSession(tid, row.player_id, "account") : null;
        if (s && !(here?.role === "organiser" && s.role !== "organiser")) await setSession(tid, s);
      }
      return json({ ok: true, ...(await myGolf(account)), here: await onThisPhone(account) });
    }

    // Your data: a copy of everything held about me, or delete me (the console's Needs you, answered within a month)
    if (b.action === "data") {
      const kind = b.kind === "delete" ? "delete" : b.kind === "copy" ? "copy" : null;
      if (!kind) return bad("Which?");
      const email = account.email.toLowerCase();
      const db = adminClient();
      const { data: open } = await db.from("data_requests").select("id").eq("email", email).eq("kind", kind).is("done_at", null).maybeSingle();
      if (!open) {
        const { data: r } = await db.from("data_requests").insert({ email, kind }).select("id").single();
        if (r)
          await raise({
            kind: "data_request",
            subject: r.id,
            person: email,
            title: kind === "copy" ? `Copy of data for ${email}` : `Delete ${email}`,
            dueAt: new Date(Date.now() + 30 * 864e5).toISOString(),
            detail: { kind },
          });
      }
      const { data: requests } = await db.from("data_requests").select("kind,created_at,done_at").eq("email", email).is("done_at", null);
      return json({ ok: true, requests: requests ?? [] });
    }

    // Delete my account: everything I posted too, or keep my posts up under my name
    if (b.action === "delete") {
      if (b.confirm !== true) return bad("Confirm first");
      const sole = await soleOrganiserOf(account.id);
      if (sole.length)
        return bad(
          `You're the only organiser of ${sole.join(" and ")}. Finish ${sole.length === 1 ? "it" : "them"} first, or add someone to help run ${sole.length === 1 ? "it" : "them"}, then delete your account.`,
          409,
        );
      // The goodbye goes first: afterwards there's no record of the address to send it with
      const bye = mailConfigured() ? await accountDeletedMail(account.email).catch(() => null) : null;
      if (bye) await deliver(bye).catch(() => null);
      await deleteAccount(account, b.keepPosts === true);
      await clearAccount();
      return json({ ok: true, deleted: true });
    }

    if (b.action === "claim") {
      await claim(account, String(b.tournament ?? ""));
      return json({ ok: true, ...(await myGolf(account)), here: await onThisPhone(account) });
    }

    return bad("Unknown action");
  } catch (e) {
    if (e instanceof SignInError) return bad(e.message, e.status);
    console.error("[account]", e);
    return bad("That didn't work just now. Try again.", 500);
  }
}
