/**
 * A calendar file with a tournament's rounds, attached to the player's link email. Each round keeps the same id, so
 * opening a newer file (after the dates change) moves the event rather than adding a second one. Tee times are local
 * "wall clock" times with no time zone: 9:10 means 9:10 wherever the course is, which is what a golfer wants.
 */

export interface IcsRound {
  id: string;
  number: number;
  course_name: string;
  play_date: string | null;
  tee_time?: string | null;
}

const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Long lines are folded at 75 bytes, as the format asks */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, "utf8") > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function roundsIcs(tournamentName: string, rounds: IcsRound[], link: string, now = new Date()): string | null {
  const dated = rounds.filter((r) => r.play_date && /^\d{4}-\d{2}-\d{2}$/.test(r.play_date));
  if (!dated.length) return null;
  const seq = Math.floor(now.getTime() / 60000) % 2_000_000_000;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MyGolfBroadcast//Rounds//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const r of dated) {
    const day = r.play_date!.replace(/-/g, "");
    const tee = r.tee_time && /^\d{2}:\d{2}/.test(r.tee_time) ? r.tee_time.slice(0, 5).replace(":", "") : null;
    lines.push("BEGIN:VEVENT", `UID:${r.id}@mygolfbroadcast.com`, `DTSTAMP:${stamp(now)}`, `SEQUENCE:${seq}`);
    if (tee) lines.push(`DTSTART:${day}T${tee}00`, "DURATION:PT5H");
    else {
      const next = new Date(`${r.play_date}T12:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, "")}`);
    }
    lines.push(
      fold(`SUMMARY:${icsText(`${tournamentName}: round ${r.number}, ${r.course_name}`)}`),
      fold(`LOCATION:${icsText(r.course_name)}`),
      fold(`DESCRIPTION:${icsText(`Scores, photos and the leaderboard: ${link}`)}`),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

/** "Round 1: Saturday 14 June, Old Head, 9:10" */
export function roundLine(r: IcsRound): string {
  const d = r.play_date ? new Date(`${r.play_date}T12:00:00Z`) : null;
  const part = (o: Intl.DateTimeFormatOptions) => d!.toLocaleDateString("en-IE", { ...o, timeZone: "UTC" });
  const when = d ? `${part({ weekday: "long" })} ${part({ day: "numeric" })} ${part({ month: "long" })}` : "date to be set";
  const tee = r.tee_time ? `, ${r.tee_time.slice(0, 5)}` : "";
  return `Round ${r.number}: ${when}, ${r.course_name}${tee}`;
}

/** What the players were last sent, to tell when it changes */
export const datesSignature = (rounds: IcsRound[]) =>
  rounds
    .map((r) => `${r.id}|${r.play_date ?? ""}|${(r.tee_time ?? "").slice(0, 5)}`)
    .sort()
    .join(";");
