import "server-only";
import { createHash } from "node:crypto";
import { adminClient } from "./admin";
import { paletteFor } from "./themes";
import type { AiPieceRow, TournamentRow } from "./types";
import { coursePhotoFor } from "@/data/course-photos";
import { mediaUrl } from "./supabase";
import { EMAIL_RE } from "./email-re";
import { cleanTitle } from "./cleanText";
import { EMAIL_SECS, primeFiles } from "./files";
import { newsletterEmail, type NewsletterData } from "./newsletter";
import { loadServerState } from "./server-data";
import { courseInfo, forecast } from "./ai";
import { roundPointsAvailable, tournamentSummary } from "./engine";
import { totalsView } from "./live";
import { SIDE_GAME_LABEL, formatLabel, sideLabel, toEntries, toRoundCfg, toTournamentCfg } from "./types";
import { deliver, deliverMany, mailConfigured, newSendId, smtpFrom, type Outgoing } from "./mail/send";
import { postmarkOn, postmarkSetup } from "./mail/postmark";
import { emailKey } from "./mail/tokens";
import { emailSettings } from "./mail/settings";
import { oneTap, organiserReplyTo } from "./mail/emails";
import { fill, wordsFor, SERVICE } from "./mail/words";

/**
 * Email: the pieces the site writes, to everyone signed up for a tournament's updates, and the helpers the rest of the
 * site uses. Sending itself is in mail/send.ts (Postmark, or the old mailbox until it's set up); every email's words
 * and look are in mail/.
 */

export { EMAIL_RE, mailConfigured };

/** How the site sends email (no passwords or keys): for the console's setup check. */
export async function mailSetup() {
  const pm = postmarkOn() ? await postmarkSetup() : null;
  return {
    via: postmarkOn() ? "postmark" : process.env.SMTP_USER ? "smtp" : "none",
    postmark: pm ? { at: pm.at, server: pm.server, customUnsub: pm.customUnsub } : null,
    host: process.env.SMTP_HOST || "smtp.mail.me.com (default)",
    port: Number(process.env.SMTP_PORT || 587),
    from: smtpFrom(),
    login: !!process.env.SMTP_USER,
    password: !!process.env.SMTP_PASS,
  };
}

export function ipHash(ip: string) {
  return createHash("sha256").update(`${process.env.SESSION_SECRET ?? ""}:${ip}`).digest("hex").slice(0, 32);
}

/** An email built elsewhere (the older shape): sent as a service email, or an update when it's a report. */
export interface Mail {
  subject: string;
  html: string;
  text: string;
  kind?: string;
  attachments?: { filename: string; content: string; contentType: string }[];
}

export async function sendOne(t: Pick<TournamentRow, "name">, to: string, msg: Mail, unsubscribe?: string) {
  const kind = msg.kind ?? "other";
  await deliver({ ...msg, to, kind, stream: kind === "report" ? "updates" : "service", fromName: t.name, unsubscribe: unsubscribe ?? null });
}

const LABEL: Record<AiPieceRow["kind"], string> = { preview: "Preview", report: "Match report", tournament: "Tournament review", bulletin: "Live bulletin" };

/** Email a published piece to every active subscriber. Returns how many were sent. */
/** Gather everything the newsletter shows, from the live tournament state. */
export async function buildNewsletter(t: TournamentRow, piece: AiPieceRow, site: string, links: { prefs: string; stop: string }, issue: number) {
  // A private tournament's photos in the email: links that work for a month
  await primeFiles(t.slug, EMAIL_SECS);
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
    prefs: links.prefs,
    stop: links.stop,
    address: (await emailSettings()).address,
  };
  return { ...newsletterEmail(data), title: cleanTitle(piece.title ?? "") || label };
}

/**
 * Email a published piece to everyone signed up for the tournament's updates (but not those who chose one email each
 * evening: it's in theirs). Returns how many were sent.
 */
export async function emailPiece(t: TournamentRow, pieceId: string, site: string, onlyTo?: string) {
  const db = adminClient();
  const { data: piece } = await db.from("ai_pieces").select("*").eq("id", pieceId).eq("tournament_id", t.id).single();
  if (!piece) throw new Error("Piece not found");
  const { count } = await db.from("ai_pieces").select("id", { count: "exact", head: true }).eq("tournament_id", t.id).not("emailed_at", "is", null);
  const issue = (count ?? 0) + (piece.emailed_at ? 0 : 1);

  let list: { email: string }[];
  if (onlyTo) list = [{ email: onlyTo }];
  else {
    const { data } = await db.from("subscribers").select("email,added_by,evening").eq("tournament_id", t.id).is("unsubscribed_at", null);
    list = (data ?? []).filter((s) => !s.evening);
    // Private: only people let in get it, and anyone the organiser added to the list themselves (someone who signed up
    // while anyone could watch, and hasn't been let in since, doesn't)
    if (t.privacy === "private") {
      const inside = await letInEmails(t.id);
      list = (data ?? []).filter((s) => !s.evening && (s.added_by === "organiser" || inside.has(s.email.toLowerCase())));
    }
  }
  // Built once; each person's own links go in where the markers are
  const tpl = await buildNewsletter(t, piece as AiPieceRow, site, { prefs: PREFS_MARK, stop: STOP_MARK }, issue);
  const w = await wordsFor(SERVICE.find((d) => d.key === "piece")!);
  const subject = fill(w.subject, { headline: tpl.title, tournament: t.name }).replace(/[\r\n]+/g, " ");
  const replyTo = await organiserReplyTo(t.id);
  const out: Outgoing[] = list.map((s) => {
    const email = s.email.toLowerCase();
    const sendId = newSendId();
    const prefs = `${site}/email?k=${emailKey(email, "p")}`;
    const stop = `${site}/email?k=${emailKey(email, `u:${t.id}`, sendId)}`;
    const swap = (x: string) => x.split(PREFS_MARK).join(prefs).split(STOP_MARK).join(stop);
    return {
      to: email,
      sendId,
      subject: onlyTo ? `Test: ${subject}` : subject,
      html: swap(tpl.html),
      text: swap(tpl.text),
      kind: "report",
      stream: "updates",
      template: "piece",
      tournamentId: t.id,
      fromName: t.name,
      replyTo,
      unsubscribe: oneTap(site, email, `u:${t.id}`, sendId),
    };
  });
  // A test goes to the organiser whatever their own choices
  if (onlyTo) {
    await deliver({ ...out[0], stream: "service", unsubscribe: null });
    return { sent: 1, failed: [] as string[] };
  }
  const r = await deliverMany(out);
  // Only mark it emailed if someone actually got it, so "Email it" stays on offer after a failed send
  if (r.sent > 0) await db.from("ai_pieces").update({ emailed_at: new Date().toISOString(), emailed_count: r.sent }).eq("id", pieceId);
  return { sent: r.sent, failed: r.failed };
}

const PREFS_MARK = "__PREFS__";
const STOP_MARK = "__STOP__";

/** The emails of everyone let into a tournament: its players and organisers, and followers let in with a confirmed email. */
export async function letInEmails(tournamentId: string): Promise<Set<string>> {
  const db = adminClient();
  const [joined, players, fans] = await Promise.all([
    db.from("account_tournaments").select("account_id").eq("tournament_id", tournamentId),
    db.from("players").select("email").eq("tournament_id", tournamentId).not("email", "is", null),
    db.from("fans").select("email").eq("tournament_id", tournamentId).eq("status", "approved").not("verified_at", "is", null).not("email", "is", null),
  ]);
  const ids = (joined.data ?? []).map((r) => r.account_id);
  const accts = ids.length ? (await db.from("accounts").select("email").in("id", ids)).data ?? [] : [];
  const out = new Set<string>();
  for (const r of [...accts, ...(players.data ?? []), ...(fans.data ?? [])]) if (r.email) out.add(String(r.email).toLowerCase());
  return out;
}
