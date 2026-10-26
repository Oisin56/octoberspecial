import { adminClient } from "@/lib/admin";
import { EMAIL_RE, inviteRequestEmail, mailConfigured, sendOne } from "@/lib/email";
import { inviteFor } from "@/lib/invites";
import { bad, json, siteOrigin } from "@/lib/server-data";
import { clientIp, tooFast } from "@/lib/social";
import { BRAND } from "@/lib/brand";
import { raise } from "@/lib/queue";
import { consoleAddress } from "@/lib/console-mail";

/**
 *   request  {name, email, about}   ask to run a tournament (the site owner is told by email)
 *   check    {token}                is this invite link still good? (the wizard asks before it starts)
 */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (b.action === "check") {
    const inv = await inviteFor(String(b.token ?? ""));
    return inv ? json({ ok: true, name: inv.name, email: inv.email }) : bad("That invite link has been used or has expired. Ask for a new one.", 410);
  }
  if (b.action !== "request") return bad("Unknown action");
  if (tooFast(`invite:${clientIp(req)}`, 5, 3600e3)) return bad("Too many requests from here. Try again later.", 429);
  const name = String(b.name ?? "").trim().slice(0, 80);
  const email = String(b.email ?? "").trim().toLowerCase().slice(0, 200);
  const about = String(b.about ?? "").trim().slice(0, 600) || null;
  if (!name) return bad("Add your name");
  if (!EMAIL_RE.test(email)) return bad("That email address doesn't look right");
  const db = adminClient();
  // Asked already and still waiting: no second request
  const { data: open } = await db.from("invite_requests").select("id").eq("email", email).eq("status", "new").maybeSingle();
  if (!open) {
    const { data: row, error } = await db.from("invite_requests").insert({ name, email, about }).select("id").single();
    if (error || !row) return bad(/invite_requests/.test(error?.message ?? "") ? "Requests aren't open just yet. Try again soon." : "Couldn't send that just now. Try again.", 500);
    await raise({ kind: "invite", subject: row.id, person: email, title: `Invite request: ${name}`, detail: { about } });
    const to = await consoleAddress();
    // A flood of requests: they all go in Needs you, but the console's inbox hears about the first ten an hour
    const { count: lastHour } = await db.from("invite_requests").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 3600e3).toISOString());
    if ((lastHour ?? 0) > 10) return json({ ok: true });
    if (!to || !mailConfigured()) console.error("[invites] no console email to notify (set OWNER_EMAIL and the SMTP settings)");
    else
      await sendOne({ name: BRAND.name }, to, inviteRequestEmail({ name, email, about }, `${siteOrigin(req)}/console/needs`)).catch((e) =>
        console.error("[invites] couldn't email the console:", e instanceof Error ? e.message : e),
      );
  }
  return json({ ok: true });
}
