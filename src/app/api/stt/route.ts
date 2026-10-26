import { PRICES, claude, paidFetch } from "@/lib/usage";
import { isCrew } from "@/lib/auth";
import { adminClient } from "@/lib/admin";
import { bad, context, json, DEMO_READONLY } from "@/lib/server-data";
import { GOLF_TERMS } from "@/lib/golfTerms";

export const maxDuration = 60;
const MODEL = process.env.AI_MODEL || "claude-sonnet-5-5";

/**
 * Speech to text for notes on the course. ElevenLabs Scribe v2, told the players' names, the courses and golf
 * words up front; then a light tidy-up that fixes only misheard names and golf terms.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return bad("Bad request");
  const { t, session, demo } = await context(req, { t: String(form.get("t") ?? "") });
  if (!t) return bad("Tournament not found", 404);
  if (demo) return bad(DEMO_READONLY, 403);
  if (!isCrew(session)) return bad("Log in to use voice notes", 401);
  if (!process.env.ELEVENLABS_API_KEY) return bad("Voice notes aren't set up (no ElevenLabs key)", 500);
  const audio = form.get("file");
  if (!(audio instanceof Blob) || audio.size < 1000) return bad("Nothing was recorded. Hold the button while you speak.");
  if (audio.size > 8 * 1024 * 1024) return bad("That's too long. Keep voice notes under a minute.");

  // Words to listen for: this tournament's people and places, then golf
  const db = adminClient();
  const [{ data: players }, { data: rounds }] = await Promise.all([
    db.from("public_players").select("name,nickname").eq("tournament_id", t.id),
    db.from("rounds").select("course_name").eq("tournament_id", t.id),
  ]);
  const names = [...new Set([...(players ?? []).flatMap((p) => [p.name, p.nickname]), ...(rounds ?? []).map((r) => r.course_name), t.name].filter((x): x is string => !!x && x.length <= 50))];
  const keyterms = [...names, ...GOLF_TERMS].slice(0, 100);

  const raw = await transcribe(audio, keyterms);
  if (!raw.ok) return bad(raw.error, 502);
  const text = raw.text.trim();
  if (!text) return json({ text: "", raw: "" });
  const tidy = await tidyUp(text, names).catch(() => text);
  return json({ text: tidy, raw: text });
}

async function transcribe(audio: Blob, keyterms: string[]): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const base = process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io";
  const send = (mode: "repeat" | "json" | "none") => {
    const f = new FormData();
    f.append("file", audio, "note.webm");
    f.append("model_id", "scribe_v2");
    f.append("language_code", "en");
    f.append("tag_audio_events", "false");
    if (mode === "repeat") keyterms.forEach((k) => f.append("keyterms", k));
    if (mode === "json") f.append("keyterms", JSON.stringify(keyterms));
    return paidFetch("voices", "spoken note", `${base}/v1/speech-to-text`, { method: "POST", headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! }, body: f }, { cents: PRICES.listenPerMinute / 4 });
  };
  // The word list is sent as repeated fields; if the service wants it another way, try that, then without it
  let last = "";
  for (const mode of ["repeat", "json", "none"] as const) {
    const r = await send(mode);
    if (r.ok) {
      const j = (await r.json().catch(() => ({}))) as { text?: string };
      return { ok: true, text: j.text ?? "" };
    }
    last = `${r.status}: ${(await r.text()).slice(0, 200)}`;
    if (r.status === 401 || r.status === 402 || r.status === 429) break;
    if (!(r.status === 400 || r.status === 422) || !/keyterm/i.test(last)) break;
  }
  return { ok: false, error: `The voice note didn't go through (${last}). Try again, or type it.` };
}

/** Fix misheard names and golf words only; never rewrite what was said. */
async function tidyUp(text: string, names: string[]): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) return text;
  const client = claude("note tidy-up");
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system:
      "You correct speech-to-text from a golf course. Fix only words that were clearly misheard: player names, course names and golf terms (e.g. 'birdy' → 'birdie', 'lipped out', 'gimme', 'shanked'). Keep the speaker's words, slang and tone otherwise exactly. Add sensible punctuation. Reply with the corrected text only.",
    messages: [{ role: "user", content: `Names: ${names.join(", ")}\n\nTranscript: ${text}` }],
  });
  const out = msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("")
    .trim();
  // Safety: a tidy-up that changes the length a lot isn't a tidy-up
  return out && out.length < text.length * 1.6 + 20 && out.length > text.length * 0.5 ? out : text;
}
