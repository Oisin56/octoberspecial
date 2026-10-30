import "server-only";
import { adminClient } from "./admin";
import { composePiece, writerWay } from "./ai";
import { writePlan } from "./director";
import { findProblems, type CheckLog } from "./factcheck";
import { splitSentences } from "./sentences";
import { loadServerState } from "./server-data";
import { getSetting, setSetting } from "./site";
import { testRound, TEST_ROUND_ID, type TestTold } from "./testRound";
import { writerBrief } from "./writerBrief";
import { nth } from "./grid";
import type { Brief, Plan } from "./director-types";
import type { TournamentState } from "./types";

/**
 * The writing test in the console: a piece written both ways (today's writer and the grid), labelled A and B so the
 * site owner doesn't know which is which, with the fact check's count of mistakes in each first draft. Nothing is
 * published. The switch puts the grid writer live for everyone.
 */

export type TestKind = "report" | "bulletin" | "tournament" | "film";

const MADE_UP: Record<TestTold, string> = {
  every: "A made-up round, every shot told",
  some: "A made-up round, tee shots only",
  scores: "A made-up round, scores only",
};

export interface Source {
  id: string;
  label: string;
  /** Has clips, so a film script can be written */
  film: boolean;
}

/** What can be written: the made-up rounds, then the latest real rounds with scores in */
export async function writingSources(): Promise<Source[]> {
  const out: Source[] = (Object.keys(MADE_UP) as TestTold[]).map((k) => ({ id: `made-up:${k}`, label: MADE_UP[k], film: false }));
  const db = adminClient();
  const { data: recent } = await db.from("hole_entries").select("round_id,updated_at").order("updated_at", { ascending: false }).limit(3000);
  const ids = [...new Set(((recent ?? []) as { round_id: string }[]).map((r) => r.round_id))].slice(0, 40);
  if (!ids.length) return out;
  const { data: rounds } = await db.from("rounds").select("id,number,course_name,play_date,tournament_id").in("id", ids);
  const tids = [...new Set(((rounds ?? []) as { tournament_id: string }[]).map((r) => r.tournament_id))];
  const [{ data: ts }, { data: vids }] = await Promise.all([
    db.from("tournaments").select("id,name,slug").in("id", tids),
    db.from("posts").select("tournament_id").eq("kind", "video").not("media_path", "is", null).in("tournament_id", tids).limit(5000),
  ]);
  const names = new Map(((ts ?? []) as { id: string; name: string; slug: string }[]).filter((t) => t.slug !== "sample-round").map((t) => [t.id, t.name]));
  const filmed = new Set(((vids ?? []) as { tournament_id: string }[]).map((v) => v.tournament_id));
  for (const id of ids) {
    const r = ((rounds ?? []) as { id: string; number: number; course_name: string; play_date: string | null; tournament_id: string }[]).find((x) => x.id === id);
    if (!r || !names.has(r.tournament_id)) continue;
    const when = r.play_date ? `, ${new Date(r.play_date + "T12:00:00").toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" })}` : "";
    out.push({ id: `round:${r.id}`, label: `${names.get(r.tournament_id)}, Round ${r.number} at ${r.course_name}${when}`, film: filmed.has(r.tournament_id) });
  }
  return out;
}

interface Side {
  title: string;
  body: string;
  /** Mistakes the fact check found in the first draft */
  mistakes: number;
  problems: { text: string; why: string }[];
  /** The new way only: what the check did before it went out */
  fixed?: number;
  dropped?: { text: string; why: string }[];
}

/** A film's script as text to read side by side */
function scriptText(p: Plan): string {
  const out: string[] = [];
  for (const seg of p.segments) {
    if (seg.kind === "card") {
      const head = [seg.heading, seg.sub].filter(Boolean).join(", ");
      out.push(`${head}${seg.voice ? `\n${seg.voice}` : ""}`);
    } else if (seg.kind === "clip") {
      const lines = [`${seg.caption}${seg.sub ? ` (${seg.sub})` : ""}${seg.hole ? `, the ${nth(seg.hole)}` : ""}`];
      if (seg.voice) lines.push(`Set-up: ${seg.voice}`);
      if (seg.payoff) lines.push(`Payoff: ${seg.payoff}`);
      if (seg.replay) lines.push(`Replay${seg.replayVoice ? `: ${seg.replayVoice}` : ""}`);
      out.push(lines.join("\n"));
    }
  }
  return out.join("\n\n");
}

async function load(source: string): Promise<{ s: TournamentState; roundId: string; tournamentId: string | null; label: string }> {
  if (source.startsWith("made-up:")) {
    const told = source.slice(8) as TestTold;
    if (!MADE_UP[told]) throw new Error("Pick a round");
    return { s: testRound(told), roundId: TEST_ROUND_ID, tournamentId: null, label: MADE_UP[told] };
  }
  const id = source.replace(/^round:/, "");
  const { data: r } = await adminClient().from("rounds").select("id,tournament_id,number,course_name").eq("id", id).maybeSingle();
  if (!r) throw new Error("That round isn't there any more");
  const s = await loadServerState(r.tournament_id);
  return { s, roundId: r.id, tournamentId: r.tournament_id, label: `${s.tournament.name}, Round ${r.number} at ${r.course_name}` };
}

const KIND_LABEL: Record<TestKind, string> = { report: "Round report", bulletin: "Live bulletin", tournament: "Tournament review", film: "Film script" };

/** Write one both ways and keep them for reading */
export async function runWritingTest(source: string, kind: TestKind, by: string) {
  const { s, roundId, tournamentId, label } = await load(source);
  if (s.tournament.ai_on === false) s.tournament = { ...s.tournament, ai_on: true };
  let old: Side;
  let neu: Side;
  let told: string | null = null;
  if (kind === "film") {
    if (!tournamentId) throw new Error("A film script needs a real round with clips");
    const round = s.rounds.find((r) => r.id === roundId)!;
    const brief: Brief = { roundNumber: round.number, length: 180, aspect: s.tournament.share_shape === "landscape" ? "16:9" : "9:16", voice: true, veo: false, sound: "commentary", style: "classic", amount: "full", booth: 1 };
    let log: CheckLog | null = null;
    const [a, b] = await Promise.all([writePlan(tournamentId, brief, [], { way: "classic" }), writePlan(tournamentId, brief, [], { way: "grid", record: "test", onCheck: (l) => (log = l) })]);
    const facts = writerBrief(s, "report", roundId).facts;
    const lines = (p: Plan) => scriptText(p).split("\n").filter((x) => x.trim() && !/^Replay$/.test(x)).map((text, i) => ({ n: i + 1, text }));
    const oldProblems = await findProblems(facts, lines(a), { what: "writing test" }).catch(() => []);
    const l = log as CheckLog | null;
    old = { title: a.title, body: scriptText(a), mistakes: oldProblems.length, problems: oldProblems.map((p) => ({ text: p.text, why: p.why })) };
    neu = { title: b.title, body: scriptText(b), mistakes: l?.first ?? 0, problems: [], fixed: l?.fixed ?? 0, dropped: (l?.dropped ?? []).map((d) => ({ text: d.text, why: d.why })) };
  } else {
    const rid = kind === "tournament" ? null : roundId;
    // A bulletin: about the round's biggest moment, as if it had just happened
    let opts: { gameId?: string; hole?: number; reason?: string } = {};
    if (kind === "bulletin") {
      const top = writerBrief(s, "report", roundId).moments.find((m) => m.refs.length);
      const ref = top?.refs[0];
      const game = ref ? s.rounds.find((r) => r.id === roundId)?.games?.find((g) => g.sides.some((sd) => sd.playerIds.includes(ref.playerId))) : undefined;
      opts = ref ? { hole: ref.hole, gameId: game?.id, reason: top!.text } : { reason: "the latest hole has just finished" };
    }
    const [a, b] = await Promise.all([composePiece(s, kind, rid, { ...opts, way: "classic", trigger: "writing-test" }), composePiece(s, kind, rid, { ...opts, way: "grid", trigger: "writing-test" })]);
    const lines = [{ n: 0, text: a.title }, ...splitSentences(a.body).map((x) => ({ n: x.n, text: x.text }))];
    const oldProblems = await findProblems(a.facts, lines, { what: "writing test" }).catch(() => []);
    old = { title: a.title, body: a.body, mistakes: oldProblems.length, problems: oldProblems.map((p) => ({ text: p.text, why: p.why })) };
    neu = { title: b.title, body: b.body, mistakes: b.log?.first ?? 0, problems: [], fixed: b.log?.fixed ?? 0, dropped: (b.log?.dropped ?? []).map((d) => ({ text: d.text, why: d.why })) };
    told = b.told;
  }
  const newIs = Math.random() < 0.5 ? "a" : "b";
  const row = {
    tournament_id: tournamentId,
    round_id: tournamentId ? roundId : null,
    label: `${KIND_LABEL[kind]}: ${label}`,
    kind,
    told,
    new_is: newIs,
    a: newIs === "a" ? neu : old,
    b: newIs === "a" ? old : neu,
  };
  const { data, error } = await adminClient().from("writing_tests").insert(row).select().single();
  if (error) throw new Error(/writing_tests/.test(error.message) ? "This needs the latest database update (run supabase/schema.sql)" : error.message);
  void by;
  return data;
}

export async function pickWritingTest(id: string, pick: "a" | "b" | "same", note: string, by: string) {
  const { error } = await adminClient()
    .from("writing_tests")
    .update({ pick, note: note.trim().slice(0, 2000) || null, picked_at: new Date().toISOString(), picked_by: by })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function setWriter(on: boolean, by: string) {
  await setSetting("writer", { grid: on, at: new Date().toISOString(), by });
}

interface TestRow {
  id: string;
  at: string;
  label: string;
  kind: TestKind;
  told: string | null;
  new_is: "a" | "b";
  a: Side;
  b: Side;
  pick: "a" | "b" | "same" | null;
  note: string | null;
}

/** The page: the switch, what can be written, the tests so far (which was which shown only once picked) */
export async function writingView() {
  const [way, sources, tests] = await Promise.all([writerWay(), writingSources(), adminClient().from("writing_tests").select("*").order("at", { ascending: false }).limit(200)]);
  const rows = ((tests.data ?? []) as TestRow[]).filter(Boolean);
  const kinds: TestKind[] = ["report", "bulletin", "tournament", "film"];
  const summary = kinds
    .map((k) => {
      const of = rows.filter((r) => r.kind === k);
      const side = (r: TestRow, which: "new" | "old") => ((r.new_is === "a") === (which === "new") ? r.a : r.b);
      const picked = of.filter((r) => r.pick);
      return {
        kind: k,
        label: KIND_LABEL[k],
        tests: of.length,
        picked: picked.length,
        newBetter: picked.filter((r) => r.pick === r.new_is).length,
        oldBetter: picked.filter((r) => r.pick !== "same" && r.pick !== r.new_is).length,
        same: picked.filter((r) => r.pick === "same").length,
        oldMistakes: of.reduce((a, r) => a + (side(r, "old").mistakes ?? 0), 0),
        newMistakes: of.reduce((a, r) => a + (side(r, "new").mistakes ?? 0), 0),
        newDropped: of.reduce((a, r) => a + (side(r, "new").dropped?.length ?? 0), 0),
      };
    })
    .filter((x) => x.tests);
  const hide = (x: Side) => ({ title: x.title, body: x.body });
  const facts = (x: Side) => ({ mistakes: x.mistakes, problems: x.problems, fixed: x.fixed ?? null, dropped: x.dropped ?? null });
  const setting = await getSetting<{ grid?: boolean; at?: string; by?: string }>("writer", {});
  return {
    on: way === "grid",
    since: setting.at ?? null,
    sources,
    available: !tests.error,
    summary,
    tests: rows.slice(0, 40).map((r) => ({
      id: r.id,
      at: r.at,
      label: r.label,
      kind: r.kind,
      told: r.told,
      a: hide(r.a),
      b: hide(r.b),
      pick: r.pick,
      note: r.note,
      // Which was which, and what the check found, only once it's been read and picked
      reveal: r.pick ? { newIs: r.new_is, a: facts(r.a), b: facts(r.b) } : null,
    })),
  };
}
