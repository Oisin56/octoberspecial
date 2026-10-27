import "server-only";
import { adminClient } from "../admin";
import { paletteFor } from "../themes";
import { FILM_KEPT, type TournamentRow } from "../types";
import { compose, type Footer, type Look, type Piece } from "./design";
import { SERVICE, fill, paragraphs, wordsFor, type Words, type WordsDef } from "./words";
import { emailSettings } from "./settings";
import { emailKey, type Scope } from "./tokens";
import { newSendId, type Outgoing } from "./send";
import { roundLine, roundsIcs, type IcsRound } from "./ics";

/**
 * Every email the site sends to the people using it, built on the one design from the words in the console. Each
 * function returns the email ready to send (deliver it with send.ts); `words` lets the console preview unsaved words.
 */

export type TLike = Pick<TournamentRow, "id" | "name" | "slug" | "theme" | "custom_colors">;

export const firstName = (n?: string | null) => (n ?? "").trim().split(/\s+/)[0] ?? "";
export const tournamentLook = (t: Pick<TournamentRow, "name" | "theme" | "custom_colors">, sub?: string | null): Look => ({ name: t.name, sub: sub ?? null, palette: paletteFor(t.theme, t.custom_colors) });
export const BRAND_LOOK: Look = { name: "MyGolfBroadcast" };
export const BRAND_FROM = "MyGolfBroadcast";

export const serviceDef = (key: string): WordsDef => {
  const d = SERVICE.find((x) => x.key === key);
  if (!d) throw new Error(`No email called ${key}`);
  return d;
};

export async function serviceFooter(): Promise<Footer> {
  return { kind: "service", address: (await emailSettings()).address };
}

/** The footer on updates and marketing: why it came, the address, change what you get, stop these. */
export async function listFooter(site: string, email: string, why: string, scope: Scope, sendId: string, stopLabel?: string): Promise<Footer> {
  return {
    kind: "list",
    why,
    address: (await emailSettings()).address,
    prefs: `${site}/email?k=${emailKey(email, "p")}`,
    stop: `${site}/email?k=${emailKey(email, scope, sendId)}`,
    stopLabel,
  };
}

/** The address for the mail app's one-tap unsubscribe (it posts to it) */
export const oneTap = (site: string, email: string, scope: Scope, sendId: string) => `${site}/api/email/stop?k=${emailKey(email, scope, sendId)}`;

/** Where replies to a tournament's emails go: its organiser (the first one with an email). */
export async function organiserReplyTo(tournamentId: string): Promise<string | null> {
  const db = adminClient();
  const { data: rows } = await db.from("account_tournaments").select("account_id,created_at").eq("tournament_id", tournamentId).eq("role", "organiser").order("created_at").limit(5);
  const ids = (rows ?? []).map((r) => r.account_id);
  if (!ids.length) return null;
  const { data: accts } = await db.from("accounts").select("id,email").in("id", ids);
  for (const id of ids) {
    const e = (accts ?? []).find((a) => a.id === id)?.email;
    if (e) return String(e).toLowerCase();
  }
  return null;
}

export async function supportReplyTo(): Promise<string | null> {
  return (await emailSettings()).support;
}

/** Fill in one email: its words (with the locked parts around them), the look and the footer. */
export async function build(
  d: WordsDef,
  o: { vars: Record<string, string | null | undefined>; look: Look; footer: Footer; href?: string | null; before?: Piece[]; after?: Piece[]; intro?: string[] | null; words?: Words; fallbackLink?: boolean },
) {
  const w = o.words ?? (await wordsFor(d));
  const body: Piece[] = [];
  for (const l of o.intro ?? paragraphs(fill(w.lines, o.vars))) body.push({ type: "p", text: l });
  body.push(...(o.before ?? []));
  if (d.words.button !== null && o.href) body.push({ type: "button", label: fill(w.button, o.vars), href: o.href });
  body.push(...(o.after ?? []));
  return compose({ subject: fill(w.subject, o.vars).replace(/[\r\n]+/g, " "), look: o.look, headline: d.words.headline === null ? null : fill(w.headline, o.vars), body, footer: o.footer, fallbackLink: o.fallbackLink });
}

const safety = "Didn't ask for this? Ignore this email and nothing happens.";


// ------------------------------------------------------------ service emails

export async function signInMail(email: string, link: string, code: string, intro?: string | null, words?: Words): Promise<Outgoing> {
  const m = await build(serviceDef("sign-in"), {
    vars: { code },
    look: BRAND_LOOK,
    footer: await serviceFooter(),
    href: link,
    intro: intro ? [intro] : null,
    after: [{ type: "small", text: "Or type this code where you asked to sign in:" }, { type: "code", code }, { type: "small", text: `The button and the code work once, for 30 minutes. ${safety}` }],
    words,
  });
  return { ...m, to: email, kind: "sign-in", stream: "service", template: "sign-in", fromName: BRAND_FROM, replyTo: await supportReplyTo() };
}

/** "Neil via MyGolfBroadcast": the organiser's first name when there is one */
const viaName = (organiser: string | null | undefined, t: { name: string }) => {
  const f = firstName(organiser);
  return f && !/^(organiser|support|owner)$/i.test(f) ? `${f} via MyGolfBroadcast` : t.name;
};

export async function playerLinkMail(t: TLike, p: { name: string; email: string; needsBio?: boolean }, link: string, rounds: IcsRound[], organiser: string | null, words?: Words): Promise<Outgoing> {
  const ics = roundsIcs(t.name, rounds, link);
  const after: Piece[] = [];
  if (p.needsBio) after.push({ type: "p", text: "Fill in your player bio before the trip so the commentators know who you are." });
  if (ics) after.push({ type: "small", text: "The rounds are attached as a calendar file. Tap it to put them in your phone's calendar." });
  after.push({ type: "small", text: `This link is yours alone: it signs you in as ${p.name}. Please don't forward it.` });
  const m = await build(serviceDef("player-link"), {
    vars: { "first name": firstName(p.name), name: p.name, tournament: t.name, organiser: firstName(organiser) || "The organiser" },
    look: tournamentLook(t),
    footer: await serviceFooter(),
    href: link,
    after,
    words,
  });
  return {
    ...m,
    to: p.email,
    kind: "player link",
    stream: "service",
    template: "player-link",
    tournamentId: t.id,
    fromName: viaName(organiser, t),
    replyTo: await organiserReplyTo(t.id),
    attachments: ics ? [{ filename: "rounds.ics", content: ics, contentType: "text/calendar; charset=utf-8; method=PUBLISH" }] : undefined,
  };
}

export async function datesChangedMail(t: TLike, p: { name: string; email: string }, link: string, rounds: IcsRound[], organiser: string | null, words?: Words): Promise<Outgoing> {
  const ics = roundsIcs(t.name, rounds, link);
  const m = await build(serviceDef("dates-changed"), {
    vars: { "first name": firstName(p.name), name: p.name, tournament: t.name, organiser: firstName(organiser) || "The organiser" },
    look: tournamentLook(t),
    footer: await serviceFooter(),
    href: link,
    before: [...rounds].sort((a, b) => a.number - b.number).map((r) => ({ type: "p" as const, text: roundLine(r) })),
    after: [{ type: "small", text: `This link is yours alone: it signs you in as ${p.name}. Please don't forward it.` }],
    words,
  });
  return {
    ...m,
    to: p.email,
    kind: "dates changed",
    stream: "service",
    template: "dates-changed",
    tournamentId: t.id,
    fromName: viaName(organiser, t),
    replyTo: await organiserReplyTo(t.id),
    attachments: ics ? [{ filename: "rounds.ics", content: ics, contentType: "text/calendar; charset=utf-8; method=PUBLISH" }] : undefined,
  };
}

export async function followApprovedMail(t: TLike, name: string, email: string, link: string, words?: Words): Promise<Outgoing> {
  const m = await build(serviceDef("follow-approved"), {
    vars: { "first name": firstName(name), name, tournament: t.name },
    look: tournamentLook(t),
    footer: await serviceFooter(),
    href: link,
    after: [{ type: "small", text: "On another phone or computer, sign in with this email to get in." }],
    words,
  });
  return { ...m, to: email, kind: "follower", stream: "service", template: "follow-approved", tournamentId: t.id, fromName: t.name, replyTo: await organiserReplyTo(t.id) };
}

export async function followWaitingMail(t: TLike, names: string[], link: string, to: string, words?: Words): Promise<Outgoing> {
  const waiting = names.length === 1 ? `${names[0]} is` : `${names.length} people are`;
  const m = await build(serviceDef("follow-waiting"), { vars: { tournament: t.name, waiting }, look: tournamentLook(t), footer: await serviceFooter(), href: link, words });
  return { ...m, to, kind: "reminder", stream: "service", template: "follow-waiting", tournamentId: t.id, fromName: BRAND_FROM, replyTo: await supportReplyTo() };
}

export async function filmReadyMail(t: TLike, link: string, to: string, words?: Words): Promise<Outgoing> {
  const m = await build(serviceDef("film-ready"), {
    vars: { tournament: t.name },
    look: tournamentLook(t),
    footer: await serviceFooter(),
    href: link,
    after: [{ type: "small", text: FILM_KEPT }],
    words,
  });
  return { ...m, to, kind: "film", stream: "service", template: "film-ready", tournamentId: t.id, fromName: BRAND_FROM, replyTo: await supportReplyTo() };
}

export async function finishTomorrowMail(t: TLike, site: string, to: string, name: string | null, words?: Words): Promise<Outgoing> {
  const m = await build(serviceDef("finish-tomorrow"), {
    vars: { tournament: t.name, "first name": firstName(name) },
    look: tournamentLook(t),
    footer: await serviceFooter(),
    href: `${site}/t/${t.slug}/admin#cards`,
    after: [{ type: "link", label: "Finish it now", href: `${site}/t/${t.slug}/admin#finish` }],
    words,
  });
  return { ...m, to, kind: "finish", stream: "service", template: "finish-tomorrow", tournamentId: t.id, fromName: BRAND_FROM, replyTo: await supportReplyTo() };
}

/** A month before a film is removed. Followers get it as an update (one tap stops the trip's updates). */
export async function filmReminderMail(
  t: TLike,
  site: string,
  p: { email: string; name: string | null; follower: boolean },
  film: { href: string; removeOn: string },
  words?: Words,
): Promise<Outgoing> {
  const vars = { tournament: t.name, date: film.removeOn, "first name": firstName(p.name) };
  if (!p.follower) {
    const m = await build(serviceDef("film-reminder"), { vars, look: tournamentLook(t), footer: await serviceFooter(), href: film.href, words });
    return { ...m, to: p.email, kind: "film", stream: "service", template: "film-reminder", tournamentId: t.id, fromName: t.name, replyTo: await organiserReplyTo(t.id) };
  }
  const sendId = newSendId();
  const scope: Scope = `u:${t.id}`;
  const m = await build(serviceDef("film-reminder"), {
    vars,
    look: tournamentLook(t),
    footer: await listFooter(site, p.email, `You're getting this because you signed up for updates from ${t.name}.`, scope, sendId),
    href: film.href,
    words,
  });
  return { ...m, to: p.email, sendId, kind: "film", stream: "updates", template: "film-reminder", tournamentId: t.id, fromName: t.name, replyTo: await organiserReplyTo(t.id), unsubscribe: oneTap(site, p.email, scope, sendId) };
}

export async function accountDeletedMail(email: string, words?: Words): Promise<Outgoing> {
  const m = await build(serviceDef("account-deleted"), { vars: {}, look: BRAND_LOOK, footer: await serviceFooter(), words });
  return { ...m, to: email, kind: "account", stream: "service", template: "account-deleted", fromName: BRAND_FROM, replyTo: await supportReplyTo() };
}

export async function filmFailedMail(t: TLike, link: string, to: string, words?: Words): Promise<Outgoing> {
  const m = await build(serviceDef("film-failed"), { vars: { tournament: t.name }, look: tournamentLook(t), footer: await serviceFooter(), href: link, words });
  return { ...m, to, kind: "film", stream: "service", template: "film-failed", tournamentId: t.id, fromName: BRAND_FROM, replyTo: await supportReplyTo() };
}

export async function inviteApprovedMail(name: string, email: string, link: string, words?: Words): Promise<Outgoing> {
  const m = await build(serviceDef("invite-approved"), {
    vars: { "first name": firstName(name), name },
    look: BRAND_LOOK,
    footer: await serviceFooter(),
    href: link,
    after: [{ type: "small", text: "The link works for one tournament. Keep this email until you've used it." }],
    words,
  });
  return { ...m, to: email, kind: "invite", stream: "service", template: "invite-approved", fromName: BRAND_FROM, replyTo: await supportReplyTo() };
}

export async function dataCopyMail(email: string, file: { filename: string; content: string }, words?: Words): Promise<Outgoing> {
  const m = await build(serviceDef("data-copy"), { vars: {}, look: BRAND_LOOK, footer: await serviceFooter(), words });
  return { ...m, to: email, kind: "data", stream: "service", template: "data-copy", fromName: BRAND_FROM, replyTo: await supportReplyTo(), attachments: [{ ...file, contentType: "application/json" }] };
}

export async function signedUpMail(site: string, t: TLike, name: string | null, email: string, words?: Words): Promise<Outgoing> {
  const sendId = newSendId();
  const scope: Scope = `u:${t.id}`;
  const m = await build(serviceDef("signed-up"), {
    vars: { "first name": firstName(name), name: name ?? "", tournament: t.name },
    look: tournamentLook(t),
    footer: await listFooter(site, email, `You're getting this because you signed up for updates from ${t.name}.`, scope, sendId),
    href: `${site}/t/${t.slug}`,
    words,
  });
  return { ...m, to: email, sendId, kind: "signed up", stream: "updates", template: "signed-up", tournamentId: t.id, fromName: t.name, replyTo: await organiserReplyTo(t.id), unsubscribe: oneTap(site, email, scope, sendId) };
}

/** Someone signed this address up for updates, but they'd stopped every email: how to turn them back on */
export async function stoppedBeforeMail(site: string, t: TLike, email: string): Promise<Outgoing> {
  const m = compose({
    subject: `Updates from ${t.name}`,
    look: tournamentLook(t),
    headline: "You'd stopped our emails",
    body: [
      { type: "p", text: `Someone (hopefully you) signed this address up for updates from ${t.name}. You'd asked us to stop our emails, so none will come unless you turn them back on.` },
      { type: "button", label: "Change what you get", href: `${site}/email?k=${emailKey(email, "p")}` },
      { type: "small", text: safety },
    ],
    footer: await serviceFooter(),
  });
  return { ...m, to: email, kind: "signed up", stream: "service", tournamentId: t.id, fromName: BRAND_FROM, replyTo: await supportReplyTo() };
}

// ------------------------------------------------------------ emails to the owner and staff (plain, not edited)

/** The console's own emails, and other notes to the owner: the same look, the site's name across the top. */
export async function noteMail(to: string, subject: string, paras: string[], button: { label: string; href: string } | null, foot?: string): Promise<Outgoing> {
  const body: Piece[] = paras.map((text) => ({ type: "p", text }));
  if (button) body.push({ type: "button", label: button.label, href: button.href });
  if (foot) body.push({ type: "small", text: foot });
  const m = compose({ subject, look: BRAND_LOOK, body, footer: await serviceFooter(), fallbackLink: false });
  return { ...m, to, kind: "console", stream: "service", fromName: "MyGolfBroadcast console" };
}

// ------------------------------------------------------------ previews for the console

const SAMPLE_T: TLike = { id: "00000000-0000-4000-8000-000000000000", name: "Kinsale Spring Classic", slug: "kinsale-spring-classic", theme: "spring", custom_colors: null };
const SAMPLE_ROUNDS: IcsRound[] = [
  { id: "r1", number: 1, course_name: "Old Head", play_date: "2026-06-13", tee_time: "09:10" },
  { id: "r2", number: 2, course_name: "Kinsale, Farrangalway", play_date: "2026-06-14", tee_time: "10:00" },
];

/** One email as it would look, filled in with made-up details (and the words being edited, when given). */
export async function previewService(key: string, site: string, words?: Words): Promise<{ subject: string; html: string; text: string }> {
  const at = `${site}/preview-link`;
  switch (key) {
    case "sign-in":
      return signInMail("neil@example.com", at, "482913", null, words);
    case "player-link":
      return playerLinkMail(SAMPLE_T, { name: "Neil Byrne", email: "neil@example.com", needsBio: true }, at, SAMPLE_ROUNDS, "Ciarán Walsh", words);
    case "dates-changed":
      return datesChangedMail(SAMPLE_T, { name: "Neil Byrne", email: "neil@example.com" }, at, SAMPLE_ROUNDS, "Ciarán Walsh", words);
    case "follow-approved":
      return followApprovedMail(SAMPLE_T, "Clodagh Byrne", "clodagh@example.com", at, words);
    case "follow-waiting":
      return followWaitingMail(SAMPLE_T, ["Clodagh"], at, "neil@example.com", words);
    case "film-ready":
      return filmReadyMail(SAMPLE_T, at, "neil@example.com", words);
    case "film-failed":
      return filmFailedMail(SAMPLE_T, at, "neil@example.com", words);
    case "finish-tomorrow":
      return finishTomorrowMail(SAMPLE_T, site, "neil@example.com", "Neil Byrne", words);
    case "film-reminder":
      return filmReminderMail(SAMPLE_T, site, { email: "neil@example.com", name: "Neil Byrne", follower: false }, { href: at, removeOn: "14 June" }, words);
    case "account-deleted":
      return accountDeletedMail("neil@example.com", words);
    case "invite-approved":
      return inviteApprovedMail("Neil Byrne", "neil@example.com", at, words);
    case "data-copy":
      return dataCopyMail("neil@example.com", { filename: "my-data.json", content: "{}" }, words);
    case "signed-up":
      return signedUpMail(site, SAMPLE_T, "Clodagh Byrne", "clodagh@example.com", words);
  }
  throw new Error("No preview for that one");
}
export { SAMPLE_T };
