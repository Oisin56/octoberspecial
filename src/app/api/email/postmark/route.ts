import { timingSafeEqual } from "node:crypto";
import { adminClient } from "@/lib/admin";
import { webhookPassword } from "@/lib/mail/tokens";
import { postmarkSetup, DEFAULT_STREAMS } from "@/lib/mail/postmark";
import { stopEverything } from "@/lib/mail/prefs";
import { emailFailed, forgetBlocked } from "@/lib/email-log";
import { logActivity, SYSTEM } from "@/lib/activity";

export const dynamic = "force-dynamic";

/**
 * Postmark tells the site about bounces, spam complaints and addresses it has stopped, straight away:
 *  - a hard bounce (the address doesn't exist) stops that address for everything
 *  - a spam complaint stops all marketing and updates to them (service emails still go, so they can sign in)
 *  - a soft bounce (a full mailbox) is counted; three in a week puts the address in Needs you
 *  - someone unsubscribing through Postmark's own link stops marketing
 * Postmark signs in with a password made from the site's secret (set when the console sets Postmark up).
 */
function allowed(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  const want = Buffer.from(`Basic ${Buffer.from(`postmark:${webhookPassword()}`).toString("base64")}`);
  const got = Buffer.from(h);
  return got.length === want.length && timingSafeEqual(got, want);
}

// Only an address that doesn't exist stops it for everything; blocks and DMARC failures can be our own doing
const HARD = new Set(["HardBounce", "BadEmailAddress"]);

async function block(email: string, reason: string) {
  const db = adminClient();
  const { data: was } = await db.from("email_blocks").select("email").eq("email", email).maybeSingle();
  if (was) return;
  await db.from("email_blocks").upsert({ email, by_who: "postmark", reason });
  forgetBlocked(email);
  await logActivity(SYSTEM, "email.bounced", { person: email, detail: { reason } });
}

export async function POST(req: Request) {
  if (!allowed(req)) return new Response("Not allowed", { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const db = adminClient();
  const type = String(b.RecordType ?? "");
  const email = String(b.Email ?? b.Recipient ?? "")
    .trim()
    .toLowerCase();
  if (!email.includes("@")) return Response.json({ ok: true });
  const sendId = String((b.Metadata as Record<string, unknown> | undefined)?.send ?? "");
  const messageId = String(b.MessageID ?? "");
  const mark = async (status: string) => {
    if (/^[0-9a-f-]{36}$/i.test(sendId)) await db.from("email_sends").update({ status }).eq("id", sendId).eq("email", email);
    else if (messageId) await db.from("email_sends").update({ status }).eq("message_id", messageId);
  };

  try {
    if (type === "Bounce") {
      const kind = String(b.Type ?? "");
      const hard = HARD.has(kind) || b.Inactive === true;
      if (hard) {
        await mark("bounced");
        await block(email, `Bounced: ${String(b.Description ?? b.Name ?? kind).slice(0, 200)}`);
      } else await emailFailed(email, "bounce", new Error(`${String(b.Name ?? kind)}: ${String(b.Description ?? "").slice(0, 200)}`));
    } else if (type === "SpamComplaint") {
      await mark("complained");
      await stopEverything(email, "spam");
      await logActivity(SYSTEM, "email.spam", { person: email });
    } else if (type === "SubscriptionChange" && b.SuppressSending === true) {
      const reason = String(b.SuppressionReason ?? "");
      const marketing = (await postmarkSetup())?.streams.marketing ?? DEFAULT_STREAMS.marketing;
      if (reason === "HardBounce") await block(email, "Bounced");
      else if (reason === "SpamComplaint") await stopEverything(email, "spam");
      else if (String(b.MessageStream ?? "") === marketing) {
        // Unsubscribed with Postmark's own link (until custom unsubscribes are approved)
        await db.from("people").update({ marketing_stopped_at: new Date().toISOString(), marketing_stopped_reason: "unsubscribed" }).eq("email", email).is("marketing_stopped_at", null);
      } else await block(email, "Stopped in Postmark");
    }
  } catch (e) {
    console.error("[postmark] couldn't record", type, e);
    // Postmark tries again on a failure
    return new Response("Try again", { status: 500 });
  }
  return Response.json({ ok: true });
}
