/**
 * The figures the app works out, so the AI never counts: birdies and doubles, nines, runs, fairways and greens
 * (out of how many were told), lead changes, the hole a match turned on, who led the round after each hole, and the
 * same across the trip. Every figure says what it's out of; nothing here is ever a percentage.
 *
 * Pure: built from the grid.
 */
import { nth, type GridRow, type GridStroke } from "./grid";

// ------------------------------------------------------------ a player's round

export interface Run {
  from: number;
  to: number;
  length: number;
}

export interface PlayerFigures {
  playerId: string;
  name: string;
  round: number;
  played: number;
  /** Stableford points (when the round is Stableford) */
  pts: number | null;
  /** Gross total, only when every hole was finished */
  gross: number | null;
  front: number | null;
  back: number | null;
  birdies: number[];
  doubles: number[];
  pickups: number[];
  byPar: Record<number, number>;
  /** Longest run of holes at par or better */
  bestRun: Run | null;
  /** Longest run of holes without a point (Stableford), or at bogey or worse */
  worstRun: Run | null;
  fairways: { hit: number; told: number };
  greens: { hit: number; told: number };
  putts: { putts: number; holes: number; threePutts: number[] };
  longestDrive: { yards: number; hole: number } | null;
  bunkers: { out: number; told: number };
}

const ON_GREEN = /^(On the green|Close|Holed|On in two|Stiff)/i;

/** Where the ball first reached the green (or went in), when the strokes say so */
function onGreenAt(strokes: GridStroke[]): number | null {
  for (const st of strokes) {
    if (st.kind === "putt" && st.kindFrom === "told") return st.seq - 1;
    if (st.outcome && ON_GREEN.test(st.outcome) && st.outcomeFrom === "told") return st.seq;
  }
  return null;
}

function longest(rows: GridRow[], test: (r: GridRow) => boolean): Run | null {
  let best: Run | null = null;
  let start = -1;
  rows.forEach((r, i) => {
    if (test(r)) {
      if (start < 0) start = i;
      const len = i - start + 1;
      if (!best || len > best.length) best = { from: rows[start].hole, to: r.hole, length: len };
    } else start = -1;
  });
  return best;
}

export function playerFigures(rows: GridRow[]): PlayerFigures {
  const r0 = rows[0];
  const done = rows.filter((r) => r.score.gross != null || r.score.pickedUp || r.score.conceded);
  const stableford = rows.some((r) => r.score.pts != null);
  const sum = (list: GridRow[]) => (stableford ? list.reduce((a, r) => a + (r.score.pts ?? 0), 0) : list.every((r) => r.score.gross != null) ? list.reduce((a, r) => a + r.score.gross!, 0) : null);
  const nineSplit = rows.length > 9;
  const byPar: Record<number, number> = {};
  if (stableford) for (const r of done) byPar[r.par] = (byPar[r.par] ?? 0) + (r.score.pts ?? 0);
  const fair = rows.filter((r) => r.par >= 4 && r.strokes[0]?.kind === "tee" && r.strokes[0].outcomeFrom === "told");
  const greens = rows
    .map((r) => {
      const at = onGreenAt(r.strokes);
      const target = r.par - 2;
      if (at != null) return { told: true, hit: at <= target };
      const st = r.strokes.find((x) => x.seq === target);
      if (st?.outcomeFrom === "told") return { told: true, hit: false };
      return { told: false, hit: false };
    })
    .filter((x) => x.told);
  const full = rows.filter((r) => r.told === "every" && r.score.gross != null);
  const puttsOf = (r: GridRow) => r.strokes.filter((st) => st.kind === "putt").length;
  const drives = rows.flatMap((r) => r.strokes.filter((st) => st.drive != null).map((st) => ({ yards: st.drive!, hole: r.hole })));
  const bunkerShots = rows.flatMap((r) => r.strokes.filter((st) => st.kind === "bunker" && st.outcomeFrom === "told"));
  return {
    playerId: r0.playerId,
    name: r0.name,
    round: r0.round,
    played: done.length,
    pts: stableford ? sum(done) : null,
    gross: done.length === rows.length && rows.every((r) => r.score.gross != null) ? rows.reduce((a, r) => a + r.score.gross!, 0) : null,
    front: nineSplit ? sum(done.filter((r) => r.index < 9)) : null,
    back: nineSplit ? sum(done.filter((r) => r.index >= 9)) : null,
    birdies: done.filter((r) => r.score.gross != null && r.score.gross < r.par).map((r) => r.hole),
    doubles: done.filter((r) => r.score.gross != null && r.score.gross >= r.par + 2).map((r) => r.hole),
    pickups: done.filter((r) => r.score.pickedUp).map((r) => r.hole),
    byPar,
    bestRun: longest(rows, (r) => r.score.gross != null && r.score.gross <= r.par),
    worstRun: longest(rows, (r) => (stableford ? r.score.pts === 0 && (r.score.gross != null || r.score.pickedUp) : r.score.pickedUp || (r.score.gross != null && r.score.gross > r.par))),
    fairways: { hit: fair.filter((r) => r.strokes[0].outcome === "Fairway").length, told: fair.length },
    greens: { hit: greens.filter((g) => g.hit).length, told: greens.length },
    putts: { putts: full.reduce((a, r) => a + puttsOf(r), 0), holes: full.length, threePutts: full.filter((r) => puttsOf(r) >= 3).map((r) => r.hole) },
    longestDrive: drives.length ? drives.reduce((a, b) => (b.yards > a.yards ? b : a)) : null,
    bunkers: { out: bunkerShots.filter((st) => st.outcome && ON_GREEN.test(st.outcome)).length, told: bunkerShots.length },
  };
}

const holesList = (hs: number[]) => (hs.length ? ` (${hs.map((h) => `H${h}`).join(", ")})` : "");

export function playerFiguresText(f: PlayerFigures, units: "yards" | "metres" = "yards"): string {
  const bits: string[] = [];
  if (f.pts != null) bits.push(`${f.pts} pts${f.front != null ? ` (front nine ${f.front}, back nine ${f.back})` : ""}`);
  else if (f.gross != null) bits.push(`${f.gross} gross${f.front != null ? ` (out ${f.front}, back ${f.back})` : ""}`);
  bits.push(`${f.played} holes finished`);
  bits.push(`birdies or better ${f.birdies.length}${holesList(f.birdies)}`);
  bits.push(`doubles or worse ${f.doubles.length}${holesList(f.doubles)}`);
  if (f.pickups.length) bits.push(`picked up ${f.pickups.length}${holesList(f.pickups)}`);
  const pars = Object.entries(f.byPar);
  if (pars.length) bits.push(pars.map(([p, v]) => `${v} pts on the par ${p}s`).join(", "));
  if (f.bestRun && f.bestRun.length >= 3) bits.push(`best run: ${f.bestRun.length} holes at par or better, H${f.bestRun.from} to H${f.bestRun.to}`);
  if (f.worstRun && f.worstRun.length >= 3) bits.push(`worst run: ${f.worstRun.length} holes ${f.pts != null ? "without a point" : "at bogey or worse"}, H${f.worstRun.from} to H${f.worstRun.to}`);
  if (f.fairways.told) bits.push(`fairways: ${f.fairways.hit} of the ${f.fairways.told} told`);
  if (f.greens.told) bits.push(`greens in regulation: ${f.greens.hit} of the ${f.greens.told} told`);
  if (f.putts.holes) bits.push(`putts: ${f.putts.putts} on the ${f.putts.holes} hole${f.putts.holes === 1 ? "" : "s"} told in full${f.putts.threePutts.length ? `, three-putts${holesList(f.putts.threePutts)}` : ""}`);
  if (f.bunkers.told) bits.push(`out of a bunker onto the green: ${f.bunkers.out} of the ${f.bunkers.told} told`);
  if (f.longestDrive) bits.push(`longest drive measured about ${units === "metres" ? Math.round(f.longestDrive.yards * 0.9144) + " m" : f.longestDrive.yards + " yds"} (H${f.longestDrive.hole})`);
  return `${f.name}, R${f.round}: ${bits.join(" · ")}`;
}

// ------------------------------------------------------------ a match

export interface MatchFigures {
  gameId: string;
  round: number;
  a: string;
  b: string;
  aId: string;
  bId: string;
  /** The score after each hole, from A's side (+ = A up) */
  path: { hole: number; up: number; left: number }[];
  /** Holes where the lead changed hands (or went level) */
  changes: { hole: number; leader: string | null; up: number }[];
  /** How many times the lead changed hands (one side ahead, then the other) */
  swaps: number;
  biggest: { name: string; up: number; hole: number } | null;
  /** Who won (null: halved, or not finished) */
  winner: string | null;
  winnerId: string | null;
  loserId: string | null;
  finished: boolean;
  /** "1 up", "5&4" */
  margin: string | null;
  /** The hole it finished on */
  endHole: number | null;
  /** The hole the winner went ahead for good */
  turnedOn: number | null;
  /** The deepest the winner (or a side that halved) was down */
  deepest: { name: string; down: number; hole: number } | null;
  /** The most the loser was up */
  loserBest: { name: string; up: number; hole: number; left: number } | null;
  halvedRun: Run | null;
}

/** Match figures for one game, from the grid's rows */
export function matchFigures(rows: GridRow[]): MatchFigures | null {
  const sides = [...new Set(rows.map((r) => r.sideId))];
  if (sides.length !== 2 || rows[0]?.game.kind !== "match") return null;
  const [aId, bId] = sides;
  const nameOf = (sid: string) => [...new Set(rows.filter((r) => r.sideId === sid).map((r) => r.name.split(" ")[0]))].join(" and ");
  const a = nameOf(aId);
  const b = nameOf(bId);
  const aRows = [...new Map(rows.filter((r) => r.sideId === aId).map((r) => [r.hole, r])).values()].sort((x, y) => x.index - y.index);
  const path: MatchFigures["path"] = [];
  for (const r of aRows) if (!r.game.over && r.game.up != null && (r.game.hole != null || r.score.gross != null || r.score.pickedUp)) path.push({ hole: r.hole, up: r.game.up, left: r.game.left ?? 0 });
  const changes: MatchFigures["changes"] = [];
  let prev = 0;
  let lastLeader = 0;
  let swaps = 0;
  for (const p of path) {
    const s = Math.sign(p.up);
    if (s !== Math.sign(prev)) {
      changes.push({ hole: p.hole, leader: s === 0 ? null : s > 0 ? a : b, up: Math.abs(p.up) });
      if (s !== 0 && lastLeader !== 0 && s !== lastLeader) swaps++;
      if (s !== 0) lastLeader = s;
    }
    prev = p.up;
  }
  let biggest: MatchFigures["biggest"] = null;
  for (const p of path) if (!biggest || Math.abs(p.up) > biggest.up) biggest = p.up ? { name: p.up > 0 ? a : b, up: Math.abs(p.up), hole: p.hole } : biggest;
  const last = path[path.length - 1];
  const finished = !!last && (last.left === 0 || Math.abs(last.up) > last.left);
  const sign = last ? Math.sign(last.up) : 0;
  const winner = finished && sign ? (sign > 0 ? a : b) : null;
  const margin = finished ? (sign === 0 ? "halved" : last.left === 0 ? `${Math.abs(last.up)} up` : `${Math.abs(last.up)}&${last.left}`) : null;
  let turnedOn: number | null = null;
  let deepest: MatchFigures["deepest"] = null;
  let loserBest: MatchFigures["loserBest"] = null;
  if (finished) {
    const ws = sign || 1;
    if (sign) {
      let lastLevel = -1;
      path.forEach((p, i) => {
        if (p.up * ws <= 0) lastLevel = i;
      });
      turnedOn = path[lastLevel + 1]?.hole ?? null;
    }
    // The comeback: how far down the winner (or either side, in a halve) was
    for (const s of sign ? [ws] : [1, -1]) {
      for (const p of path) if (p.up * s < 0 && (!deepest || -p.up * s >= deepest.down)) deepest = { name: s > 0 ? a : b, down: -p.up * s, hole: p.hole };
    }
    if (sign) for (const p of path) if (p.up * ws < 0 && (!loserBest || -p.up * ws >= loserBest.up)) loserBest = { name: ws > 0 ? b : a, up: -p.up * ws, hole: p.hole, left: p.left };
  }
  const halvedRun = longest(aRows.filter((r) => !r.game.over), (r) => r.game.hole === "halved");
  return {
    gameId: rows[0].gameId,
    round: rows[0].round,
    a,
    b,
    aId,
    bId,
    path,
    changes,
    swaps,
    biggest,
    winner,
    winnerId: finished && sign ? (sign > 0 ? aId : bId) : null,
    loserId: finished && sign ? (sign > 0 ? bId : aId) : null,
    finished,
    margin,
    endHole: finished ? last.hole : null,
    turnedOn,
    deepest,
    loserBest,
    halvedRun: halvedRun && halvedRun.length >= 3 ? halvedRun : null,
  };
}

export function matchFiguresText(m: MatchFigures, holes: number): string {
  const bits: string[] = [];
  bits.push(m.finished ? (m.winner ? `${m.winner} beat ${m.winner === m.a ? m.b : m.a} ${m.margin}, finished on the ${nth(m.endHole!)}` : `halved, finished on the ${nth(m.endHole!)}`) : `not finished yet (${m.path.length} of ${holes} holes played)`);
  if (m.changes.length) bits.push(`the score as it moved: ${m.changes.map((c) => `H${c.hole} ${c.leader ? `${c.leader} ${c.up} up` : "all square"}`).join(", ")}`);
  bits.push(`the lead changed hands ${m.swaps} time${m.swaps === 1 ? "" : "s"}`);
  if (m.biggest) bits.push(`biggest lead: ${m.biggest.name} ${m.biggest.up} up (after H${m.biggest.hole})`);
  if (m.turnedOn) bits.push(`turned on the ${nth(m.turnedOn)} (where ${m.winner} went ahead for good)`);
  if (m.deepest && m.deepest.down >= 2) bits.push(`${m.deepest.name} was ${m.deepest.down} down after H${m.deepest.hole}`);
  if (m.loserBest && m.loserBest.up >= 2) bits.push(`${m.loserBest.name} was ${m.loserBest.up} up after H${m.loserBest.hole} with ${m.loserBest.left} to play`);
  if (m.halvedRun) bits.push(`${m.halvedRun.length} holes halved in a row (H${m.halvedRun.from} to H${m.halvedRun.to})`);
  return `${m.a} v ${m.b}: ${bits.join(" · ")}`;
}

// ------------------------------------------------------------ the round

export interface RoundFigures {
  round: number;
  /** Stableford or stroke play over the field: who led after each hole */
  leaders: { hole: number; names: string[] }[];
  /** Where the round lead changed */
  leadChanges: { hole: number; names: string[] }[];
  /** The hole that cost the field most (average over par) */
  hardest: { hole: number; over: number } | null;
  /** Best score on each hole */
  best: { hole: number; gross: number; names: string[] }[];
  /** The round of the day: most points, or the lowest gross of those who finished every hole */
  ofTheDay: { name: string; value: string } | null;
}

export function roundFigures(rows: GridRow[]): RoundFigures {
  const round = rows[0]?.round ?? 0;
  const byHole = new Map<number, GridRow[]>();
  for (const r of rows) byHole.set(r.index, [...(byHole.get(r.index) ?? []), r]);
  const indexes = [...byHole.keys()].sort((a, b) => a - b);
  const leaders: RoundFigures["leaders"] = [];
  for (const i of indexes) {
    const top = byHole.get(i)!.filter((r) => r.game.place === "1st" || r.game.place === "tied 1st");
    if (top.length) leaders.push({ hole: byHole.get(i)![0].hole, names: [...new Set(top.map((r) => r.name))] });
  }
  const leadChanges = leaders.filter((l, i) => i === 0 || l.names.join() !== leaders[i - 1].names.join());
  let hardest: RoundFigures["hardest"] = null;
  const best: RoundFigures["best"] = [];
  for (const i of indexes) {
    const list = byHole.get(i)!;
    const scored = list.filter((r) => r.score.gross != null || r.score.pickedUp);
    if (!scored.length) continue;
    const over = scored.reduce((a, r) => a + (r.score.gross != null ? r.score.gross - r.par : 2), 0) / scored.length;
    if (!hardest || over > hardest.over) hardest = { hole: list[0].hole, over: Math.round(over * 10) / 10 };
    const g = scored.filter((r) => r.score.gross != null);
    if (g.length) {
      const low = Math.min(...g.map((r) => r.score.gross!));
      best.push({ hole: list[0].hole, gross: low, names: g.filter((r) => r.score.gross === low).map((r) => r.name.split(" ")[0]) });
    }
  }
  const players = [...new Set(rows.map((r) => r.playerId))].map((pid) => playerFigures(rows.filter((r) => r.playerId === pid)));
  let ofTheDay: RoundFigures["ofTheDay"] = null;
  const pts = players.filter((p) => p.pts != null);
  if (pts.length) {
    const top = pts.reduce((a, b) => (b.pts! > a.pts! ? b : a));
    ofTheDay = { name: top.name, value: `${top.pts} pts` };
  } else {
    const full = players.filter((p) => p.gross != null);
    if (full.length) {
      const top = full.reduce((a, b) => (b.gross! < a.gross! ? b : a));
      ofTheDay = { name: top.name, value: `${top.gross} gross` };
    }
  }
  return { round, leaders, leadChanges, hardest, best, ofTheDay };
}

export function roundFiguresText(f: RoundFigures): string {
  const bits: string[] = [];
  if (f.leadChanges.length) bits.push(`the lead of the round: ${f.leadChanges.map((l) => `H${l.hole} ${l.names.join(" and ")}`).join(", ")}`);
  if (f.hardest) bits.push(`the hole that cost the field most: the ${nth(f.hardest.hole)} (on average ${f.hardest.over} over par)`);
  if (f.best.length) bits.push(`best score on each hole: ${f.best.map((b) => `H${b.hole} ${b.gross} (${b.names.join(", ")})`).join("; ")}`);
  if (f.ofTheDay) bits.push(`round of the day: ${f.ofTheDay.name}, ${f.ofTheDay.value}`);
  return `Round ${f.round}: ${bits.join(" · ")}`;
}

// ------------------------------------------------------------ the trip

export interface TripFigures {
  /** Each player's rounds, in order */
  form: { name: string; rounds: { round: number; value: string }[] }[];
  firstBirdie: { name: string; round: number; hole: number } | null;
  bestRound: { name: string; round: number; value: string } | null;
  /** Best run of holes at par or better, carried across rounds */
  bestRun: { name: string; length: number; from: string; to: string } | null;
}

export function tripFigures(rowsByRound: GridRow[][]): TripFigures {
  const all = rowsByRound.flat();
  const pids = [...new Set(all.map((r) => r.playerId))];
  const form = pids.map((pid) => {
    const mine = rowsByRound.map((rs) => rs.filter((r) => r.playerId === pid)).filter((rs) => rs.length);
    return {
      name: mine[0][0].name,
      rounds: mine.map((rs) => {
        const f = playerFigures(rs);
        return { round: f.round, value: f.pts != null ? `${f.pts} pts` : f.gross != null ? `${f.gross} gross` : `${f.birdies.length} birdies, ${f.played} holes` };
      }),
    };
  });
  let firstBirdie: TripFigures["firstBirdie"] = null;
  const sorted = [...all].sort((a, b) => a.round - b.round || a.index - b.index);
  const fb = sorted.find((r) => r.score.gross != null && r.score.gross < r.par);
  if (fb) firstBirdie = { name: fb.name, round: fb.round, hole: fb.hole };
  let bestRound: TripFigures["bestRound"] = null;
  for (const rs of rowsByRound)
    for (const pid of pids) {
      const mine = rs.filter((r) => r.playerId === pid);
      if (!mine.length) continue;
      const f = playerFigures(mine);
      const v = f.pts ?? (f.gross != null ? -f.gross : null);
      if (v == null) continue;
      const cur = bestRound ? Number(bestRound.value.split(" ")[0]) * (bestRound.value.includes("gross") ? -1 : 1) : -Infinity;
      if (v > cur) bestRound = { name: f.name, round: f.round, value: f.pts != null ? `${f.pts} pts` : `${f.gross} gross` };
    }
  let bestRun: TripFigures["bestRun"] = null;
  for (const pid of pids) {
    const mine = sorted.filter((r) => r.playerId === pid);
    let start = -1;
    mine.forEach((r, i) => {
      if (r.score.gross != null && r.score.gross <= r.par) {
        if (start < 0) start = i;
        const len = i - start + 1;
        if (len >= 3 && (!bestRun || len > bestRun.length) && mine[start].round !== r.round)
          bestRun = { name: r.name, length: len, from: `R${mine[start].round} H${mine[start].hole}`, to: `R${r.round} H${r.hole}` };
      } else start = -1;
    });
  }
  return { form, firstBirdie, bestRound, bestRun };
}

export function tripFiguresText(f: TripFigures): string {
  const lines: string[] = [];
  if (f.form.some((p) => p.rounds.length > 1)) for (const p of f.form) lines.push(`${p.name}: ${p.rounds.map((r) => `R${r.round} ${r.value}`).join(", ")}`);
  if (f.firstBirdie) lines.push(`first birdie of the trip: ${f.firstBirdie.name}, R${f.firstBirdie.round} H${f.firstBirdie.hole}`);
  if (f.bestRound) lines.push(`best round of the trip so far: ${f.bestRound.name}, R${f.bestRound.round}, ${f.bestRound.value}`);
  if (f.bestRun) lines.push(`a run carried from one round to the next: ${f.bestRun.name}, ${f.bestRun.length} holes at par or better, ${f.bestRun.from} to ${f.bestRun.to}`);
  return lines.join("\n");
}

// ------------------------------------------------------------ all of it

/** Every figure for a round (and the trip so far), as the writer reads them */
export function figuresText(rows: GridRow[], earlier: GridRow[][] = [], units: "yards" | "metres" = "yards"): string {
  const out: string[] = [];
  const pids = [...new Set(rows.map((r) => r.playerId))];
  for (const pid of pids) out.push(playerFiguresText(playerFigures(rows.filter((r) => r.playerId === pid)), units));
  const holes = new Set(rows.map((r) => r.hole)).size;
  for (const gid of [...new Set(rows.map((r) => r.gameId))]) {
    const m = matchFigures(rows.filter((r) => r.gameId === gid));
    if (m) out.push(matchFiguresText(m, holes));
  }
  if (rows.some((r) => r.game.kind === "field" || r.game.kind === "match")) out.push(roundFiguresText(roundFigures(rows)));
  if (earlier.length) {
    const t = tripFiguresText(tripFigures([...earlier, rows]));
    if (t) out.push(`The trip so far:\n${t}`);
  }
  return out.join("\n");
}


