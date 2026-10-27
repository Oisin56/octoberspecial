import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed links in emails: the preferences page, one-tap stops, and taps on buttons. Signed with the site's secret so
 * nobody can make one for someone else's address; they don't expire (an unsubscribe link must keep working).
 */

/** What a stop link stops: marketing, tips for organisers, one tournament's updates, or (p) nothing, it only opens the page. */
export type Scope = "p" | "m" | "t" | `u:${string}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sign(what: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET isn't set");
  return createHmac("sha256", secret).update(`mgs-email:${what}`).digest("base64url").slice(0, 22);
}

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** A key for one person's email settings (and, with a scope, what one tap stops). `send` is the email it came in. */
export function emailKey(email: string, scope: Scope = "p", send?: string | null): string {
  const body = Buffer.from(`${email.trim().toLowerCase()}\n${scope}\n${send ?? ""}`).toString("base64url");
  return `${body}.${sign(body)}`;
}

export interface KeyParts {
  email: string;
  scope: Scope;
  send: string | null;
}

export function readKey(key: string | null | undefined): KeyParts | null {
  if (!key || key.length > 600) return null;
  const [body, sig] = key.split(".");
  if (!body || !sig || !same(sig, sign(body))) return null;
  const [email, scope, send] = Buffer.from(body, "base64url").toString("utf8").split("\n");
  if (!email || !email.includes("@")) return null;
  if (!(scope === "p" || scope === "m" || scope === "t" || (scope?.startsWith("u:") && UUID.test(scope.slice(2))))) return null;
  return { email, scope: scope as Scope, send: send && UUID.test(send) ? send : null };
}

/** A button's link that counts the tap, then goes on to `url`. */
export function tapLink(site: string, sendId: string, url: string) {
  return `${site}/api/email/go?${new URLSearchParams({ s: sendId, u: url, k: sign(`go:${sendId}:${url}`) })}`;
}

export function readTap(sendId: string | null, url: string | null, k: string | null): boolean {
  return !!(sendId && url && k && UUID.test(sendId) && same(k, sign(`go:${sendId}:${url}`)));
}

/** The password Postmark sends with its notices (bounces, complaints), made from the site's secret. */
export function webhookPassword() {
  return sign("postmark-webhook");
}
