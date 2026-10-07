import "server-only";
import nodemailer from "nodemailer";
import { createHash } from "node:crypto";
import { adminClient } from "./admin";
import { paletteFor } from "./themes";
import type { AiPieceRow, TournamentRow } from "./types";
import { COURSE_PHOTOS } from "@/data/course-photos";
import { mediaUrl } from "./supabase";
import { cleanBody, cleanTitle } from "./cleanText";

/**
 * Email: previews and reports to subscribers, sent from the organiser's own mailbox
 * over SMTP (iCloud by default: smtp.mail.me.com with an app-specific password).
 */

export function mailConfigured() {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

function transport() {
  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.mail.me.com",
    port,
    secure: port === 465,
    requireTLS: port === 587 && process.env.SMTP_HOST !== "127.0.0.1",
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
  });
}

function fromHeader(t: Pick<TournamentRow, "name">) {
  // iCloud only sends from your own address, so the name carries the branding
  const addr = process.env.MAIL_FROM || process.env.SMTP_USER!;
  return { name: t.name, address: addr };
}

export const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;

export function ipHash(ip: string) {
  return createHash("sha256").update(`${process.env.SESSION_SECRET ?? ""}:${ip}`).digest("hex").slice(0, 32);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Same rule as the site: a short line with no full stop is a subheading. */
function blocks(body: string): { head?: string; text?: string }[] {
  const out: { head?: string; text?: string }[] = [];
  for (const p of cleanBody(body).split(/\n\s*\n/).filter((x) => x.trim())) {
    const [first, ...rest] = p.split("\n");
    if (first.trim() && first.length < 60 && !/[.!?:,"”']$/.test(first.trim())) {
      out.push({ head: first.trim() });
      if (rest.join(" ").trim()) out.push({ text: rest.join(" ").trim() });
    } else out.push({ text: p.replace(/\n/g, " ").trim() });
  }
  return out;
}

export function pieceEmail(
  t: TournamentRow,
  piece: Pick<AiPieceRow, "kind" | "title" | "body">,
  opts: { label: string; link: string; linkLabel: string; unsubscribe: string; site: string; image?: { src: string; alt: string; credit?: string } | null },
) {
  const p = paletteFor(t.theme, t.custom_colors);
  const title = cleanTitle(piece.title ?? "") || opts.label;
  const bodyHtml = blocks(piece.body)
    .map((b) =>
      b.head
        ? `<h2 style="font-family:Arial Narrow,Arial,sans-serif;font-size:20px;color:${p.board};margin:22px 0 4px">${esc(b.head)}</h2>`
        : `<p style="margin:0 0 14px;font-size:17px;line-height:1.55">${esc(b.text!)}</p>`,
    )
    .join("");
  const html = `<!doctype html><html><body style="margin:0;background:${p.mist};font-family:Georgia,'Times New Roman',serif;color:${p.ink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${p.mist}"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:${p.board};color:${p.tile};padding:18px 24px;font-family:Arial Narrow,Arial,sans-serif;font-size:24px;font-weight:bold">${esc(t.name)}</td></tr>
${opts.image ? `<tr><td style="padding:0"><img src="${esc(opts.image.src)}" alt="${esc(opts.image.alt)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0">${opts.image.credit ? `<div style="font-family:Arial,sans-serif;font-size:11px;color:#888;padding:4px 24px 0">${esc(opts.image.credit)}</div>` : ""}</td></tr>` : ""}
<tr><td style="padding:22px 24px 8px">
<div style="font-family:Arial Narrow,Arial,sans-serif;font-size:14px;text-transform:uppercase;letter-spacing:1px;color:${p.red}">${esc(opts.label)}</div>
<h1 style="font-family:Arial Narrow,Arial,sans-serif;font-size:28px;line-height:1.15;margin:6px 0 16px;color:${p.ink}">${esc(title)}</h1>
${bodyHtml}
<p style="margin:22px 0 8px"><a href="${esc(opts.link)}" style="display:inline-block;background:${p.board};color:${p.tile};text-decoration:none;font-family:Arial,sans-serif;font-weight:bold;padding:12px 18px;border-radius:6px">${esc(opts.linkLabel)}</a></p>
</td></tr>
<tr><td style="padding:14px 24px 20px;font-family:Arial,sans-serif;font-size:12px;color:#666;border-top:1px solid ${p.mist}">
You're getting this because you signed up for updates from ${esc(t.name)} at <a href="${esc(opts.site)}" style="color:#666">${esc(opts.site.replace(/^https?:\/\//, ""))}</a>.
<a href="${esc(opts.unsubscribe)}" style="color:#666">Unsubscribe</a>.
</td></tr></table></td></tr></table></body></html>`;
  const text = `${t.name}\n${opts.label}\n\n${title}\n\n${piece.body}\n\n${opts.linkLabel}: ${opts.link}\n\nUnsubscribe: ${opts.unsubscribe}\n`;
  return { subject: `${title} | ${t.name}`, html, text };
}

export function welcomeEmail(t: TournamentRow, name: string | null, opts: { link: string; unsubscribe: string }) {
  const p = paletteFor(t.theme, t.custom_colors);
  const hi = name ? `Hi ${esc(name)},` : "Hi,";
  const html = `<!doctype html><html><body style="margin:0;background:${p.mist};font-family:Georgia,serif;color:${p.ink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:8px;overflow:hidden">
<tr><td style="background:${p.board};color:${p.tile};padding:18px 24px;font-family:Arial Narrow,Arial,sans-serif;font-size:24px;font-weight:bold">${esc(t.name)}</td></tr>
<tr><td style="padding:22px 24px;font-size:17px;line-height:1.55">
<p>${hi}</p><p>You're signed up. The previews and match reports will arrive here as they're published.</p>
<p><a href="${esc(opts.link)}" style="color:${p.board};font-weight:bold">Follow it live</a></p>
<p style="font-size:12px;color:#666;font-family:Arial,sans-serif">Didn't sign up, or changed your mind? <a href="${esc(opts.unsubscribe)}" style="color:#666">Unsubscribe</a>.</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `${hi}\n\nYou're signed up for ${t.name}. The previews and match reports will arrive here as they're published.\n\nFollow it live: ${opts.link}\n\nUnsubscribe: ${opts.unsubscribe}\n`;
  return { subject: `You're signed up: ${t.name}`, html, text };
}

export async function sendOne(t: TournamentRow, to: string, msg: { subject: string; html: string; text: string }, unsubscribe?: string) {
  await transport().sendMail({
    from: fromHeader(t),
    to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    ...(unsubscribe
      ? { list: { unsubscribe: { url: unsubscribe, comment: "Unsubscribe" } }, headers: { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }
      : {}),
  });
}

const LABEL: Record<AiPieceRow["kind"], string> = { preview: "Preview", report: "Match report", tournament: "Tournament review", bulletin: "Live bulletin" };

/** Email a published piece to every active subscriber. Returns how many were sent. */
export async function emailPiece(t: TournamentRow, pieceId: string, site: string, onlyTo?: string) {
  const db = adminClient();
  const { data: piece } = await db.from("ai_pieces").select("*").eq("id", pieceId).eq("tournament_id", t.id).single();
  if (!piece) throw new Error("Piece not found");
  const round = piece.round_id ? (await db.from("rounds").select("number,course_slug,course_name,photo_path").eq("id", piece.round_id).single()).data : null;
  // Course photo at the top: the organiser's upload, else the credited free-licence photo via the site's image service
  let image: { src: string; alt: string; credit?: string } | null = null;
  if (round?.photo_path) image = { src: mediaUrl(round.photo_path)!, alt: round.course_name };
  else if (round) {
    const ph = COURSE_PHOTOS[String(round.course_slug).replace(/^local:/, "")];
    if (ph) image = { src: `${site}/_next/image?url=${encodeURIComponent(ph.src)}&w=1200&q=75`, alt: ph.alt, credit: `Photo © ${ph.author}, ${ph.licence}` };
  }
  const label = piece.kind === "preview" && !round ? "Tournament preview" : `${LABEL[piece.kind as AiPieceRow["kind"]]}${round ? ` · Round ${round.number}` : ""}`;
  const base = `${site}/t/${t.slug}`;
  const link = round ? `${base}/rounds/${round.number}` : base;
  const linkLabel = piece.kind === "report" || piece.kind === "tournament" ? "See the scorecards and standings" : "Follow it live";

  let list: { email: string; token: string }[];
  if (onlyTo) list = [{ email: onlyTo, token: "test" }];
  else {
    const { data } = await db.from("subscribers").select("email,token").eq("tournament_id", t.id).is("unsubscribed_at", null);
    list = data ?? [];
  }
  let sent = 0;
  const failed: string[] = [];
  for (const s of list) {
    const unsubscribe = `${site}/api/unsubscribe?token=${s.token}`;
    try {
      await sendOne(t, s.email, pieceEmail(t, piece, { label, link, linkLabel, unsubscribe, site, image }), unsubscribe);
      sent++;
    } catch {
      failed.push(s.email);
    }
  }
  if (!onlyTo) await db.from("ai_pieces").update({ emailed_at: new Date().toISOString(), emailed_count: sent }).eq("id", pieceId);
  return { sent, failed };
}
