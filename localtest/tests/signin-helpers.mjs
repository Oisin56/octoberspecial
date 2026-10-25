// Signing in, the way people do now: organisers and owners with an emailed code, players with their personal link.
import fs from "node:fs";

export const BASE = "http://127.0.0.1:3100";
const MAIL = "/var/tmp/ospg/mail";

/** Every email in the test mailbox, oldest first. */
export const mails = () =>
  fs.existsSync(MAIL)
    ? fs
        .readdirSync(MAIL)
        .sort()
        .map((f) => JSON.parse(fs.readFileSync(`${MAIL}/${f}`, "utf8")))
    : [];

/** The newest email to an address (waits a little for it to land). */
export async function lastMailTo(to, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const m = mails().filter((x) => x.to.join().toLowerCase() === to.toLowerCase());
    if (m.length) return m[m.length - 1];
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

/** The 6-digit code from a sign-in email */
export const codeOf = (m) => m?.subject?.match(/^(\d{6}) is your/)?.[1] ?? null;
/** The button's link from a sign-in or player-link email */
export const linkOf = (m) => m?.text?.match(/https?:\/\/\S+/)?.[0] ?? null;

/** A fetch-style agent with its own cookie: call(path, body) POSTs JSON, call(path) GETs. */
export function agent() {
  let cookie = "";
  const call = async (path, body, method) => {
    const r = await fetch(BASE + path, {
      method: method ?? (body ? "POST" : "GET"),
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    return { status: r.status, j: await r.json().catch(() => ({})) };
  };
  call.cookie = () => cookie;
  return call;
}

/** Sign an agent in with an email: ask for the email, then type the code from it. */
export async function signInWithEmail(call, email) {
  const before = mails().length;
  const s = await call("/api/account", { action: "send", email });
  if (s.status !== 200) return s;
  let m = null;
  for (let i = 0; i < 40 && !m; i++) {
    m = mails().slice(before).filter((x) => x.to.join().toLowerCase() === email.toLowerCase()).pop() ?? null;
    if (!m) await new Promise((r) => setTimeout(r, 150));
  }
  return call("/api/account", { action: "code", email, code: codeOf(m) });
}

/** A player's personal link, made by the organiser's agent (orgCall); the code at the end of it. */
export async function playerLink(orgCall, t, playerId, reset = false) {
  const r = await orgCall("/api/admin", { t, action: "playerLink", playerId, reset });
  return r.j.url;
}

/** Sign a player's agent in through their personal link ("I'm Neil"). */
export async function signInAsPlayer(orgCall, playerCall, t, playerId) {
  const url = await playerLink(orgCall, t, playerId);
  const code = url.split("/in/")[1];
  return playerCall("/api/login", { t, mode: "link", code, step: "confirm" });
}

/** For Playwright: the cookie header string set by an agent, as a browser cookie */
export function browserCookie(call) {
  const [name, value] = call.cookie().split("=");
  return { name, value: call.cookie().slice(name.length + 1), domain: "127.0.0.1", path: "/" };
}
