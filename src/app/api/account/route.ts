import { adminClient } from "@/lib/admin";
import { clearAccount, getAccount, getSession, isOwnerEmail, setSession, touch } from "@/lib/auth";
import { SignInError, answerOffer, claim, onThisPhone, peekToken, cleanEmail, myGolf, organiserSession, playerSession, redeemCode, redeemToken, sendSignIn, signIn } from "@/lib/accounts";
import { bad, json, siteOrigin, crossSite, CROSS_SITE } from "@/lib/server-data";
import { clientIp, tooFast } from "@/lib/social";

/** Who's signed in, and My golf: the tournaments they run, play in and follow, and anything asking "Is this you?" */
export async function GET() {
  const account = await touch();
  if (!account) return json({ account: null });
  const golf = await myGolf(account);
  return json({ account, owner: isOwnerEmail(account.email), ...golf, here: await onThisPhone(account) });
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
