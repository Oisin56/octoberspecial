import "server-only";
import { getSetting } from "../site";
import type { Stream } from "./postmark";

/** The email settings kept in the console: the company's postal address for footers, and where replies go. */
export interface EmailSettings {
  address: string;
  /** Replies to the site's own emails (sign-in, offers…) go here; none = the sending address */
  support: string | null;
}

export const ADDRESS_PLACEHOLDER = "[Company address, to be added]";

let cached: { at: number; v: EmailSettings } | null = null;
/** Read at most every 20 seconds (thousands of emails in a run each show the address) */
export async function emailSettings(): Promise<EmailSettings> {
  if (cached && Date.now() - cached.at < 20e3) return cached.v;
  const v = await getSetting<Partial<EmailSettings>>("email", {});
  cached = { at: Date.now(), v: { address: (v.address ?? "").trim() || ADDRESS_PLACEHOLDER, support: (v.support ?? "").trim().toLowerCase() || null } };
  return cached.v;
}
export const forgetEmailSettings = () => {
  cached = null;
};

/** The address each kind of email comes from, once Postmark sends (the domains are set up in Postmark). */
export function sendingAddress(s: Stream): string {
  const env = { service: process.env.MAIL_FROM_SERVICE, updates: process.env.MAIL_FROM_UPDATES, marketing: process.env.MAIL_FROM_MARKETING }[s];
  if (env?.trim()) return env.trim();
  return { service: "hello@mail.mygolfbroadcast.com", updates: "updates@news.mygolfbroadcast.com", marketing: "hello@news.mygolfbroadcast.com" }[s];
}

export function site() {
  return (process.env.SITE_URL || "https://mygolfbroadcast.com").replace(/\/$/, "");
}
