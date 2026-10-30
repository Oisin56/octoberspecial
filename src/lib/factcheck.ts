import "server-only";
import { adminClient } from "./admin";
import { claude } from "./usage";
import { joinSentences, splitSentences } from "./sentences";

/**
 * The fact check, done quietly after every piece and every film script, before anything is published or recorded.
 * Every sentence is checked against the grid and the figures (names, holes, scores, results, clubs, distances). A
 * sentence that doesn't match goes back to the writer once to be fixed; if it still doesn't match, it's dropped and
 * the piece goes out without it. Nobody is asked anything. Each check is written down for the site owner's
 * Fact check panel.
 */

const MODEL = process.env.FACT_MODEL || process.env.AI_MODEL || "claude-sonnet-5-5";

export interface Problem {
  n: number;
  text: string;
  why: string;
}

export interface CheckLog {
  checked: number;
  /** Sentences that failed on the first check */
  first: number;
  fixed: number;
  dropped: Problem[];
  /** The check couldn't be done (the service failed): the piece went out unchecked */
  skipped?: boolean;
}

// ------------------------------------------------------------ the checker

const CHECK_RULES = `You check a golf write-up against the facts, sentence by sentence. Report a sentence when it states something about play that the facts contradict or don't support: a player's name or who did what, a hole number, a score or score word (birdie, par, bogey), a match or round result or margin, who led or when, a club, a distance or putt length, an outcome (fairway, bunker, water, holed), or a figure (counts, totals).

The facts have three kinds of cell. Told: use freely. Known from the score: may be said plainly (the last stroke went in) but not dressed up (not "a 30-footer" unless the length was told, not "a putt" unless a putt was told). Not told: must never be filled in, guessed at or hinted at; a sentence that does is a problem.
Figures must be quoted with what they are out of; a percentage is a problem.
Not problems: description of the course from the guide, the weather, mood, jokes, opinions, the stakes, paraphrase of what players said, anything about the standings that the standings support, and general colour that doesn't claim a fact about play.

Be strict about facts and relaxed about style. Report nothing when everything matches.`;

async function ask(system: string, user: string, tool: { name: string; description: string; input_schema: Record<string, unknown> }, what: string, maxTokens = 2000) {
  const msg = await claude(what).messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    tools: [tool as never],
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: user }],
  });
  const call = msg.content.find((b) => b.type === "tool_use") as { input?: Record<string, unknown> } | undefined;
  if (call?.input) return call.input;
  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (m)
    try {
      return JSON.parse(m[0]) as Record<string, unknown>;
    } catch {}
  throw new Error("The fact check came back unreadable");
}

const REPORT = {
  name: "report_problems",
  description: "List the sentences that don't match the facts (an empty list when they all do).",
  input_schema: {
    type: "object",
    properties: {
      problems: {
        type: "array",
        items: {
          type: "object",
          properties: { n: { type: "integer", description: "The sentence's number" }, why: { type: "string", description: "What doesn't match, in a few words (\"said 7 iron, the card says 8 iron\")" } },
          required: ["n", "why"],
        },
      },
    },
    required: ["problems"],
  },
};

/** The sentences that don't match the facts. `only`: check just these numbers (the rest are context). */
export async function findProblems(facts: string, lines: { n: number; text: string }[], opts: { only?: number[]; what?: string } = {}): Promise<Problem[]> {
  if (!lines.length) return [];
  const numbered = lines.map((l) => `${l.n}. ${l.text}`).join("\n");
  const only = opts.only?.length ? `\n\nCheck ONLY sentences ${opts.only.join(", ")}; the others are there for context.` : "";
  const got = await ask(CHECK_RULES, `THE FACTS\n${facts}\n\nTHE SENTENCES\n${numbered}${only}\n\nReport the problems with the report_problems tool.`, REPORT, opts.what ?? "fact check");
  const list = Array.isArray(got.problems) ? (got.problems as { n?: unknown; why?: unknown }[]) : [];
  const ok = new Set((opts.only?.length ? opts.only : lines.map((l) => l.n)).map(Number));
  const seen = new Set<number>();
  return list
    .map((p) => ({ n: Number(p.n), why: String(p.why ?? "").slice(0, 200) }))
    .filter((p) => ok.has(p.n) && !seen.has(p.n) && (seen.add(p.n), true))
    .map((p) => ({ ...p, text: lines.find((l) => l.n === p.n)?.text ?? "" }));
}

const FIX = {
  name: "fix_lines",
  description: "Hand back each corrected sentence.",
  input_schema: {
    type: "object",
    properties: {
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: { n: { type: "integer" }, text: { type: "string", description: "The corrected sentence, or empty to leave the point out" } },
          required: ["n", "text"],
        },
      },
    },
    required: ["lines"],
  },
};

/** Ask the writer once to correct the sentences that failed */
export async function fixLines(system: string, facts: string, problems: Problem[], context: string, what = "fact fix"): Promise<Map<number, string>> {
  const list = problems.map((p) => `${p.n}. ${p.text}\n   Doesn't match: ${p.why}`).join("\n");
  const got = await ask(
    system,
    `THE FACTS\n${facts}\n\nTHE PIECE SO FAR\n${context}\n\nThese sentences don't match the facts:\n${list}\n\nRewrite each one so it matches the facts exactly, in the same voice and about the same length, so it still reads well where it sits. If a sentence can't be put right from the facts, give it back empty. Never fill in anything marked not told. Hand them back with the fix_lines tool.`,
    FIX,
    what,
    3000,
  );
  const out = new Map<number, string>();
  for (const l of Array.isArray(got.lines) ? (got.lines as { n?: unknown; text?: unknown }[]) : []) {
    const n = Number(l.n);
    if (problems.some((p) => p.n === n)) out.set(n, typeof l.text === "string" ? l.text.trim() : "");
  }
  return out;
}

/**
 * Check a set of lines, fix the ones that fail once, and drop what still fails. Returns the lines as they'll go out
 * (an empty text = dropped) and the log.
 */
export async function checkLines(facts: string, lines: { n: number; text: string }[], fix: (problems: Problem[]) => Promise<Map<number, string>>, what = "fact check"): Promise<{ lines: Map<number, string>; log: CheckLog }> {
  const out = new Map(lines.map((l) => [l.n, l.text]));
  const log: CheckLog = { checked: lines.length, first: 0, fixed: 0, dropped: [] };
  let problems: Problem[];
  try {
    problems = await findProblems(facts, lines, { what });
  } catch (e) {
    console.error("[factcheck] check failed:", e instanceof Error ? e.message : e);
    return { lines: out, log: { ...log, skipped: true } };
  }
  log.first = problems.length;
  if (!problems.length) return { lines: out, log };
  let fixed = new Map<number, string>();
  try {
    fixed = await fix(problems);
  } catch (e) {
    console.error("[factcheck] fix failed:", e instanceof Error ? e.message : e);
  }
  const changed: number[] = [];
  for (const p of problems) {
    const t = fixed.get(p.n);
    if (t) {
      out.set(p.n, t);
      changed.push(p.n);
    } else out.set(p.n, "");
  }
  // The writer chose to leave these out: dropped
  for (const p of problems) if (!fixed.get(p.n)) log.dropped.push(p);
  if (changed.length) {
    let still: Problem[] = [];
    try {
      still = await findProblems(
        facts,
        [...out.entries()].filter(([, t]) => t).map(([n, text]) => ({ n, text })),
        { only: changed, what },
      );
    } catch (e) {
      // Can't check the fixes: leave them out rather than publish something unchecked
      console.error("[factcheck] recheck failed:", e instanceof Error ? e.message : e);
      still = changed.map((n) => ({ n, text: out.get(n)!, why: "couldn't be checked again" }));
    }
    for (const p of still) {
      log.dropped.push({ ...p, why: problems.find((x) => x.n === p.n)?.why ?? p.why });
      out.set(p.n, "");
    }
    log.fixed = changed.length - still.length;
  }
  return { lines: out, log };
}

// ------------------------------------------------------------ a written piece

/**
 * Check a written piece: the headline is line 0, the body's sentences 1 onwards. Returns the piece as it goes out.
 */
export async function checkPiece(opts: { facts: string; title: string; body: string; system: string; fallbackTitle: string }): Promise<{ title: string; body: string; log: CheckLog }> {
  const sentences = splitSentences(opts.body);
  const lines = [{ n: 0, text: opts.title }, ...sentences.map((s) => ({ n: s.n, text: s.text }))];
  const context = `Headline: ${opts.title}\n\n${opts.body}`;
  const { lines: out, log } = await checkLines(opts.facts, lines, (problems) => fixLines(opts.system, opts.facts, problems, context));
  const body = joinSentences(sentences.map((s) => ({ ...s, text: out.get(s.n) ?? s.text })));
  // A headline that can't be put right is replaced, never left wrong
  const title = out.get(0) || opts.fallbackTitle;
  return { title, body, log };
}

// ------------------------------------------------------------ the record

export interface CheckRecord {
  tournamentId: string | null;
  what: "piece" | "film" | "test";
  kind: string;
  label: string;
  refId?: string | null;
  log: CheckLog;
}

/** Write the check down for the site owner (best-effort: an old database without the table just skips it) */
export async function recordCheck(r: CheckRecord) {
  if (r.log.skipped) return;
  await adminClient()
    .from("fact_checks")
    .insert({
      tournament_id: r.tournamentId,
      what: r.what,
      kind: r.kind,
      label: r.label.slice(0, 200),
      ref_id: r.refId ?? null,
      checked: r.log.checked,
      first_problems: r.log.first,
      fixed: r.log.fixed,
      dropped: r.log.dropped.length,
      lines: r.log.dropped.map((d) => ({ text: d.text.slice(0, 400), why: d.why })),
    })
    .then(
      () => undefined,
      () => undefined,
    );
}
