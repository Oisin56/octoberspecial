import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../admin", () => ({
  adminClient: () => {
    throw new Error("no database in unit tests");
  },
}));

import { compose } from "./design";
import { checkWords, fill, paragraphs, placeholdersIn, SERVICE } from "./words";
import { datesSignature, roundLine, roundsIcs } from "./ics";
import { emailKey, readKey, readTap, tapLink } from "./tokens";

process.env.SESSION_SECRET = "unit-test-secret";

describe("filling in an email's words", () => {
  it("fills placeholders", () => {
    expect(fill("Hi {first name}, here's your link for {tournament}", { "first name": "Neil", tournament: "Kinsale Spring Classic" })).toBe("Hi Neil, here's your link for Kinsale Spring Classic");
  });
  it("reads Hi, with no first name", () => {
    expect(fill("Hi {first name}, you're in.", { "first name": "" })).toBe("Hi, you're in.");
    expect(fill("Hi {first name}.", { "first name": null })).toBe("Hi.");
  });
  it("leaves a placeholder it doesn't know", () => {
    expect(fill("{code} is your code", {})).toBe("{code} is your code");
  });
  it("splits lines into paragraphs at blank lines", () => {
    expect(paragraphs("One line\nstill the first.\n\nSecond.\n\n\n")).toEqual(["One line still the first.", "Second."]);
  });
  it("finds placeholders", () => {
    expect(placeholdersIn("Hi {First Name} from {tournament}")).toEqual(["first name", "tournament"]);
  });
});

describe("checking words before they're saved", () => {
  const playerLink = SERVICE.find((d) => d.key === "player-link")!;
  const ok = { subject: "Your link for {tournament}", headline: "Hi {first name}", lines: "Tap it.", button: "Open my link" };
  it("accepts fair words", () => {
    expect(checkWords(playerLink, ok)).toBeNull();
  });
  it("refuses an empty subject or button", () => {
    expect(checkWords(playerLink, { ...ok, subject: " " })).toMatch(/subject/);
    expect(checkWords(playerLink, { ...ok, button: "" })).toMatch(/button/);
  });
  it("refuses a placeholder the email can't fill", () => {
    expect(checkWords(playerLink, { ...ok, lines: "Your code is {code}" })).toMatch(/\{code\} isn't something/);
  });
  it("refuses markup", () => {
    expect(checkWords(playerLink, { ...ok, lines: "<b>Bold</b>" })).toMatch(/Leave out/);
  });
  it("lets a series step with mayBeEmpty have no lines yet", () => {
    expect(checkWords({ ...playerLink, mayBeEmpty: true }, { ...ok, lines: "" })).toBeNull();
  });
});

describe("the email design", () => {
  const m = compose({
    subject: "Your film is ready",
    look: { name: "Kinsale <Spring> Classic", palette: { board: "#0d5134", tile: "#ffffff", mist: "#f2f0e6", ink: "#13241a" } },
    headline: "Your film is ready",
    body: [
      { type: "p", text: "It's in Highlights & ready to share." },
      { type: "button", label: "Watch the film", href: "https://example.com/film?a=1&b=2" },
    ],
    footer: { kind: "list", why: "You're getting this because you follow it.", address: "1 Main Street", prefs: "https://example.com/email?k=p", stop: "https://example.com/email?k=s" },
  });
  it("escapes everything it's given", () => {
    expect(m.html).toContain("Kinsale &lt;Spring&gt; Classic");
    expect(m.html).toContain("Highlights &amp; ready");
    expect(m.html).toContain('href="https://example.com/film?a=1&amp;b=2"');
  });
  it("has a plain link under the first button, and the footer", () => {
    expect(m.html).toContain("Button not working?");
    expect(m.html).toContain("Change what you get");
    expect(m.html).toContain("Stop these emails");
    expect(m.html).toContain("1 Main Street");
  });
  it("works in dark mode and has no tracking picture", () => {
    expect(m.html).toContain("prefers-color-scheme:dark");
    expect(m.html).not.toMatch(/<img[^>]+width="1"/);
  });
  it("comes with a plain text copy with the link", () => {
    expect(m.text).toContain("Watch the film: https://example.com/film?a=1&b=2");
    expect(m.text).toContain("Change what you get: https://example.com/email?k=p");
  });
});

describe("the calendar file", () => {
  const rounds = [
    { id: "r1", number: 1, course_name: "Old Head, Kinsale", play_date: "2026-06-13", tee_time: "09:10:00" },
    { id: "r2", number: 2, course_name: "Farrangalway", play_date: "2026-06-14", tee_time: null },
    { id: "r3", number: 3, course_name: "Not set", play_date: null, tee_time: null },
  ];
  const ics = roundsIcs("Kinsale Spring Classic", rounds, "https://example.com/t/k/in/abc", new Date("2026-05-01T10:00:00Z"))!;
  it("has one event per dated round, tee times as local times", () => {
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain("DTSTART:20260613T091000");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260614");
    expect(ics).toContain("DTEND;VALUE=DATE:20260615");
    expect(ics).toContain("UID:r1@mygolfbroadcast.com");
  });
  it("escapes commas and keeps lines short", () => {
    expect(ics).toContain("Old Head\\, Kinsale");
    for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  });
  it("is null when nothing has a date", () => {
    expect(roundsIcs("X", [rounds[2]], "https://x")).toBeNull();
  });
  it("reads a round in words, and notices a change", () => {
    expect(roundLine(rounds[0])).toBe("Round 1: Saturday 13 June, Old Head, Kinsale, 09:10");
    expect(datesSignature(rounds)).not.toBe(datesSignature([{ ...rounds[0], tee_time: "09:20" }, rounds[1], rounds[2]]));
  });
});

describe("signed links", () => {
  it("reads back what it signed", () => {
    const k = emailKey("Neil@Example.com", "m", "00000000-0000-4000-8000-000000000001");
    expect(readKey(k)).toEqual({ email: "neil@example.com", scope: "m", send: "00000000-0000-4000-8000-000000000001" });
  });
  it("refuses a changed or made-up key", () => {
    const k = emailKey("neil@example.com", "p");
    const [body, sig] = k.split(".");
    const other = Buffer.from("someone@else.com\nm\n").toString("base64url");
    expect(readKey(`${other}.${sig}`)).toBeNull();
    expect(readKey(`${body}.AAAAAAAAAAAAAAAAAAAAAA`)).toBeNull();
    expect(readKey("nonsense")).toBeNull();
  });
  it("only counts taps on links it made", () => {
    const l = new URL(tapLink("https://site", "00000000-0000-4000-8000-000000000002", "https://site/new"));
    expect(readTap(l.searchParams.get("s"), l.searchParams.get("u"), l.searchParams.get("k"))).toBe(true);
    expect(readTap(l.searchParams.get("s"), "https://evil.example", l.searchParams.get("k"))).toBe(false);
  });
});
