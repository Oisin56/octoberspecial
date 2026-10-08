/**
 * The newsletter email: masthead, hero, scoreboard strip, the article with a drop cap
 * and pull quote, a round card, results, a highlight, buttons and footer.
 * Table-based with inline styles so it holds up in Gmail, Apple Mail and Outlook;
 * a <style> block adds phone and dark-mode touches where clients support them.
 * Pure: takes prepared data, returns subject + HTML + plain text.
 */
import { cleanBody, cleanTitle } from "./cleanText";
import type { Palette } from "./themes";

export interface NewsletterData {
  tournamentName: string;
  palette: Palette;
  logo?: string | null;
  issue: number;
  dateLabel: string;
  label: string; // "Preview · Round 2"
  kind: "preview" | "report" | "tournament" | "bulletin";
  title: string;
  body: string;
  hero?: { src: string; alt: string; credit?: string } | null;
  standings: { name: string; value: string; lead: boolean }[];
  standingsTitle: string;
  leadLine?: string | null; // "Oisin leads by 12"
  tug?: { left: string; right: string; leftPct: number; rightPct: number; target: string } | null;
  awards: { label: string; value: string; note: string }[];
  roundCard?: { heading: string; rows: [string, string][] } | null;
  results?: { heading: string; rows: [string, string, string][] } | null; // segment, result, points
  highlight?: { caption: string; link: string } | null;
  links: { primary: { label: string; href: string }; secondary: { label: string; href: string } };
  siteHref: string;
  siteLabel: string;
  promoHref?: string | null;
  unsubscribe: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const SANS = "'Arial Narrow','Helvetica Neue',Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

/** Paragraphs and subheadings, the same rule as the site. */
export function articleBlocks(body: string): { head?: string; text?: string }[] {
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

/** A striking sentence from the middle of a long article, or null. */
export function pickPullQuote(blocks: { head?: string; text?: string }[]): string | null {
  const paras = blocks.filter((b) => b.text).map((b) => b.text!);
  const words = paras.join(" ").split(/\s+/).length;
  if (words < 200 || paras.length < 5) return null;
  const middle = paras.slice(2, -1);
  const sentences = middle.flatMap((p) => p.match(/[^.!?]+[.!?]/g) ?? []).map((s) => s.trim());
  const good = sentences.filter((s) => s.length >= 50 && s.length <= 160 && !/^(But|And|So|He|She|It|They)\b/.test(s));
  if (!good.length) return null;
  // Prefer lines with a name, a number or punchy punctuation
  good.sort((a, b) => score(b) - score(a));
  return good[0];
  function score(s: string) {
    return (/[A-Z][a-z]+/.test(s.slice(1)) ? 2 : 0) + (/\d/.test(s) ? 1 : 0) + (/[!—–]/.test(s) ? 1 : 0) - Math.abs(s.length - 95) / 40;
  }
}

export function newsletterEmail(d: NewsletterData) {
  const p = d.palette;
  const gold = "#c9a227";
  const blocks = articleBlocks(d.body);
  const quote = pickPullQuote(blocks);
  const title = cleanTitle(d.title) || d.label;

  // ---- article with a drop cap and an optional pull quote after the third paragraph
  let paraN = 0;
  let quoted = false;
  const article = blocks
    .map((b) => {
      if (b.head) return `<h2 class="nl-h2" style="margin:26px 0 6px;font-family:${SANS};font-size:21px;line-height:1.2;color:${p.board};font-weight:700;letter-spacing:.2px">${esc(b.head)}</h2>`;
      paraN++;
      let html: string;
      if (paraN === 1) {
        const t = b.text!;
        const first = t.charAt(0);
        html = `<p class="nl-p" style="margin:0 0 16px;font-family:${SERIF};font-size:18px;line-height:1.6;color:${p.ink}"><span class="nl-drop" style="float:left;font-family:${SERIF};font-size:58px;line-height:48px;padding:6px 8px 0 0;color:${p.board};font-weight:700">${esc(first)}</span>${esc(t.slice(1))}</p>`;
      } else html = `<p class="nl-p" style="margin:0 0 16px;font-family:${SERIF};font-size:18px;line-height:1.6;color:${p.ink}">${esc(b.text!)}</p>`;
      if (quote && !quoted && paraN === 3) {
        quoted = true;
        html += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 22px"><tr><td style="border-left:4px solid ${gold};padding:6px 0 6px 18px;font-family:${SERIF};font-style:italic;font-size:23px;line-height:1.35;color:${p.board}">&ldquo;${esc(quote)}&rdquo;</td></tr></table>`;
      }
      return html;
    })
    .join("\n");

  // ---- scoreboard strip
  const tile = (v: string, lead: boolean) =>
    `<td align="center" style="background:#ffffff;border-radius:8px;padding:6px 10px;min-width:52px;font-family:${SANS};font-size:34px;line-height:38px;font-weight:700;color:${lead ? p.red : p.ink};${lead ? `box-shadow:0 0 0 2px ${gold};` : ""}">${esc(v)}</td>`;
  const rows = d.standings
    .slice(0, 6)
    .map(
      (s, i) => `<tr><td style="padding:${i ? 10 : 2}px 0 2px;border-top:${i ? "1px solid rgba(255,255,255,.12)" : "0"}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
   <td style="font-family:${SANS};font-size:26px;font-weight:700;color:#ffffff;line-height:1.1">${esc(s.name)}${s.lead && d.leadLine ? ` <span style="display:inline-block;vertical-align:middle;background:${gold};color:#1b1408;font-size:11px;letter-spacing:1px;text-transform:uppercase;padding:3px 8px;border-radius:99px">${esc(d.leadLine)}</span>` : ""}</td>
   <td align="right"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${tile(s.value, s.lead)}</tr></table></td>
  </tr></table></td></tr>`,
    )
    .join("");
  const tug = d.tug
    ? `<tr><td style="padding:14px 0 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:99px;overflow:hidden;background:rgba(255,255,255,.12)"><tr>
   ${d.tug.leftPct > 0 ? `<td width="${d.tug.leftPct.toFixed(1)}%" style="height:10px;line-height:10px;font-size:0;background:${gold}">&nbsp;</td>` : ""}
   <td style="height:10px;line-height:10px;font-size:0">&nbsp;</td>
   ${d.tug.rightPct > 0 ? `<td width="${d.tug.rightPct.toFixed(1)}%" style="height:10px;line-height:10px;font-size:0;background:${p.red}">&nbsp;</td>` : ""}
  </tr></table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:5px"><tr>
   <td style="font-family:${SANS};font-size:12px;color:#cfdcd3">${esc(d.tug.left)}</td>
   <td align="center" style="font-family:${SANS};font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#9fb6a7">${esc(d.tug.target)}</td>
   <td align="right" style="font-family:${SANS};font-size:12px;color:#cfdcd3">${esc(d.tug.right)}</td>
  </tr></table></td></tr>`
    : "";
  const awards = d.awards.length
    ? `<tr><td style="padding:14px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${d.awards
        .slice(0, 3)
        .map(
          (a, i) =>
            `<td width="${Math.floor(100 / Math.min(3, d.awards.length))}%" valign="top" style="padding:${i ? "0 0 0 6px" : "0"}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:9px 10px">
  <div style="font-family:${SANS};font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#9fb6a7">${esc(a.label)}</div>
  <div style="font-family:${SANS};font-size:20px;font-weight:700;color:#ffffff;line-height:1.2">${esc(a.value)}</div>
  <div style="font-family:${SANS};font-size:11px;color:${gold}">${esc(a.note)}</div></td></tr></table></td>`,
        )
        .join("")}</tr></table></td></tr>`
    : "";
  const scoreboard = d.standings.length
    ? `<tr><td class="nl-pad" style="padding:0 28px 6px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${p.board}" style="background:${p.board};background-image:linear-gradient(140deg,${p.board} 0%,${p.boardDeep} 100%);border-radius:14px;border-top:3px solid ${gold}"><tr><td style="padding:16px 18px 16px">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td style="font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${gold};padding-bottom:6px">${esc(d.standingsTitle)}</td></tr>
  ${rows}${tug}${awards}
 </table></td></tr></table></td></tr>`
    : "";

  // ---- round card and results
  const card = (heading: string, inner: string) =>
    `<tr><td class="nl-pad" style="padding:6px 28px 6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${p.mist};border-radius:12px"><tr><td style="padding:16px 18px">
  <div style="font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${p.bracken};padding-bottom:8px">${esc(heading)}</div>${inner}</td></tr></table></td></tr>`;
  const roundCard = d.roundCard
    ? card(
        d.roundCard.heading,
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${d.roundCard.rows
          .map(
            ([k, v]) =>
              `<tr><td valign="top" style="padding:5px 12px 5px 0;font-family:${SANS};font-size:14px;color:#5b6a61;white-space:nowrap;width:110px">${esc(k)}</td><td style="padding:5px 0;font-family:${SERIF};font-size:16px;line-height:1.45;color:${p.ink}">${esc(v)}</td></tr>`,
          )
          .join("")}</table>`,
      )
    : "";
  const results = d.results?.rows.length
    ? card(
        d.results.heading,
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${d.results.rows
          .map(
            ([seg, res, pts], i) =>
              `<tr><td style="padding:7px 10px 7px 0;border-top:${i ? `1px solid #d6ddd8` : "0"};font-family:${SANS};font-size:14px;font-weight:700;color:${p.ink};white-space:nowrap">${esc(seg)}</td><td style="padding:7px 10px 7px 0;border-top:${i ? `1px solid #d6ddd8` : "0"};font-family:${SERIF};font-size:15px;color:${p.ink}">${esc(res)}</td><td align="right" style="padding:7px 0;border-top:${i ? `1px solid #d6ddd8` : "0"};font-family:${SANS};font-size:14px;font-weight:700;color:${p.board};white-space:nowrap">${esc(pts)}</td></tr>`,
          )
          .join("")}</table>`,
      )
    : "";
  const highlight = d.highlight
    ? `<tr><td class="nl-pad" style="padding:6px 28px 6px"><a href="${esc(d.highlight.link)}" style="text-decoration:none"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${p.boardDeep}" style="background:${p.boardDeep};border-radius:12px"><tr>
  <td width="64" align="center" style="padding:14px 0 14px 16px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" width="44" height="44" style="width:44px;height:44px;border-radius:22px;background:${p.red};font-family:Arial,sans-serif;font-size:18px;color:#ffffff;line-height:44px">&#9654;</td></tr></table></td>
  <td style="padding:14px 16px;font-family:${SANS};color:#ffffff"><div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${gold}">Watch the highlight</div><div style="font-size:18px;font-weight:700;line-height:1.25">${esc(d.highlight.caption)}</div></td>
 </tr></table></a></td></tr>`
    : "";

  const btn = (label: string, href: string, solid: boolean) =>
    `<td style="padding:4px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="${solid ? p.board : "#ffffff"}" style="border-radius:10px;${solid ? `background:${p.board};` : `border:2px solid ${p.board};`}"><a href="${esc(href)}" style="display:inline-block;padding:13px 20px;font-family:${SANS};font-size:16px;font-weight:700;color:${solid ? "#ffffff" : p.board};text-decoration:none">${esc(label)}</a></td></tr></table></td>`;

  const hero = d.hero
    ? `<tr><td style="padding:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td background="${esc(d.hero.src)}" bgcolor="${p.boardDeep}" valign="bottom" style="background:${p.boardDeep} url('${esc(d.hero.src)}') center/cover no-repeat;height:280px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="nl-pad" style="padding:110px 28px 22px;background-image:linear-gradient(180deg,rgba(0,0,0,0) 0%,rgba(0,0,0,.55) 55%,rgba(0,0,0,.78) 100%)">
   <div style="font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${gold}">${esc(d.label)}</div>
   <h1 class="nl-h1" style="margin:6px 0 0;font-family:${SANS};font-size:36px;line-height:1.05;font-weight:700;color:#ffffff">${esc(title)}</h1>
  </td></tr></table></td></tr>${d.hero.credit ? `<tr><td style="padding:4px 28px 0;font-family:Arial,sans-serif;font-size:10px;color:#8a948e">${esc(d.hero.credit)}</td></tr>` : ""}</table></td></tr>`
    : `<tr><td class="nl-pad" style="padding:26px 28px 6px"><div style="font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${p.bracken}">${esc(d.label)}</div><h1 class="nl-h1" style="margin:6px 0 0;font-family:${SANS};font-size:36px;line-height:1.05;font-weight:700;color:${p.ink}">${esc(title)}</h1></td></tr>`;

  const preheader = (blocks.find((b) => b.text)?.text ?? "").slice(0, 140);

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(title)}</title>
<style>
@media (max-width:620px){.nl-pad{padding-left:18px!important;padding-right:18px!important}.nl-h1{font-size:30px!important}.nl-p{font-size:17px!important}}
@media (prefers-color-scheme:dark){.nl-body,.nl-card{background:#111814!important}.nl-p,.nl-h1-plain{color:#e8ece9!important}.nl-h2,.nl-drop{color:#d9c27a!important}}
</style></head>
<body class="nl-body" style="margin:0;padding:0;background:${p.mist}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${p.mist}" style="background:${p.mist}"><tr><td align="center" style="padding:18px 10px 28px">
<table role="presentation" class="nl-card" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.08)">
<tr><td bgcolor="${p.board}" style="background:${p.board};background-image:linear-gradient(180deg,${p.board},${p.boardDeep});border-bottom:3px solid ${gold}">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  ${d.logo ? `<td width="52" class="nl-pad" style="padding:16px 0 16px 28px"><img src="${esc(d.logo)}" width="40" height="40" alt="" style="display:block;border-radius:8px;border:0"></td>` : ""}
  <td class="nl-pad" style="padding:16px 28px;${d.logo ? "padding-left:12px;" : ""}font-family:${SANS};color:#ffffff"><div style="font-size:24px;font-weight:700;line-height:1.1">${esc(d.tournamentName)}</div><div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#cfdcd3;padding-top:3px">Issue ${d.issue} · ${esc(d.dateLabel)}</div></td>
 </tr></table></td></tr>
${hero}
<tr><td style="height:22px;line-height:22px;font-size:0">&nbsp;</td></tr>
${scoreboard}
<tr><td class="nl-pad" style="padding:20px 28px 4px">${d.hero ? "" : ""}${article}</td></tr>
${roundCard}
${results}
${highlight}
<tr><td class="nl-pad" align="center" style="padding:18px 24px 8px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${btn(d.links.primary.label, d.links.primary.href, true)}${btn(d.links.secondary.label, d.links.secondary.href, false)}</tr></table></td></tr>
<tr><td class="nl-pad" style="padding:18px 28px 24px;border-top:1px solid #e3e8e5;font-family:Arial,sans-serif;font-size:12px;line-height:1.6;color:#6b756f">
 ${d.promoHref ? `<div style="padding-bottom:8px"><a href="${esc(d.promoHref)}" style="color:${p.board};font-weight:bold;text-decoration:none">Run your own golf trip with MyGolfSpecial</a></div>` : ""}
 You're getting this because you follow ${esc(d.tournamentName)} at <a href="${esc(d.siteHref)}" style="color:#6b756f">${esc(d.siteLabel)}</a>. <a href="${esc(d.unsubscribe)}" style="color:#6b756f">Unsubscribe</a>.
</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    `${d.tournamentName} · Issue ${d.issue} · ${d.dateLabel}`,
    d.label.toUpperCase(),
    "",
    title,
    "",
    d.standings.length ? `${d.standingsTitle}: ${d.standings.map((s) => `${s.name} ${s.value}`).join(", ")}${d.leadLine ? ` (${d.leadLine})` : ""}` : "",
    "",
    blocks.map((b) => (b.head ? b.head.toUpperCase() : b.text)).join("\n\n"),
    "",
    d.roundCard ? `${d.roundCard.heading}\n${d.roundCard.rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n` : "",
    d.results ? `${d.results.heading}\n${d.results.rows.map((r) => r.join(" · ")).join("\n")}\n` : "",
    d.highlight ? `Watch the highlight: ${d.highlight.caption} ${d.highlight.link}\n` : "",
    `${d.links.primary.label}: ${d.links.primary.href}`,
    `${d.links.secondary.label}: ${d.links.secondary.href}`,
    "",
    `Unsubscribe: ${d.unsubscribe}`,
  ]
    .filter((x) => x !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  return { subject: `${title} | ${d.tournamentName}`, html, text };
}
