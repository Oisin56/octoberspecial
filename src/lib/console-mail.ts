import "server-only";
import { ownerEmail } from "./auth";
import { brandEmail, mailConfigured, sendOne } from "./email";
import { getSetting } from "./site";
import { BRAND } from "./brand";

/**
 * The console's own email: the morning summary and red alerts go to an address set in Settings (so they stay out of
 * the owner's main inbox), or to the owner's email until one is set.
 */
export async function consoleAddress(): Promise<string | null> {
  const s = await getSetting<{ email?: string }>("console", {});
  return (s.email || ownerEmail() || "").trim().toLowerCase() || null;
}

function site() {
  return (process.env.SITE_URL || "https://mygolfbroadcast.com").replace(/\/$/, "");
}

/** Something's red: sent straight away, once (the caller makes sure of once). */
export async function alert(subject: string, lines: string[], link = "/console/health") {
  const to = await consoleAddress();
  if (!to || !mailConfigured()) return;
  await sendOne({ name: `${BRAND.name} console` }, to, { subject: `Alert: ${subject}`, html: brandEmail(lines, { label: "Open the console", href: `${site()}${link}` }), text: `${lines.join("\n\n")}\n\n${site()}${link}\n`, kind: "console" }).catch((e) =>
    console.warn("[console] alert not sent", e instanceof Error ? e.message : e),
  );
}

export async function consoleMail(subject: string, html: string, text: string) {
  const to = await consoleAddress();
  if (!to || !mailConfigured()) return false;
  await sendOne({ name: `${BRAND.name} console` }, to, { subject, html, text, kind: "console" });
  return true;
}
