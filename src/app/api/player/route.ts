import { after } from "next/server";
import { adminClient } from "@/lib/admin";
import { clearSession, getAccount, getSession } from "@/lib/auth";
import { clearSpot } from "@/lib/deleting";
import { logActivity } from "@/lib/activity";
import { claim, cleanEmail, sendSignIn, SignInError } from "@/lib/accounts";
import { bad, context, json, loadServerState, siteOrigin, crossSite, CROSS_SITE, DEMO_READONLY } from "@/lib/server-data";
import { BIO_FIELDS, bioToAccount, cleanBio, hasBio, type Bio } from "@/lib/bios";
import { EMAIL_RE } from "@/lib/email-re";
import { MARKETING_WORDING } from "@/lib/consent";
import { recordMarketing } from "@/lib/mail/prefs";
import { deliver } from "@/lib/mail/send";
import { filmReadyMail } from "@/lib/mail/emails";
import { clientIp, tooFast } from "@/lib/social";
import { tournamentSummary } from "@/lib/engine";
import { toEntries, toRoundCfg, toTournamentCfg } from "@/lib/types";

/**
 * A player's own asks, on their own phone: the bio ("Complete player bio" or "Later") and their email (asked after
 * their first round and when the film is ready, twice at most).
 *   me                       what to ask now, and their bio as it stands
 *   bio        {bio, done?}  save answers (each screen saves); done: the bio is finished
 *   later                    "Later": asked once more, after their first round
 *   seen       {ask}         an ask was shown ("bioAgain", "round1", "film"), so it isn't shown again
 *   notNow                   "Not now" on an email ask (two and we stop asking)
 *   emailStart {email, marketing?}  the confirm email (a button and a 6-digit code)
 *   emailDone                confirmed (signed in with that email on this phone): the email joins their spot
 */

interface Asks {
  bio?: "later" | "done";
  bioAgain?: boolean;
  emailShown?: string[];
  emailNo?: number;
  pending?: string;
  mkt?: { at: string; wording: string } | null;
  email?: "done";
}

export async function POST(req: Request) {
  if (crossSite(req)) return bad(CROSS_SITE, 403);
  const b = await req.json().catch(() => ({}));
  const { t, session, demo } = await context(req, b);
  if (!t) return bad("Tournament not found", 404);
  if (demo) return bad(DEMO_READONLY, 403);
  const playerId = session?.playerId;
  if (!session || !playerId || session.role === "fan") return bad("This is for players, on their own phone", 403);
  const db = adminClient();
  const { data: p } = await db.from("players").select(`id,name,email,asks,${BIO_FIELDS.join(",")}`).eq("id", playerId).eq("tournament_id", t.id).maybeSingle();
  if (!p) return bad("Player not found", 404);
  const row = p as unknown as { id: string; name: string; email: string | null; asks: Asks | null } & Bio;
  const asks: Asks = row.asks ?? {};
  const setAsks = async (patch: Partial<Asks>) => {
    const next = { ...asks, ...patch };
    await db.from("players").update({ asks: next }).eq("id", playerId).eq("tournament_id", t.id);
    return next;
  };
  const account = await getAccount();
  const joined = async () => {
    if (!account) return false;
    const { data } = await db.from("account_tournaments").select("player_id").eq("account_id", account.id).eq("tournament_id", t.id).maybeSingle();
    return data?.player_id === playerId;
  };

  /** Confirmed: the email joins the spot, they get this trip's round reports, and the film if it's ready */
  async function finishEmail(site: string) {
    if (!account) return false;
    try {
      if (!(await joined())) await claim(account, t!.id);
    } catch (e) {
      if (!(e instanceof SignInError)) throw e;
    }
    const email = account.email.toLowerCase();
    if (!row.email) await db.from("players").update({ email }).eq("id", playerId).eq("tournament_id", t!.id);
    const { data: sub } = await db.from("subscribers").select("id,unsubscribed_at").eq("tournament_id", t!.id).eq("email", email).maybeSingle();
    if (!sub) await db.from("subscribers").insert({ tournament_id: t!.id, email, name: row.name, added_by: "self" });
    if (asks.mkt?.at) await recordMarketing(email, t!.id, asks.mkt.wording, asks.mkt.at, { onlyIfNewer: true }).catch(() => null);
    await setAsks({ email: "done", pending: undefined, mkt: null });
    await bioToAccount(account.id, t!.id, playerId!).catch(() => null);
    const { data: film } = await db.from("reels").select("id").eq("tournament_id", t!.id).eq("status", "done").is("removed_at", null).order("done_at", { ascending: false }).limit(1).maybeSingle();
    if (film)
      after(async () => {
        try {
          await deliver(await filmReadyMail(t!, `${site}/t/${t!.slug}#film`, email));
        } catch {
          /* stopped or blocked: nothing to do */
        }
      });
    return true;
  }

  switch (b.action) {
    case "me": {
      // They tapped the button in the confirm email (signed in with the email they gave): it joins now
      if (account && asks.pending && cleanEmail(asks.pending) === cleanEmail(account.email) && asks.email !== "done") await finishEmail(siteOrigin(req));
      const fresh = (await db.from("players").select(`email,asks,${BIO_FIELDS.join(",")}`).eq("id", playerId).maybeSingle()).data as unknown as ({ email: string | null; asks: Asks | null } & Bio) | null;
      const a: Asks = fresh?.asks ?? {};
      const bio: Bio = Object.fromEntries(BIO_FIELDS.map((f) => [f, fresh?.[f] ?? null]));
      const s = await loadServerState(t.id);
      const sum = tournamentSummary(toTournamentCfg(s), toEntries(s.entries));
      const roundDone = s.rounds.some((r, i) => {
        const cfg = toRoundCfg(r, s.players);
        const gi = cfg.games.findIndex((g) => g.sides.some((sd) => sd.playerIds.includes(playerId)));
        return gi >= 0 && (r.status === "complete" || !!sum.rounds[i]?.games[gi]?.complete);
      });
      const film = s.posts.some((x) => x.author_name === "AI director" && x.kind === "video" && !x.hidden);
      const organiser = session.role === "organiser";
      const hasEmail = !!fresh?.email || (await joined()) || organiser;
      const filled = hasBio(bio);
      const bioDue = filled || a.bio === "done" ? null : !a.bio ? "first" : a.bio === "later" && roundDone && !a.bioAgain ? "again" : null;
      const shown = a.emailShown ?? [];
      const emailDue =
        hasEmail || t.solo || (a.emailNo ?? 0) >= 2 || bioDue
          ? null
          : film && !shown.includes("film")
            ? "film"
            : roundDone && !shown.includes("round1") && !film
              ? "round1"
              : null;
      return json({ bio, bioDue, emailDue, hasEmail, pending: a.pending ?? null, private: t.privacy === "private", solo: !!t.solo });
    }

    case "bio": {
      const patch = cleanBio(b.bio, t.slug);
      if (Object.keys(patch).length) {
        const { error } = await db.from("players").update(patch).eq("id", playerId).eq("tournament_id", t.id);
        if (error) return bad(error.message, 500);
      }
      if (b.done === true) await setAsks({ bio: "done" });
      if (account && (await joined())) await bioToAccount(account.id, t.id, playerId).catch(() => null);
      return json({ ok: true });
    }

    case "later":
      await setAsks({ bio: asks.bio === "done" ? "done" : "later" });
      return json({ ok: true });

    case "seen": {
      const ask = String(b.ask ?? "");
      if (ask === "bioAgain") await setAsks({ bioAgain: true });
      else if (ask === "round1" || ask === "film") await setAsks({ emailShown: [...new Set([...(asks.emailShown ?? []), ask])] });
      return json({ ok: true });
    }

    case "notNow":
      await setAsks({ emailNo: (asks.emailNo ?? 0) + 1 });
      return json({ ok: true });

    case "emailStart": {
      const email = cleanEmail(b.email);
      if (!EMAIL_RE.test(email)) return bad("That doesn't look like an email address. Check it and try again.");
      if (tooFast(`pemail:${clientIp(req)}`, 20, 3600e3) || tooFast(`pemail:${playerId}`, 5, 3600e3)) return bad("Too many emails. Try again in a while.", 429);
      await setAsks({ pending: email, mkt: b.marketing === true ? { at: new Date().toISOString(), wording: MARKETING_WORDING } : null });
      try {
        await sendSignIn(siteOrigin(req), email, { next: `/t/${t.slug}`, intro: `Confirm your email to get each round's report from ${t.name}, and to sign in on any phone or laptop.` });
      } catch (e) {
        if (e instanceof SignInError) return bad(e.message, e.status);
        throw e;
      }
      return json({ ok: true });
    }

    // A player without an email: their details go (the name stays on the scorecards), and their posts if they chose
    case "deleteDetails": {
      if (b.confirm !== true) return bad("Confirm first");
      if (session.role === "organiser") return bad("You run this tournament: delete your account from My golf instead.", 409);
      await clearSpot(playerId, b.keepPosts === true);
      await logActivity({ email: "someone", role: "person" }, "player.details-deleted", { tournamentId: t.id, tournamentName: t.name, detail: { keptPosts: b.keepPosts === true } });
      await clearSession(t.id);
      return json({ ok: true });
    }

    case "emailDone": {
      if (!account) return bad("Type the code from the email first", 401);
      // Still this phone's player (signing in never changes that)
      if ((await getSession(t.id))?.playerId !== playerId) return bad("Sign in on your own phone", 403);
      await finishEmail(siteOrigin(req));
      return json({ ok: true });
    }
  }
  return bad("Unknown action");
}
