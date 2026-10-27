import "server-only";
import { adminClient } from "../admin";
import type { Stream } from "./postmark";

/**
 * What each email says. The words here are the starting point; once the owner saves a change in the console's Email
 * section, the newest saved version is used. Locked parts (codes, links, how long they work, the safety lines) are
 * written by the code and never stored here, so an edit can't remove them.
 */

export interface Words {
  subject: string;
  headline: string;
  lines: string;
  button: string;
}

export interface WordsDef {
  key: string;
  name: string;
  /** What it is and who gets it, for the console */
  about: string;
  group: "service" | "updates" | "series";
  stream: Stream;
  /** The starting words. A field that's null isn't part of this email */
  words: { subject: string; headline: string | null; lines: string | null; button: string | null };
  /** Placeholders allowed in its words, as written in braces */
  placeholders: string[];
  /** What's locked, in a line */
  locked: string;
  /** Filled in for the preview */
  sample: Record<string, string>;
  /** Lines may be left empty (the owner writes them before switching it on) */
  mayBeEmpty?: boolean;
}

const SAMPLE = { "first name": "Neil", name: "Neil Byrne", tournament: "Kinsale Spring Classic", organiser: "Neil" };

export const SERVICE: WordsDef[] = [
  {
    key: "sign-in",
    name: "Sign-in",
    about: "Service email. Goes to anyone signing in, and to the owner and staff for the console's second check.",
    group: "service",
    stream: "service",
    words: { subject: "{code} is your MyGolfBroadcast code", headline: "Sign in to MyGolfBroadcast", lines: "Tap the button to sign in.", button: "Sign in" },
    placeholders: ["code"],
    locked: "Locked: the link, the 6-digit code, how long they work and the safety line. When someone else asked for it (a new tournament, a co-organiser), their reason replaces your lines.",
    sample: { code: "482913" },
  },
  {
    key: "player-link",
    name: "Player link",
    about: "Service email. Goes to each player when the organiser sends links, from the organiser's name.",
    group: "service",
    stream: "service",
    words: { subject: "Your link for {tournament}", headline: "Hi {first name}, here's your link", lines: "Tap it on your phone to keep score, post photos and follow the leaderboard.", button: "Open my link" },
    placeholders: ["first name", "name", "tournament", "organiser"],
    locked: "Locked: the link, the don't-forward line and the calendar file.",
    sample: SAMPLE,
  },
  {
    key: "dates-changed",
    name: "The dates have changed",
    about: "Service email. Goes to players who were emailed their link, when the organiser changes a round's date or tee time. Sent at 10am or 8pm, so several changes make one email.",
    group: "service",
    stream: "service",
    words: { subject: "New dates for {tournament}", headline: "The dates have changed", lines: "Hi {first name}, the rounds for {tournament} have changed. Here they are now, and a fresh calendar file is attached.", button: "Open my link" },
    placeholders: ["first name", "name", "tournament", "organiser"],
    locked: "Locked: the list of rounds, the link and the calendar file.",
    sample: SAMPLE,
  },
  {
    key: "follow-approved",
    name: "You're in",
    about: "Service email. Goes to a follower when a player or organiser lets them into a private tournament.",
    group: "service",
    stream: "service",
    words: { subject: "You're in: {tournament}", headline: "You're in", lines: "Hi {first name}, you can follow {tournament} now: the scores, the feed and the highlights.", button: "Follow {tournament}" },
    placeholders: ["first name", "name", "tournament"],
    locked: "Locked: the link and the line about signing in on another phone.",
    sample: SAMPLE,
  },
  {
    key: "follow-waiting",
    name: "Waiting to follow",
    about: "Service email. Goes to a private tournament's organisers when someone has waited 12 hours to be let in.",
    group: "service",
    stream: "service",
    words: { subject: "Waiting to follow {tournament}", headline: "Waiting to be let in", lines: "{waiting} waiting to follow {tournament}. Any player or organiser can let them in, or decline.", button: "See who's asking" },
    placeholders: ["tournament", "waiting"],
    locked: "Locked: the link. {waiting} is filled in as \"Clodagh is\" or \"3 people are\".",
    sample: { tournament: "Kinsale Spring Classic", waiting: "Clodagh is" },
  },
  {
    key: "film-ready",
    name: "Film ready",
    about: "Service email. Goes to the organiser when their highlights film is made.",
    group: "service",
    stream: "service",
    words: { subject: "Your film is ready: {tournament}", headline: "Your film is ready", lines: "It's in Highlights for everyone, and you can share it from there.", button: "Watch the film" },
    placeholders: ["tournament"],
    locked: "Locked: the link.",
    sample: SAMPLE,
  },
  {
    key: "film-failed",
    name: "Film didn't finish",
    about: "Service email. Sent from Needs you, to the organisers, when a film failed.",
    group: "service",
    stream: "service",
    words: { subject: "Your film: {tournament}", headline: "Your film didn't finish", lines: "We're looking at it. You can try again from your organiser page.", button: "Open my organiser page" },
    placeholders: ["tournament"],
    locked: "Locked: the link.",
    sample: SAMPLE,
  },
  {
    key: "invite-approved",
    name: "Invite approved",
    about: "Service email. Goes to someone you've said yes to, with their link to set up a tournament.",
    group: "service",
    stream: "service",
    words: {
      subject: "You're invited to MyGolfBroadcast",
      headline: "You're in",
      lines: "Hi {first name}, tap the button to set up your tournament: a few quick questions, and your site is ready to share with your players.",
      button: "Set up my tournament",
    },
    placeholders: ["first name", "name"],
    locked: "Locked: the link, and the line saying it works for one tournament.",
    sample: SAMPLE,
  },
  {
    key: "data-copy",
    name: "Your data",
    about: "Service email. Goes to someone who asked for a copy of what's held about them, with the file attached.",
    group: "service",
    stream: "service",
    words: { subject: "Your data from MyGolfBroadcast", headline: "Your data", lines: "Here's a copy of what we hold about you, attached. Nothing to do unless something looks wrong. If it does, reply to this email.", button: null },
    placeholders: [],
    locked: "Locked: the attached file.",
    sample: {},
  },
  {
    key: "finish-tomorrow",
    name: "Finishes tomorrow",
    about: "Service email. Goes to a group trip's organisers the day before it finishes by itself (3 days after the last round).",
    group: "service",
    stream: "service",
    words: {
      subject: "{tournament} finishes tomorrow",
      headline: "Finishes tomorrow",
      lines: "{tournament} finishes tomorrow. Anything to fix?\n\nOnce it's finished, players can't change their scores. You still can.",
      button: "Check the scores",
    },
    placeholders: ["tournament", "first name"],
    locked: "Locked: the links to the scorecards and to Finish it now.",
    sample: SAMPLE,
  },
  {
    key: "film-reminder",
    name: "Film reminder",
    about: "Service email to organisers and players with an email, a month before a film is removed (films are kept 12 months). Followers get it with the trip's updates, which one tap stops.",
    group: "service",
    stream: "service",
    words: {
      subject: "Your {tournament} film will be removed on {date}",
      headline: "Your film will be removed on {date}",
      lines: "Films are kept for 12 months. Download it to keep it for good.",
      button: "Download the film",
    },
    placeholders: ["tournament", "date", "first name"],
    locked: "Locked: the download link.",
    sample: { ...SAMPLE, date: "14 June" },
  },
  {
    key: "account-deleted",
    name: "Account deleted",
    about: "Service email. Goes to someone once their account has been deleted, as they asked.",
    group: "service",
    stream: "service",
    words: {
      subject: "Your MyGolfBroadcast account has been deleted",
      headline: "Your account has been deleted",
      lines: "Your MyGolfBroadcast account has been deleted, as you asked.\n\nScores, results, reports and films from tournaments you were part of stay, as the privacy policy says.",
      button: null,
    },
    placeholders: [],
    locked: "Locked: nothing. This is the last email we send to the address.",
    sample: {},
  },
  {
    key: "signed-up",
    name: "You're signed up",
    about: "Update. Goes to someone who signs up for a tournament's previews and reports.",
    group: "updates",
    stream: "updates",
    words: { subject: "You're signed up: {tournament}", headline: "You're signed up", lines: "Hi {first name}, the previews and round reports for {tournament} will arrive here as they're published.", button: "Follow it live" },
    placeholders: ["first name", "name", "tournament"],
    locked: "Locked: the link and the footer.",
    sample: SAMPLE,
  },
  {
    key: "piece",
    name: "Previews and reports",
    about: "Update. The piece the site wrote, with the leaderboard and its photo, to people signed up for that tournament's updates. The piece itself is written for each tournament, so only the subject is here.",
    group: "updates",
    stream: "updates",
    words: { subject: "{headline} | {tournament}", headline: null, lines: null, button: null },
    placeholders: ["headline", "tournament"],
    locked: "Locked: everything but the subject.",
    sample: { headline: "Byrne holds his nerve at the Old Head", tournament: "Kinsale Spring Classic" },
  },
  {
    key: "evening",
    name: "The evening email",
    about: "Update. At 8pm on a day something happened, to followers who chose one email each evening: the day's reports, the top of the leaderboard and a few photos.",
    group: "updates",
    stream: "updates",
    words: { subject: "Today at {tournament}", headline: "Today at {tournament}", lines: "Here's the day in one email.", button: "Follow it live" },
    placeholders: ["tournament", "first name"],
    locked: "Locked: the day's reports, leaderboard and photos, and the footer.",
    sample: SAMPLE,
  },
];

const PLACE = /\{([a-z ]{1,20})\}/gi;

/** Every placeholder written in a piece of text */
export const placeholdersIn = (s: string) => [...s.matchAll(PLACE)].map((m) => m[1].toLowerCase());

/** Fill the placeholders. "Hi {first name}," with no first name reads "Hi,". */
export function fill(s: string, vars: Record<string, string | null | undefined>): string {
  return s
    .replace(/(\s?)\{([a-z ]{1,20})\}/gi, (all, sp: string, k: string) => {
      const v = vars[k.toLowerCase()];
      if (v === undefined) return all;
      return v ? `${sp}${v}` : "";
    })
    .trim();
}

/** Lines as paragraphs: a blank line between them. */
export const paragraphs = (lines: string) =>
  lines
    .split(/\n\s*\n/)
    .map((x) => x.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);

export interface SavedWords extends Words {
  version: number;
  saved_by: string;
  saved_at: string;
  restored_from: number | null;
}

let cache: { at: number; v: Map<string, SavedWords> } | null = null;
export const forgetWords = () => {
  cache = null;
};

/** Kept for a moment only: a save in the console is used by the next email, whichever server sends it. Loops that
 *  send many fetch the words once and pass them in. */
async function latest(): Promise<Map<string, SavedWords>> {
  if (cache && Date.now() - cache.at < 1500) return cache.v;
  const { data, error } = await adminClient().from("email_words").select("*").order("key").order("version", { ascending: false });
  const v = new Map<string, SavedWords>();
  if (!error) for (const r of data ?? []) if (!v.has(r.key)) v.set(r.key, r as SavedWords & { key: string });
  cache = { at: Date.now(), v };
  return v;
}

/** The words in use now: the newest saved version, else the starting words. */
export async function wordsFor(def: Pick<WordsDef, "key" | "words">): Promise<Words & { version: number }> {
  const saved = (await latest()).get(def.key);
  const d = def.words;
  if (!saved) return { subject: d.subject, headline: d.headline ?? "", lines: d.lines ?? "", button: d.button ?? "", version: 0 };
  return {
    subject: saved.subject ?? d.subject,
    headline: d.headline === null ? "" : (saved.headline ?? d.headline),
    lines: d.lines === null ? "" : (saved.lines ?? d.lines),
    button: d.button === null ? "" : (saved.button ?? d.button),
    version: saved.version,
  };
}

/** Is this a fair set of words for that email? An error in plain words, or null. */
export function checkWords(def: WordsDef, w: Partial<Words>): string | null {
  const subject = (w.subject ?? "").trim();
  if (!subject) return "The subject can't be empty";
  if (subject.length > 150) return "The subject is too long (150 characters at most)";
  if (def.words.headline !== null && !(w.headline ?? "").trim()) return "The headline can't be empty";
  if ((w.headline ?? "").length > 150) return "The headline is too long (150 characters at most)";
  if (def.words.lines !== null && !def.mayBeEmpty && !(w.lines ?? "").trim()) return "Write at least one line";
  if ((w.lines ?? "").length > 2000) return "The lines are too long (2,000 characters at most)";
  if (def.words.button !== null && !(w.button ?? "").trim()) return "The button needs words";
  if ((w.button ?? "").length > 40) return "The button's words are too long (40 characters at most)";
  for (const k of ["subject", "headline", "lines", "button"] as const) {
    const bad = placeholdersIn(w[k] ?? "").filter((p) => !def.placeholders.includes(p));
    if (bad.length) return def.placeholders.length ? `{${bad[0]}} isn't something this email can fill in. It can use ${def.placeholders.map((p) => `{${p}}`).join(", ")}.` : `{${bad[0]}} isn't something this email can fill in.`;
  }
  if (/[<>]/.test(`${w.subject}${w.headline}${w.lines}${w.button}`)) return "Leave out < and > (the email's look takes care of the styling)";
  return null;
}

export async function saveWords(def: WordsDef, w: Words, by: string, restoredFrom: number | null = null): Promise<number> {
  const db = adminClient();
  const { data: top } = await db.from("email_words").select("version").eq("key", def.key).order("version", { ascending: false }).limit(1).maybeSingle();
  const version = Number(top?.version ?? 0) + 1;
  const { error } = await db.from("email_words").insert({
    key: def.key,
    version,
    subject: w.subject.trim(),
    headline: def.words.headline === null ? null : w.headline.trim(),
    lines: def.words.lines === null ? null : w.lines.replace(/\r/g, "").trim(),
    button: def.words.button === null ? null : w.button.trim(),
    saved_by: by,
    restored_from: restoredFrom,
  });
  if (error) throw new Error(/email_words/.test(error.message) ? "This needs the latest database update (run supabase/schema.sql)" : error.message);
  forgetWords();
  return version;
}

export async function versionsOf(key: string): Promise<SavedWords[]> {
  const { data } = await adminClient().from("email_words").select("*").eq("key", key).order("version", { ascending: false }).limit(50);
  return (data ?? []) as SavedWords[];
}
