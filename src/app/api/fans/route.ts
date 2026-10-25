import { adminClient } from "@/lib/admin";
import { bad, context, json, siteOrigin, DEMO_READONLY, crossSite, CROSS_SITE, canSee, fanStatus } from "@/lib/server-data";
import { EMAIL_RE, followApprovedEmail, sendOne } from "@/lib/email";
import { isCrew, isOrganiser, setSession } from "@/lib/auth";
import { SignInError, cleanEmail, sendSignIn, signIn } from "@/lib/accounts";
import { clientIp, tooFast } from "@/lib/social";
import { MARKETING_WORDING } from "@/lib/consent";

const TOKEN = /^[\w-]{20,64}$/;

/**
 * Followers.
 *   profile  {name, how, email?, marketing?, over16}   Friends and family: the first comment or photo asks once for a
 *            name and how they know the group (an email is optional: confirmed by a code, it works on any phone)
 *   ask      {name, how, email, over16}                 Private: ask to follow. The email is confirmed (a code) before
 *            the players see the request
 *   decide   {fanId, decision}                          players and organisers: approve or decline a request;
 *            organisers: remove a follower, stop them commenting (mute) or let them again (unmute)
 *   list                                               players and organisers: who's following, and who's asking
 *   verify   {token}                                    the old emailed join link (still works for links already sent)
 */
export async function POST(req: Request) {
  if (crossSite(req)) return bad(CROSS_SITE, 403);
  const b = await req.json().catch(() => ({}));
  const { t, session, demo } = await context(req, b, { open: true });
  if (!t) return bad("Tournament not found", 404);
  if (demo) return bad(DEMO_READONLY, 403);
  const db = adminClient();
  const origin = siteOrigin(req);

  try {
    if (b.action === "profile" || b.action === "ask") {
      const ask = b.action === "ask";
      if (ask !== (t.privacy === "private")) return bad(ask ? "Anyone with the link can follow this one" : "This tournament is private: ask to follow", 400);
      if (b.website) return json({ ok: true }); // bots fill in the hidden field
      const here = session?.role === "fan" && session.fanId ? session.fanId : null;
      if (isCrew(session)) return bad("You're already in this tournament as a player or organiser");
      const name = String(b.name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
      const how = String(b.how ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
      const email = cleanEmail(b.email);
      if (!name) return bad("Add your name");
      if (ask && !how) return bad("Say how you know the group, so the players know who's asking");
      if ((ask || email) && !EMAIL_RE.test(email)) return bad(ask ? "Add your email: it's how you'll get in" : "That email address doesn't look right");
      if (b.over16 !== true) return bad("You need to be 16 or over to follow");
      if (tooFast(`fan:${clientIp(req)}`, 12, 3600e3)) return bad("Too many from here. Try again later.", 429);
      const marketing = !!email && b.marketing === true ? { marketing_at: new Date().toISOString(), marketing_wording: MARKETING_WORDING } : {};

      // Someone already following (or asking) with this email, confirmed: they get in by confirming it again, never by
      // typing it. Not confirmed yet: after half an hour (the code's run out) whoever typed it before loses it
      // (A private tournament's name is never in these emails: whoever typed the address may not be let in)
      const called = ask ? "the tournament" : t.name;
      const { data: existing } = email ? await db.from("fans").select("id,status,verified_at,created_at").eq("tournament_id", t.id).eq("email", email).maybeSingle() : { data: null };
      if (existing?.verified_at) {
        await sendSignIn(origin, email, { next: `/t/${t.slug}`, intro: `Tap the button to confirm your email and carry on to ${called}.` });
        return json({ ok: true, confirm: true });
      }
      if (existing && existing.id !== here) {
        // Someone else's request with this email, still waiting for its code: theirs stands until the code runs out
        if (Date.now() - new Date(existing.created_at).getTime() < 30 * 60e3) return bad("A code was sent to that email a moment ago. Check the inbox, or try again in half an hour.", 409);
        await db.from("fans").delete().eq("id", existing.id).eq("tournament_id", t.id).is("verified_at", null);
      }
      // Turned down: asking again changes nothing (they still see "waiting")
      const was = here ? await fanStatus(t.id, here) : null;
      const status = was === "declined" ? "declined" : ask ? "asking" : "approved";
      const row = { name, how_known: how || null, email: email || null, verified_at: null, status, ...marketing };
      let fanId: string;
      if (here) {
        // Changing what this phone said before (still waiting, say)
        await db.from("fans").update(row).eq("id", here).eq("tournament_id", t.id);
        fanId = here;
      } else {
        const { data, error } = await db.from("fans").insert({ tournament_id: t.id, ...row }).select("id").single();
        if (error || !data) return bad(/column|null value/.test(error?.message ?? "") ? "This needs the latest database update (schema.sql)" : "Couldn't save that just now. Try again.", 500);
        fanId = data.id;
      }
      await setSession(t.id, { role: "fan", name, fanId });
      if (email) {
        await sendSignIn(origin, email, {
          next: `/t/${t.slug}`,
          intro: ask ? `To ask to follow, confirm your email. Tap the button, or type the code where you asked.` : `Confirm your email to comment on ${t.name} from any phone, and to get the trip film.`,
        });
      }
      return json({ ok: true, confirm: !!email });
    }

    if (b.action === "verify") {
      const token = String(b.token ?? "");
      if (!TOKEN.test(token)) return bad("That link isn't complete. Open it from the email again.");
      const { data: fan } = await db.from("fans").select("id,name,email,blocked,status,token_expires").eq("tournament_id", t.id).eq("token", token).maybeSingle();
      if (!fan || !fan.token_expires || new Date(fan.token_expires).getTime() < Date.now()) return bad("That link has expired. Ask for a new one from the feed.", 410);
      if (fan.blocked || fan.status === "removed") return bad("This email can't join the conversation.", 403);
      await db.from("fans").update({ verified_at: new Date().toISOString(), token: null }).eq("id", fan.id);
      if (fan.email) await signIn(fan.email).catch(() => null);
      if (!isCrew(session)) await setSession(t.id, { role: "fan", name: fan.name, fanId: fan.id });
      return json({ ok: true, name: fan.name, crew: isCrew(session) });
    }

    // ---- players and organisers only from here
    if (!isCrew(session) || !(await canSee(t, session))) return bad("Players and organisers only", 403);

    if (b.action === "list") return json(await following(t.id, isOrganiser(session)));

    if (b.action === "decide") {
      const fanId = String(b.fanId ?? "");
      const d = String(b.decision ?? "");
      const { data: fan } = await db.from("fans").select("id,name,email,status,verified_at").eq("id", fanId).eq("tournament_id", t.id).maybeSingle();
      if (!fan) return bad("Not found", 404);
      const by = session!.name;
      const at = new Date().toISOString();
      if (d === "approve" || d === "decline") {
        if (fan.status !== "asking" && !(d === "approve" && fan.status === "declined")) return bad("That's been answered already", 409);
        await db.from("fans").update({ status: d === "approve" ? "approved" : "declined", decided_by: by, decided_at: at }).eq("id", fan.id);
        // They're told when they're let in (never when they're not)
        if (d === "approve" && fan.email && fan.verified_at) await sendOne(t, fan.email, followApprovedEmail(t, fan.name, `${origin}/t/${t.slug}`)).catch(() => null);
      } else if (d === "remove" || d === "mute" || d === "unmute") {
        if (!isOrganiser(session)) return bad("Only organisers can do that", 403);
        const patch = d === "remove" ? { status: "removed", decided_by: by, decided_at: at } : { blocked: d === "mute" };
        await db.from("fans").update(patch).eq("id", fan.id);
      } else return bad("Unknown decision");
      return json({ ok: true, ...(await following(t.id, isOrganiser(session))) });
    }

    return bad("Unknown action");
  } catch (e) {
    if (e instanceof SignInError) return bad(e.message, e.status);
    console.error("[fans]", e);
    return bad("That didn't work just now. Try again.", 500);
  }
}

/** Who's following: everyone who gave a name, the people asking (only once their email is confirmed), and a count of
 *  everyone else watching. */
async function following(tournamentId: string, organiser: boolean) {
  const db = adminClient();
  const { data: rows } = await db
    .from("fans")
    .select("id,name,how_known,status,blocked,verified_at,email,created_at")
    .eq("tournament_id", tournamentId)
    .order("created_at", { ascending: true });
  const { count } = await db.from("viewers").select("device", { count: "exact", head: true }).eq("tournament_id", tournamentId);
  const fans = (rows ?? []).map((f) => ({ id: f.id, name: f.name, how: f.how_known, status: f.status, muted: !!f.blocked, confirmed: !!f.verified_at || !f.email, since: f.created_at }));
  return {
    following: fans.filter((f) => f.status === "approved"),
    asking: fans.filter((f) => f.status === "asking" && f.confirmed),
    others: count ?? 0,
    organiser,
  };
}
