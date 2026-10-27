import "server-only";
import { adminClient } from "../admin";
import { loadServerState } from "../server-data";
import { toEntries, toTournamentCfg, type TournamentRow } from "../types";
import { tournamentSummary } from "../engine";
import { totalsView } from "../live";
import { mediaUrl } from "../supabase";
import { EMAIL_SECS, primeFiles } from "../files";
import { articleBlocks } from "../newsletter";
import { cleanTitle } from "../cleanText";
import { compose, esc, type Piece } from "./design";
import { listFooter, oneTap, organiserReplyTo, serviceDef, tournamentLook, firstName, type TLike } from "./emails";
import { fill, paragraphs, wordsFor, type Words } from "./words";
import { deliverMany, newSendId, type Outgoing } from "./send";
import { dublinToday } from "./limits";
import { allRows } from "./pages";

/**
 * The evening email: at 8pm on a day something happened, one email to the followers who chose it instead of every
 * update. The day's pieces (each with a link to read it on the site), the top of the leaderboard and a few photos.
 */

interface Day {
  t: TournamentRow;
  pieces: { title: string; paras: string[] }[];
  board: { name: string; score: string; lead: boolean }[];
  boardTitle: string | null;
  photos: { src: string; alt: string }[];
}

const startOfDublinDay = (day: string) => {
  // Midnight in Dublin as a time (summer is an hour ahead of UTC)
  const guess = new Date(`${day}T00:00:00Z`);
  const offset = Number(guess.toLocaleString("en-GB", { timeZone: "Europe/Dublin", hour: "2-digit", hourCycle: "h23" }));
  return new Date(guess.getTime() - offset * 3600e3).toISOString();
};

async function dayOf(t: TournamentRow, today: string): Promise<Day | null> {
  const db = adminClient();
  const since = startOfDublinDay(today);
  const [{ data: pieces }, { data: posts }] = await Promise.all([
    db.from("ai_pieces").select("title,body,kind,published_at").eq("tournament_id", t.id).eq("status", "published").neq("kind", "bulletin").gte("published_at", since).order("published_at"),
    db.from("posts").select("media_path,body,author_name").eq("tournament_id", t.id).eq("kind", "photo").eq("hidden", false).eq("visibility", "public").not("media_path", "is", null).gte("created_at", since).order("created_at", { ascending: false }).limit(3),
  ]);
  if (!pieces?.length && !posts?.length) return null;
  await primeFiles(t.slug, EMAIL_SECS);
  const st = await loadServerState(t.id);
  const cfg = toTournamentCfg(st);
  const summary = tournamentSummary(cfg, toEntries(st.entries));
  const totals = totalsView(st, summary);
  let board: Day["board"] = [];
  let boardTitle: string | null = null;
  if (totals) {
    board = totals.rows.filter((r) => r.pos).slice(0, 5).map((r) => ({ name: `${r.pos}. ${r.name}`, score: r.score, lead: r.pos === "1" }));
    boardTitle = totals.title;
  } else {
    const teamMode = cfg.teams.length >= 2;
    const rows = (teamMode ? cfg.teams.map((x) => ({ name: x.name, v: summary.teamTotal[x.id] ?? 0 })) : cfg.players.map((p) => ({ name: p.name, v: summary.playerTotal[p.id] ?? 0 }))).sort((a, b) => b.v - a.v);
    if (rows.some((r) => r.v > 0)) {
      board = rows.slice(0, 5).map((r, i) => ({ name: r.name, score: `${Number.isInteger(r.v) ? r.v : r.v.toFixed(1)} pts`, lead: i === 0 && r.v > (rows[1]?.v ?? -1) }));
      boardTitle = summary.complete ? "Final standings" : "Overall points";
    }
  }
  return {
    t,
    pieces: (pieces ?? []).map((p) => ({
      title: cleanTitle(p.title ?? "") || "The latest",
      paras: articleBlocks(p.body)
        .filter((b) => b.text)
        .slice(0, 4)
        .map((b) => b.text!),
    })),
    board,
    boardTitle,
    photos: (posts ?? []).map((p) => ({ src: mediaUrl(p.media_path) ?? "", alt: p.body?.trim() ? p.body.slice(0, 120) : `A photo from ${p.author_name}` })).filter((p) => p.src),
  };
}

function boardHtml(d: Day): Piece | null {
  if (!d.board.length) return null;
  const rows = d.board
    .map(
      (r) =>
        `<tr><td class="m-ink" style="padding:8px 0;border-top:1px solid #e3e8e5;font-family:Arial,sans-serif;font-size:17px;${r.lead ? "font-weight:bold;" : ""}color:#18231d">${esc(r.name)}</td><td class="m-ink" align="right" style="padding:8px 0;border-top:1px solid #e3e8e5;font-family:Arial,sans-serif;font-size:17px;font-weight:bold;color:#18231d">${esc(r.score)}</td></tr>`,
    )
    .join("");
  return {
    type: "html",
    html: `<h2 class="m-ink" style="margin:26px 0 8px;font-family:Arial,sans-serif;font-size:21px;line-height:1.25;color:#18231d">${esc(d.boardTitle ?? "The leaderboard")}</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px">${rows}</table>`,
    text: `${(d.boardTitle ?? "The leaderboard").toUpperCase()}\n${d.board.map((r) => `${r.name}  ${r.score}`).join("\n")}`,
  };
}

export async function eveningMail(site: string, d: Day, email: string, name: string | null, words?: Words, replyTo?: string | null): Promise<Outgoing> {
  const def = serviceDef("evening");
  const w = words ?? (await wordsFor(def));
  const vars = { tournament: d.t.name, "first name": firstName(name) };
  const sendId = newSendId();
  const scope = `u:${d.t.id}` as const;
  const base = `${site}/t/${d.t.slug}`;
  const body: Piece[] = paragraphs(fill(w.lines, vars)).map((text) => ({ type: "p", text }));
  for (const p of d.pieces) {
    body.push({ type: "h", text: p.title });
    for (const x of p.paras) body.push({ type: "p", text: x });
    body.push({ type: "link", label: "Read it on the site", href: `${base}/feed` });
  }
  const b = boardHtml(d);
  if (b) body.push(b);
  for (const ph of d.photos) body.push({ type: "photo", src: ph.src, alt: ph.alt, href: `${base}/feed` });
  body.push({ type: "button", label: fill(w.button, vars), href: base });
  const m = compose({
    subject: fill(w.subject, vars),
    look: tournamentLook(d.t),
    headline: fill(w.headline, vars),
    body,
    footer: await listFooter(site, email, `You're getting this because you asked for one email each evening about ${d.t.name}.`, scope, sendId),
    fallbackLink: false,
  });
  return {
    ...m,
    to: email,
    sendId,
    kind: "evening",
    stream: "updates",
    template: "evening",
    ref: `evening:${dublinToday()}`,
    tournamentId: d.t.id,
    fromName: d.t.name,
    replyTo: replyTo === undefined ? await organiserReplyTo(d.t.id) : replyTo,
    unsubscribe: oneTap(site, email, scope, sendId),
  };
}

/** At 8pm: every tournament with evening followers and something new today. */
export async function runEvening(site: string, now = new Date()): Promise<{ tournaments: number; sent: number }> {
  const db = adminClient();
  const today = dublinToday(now);
  const subs = await allRows<{ tournament_id: string; email: string; name: string | null; added_by: string }>((a, b) =>
    db.from("subscribers").select("tournament_id,email,name,added_by").eq("evening", true).is("unsubscribed_at", null).order("id").range(a, b),
  );
  const byT = new Map<string, { email: string; name: string | null; added_by: string }[]>();
  for (const s of subs) byT.set(s.tournament_id, [...(byT.get(s.tournament_id) ?? []), s]);
  let sent = 0;
  let tournaments = 0;
  const { letInEmails } = await import("../email");
  for (const [tid, list] of byT) {
    const { data: t } = await db.from("tournaments").select("*").eq("id", tid).maybeSingle();
    if (!t) continue;
    const d = await dayOf(t as TournamentRow, today);
    if (!d) continue;
    tournaments++;
    let who = list;
    if (t.privacy === "private") {
      const inside = await letInEmails(t.id);
      who = list.filter((s) => s.added_by === "organiser" || inside.has(s.email.toLowerCase()));
    }
    const words = await wordsFor(serviceDef("evening"));
    const replyTo = await organiserReplyTo(t.id);
    const mails: Outgoing[] = [];
    for (const s of who) mails.push(await eveningMail(site, d, s.email.toLowerCase(), s.name, words, replyTo));
    sent += (await deliverMany(mails)).sent;
  }
  return { tournaments, sent };
}

/** A made-up evening, for the console's preview */
export function sampleDay(t: TLike): Day {
  return {
    t: t as TournamentRow,
    pieces: [
      {
        title: "Byrne holds his nerve at the Old Head",
        paras: ["Neil Byrne birdied the 17th to take a one-shot lead into the final round, as the wind picked up on the cliffs above the Atlantic.", "Ciarán Walsh had the round of the day, a 38-point effort built on three birdies on the back nine."],
      },
    ],
    board: [
      { name: "1. Neil Byrne", score: "74 pts", lead: true },
      { name: "2. Ciarán Walsh", score: "73 pts", lead: false },
      { name: "3. Seán Murphy", score: "69 pts", lead: false },
    ],
    boardTitle: "Overall points",
    photos: [],
  };
}
