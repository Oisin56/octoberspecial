import type { Palette } from "../themes";

/**
 * The one email design. A coloured band with the tournament's (or the site's) name, a headline, a few short lines in
 * large type, one big full-width button with a plain link under it, and a footer saying why it came. Tables and inline
 * styles so it holds in Gmail, Apple Mail and Outlook; a style block adds the phone and dark-mode touches. No words
 * inside pictures, no tracking pictures. Pure: everything it needs comes in.
 */

export const BRAND_PALETTE: Pick<Palette, "board" | "tile" | "mist" | "ink"> = { board: "#1f3d2b", tile: "#f7f7f2", mist: "#e4e9e5", ink: "#18231d" };

export interface Look {
  /** Across the top: the tournament's name, or MyGolfBroadcast */
  name: string;
  sub?: string | null;
  palette?: Pick<Palette, "board" | "tile" | "mist" | "ink"> | null;
}

export type Piece =
  | { type: "p"; text: string }
  | { type: "h"; text: string }
  | { type: "button"; label: string; href: string; plain?: boolean }
  | { type: "link"; label: string; href: string }
  | { type: "code"; code: string }
  | { type: "photo"; src: string; alt: string; href?: string | null }
  | { type: "film"; src: string | null; alt: string; href: string; caption: string }
  | { type: "quote"; text: string; by: string }
  | { type: "small"; text: string }
  | { type: "html"; html: string; text: string };

export type Footer =
  | { kind: "service"; address: string }
  | { kind: "list"; why: string; address: string; prefs: string; stop: string; stopLabel?: string };

export interface Composed {
  subject: string;
  preheader?: string | null;
  look: Look;
  headline?: string | null;
  body: Piece[];
  footer: Footer;
  /** The "Button not working?" line under the first button (on by default) */
  fallbackLink?: boolean;
}

/** "MyGolfBroadcast, 1 Main Street", without saying the name twice when the address starts with it */
export const companyLine = (address: string) => (/^mygolfbroadcast\b/i.test(address.trim()) ? address.trim() : `MyGolfBroadcast, ${address.trim()}`);

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const SANS = "Arial,'Helvetica Neue',Helvetica,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";
const QUIET = "#56635b";

function pieceHtml(x: Piece, p: Pick<Palette, "board" | "tile" | "ink">, firstButton: boolean, fallback: boolean): string {
  switch (x.type) {
    case "p":
      return `<p class="m-ink" style="margin:0 0 16px;font-family:${SERIF};font-size:18px;line-height:1.6;color:${p.ink}">${esc(x.text)}</p>`;
    case "h":
      return `<h2 class="m-ink" style="margin:26px 0 8px;font-family:${SANS};font-size:21px;line-height:1.25;font-weight:bold;color:${p.ink}">${esc(x.text)}</h2>`;
    case "small":
      return `<p class="m-quiet" style="margin:0 0 14px;font-family:${SANS};font-size:15px;line-height:1.5;color:${QUIET}">${esc(x.text)}</p>`;
    case "code":
      return `<p class="m-ink" style="margin:6px 0 22px;font-family:${SANS};font-size:36px;line-height:1.2;font-weight:bold;letter-spacing:8px;color:${p.ink}">${esc(x.code)}</p>`;
    case "link":
      return `<p style="margin:0 0 16px;font-family:${SANS};font-size:17px;line-height:1.5"><a class="m-ink" href="${esc(x.href)}" style="color:${p.board};font-weight:bold;text-decoration:underline">${esc(x.label)}</a></p>`;
    case "button": {
      const btn = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 ${firstButton && fallback ? 10 : 22}px"><tr><td class="m-btn" align="center" bgcolor="${p.board}" style="background:${p.board};border-radius:10px"><a href="${esc(x.href)}" style="display:block;padding:16px 20px;font-family:${SANS};font-size:19px;line-height:1.2;font-weight:bold;color:${p.tile};text-decoration:none;border-radius:10px">${esc(x.label)}</a></td></tr></table>`;
      const line =
        firstButton && fallback
          ? `<p class="m-quiet" style="margin:0 0 20px;font-family:${SANS};font-size:15px;line-height:1.5;color:${QUIET}">Button not working? <a class="m-quiet" href="${esc(x.href)}" style="color:${QUIET};text-decoration:underline">Use this link.</a></p>`
          : "";
      return btn + line;
    }
    case "photo": {
      const img = `<img src="${esc(x.src)}" alt="${esc(x.alt)}" width="544" style="display:block;width:100%;max-width:544px;height:auto;border:0;border-radius:8px">`;
      return `<div style="margin:6px 0 20px">${x.href ? `<a href="${esc(x.href)}">${img}</a>` : img}</div>`;
    }
    case "film": {
      const still = x.src
        ? `<td background="${esc(x.src)}" bgcolor="#14231b" valign="middle" align="center" style="background:#14231b url('${esc(x.src)}') center/cover no-repeat;height:240px;border-radius:8px">`
        : `<td bgcolor="#14231b" valign="middle" align="center" style="background:#14231b;height:240px;border-radius:8px">`;
      return `<a href="${esc(x.href)}" style="text-decoration:none"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 8px"><tr>${still}<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" width="64" height="64" style="width:64px;height:64px;border-radius:32px;background:#ffffff;font-family:${SANS};font-size:26px;line-height:64px;color:#14231b" aria-label="Play">&#9654;</td></tr></table></td></tr></table></a><p class="m-quiet" style="margin:0 0 20px;font-family:${SANS};font-size:15px;line-height:1.5;color:${QUIET}">${esc(x.caption)}</p>`;
    }
    case "quote":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 22px"><tr><td style="border-left:4px solid ${p.board};padding:4px 0 4px 18px"><p class="m-ink" style="margin:0 0 6px;font-family:${SERIF};font-style:italic;font-size:20px;line-height:1.45;color:${p.ink}">&ldquo;${esc(x.text)}&rdquo;</p><p class="m-quiet" style="margin:0;font-family:${SANS};font-size:15px;color:${QUIET}">${esc(x.by)}</p></td></tr></table>`;
    case "html":
      return x.html;
  }
}

function pieceText(x: Piece): string {
  switch (x.type) {
    case "p":
    case "small":
      return x.text;
    case "h":
      return x.text.toUpperCase();
    case "code":
      return `Your code: ${x.code}`;
    case "button":
    case "link":
      return `${x.label}: ${x.href}`;
    case "photo":
      return x.href ? `${x.alt}: ${x.href}` : "";
    case "film":
      return `${x.caption}: ${x.href}`;
    case "quote":
      return `"${x.text}"\n${x.by}`;
    case "html":
      return x.text;
  }
}

export function compose(c: Composed): { subject: string; html: string; text: string } {
  const p = { ...BRAND_PALETTE, ...(c.look.palette ?? {}) };
  const fallback = c.fallbackLink !== false;
  let seenButton = false;
  const body = c.body
    .map((x) => {
      const first = x.type === "button" && !seenButton;
      if (x.type === "button") seenButton = true;
      return pieceHtml(x, p, first, fallback);
    })
    .join("\n");
  const pre = c.preheader ?? c.body.find((x): x is { type: "p"; text: string } => x.type === "p")?.text ?? "";
  const f = c.footer;
  const footer =
    f.kind === "service"
      ? esc(companyLine(f.address))
      : `${esc(f.why)}<br>${esc(companyLine(f.address))}<br><br><a class="m-quiet" href="${esc(f.prefs)}" style="color:${QUIET};text-decoration:underline">Change what you get</a>&nbsp;&nbsp;&nbsp;<a class="m-quiet" href="${esc(f.stop)}" style="color:${QUIET};text-decoration:underline">${esc(f.stopLabel ?? "Stop these emails")}</a>`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(c.subject)}</title>
<style>
body{margin:0;padding:0;-webkit-text-size-adjust:100%}
@media (max-width:620px){.m-pad{padding-left:20px!important;padding-right:20px!important}.m-h1{font-size:25px!important}}
@media (prefers-color-scheme:dark){.m-bg{background:#0f1512!important}.m-card{background:#18201b!important}.m-ink{color:#eaefeb!important}.m-quiet{color:#aebbb3!important}.m-rule{border-color:#2c3731!important}.m-btn{background:#eaefeb!important}.m-btn a{color:#0f1512!important}}
[data-ogsc] .m-ink{color:#eaefeb!important}[data-ogsc] .m-quiet{color:#aebbb3!important}[data-ogsb] .m-card{background:#18201b!important}
</style></head>
<body class="m-bg" style="margin:0;padding:0;background:${p.mist}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(pre.slice(0, 140))}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" class="m-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${p.mist}" style="background:${p.mist}"><tr><td align="center" style="padding:16px 10px 28px">
<table role="presentation" class="m-card" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td class="m-pad" bgcolor="${p.board}" style="background:${p.board};padding:20px 28px">
<div style="font-family:${SANS};font-size:22px;line-height:1.25;font-weight:bold;color:${p.tile}">${esc(c.look.name)}</div>${c.look.sub ? `\n<div style="font-family:${SANS};font-size:15px;line-height:1.4;color:${p.tile};opacity:.85;padding-top:3px">${esc(c.look.sub)}</div>` : ""}
</td></tr>
<tr><td class="m-pad" style="padding:30px 28px 10px">
${c.headline ? `<h1 class="m-ink m-h1" style="margin:0 0 16px;font-family:${SANS};font-size:27px;line-height:1.2;font-weight:bold;color:${p.ink}">${esc(c.headline)}</h1>\n` : ""}${body}
</td></tr>
<tr><td class="m-pad m-rule m-quiet" style="padding:18px 28px 26px;border-top:1px solid #e3e8e5;font-family:${SANS};font-size:14px;line-height:1.6;color:${QUIET}">${footer}</td></tr>
</table></td></tr></table></body></html>`;

  const foot =
    f.kind === "service"
      ? companyLine(f.address)
      : `${f.why}\n${companyLine(f.address)}\n\nChange what you get: ${f.prefs}\n${f.stopLabel ?? "Stop these emails"}: ${f.stop}`;
  const text = [c.look.name, c.headline ?? "", ...c.body.map(pieceText).filter(Boolean), "", "--", foot]
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .concat("\n");
  return { subject: c.subject, html, text };
}
