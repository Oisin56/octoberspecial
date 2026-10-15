import { BRAND } from "./brand";
import "server-only";
import nodemailer from "nodemailer";
import { createHash } from "node:crypto";
import { adminClient } from "./admin";
import { paletteFor } from "./themes";
import type { AiPieceRow, TournamentRow } from "./types";
import { coursePhotoFor } from "@/data/course-photos";
import { mediaUrl } from "./supabase";
import { cleanBody, cleanTitle } from "./cleanText";
import { newsletterEmail, type NewsletterData } from "./newsletter";
import { loadServerState } from "./server-data";
import { courseInfo, forecast } from "./ai";
import { roundPointsAvailable, tournamentSummary } from "./engine";
import { totalsView } from "./live";
import { SIDE_GAME_LABEL, formatLabel, sideLabel, toEntries, toRoundCfg, toTournamentCfg } from "./types";

/**
 * Email: previews and reports to subscribers, sent from the organiser's own mailbox
 * over SMTP (iCloud by default: smtp.mail.me.com with an app-specific password).
 */

/** What the site sends email through (no passwords or keys): for the owner page and the setup check. */
export function mailSetup() {
  return {
    host: process.env.SMTP_HOST || "smtp.mail.me.com (default)",
    port: Number(process.env.SMTP_PORT || 587),
    from: fromAddress(),
    login: !!process.env.SMTP_USER,
    password: !!process.env.SMTP_PASS,
  };
}

/** A plain test message, so the site owner can see sending work (or the exact reason it doesn't). */
export function testEmail(site: string) {
  const text = `This is a test from ${BRAND.name}. If you can read it, the site can send email.\n\n${site}\n`;
  return { subject: `Test email from ${BRAND.name}`, html: brandEmail([`This is a test from ${BRAND.name}. If you can read it, the site can send email.`], { label: "Open the site", href: site }), text };
}

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

/** The address emails come from: MAIL_FROM (tidied of stray quotes and spaces), else the login if that's an address. */
export function fromAddress(): string | null {
  const clean = (v?: string) => (v ?? "").trim().replace(/^["'<]+|["'>]+$/g, "").trim();
  const from = clean(process.env.MAIL_FROM);
  if (from) return from;
  const login = clean(process.env.SMTP_USER);
  return login.includes("@") ? login : null;
}

function fromHeader(t: Pick<TournamentRow, "name">) {
  // The tournament's name carries the branding; the address is the site's
  const addr = fromAddress();
  if (!addr) throw new Error("No sending address: set MAIL_FROM in Vercel (for example hello@mygolfbroadcast.com)");
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

/** A follower joining the conversation: one tap signs them in (no password). */
export function fanLinkEmail(t: TournamentRow, name: string, link: string) {
  const p = paletteFor(t.theme, t.custom_colors);
  const html = `<!doctype html><html><body style="margin:0;background:${p.mist};font-family:Georgia,serif;color:${p.ink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:8px;overflow:hidden">
<tr><td style="background:${p.board};color:${p.tile};padding:18px 24px;font-family:Arial Narrow,Arial,sans-serif;font-size:24px;font-weight:bold">${esc(t.name)}</td></tr>
<tr><td style="padding:22px 24px;font-size:17px;line-height:1.55">
<p>Hi ${esc(name)},</p><p>Tap the button to join the conversation. You can then share photos, comment and like from this phone or computer.</p>
<p style="margin:26px 0"><a href="${esc(link)}" style="display:inline-block;background:${p.board};color:${p.tile};text-decoration:none;font-family:Arial,sans-serif;font-weight:bold;font-size:19px;padding:16px 28px;border-radius:10px">Join the conversation</a></p>
<p style="font-size:13px;color:#666;font-family:Arial,sans-serif">The button works for 2 days. Didn't ask for this? Ignore this email and nothing happens.</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `Hi ${name},\n\nOpen this link to join the conversation on ${t.name}. You can then share photos, comment and like.\n\n${link}\n\nThe link works for 2 days. Didn't ask for this? Ignore this email and nothing happens.\n`;
  return { subject: `Join the conversation: ${t.name}`, html, text };
}

/** An organiser signing in to see their tournaments. */
export function accountLinkEmail(link: string) {
  const html = `<!doctype html><html><body style="margin:0;background:#e4e9e5;font-family:Georgia,serif;color:#18231d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:8px;overflow:hidden">
<tr><td style="background:#1f3d2b;color:#f7f7f2;padding:18px 24px;font-family:Arial Narrow,Arial,sans-serif;font-size:24px;font-weight:bold">${BRAND.name}</td></tr>
<tr><td style="padding:22px 24px;font-size:17px;line-height:1.55">
<p>Tap the button to sign in and see your tournaments.</p>
<p style="margin:26px 0"><a href="${esc(link)}" style="display:inline-block;background:#1f3d2b;color:#f7f7f2;text-decoration:none;font-family:Arial,sans-serif;font-weight:bold;font-size:19px;padding:16px 28px;border-radius:10px">Sign in</a></p>
<p style="font-size:13px;color:#666;font-family:Arial,sans-serif">The button works once, for 30 minutes. Didn't ask for this? Ignore this email and nothing happens.</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `Open this link to sign in to ${BRAND.name} and see your tournaments:\n\n${link}\n\nIt works once, for 30 minutes. Didn't ask for this? Ignore this email and nothing happens.\n`;
  return { subject: `Sign in to ${BRAND.name}`, html, text };
}

/** A plain brand email: a heading, a few paragraphs and one big button. */
function brandEmail(paras: string[], button: { label: string; href: string } | null, foot?: string) {
  return `<!doctype html><html><body style="margin:0;background:#e4e9e5;font-family:Georgia,serif;color:#18231d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:8px;overflow:hidden">
<tr><td style="background:#1f3d2b;color:#f7f7f2;padding:18px 24px;font-family:Arial Narrow,Arial,sans-serif;font-size:24px;font-weight:bold">${BRAND.name}</td></tr>
<tr><td style="padding:22px 24px;font-size:17px;line-height:1.55">
${paras.map((x) => `<p>${esc(x)}</p>`).join("\n")}
${button ? `<p style="margin:26px 0"><a href="${esc(button.href)}" style="display:inline-block;background:#1f3d2b;color:#f7f7f2;text-decoration:none;font-family:Arial,sans-serif;font-weight:bold;font-size:19px;padding:16px 28px;border-radius:10px">${esc(button.label)}</a></p>` : ""}
${foot ? `<p style="font-size:13px;color:#666;font-family:Arial,sans-serif">${esc(foot)}</p>` : ""}
</td></tr></table></td></tr></table></body></html>`;
}

/** Someone asked to run their own tournament: a note to the site owner. */
export function inviteRequestEmail(r: { name: string; email: string; about: string | null }, ownerLink: string) {
  const lines = [`${r.name} (${r.email}) would like to run a tournament.`, r.about ? `About it: ${r.about}` : "They didn't say anything about it."];
  return {
    subject: `Invite request: ${r.name}`,
    html: brandEmail(lines, { label: "See requests", href: ownerLink }),
    text: `${lines.join("\n\n")}\n\nApprove or decline on the owner page: ${ownerLink}\n`,
  };
}

/** The site owner said yes: a link that opens the setup wizard, for one tournament. */
export function inviteApprovedEmail(name: string, link: string) {
  const first = name.split(" ")[0];
  const lines = [`Hi ${first},`, `You're in. Tap the button to set up your tournament: a few quick questions, and your site is ready to share with your players.`];
  const foot = "The link works for one tournament. Keep this email until you've used it.";
  return {
    subject: `You're invited to ${BRAND.name}`,
    html: brandEmail(lines, { label: "Set up my tournament", href: link }, foot),
    text: `${lines.join("\n\n")}\n\n${link}\n\n${foot}\n`,
  };
}

/** The organiser's film is ready. */
export function filmReadyEmail(t: Pick<TournamentRow, "name">, link: string) {
  const html = `<!doctype html><html><body style="margin:0;background:#e4e9e5;font-family:Georgia,serif;color:#18231d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:8px;overflow:hidden">
<tr><td style="background:#1f3d2b;color:#f7f7f2;padding:18px 24px;font-family:Arial Narrow,Arial,sans-serif;font-size:24px;font-weight:bold">${esc(t.name)}</td></tr>
<tr><td style="padding:22px 24px;font-size:17px;line-height:1.55">
<p>Your film is ready. It's in Highlights for everyone, and you can share it from there.</p>
<p style="margin:26px 0"><a href="${esc(link)}" style="display:inline-block;background:#1f3d2b;color:#f7f7f2;text-decoration:none;font-family:Arial,sans-serif;font-weight:bold;font-size:19px;padding:16px 28px;border-radius:10px">Watch the film</a></p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `Your film of ${t.name} is ready. It's in Highlights for everyone, and you can share it from there:\n\n${link}\n`;
  return { subject: `Your film is ready: ${t.name}`, html, text };
}

export async function sendOne(t: Pick<TournamentRow, "name">, to: string, msg: { subject: string; html: string; text: string }, unsubscribe?: string) {
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
/** Gather everything the newsletter shows, from the live tournament state. */
export async function buildNewsletter(t: TournamentRow, piece: AiPieceRow, site: string, unsubscribe: string, issue: number) {
  const st = await loadServerState(t.id);
  const cfg = toTournamentCfg(st);
  const summary = tournamentSummary(cfg, toEntries(st.entries));
  const round = piece.round_id ? st.rounds.find((r) => r.id === piece.round_id) ?? null : null;
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : Math.abs(n - Math.floor(n) - 0.5) < 1e-9 ? `${Math.floor(n)}½` : n.toFixed(1));
  const base = `${site}/t/${t.slug}`;

  // Hero image: the round's photo, else the tournament header, else round 1's
  const photoFor = (r: { course_slug: string; course_name: string; photo_path?: string | null } | null) => {
    if (!r) return null;
    if (r.photo_path) return { src: mediaUrl(r.photo_path)!, alt: r.course_name };
    const ph = coursePhotoFor(String(r.course_slug), r.course_name);
    return ph ? { src: `${site}/_next/image?url=${encodeURIComponent(ph.src)}&w=1200&q=75`, alt: ph.alt, credit: `Photo © ${ph.author}, ${ph.licence}` } : null;
  };
  const hero = photoFor(round) ?? (t.hero_path ? { src: mediaUrl(t.hero_path)!, alt: t.name } : null) ?? photoFor(st.rounds[0] ?? null);

  // Standings
  const totals = totalsView(st, summary);
  const teamMode = cfg.teams.length >= 2;
  const useProjected = !summary.complete;
  const rows = (teamMode
    ? cfg.teams.map((tm) => ({ id: tm.id, name: tm.name, v: useProjected ? summary.teamProjected[tm.id] : summary.teamTotal[tm.id] }))
    : cfg.players.map((p) => ({ id: p.id, name: p.name, v: useProjected ? summary.playerProjected[p.id] : summary.playerTotal[p.id] }))
  ).sort((a, b) => b.v - a.v);
  const best = rows[0]?.v ?? 0;
  const leaders = rows.filter((r) => r.v === best);
  const second = rows.find((r) => r.v < best)?.v ?? 0;
  const anyPoints = rows.some((r) => r.v > 0);
  const leadLine = !anyPoints ? null : leaders.length > 1 ? "level at the top" : `leads by ${fmt(best - second)}`;
  const duel = rows.length === 2 ? (teamMode ? cfg.teams.map((tm) => rows.find((r) => r.id === tm.id)!) : cfg.players.map((p) => rows.find((r) => r.id === p.id)!)) : null;
  const total = summary.pointsAvailable || 1;

  const nameOf = (id: string) => cfg.teams.find((x) => x.id === id)?.name ?? cfg.players.find((x) => x.id === id)?.name ?? id;
  const awards = summary.awards
    .filter((a) => ["ctp", "ld", "gir"].includes(a.kind))
    .map((a) => {
      const ids = Object.keys(a.counts);
      const top = Math.max(0, ...ids.map((i) => a.counts[i]));
      const lead = ids.filter((i) => a.counts[i] === top);
      return {
        label: SIDE_GAME_LABEL[a.kind as keyof typeof SIDE_GAME_LABEL],
        value: ids.length <= 2 ? ids.map((i) => a.counts[i]).join(" – ") : top ? `${nameOf(lead[0])} ${top}` : "None yet",
        note: top === 0 ? "none yet" : lead.length > 1 ? "level" : `${nameOf(lead[0])} ahead`,
      };
    });

  // Round card (previews and reports)
  let roundCard: NewsletterData["roundCard"] = null;
  let results: NewsletterData["results"] = null;
  if (round) {
    const rc = toRoundCfg(round, st.players);
    const info = courseInfo(round);
    const card: [string, string][] = [["Course", `${round.course_name}${info.location ? `, ${info.location}` : ""}`]];
    card.push(["Format", `${formatLabel(round)} · ${fmt(roundPointsAvailable(rc))} points`]);
    if (round.play_date)
      card.push([piece.kind === "report" ? "Played" : "Tee time", `${new Date(round.play_date + "T12:00:00").toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long" })}${round.tee_time ? `, ${round.tee_time.slice(0, 5)}` : ""}`]);
    if (piece.kind === "preview" && round.status !== "complete") {
      const days = round.play_date ? (new Date(round.play_date + "T12:00:00").getTime() - Date.now()) / 864e5 : 99;
      if (days > -1 && days < 6) {
        const f = await forecast(info.lat, info.lon, round.course_name, round.play_date);
        if (!/unavailable/i.test(f)) card.push(["Forecast", f.replace(/^[^:]+:\s*/, "").replace(/\.$/, "")]);
      }
    }
    const sig = info.guide?.signature?.match(/^[^.]+\./)?.[0];
    if (sig && piece.kind === "preview") card.push(["Hole to watch", sig]);
    roundCard = { heading: `Round ${round.number} at a glance`, rows: card };

    if (piece.kind === "report") {
      const ri = st.rounds.indexOf(round);
      const rs = summary.rounds[ri];
      const out: [string, string, string][] = [];
      rc.games.forEach((g, gi) => {
        const gs = rs?.games[gi];
        if (!gs) return;
        const side = (id: string) => sideLabel(id, g, st.players);
        const prefix = rc.games.length > 1 ? `${g.name ?? `Match ${gi + 1}`}: ` : "";
        const segs: [string, typeof gs.front][] = rc.scoring === "skins" ? [["Skins", gs.full]] : [["Front 9", gs.front], ["Back 9", gs.back], ["18 holes", gs.full]];
        for (const [label, seg] of segs) {
          if (!seg.holesPlayed) continue;
          const res = seg.matchLabel ?? seg.ranking.map((r) => `${side(r.sideId)} ${fmt(r.value)}`).join(" · ");
          const won = Object.entries(seg.points).filter(([, v]) => v > 0).map(([id, v]) => `${side(id)} +${fmt(v)}`).join(", ");
          out.push([prefix + label, res, seg.complete ? won || "—" : "in play"]);
        }
      });
      const tal = rs?.tallies;
      if (tal) {
        const line = (k: "ctp" | "ld" | "gir" | "birdies") =>
          cfg.players.map((p) => `${p.name} ${tal[k][p.id] ?? 0}`).join(" · ");
        out.push(["CTP", line("ctp"), ""], ["Long drive", line("ld"), ""], ["GIR", line("gir"), ""], ["Birdies", line("birdies"), ""]);
      }
      results = { heading: `Round ${round.number} results`, rows: out };
    }
  }

  // Highlight clip from the round (most votes, else latest)
  let highlight: NewsletterData["highlight"] = null;
  if (round) {
    const clips = st.posts.filter((p) => p.round_id === round.id && p.kind === "video" && p.media_path && !p.hidden && p.visibility !== "report" && !(p.body ?? "").startsWith("Highlights reel"));
    if (clips.length) {
      const votes = (id: string) => st.votes.filter((v) => v.post_id === id).length;
      const c = [...clips].sort((a, b) => votes(b.id) - votes(a.id) || b.created_at.localeCompare(a.created_at))[0];
      const who = (c.player_ids ?? []).map((id) => st.players.find((p) => p.id === id)?.name).filter(Boolean).join(" & ") || c.author_name;
      highlight = { caption: `${c.hole ? `Hole ${c.hole} · ` : ""}${who}${c.body ? `: ${c.body.slice(0, 60)}` : ""}`, link: `${base}/highlights?round=${round.number}` };
    }
  }

  const label = piece.kind === "preview" && !round ? "Tournament preview" : `${LABEL[piece.kind]}${round ? ` · Round ${round.number}` : ""}`;
  const data: NewsletterData = {
    tournamentName: t.name,
    palette: paletteFor(t.theme, t.custom_colors),
    logo: mediaUrl(t.logo_path),
    issue,
    dateLabel: new Date().toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" }),
    label,
    kind: piece.kind,
    title: piece.title ?? label,
    body: piece.body,
    hero,
    standings: totals
      ? totals.rows.slice(0, 6).map((r) => ({ name: `${r.pos ? `${r.pos}. ` : ""}${r.name}`, value: r.score, lead: !!r.pos && r.pos === "1" }))
      : rows.slice(0, 6).map((r) => ({ name: r.name, value: fmt(r.v), lead: anyPoints && leaders.length === 1 && r.id === leaders[0].id })),
    standingsTitle: totals
      ? `${summary.complete ? "Final: " : ""}${totals.title}`
      : summary.complete ? "Final standings" : anyPoints ? "Overall points" : `${fmt(summary.pointsAvailable)} points to play for`,
    leadLine: totals ? null : leadLine,
    tug: !totals && duel && anyPoints ? { left: duel[0].name, right: duel[1].name, leftPct: (duel[0].v / total) * 100, rightPct: (duel[1].v / total) * 100, target: `${fmt(total / 2 + 0.5)} wins it` } : null,
    awards: anyPoints ? awards : [],
    roundCard,
    results,
    highlight,
    links: {
      primary: { label: round && piece.kind === "report" ? "Full scorecard" : "Follow it live", href: round ? `${base}/rounds/${round.number}` : base },
      secondary: { label: "Leaderboard", href: `${base}/leaderboard` },
    },
    siteHref: base,
    siteLabel: base.replace(/^https?:\/\//, ""),
    promoHref: site,
    unsubscribe,
  };
  return newsletterEmail(data);
}

/** Email a published piece to every active subscriber. Returns how many were sent. */
export async function emailPiece(t: TournamentRow, pieceId: string, site: string, onlyTo?: string) {
  const db = adminClient();
  const { data: piece } = await db.from("ai_pieces").select("*").eq("id", pieceId).eq("tournament_id", t.id).single();
  if (!piece) throw new Error("Piece not found");
  const { count } = await db.from("ai_pieces").select("id", { count: "exact", head: true }).eq("tournament_id", t.id).not("emailed_at", "is", null);
  const issue = (count ?? 0) + (piece.emailed_at ? 0 : 1);

  let list: { email: string; token: string }[];
  if (onlyTo) list = [{ email: onlyTo, token: "test" }];
  else {
    const { data } = await db.from("subscribers").select("email,token").eq("tournament_id", t.id).is("unsubscribed_at", null);
    list = data ?? [];
  }
  // Build once; only the unsubscribe link differs per person
  const marker = "__UNSUB__";
  const tpl = await buildNewsletter(t, piece as AiPieceRow, site, marker, issue);
  let sent = 0;
  const failed: string[] = [];
  for (const s of list) {
    const unsubscribe = `${site}/api/unsubscribe?token=${s.token}`;
    const msg = { subject: tpl.subject, html: tpl.html.split(marker).join(unsubscribe), text: tpl.text.split(marker).join(unsubscribe) };
    try {
      await sendOne(t, s.email, msg, unsubscribe);
      sent++;
    } catch {
      failed.push(s.email);
    }
  }
  // Only mark it emailed if someone actually got it, so "Email it" stays on offer after a failed send
  if (!onlyTo && sent > 0) await db.from("ai_pieces").update({ emailed_at: new Date().toISOString(), emailed_count: sent }).eq("id", pieceId);
  return { sent, failed };
}
