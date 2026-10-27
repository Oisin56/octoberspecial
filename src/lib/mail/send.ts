import "server-only";
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { adminClient } from "../admin";
import { recordUsage } from "../usage";
import { pm, postmarkOn, postmarkSetup, setUpPostmark, streamId, type Stream } from "./postmark";
import { sendingAddress, site } from "./settings";

/**
 * Sending, for every email the site sends. Through Postmark once POSTMARK_TOKEN is set, each kind on its own stream;
 * until then through the old mailbox (SMTP), so nothing breaks in between. Every email is written down (email_sends):
 * the console's figures, the weekly limit on marketing, bounces, taps and stops all come from there.
 */

export interface Outgoing {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** What it's counted as in the console ("sign-in", "player link"…) */
  kind: string;
  stream: Stream;
  fromName: string;
  replyTo?: string | null;
  /** Its words' key, for the Every email figures */
  template?: string | null;
  /** A series step, campaign or evening email: sent at most once to a person (per tournament) */
  ref?: string | null;
  tournamentId?: string | null;
  attachments?: { filename: string; content: string; contentType: string; base64?: boolean }[];
  /** One-tap unsubscribe in mail apps (marketing and updates) */
  unsubscribe?: string | null;
  /** Made beforehand when links inside the email carry it */
  sendId?: string;
}

export class NotSent extends Error {
  constructor(
    message: string,
    public why: "blocked" | "stopped" | "already",
  ) {
    super(message);
  }
}

export const newSendId = () => randomUUID();

export function mailConfigured() {
  return postmarkOn() || !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

/** The old mailbox's address (MAIL_FROM, else the login when it's an address). */
export function smtpFrom(): string | null {
  const clean = (v?: string) => (v ?? "").trim().replace(/^["'<]+|["'>]+$/g, "").trim();
  const from = clean(process.env.MAIL_FROM);
  if (from) return from;
  const login = clean(process.env.SMTP_USER);
  return login.includes("@") ? login : null;
}

function smtp() {
  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.mail.me.com",
    port,
    secure: port === 465,
    requireTLS: port === 587 && process.env.SMTP_HOST !== "127.0.0.1",
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
  });
}

/** A display name that can't break the header */
const cleanName = (n: string) => n.replace(/["\r\n<>]/g, "").trim().slice(0, 80) || "MyGolfBroadcast";

// ------------------------------------------------------------ guards

async function blocked(email: string): Promise<boolean> {
  const { emailBlocked } = await import("../email-log");
  return emailBlocked(email);
}

/** Who, of these, may get this kind of email: none of the stopped addresses; updates and marketing as people chose. */
async function allowed(emails: string[], stream: Stream): Promise<Set<string>> {
  const db = adminClient();
  const out = new Set(emails);
  for (let i = 0; i < emails.length; i += 500) {
    const chunk = emails.slice(i, i + 500);
    const { data: b } = await db.from("email_blocks").select("email").in("email", chunk);
    for (const r of b ?? []) out.delete(r.email);
    if (stream === "service") continue;
    const { data: p } = await db.from("people").select("email,marketing_at,marketing_stopped_at,updates_stopped_at").in("email", chunk);
    const by = new Map((p ?? []).map((r) => [r.email, r]));
    for (const e of chunk) {
      const r = by.get(e);
      if (stream === "updates" && r?.updates_stopped_at) out.delete(e);
      if (stream === "marketing" && (!r || !r.marketing_at || r.marketing_stopped_at)) out.delete(e);
    }
    // A deleted account: marketing only if they've said yes again since
    if (stream === "marketing") {
      const { deletedHash } = await import("../deleting");
      const hashes = new Map(chunk.map((e) => [deletedHash(e), e]));
      const { data: gone } = await db.from("deleted_emails").select("hash,at").in("hash", [...hashes.keys()]);
      for (const g of gone ?? []) {
        const e = hashes.get(g.hash)!;
        const yes = by.get(e)?.marketing_at;
        if (!yes || Date.parse(yes) < Date.parse(g.at)) out.delete(e);
      }
    }
  }
  return out;
}

// ------------------------------------------------------------ the record

async function queue(list: Outgoing[]): Promise<Set<string>> {
  const rows = list.map((o) => ({ id: o.sendId!, email: o.to, stream: o.stream, kind: o.kind, template: o.template ?? null, ref: o.ref ?? null, tournament_id: o.tournamentId ?? null }));
  const { data, error } = await adminClient().rpc("email_queue", { rows });
  if (error) {
    // A sign-in code still goes, unrecorded; updates and marketing don't (unrecorded, the limits can't hold)
    console.warn("[email] not recorded:", error.message);
    return new Set(list.filter((o) => o.stream === "service").map((o) => o.sendId!));
  }
  return new Set(((data ?? []) as (string | { email_queue: string })[]).map((r) => (typeof r === "string" ? r : r.email_queue)));
}

async function mark(rows: { id: string; status: "sent" | "failed"; message_id?: string | null; error?: string | null }[]) {
  if (!rows.length) return;
  await adminClient().rpc("email_mark", { rows }).then(
    () => null,
    () => null,
  );
}

async function counted(kind: string, n: number) {
  try {
    await adminClient().rpc("bump", { nm: `email:${kind}`, by_n: n });
    await recordUsage({ service: "email", what: kind, ok: true, cents: 0, units: { emails: n } });
  } catch {
    // counting must never stop an email
  }
}

async function failed(to: string, kind: string, err: unknown) {
  const { emailFailed } = await import("../email-log");
  await emailFailed(to, kind, err);
}

// ------------------------------------------------------------ sending

/** Postmark's streams are made the first time anything is sent (the 10am run and the console do it too). */
let setupTried = 0;
async function ready() {
  if (!postmarkOn() || (await postmarkSetup())) return;
  if (Date.now() - setupTried < 10 * 60e3) return;
  setupTried = Date.now();
  await setUpPostmark(site()).catch((e) => console.error("[email] Postmark set-up:", e instanceof Error ? e.message : e));
}

function postmarkMessage(o: Outgoing, stream: string) {
  const headers: { Name: string; Value: string }[] = [];
  if (o.unsubscribe) {
    headers.push({ Name: "List-Unsubscribe", Value: `<${o.unsubscribe}>` }, { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" });
  }
  return {
    From: `"${cleanName(o.fromName)}" <${sendingAddress(o.stream)}>`,
    To: o.to,
    Subject: o.subject,
    HtmlBody: o.html,
    TextBody: o.text,
    ...(o.replyTo ? { ReplyTo: o.replyTo } : {}),
    Tag: o.kind.slice(0, 1000),
    Headers: headers,
    TrackOpens: false,
    TrackLinks: "None",
    Metadata: { send: o.sendId! },
    MessageStream: stream,
    ...(o.attachments?.length
      ? { Attachments: o.attachments.map((a) => ({ Name: a.filename, Content: a.base64 ? a.content : Buffer.from(a.content, "utf8").toString("base64"), ContentType: a.contentType })) }
      : {}),
  };
}

async function viaSmtp(o: Outgoing) {
  const addr = smtpFrom();
  if (!addr) throw new Error("No sending address: set MAIL_FROM in Vercel (for example hello@mygolfbroadcast.com)");
  await smtp().sendMail({
    from: { name: cleanName(o.fromName), address: addr },
    to: o.to,
    subject: o.subject,
    html: o.html,
    text: o.text,
    ...(o.replyTo ? { replyTo: o.replyTo } : {}),
    ...(o.attachments?.length ? { attachments: o.attachments.map((a) => ({ filename: a.filename, content: a.base64 ? Buffer.from(a.content, "base64") : a.content, contentType: a.contentType })) } : {}),
    ...(o.unsubscribe ? { list: { unsubscribe: { url: o.unsubscribe, comment: "Unsubscribe" } }, headers: { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}),
  });
  return null;
}

/** Send one email. Throws NotSent when the site won't email that address, or the error when sending failed. */
export async function deliver(input: Outgoing): Promise<{ id: string }> {
  const o = { ...input, to: input.to.trim().toLowerCase(), subject: input.subject.replace(/[\r\n]+/g, " "), sendId: input.sendId ?? newSendId() };
  if (await blocked(o.to)) throw new NotSent("The site has stopped emailing this address", "blocked");
  if (o.stream !== "service" && !(await allowed([o.to], o.stream)).has(o.to)) throw new NotSent("They've stopped these emails", "stopped");
  if (!(await queue([o])).has(o.sendId)) throw new NotSent("They've had this one already", "already");
  try {
    let messageId: string | null = null;
    if (postmarkOn()) {
      await ready();
      const r = await pm<{ MessageID?: string }>("/email", { body: postmarkMessage(o, await streamId(o.stream)) });
      messageId = r.MessageID ?? null;
    } else await viaSmtp(o);
    await mark([{ id: o.sendId, status: "sent", message_id: messageId }]);
  } catch (e) {
    await mark([{ id: o.sendId, status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 500) }]);
    await failed(o.to, o.kind, e);
    throw e;
  }
  await counted(o.kind, 1);
  return { id: o.sendId };
}

/**
 * Send many (series, campaigns, the evening email): the stopped and the unwilling are left out, anyone who has had it
 * already is skipped, and the rest go in batches of 100. Returns how many went, and the addresses that failed.
 */
export async function deliverMany(input: Outgoing[], opts: { between?: () => Promise<boolean> } = {}): Promise<{ sent: number; failed: string[]; skipped: number; stopped: boolean }> {
  const list = input.map((o) => ({ ...o, to: o.to.trim().toLowerCase(), subject: o.subject.replace(/[\r\n]+/g, " "), sendId: o.sendId ?? newSendId() }));
  let sent = 0;
  let skipped = 0;
  const bad: string[] = [];
  for (let i = 0; i < list.length; i += 100) {
    if (i > 0 && opts.between && !(await opts.between())) return { sent, failed: bad, skipped, stopped: true };
    const chunk = list.slice(i, i + 100);
    const byStream = new Map<Stream, typeof chunk>();
    for (const o of chunk) byStream.set(o.stream, [...(byStream.get(o.stream) ?? []), o]);
    for (const [stream, group] of byStream) {
      const ok = await allowed([...new Set(group.map((o) => o.to))], stream);
      const willing = group.filter((o) => ok.has(o.to));
      const fresh = await queue(willing);
      const go = willing.filter((o) => fresh.has(o.sendId));
      skipped += group.length - go.length;
      if (!go.length) continue;
      const marks: { id: string; status: "sent" | "failed"; message_id?: string | null; error?: string | null }[] = [];
      if (postmarkOn()) {
        await ready();
        const sid = await streamId(stream);
        try {
          const res = await pm<{ ErrorCode: number; Message: string; MessageID?: string }[]>("/email/batch", { body: go.map((o) => postmarkMessage(o, sid)) });
          go.forEach((o, k) => {
            const r = (res as unknown as { ErrorCode: number; Message: string; MessageID?: string }[])[k];
            if (r && r.ErrorCode === 0) marks.push({ id: o.sendId, status: "sent", message_id: r.MessageID ?? null });
            else marks.push({ id: o.sendId, status: "failed", error: String(r?.Message ?? "No answer").slice(0, 500) });
          });
        } catch (e) {
          for (const o of go) marks.push({ id: o.sendId, status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 500) });
        }
      } else {
        for (const o of go) {
          try {
            await viaSmtp(o);
            marks.push({ id: o.sendId, status: "sent" });
          } catch (e) {
            marks.push({ id: o.sendId, status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 500) });
          }
        }
      }
      await mark(marks);
      const byId = new Map(go.map((o) => [o.sendId, o]));
      const kinds = new Map<string, number>();
      for (const m of marks) {
        const o = byId.get(m.id)!;
        if (m.status === "sent") {
          sent++;
          kinds.set(o.kind, (kinds.get(o.kind) ?? 0) + 1);
        } else {
          bad.push(o.to);
          await failed(o.to, o.kind, new Error(m.error ?? "Failed"));
        }
      }
      for (const [k, n] of kinds) await counted(k, n);
    }
  }
  return { sent, failed: bad, skipped, stopped: false };
}
