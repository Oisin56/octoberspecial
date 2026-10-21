import { describe, it, expect } from "vitest";
import {
  bracketSize,
  drawBracket,
  gameShots,
  knockoutGames,
  knockoutState,
  playerHoles,
  seedOrder,
  stageName,
  tournamentSummary,
  type Game,
  type HoleEntry,
  type Knockout,
  type Player,
  type RoundCfg,
  type TournamentCfg,
} from "./engine";

/**
 * The set-up redesign's ways to win, each checked against a result worked out by hand.
 * The card: the usual 18 (par 72), stroke index 1 on the 1st, 2 on the 10th and so on.
 */
const PARS = [4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5];
const SIS = [1, 3, 5, 7, 9, 11, 13, 15, 17, 2, 4, 6, 8, 10, 12, 14, 16, 18];
const CARD = PARS.map((par, i) => ({ number: i + 1, par, si: SIS[i] }));

const P = (id: string, handicap = 0, teamId: string | null = null): Player => ({ id, name: id.toUpperCase(), handicap, teamId });
const solo = (id: string) => ({ id, playerIds: [id] });
const group = (id: string, ids: string[], extra: Partial<Game> = {}): Game => ({ id, sides: ids.map(solo), scorerId: ids[0], ...extra });

function round(id: string, number: number, games: Game[], extra: Partial<RoundCfg> = {}): RoundCfg {
  return {
    id,
    number,
    name: id,
    holes: CARD,
    play: "singles",
    scoring: "stableford",
    games,
    points: { front: 0, back: 0, full: 0 },
    handicap: { mode: "manual", shots: {} },
    ...extra,
  };
}

/** Hole entries for one game: each ball's gross scores from the 1st (null = not played yet). */
function cards(game: string, scores: Record<string, (number | null)[]>, from = 1): HoleEntry[] {
  const n = Math.max(...Object.values(scores).map((s) => s.length));
  const out: HoleEntry[] = [];
  for (let i = 0; i < n; i++) {
    const s: HoleEntry["scores"] = {};
    for (const [ball, list] of Object.entries(scores)) if (list[i] != null) s[ball] = { gross: list[i] };
    if (Object.keys(s).length) out.push({ game, hole: from + i, scores: s });
  }
  return out;
}

const pars = (delta: Record<number, number> = {}) => PARS.map((p, i) => p + (delta[i + 1] ?? 0));

function cfg(players: Player[], rounds: RoundCfg[], extra: Partial<TournamentCfg> = {}): TournamentCfg {
  const teams = [...new Set(players.map((p) => p.teamId).filter(Boolean))].map((id) => ({ id: id!, name: id! }));
  return { players, teams, rounds, sideGames: [], sideGamesBy: "player", ...extra };
}

describe("different tees for different players", () => {
  // Both index 10. The white tees: slope 113, rating 72 → course handicap 10. Ronan on the reds: rating 70 → 8,
  // and the reds' 1st is stroke index 18, so he gets no shot there; Neil (whites, SI 1) does.
  const reds = CARD.map((h) => (h.number === 1 ? { ...h, si: 18 } : h.si === 18 ? { ...h, si: 1 } : h));
  const r = round("r1", 1, [group("g1", ["neil", "ronan"])], {
    handicap: { mode: "allowance", pct: 100, relative: false, course: { slope: 113, rating: 72, par: 72 } },
    playerTees: { ronan: { tee: "Red", holes: reds, course: { slope: 113, rating: 70, par: 72 } } },
  });
  const c = cfg([P("neil", 10), P("ronan", 10)], [r]);

  it("works out each player's course handicap from their own tee", () => {
    expect(gameShots(r, r.games[0], c.players)).toEqual({ neil: 10, ronan: 8 });
  });

  it("gives shots on each player's own stroke index", () => {
    const ph = playerHoles(c, { r1: cards("g1", { neil: [5], ronan: [5] }) });
    expect(ph.r1.neil[1]).toMatchObject({ shots: 1, pts: 2 }); // a 5 with a shot on a par 4: net par
    expect(ph.r1.ronan[1]).toMatchObject({ shots: 0, pts: 1 }); // no shot on the reds' SI 18: bogey
  });
});

describe("team score: best scores count on every hole", () => {
  // Three holes (par 4, 4, 3), no shots, two groups mixing the teams.
  //            hole 1    hole 2    hole 3
  // Blue  a,b,c 4 5 3 →   5 4 6 →   3 3 2
  //   points   2 1 3      1 2 0     2 2 3   best 2: 5 + 3 + 5 = 13   all: 6 + 3 + 7 = 16
  // Red   d,e,f 4 4 6 →   3 5 5 →   4 3 4
  //   points   2 2 0      3 1 1     1 2 1   best 2: 4 + 4 + 3 = 11   all: 4 + 5 + 4 = 13
  const three = CARD.slice(0, 3);
  const players = [P("a", 0, "blue"), P("b", 0, "blue"), P("c", 0, "blue"), P("d", 0, "red"), P("e", 0, "red"), P("f", 0, "red")];
  const r = round("r1", 1, [group("g1", ["a", "b", "d"]), group("g2", ["c", "e", "f"])], { holes: three });
  const entries = { r1: [...cards("g1", { a: [4, 5, 3], b: [5, 4, 3], d: [4, 3, 4] }), ...cards("g2", { c: [3, 6, 2], e: [4, 5, 3], f: [6, 5, 4] })] };

  it("counts each team's best two", () => {
    const s = tournamentSummary(cfg(players, [r], { win: { kind: "teamscore", count: 2 } }), entries);
    expect(s.teamRows!.map((t) => [t.teamId, t.value, t.pos])).toEqual([
      ["blue", 13, 1],
      ["red", 11, 2],
    ]);
  });

  it("counts them all when asked", () => {
    const s = tournamentSummary(cfg(players, [r], { win: { kind: "teamscore", count: 0 } }), entries);
    expect(s.teamRows!.map((t) => t.value)).toEqual([16, 13]);
  });
});

describe("Texas scramble", () => {
  it("adds up each team's one ball, net to par; lowest wins", () => {
    const players = [P("a", 0, "blue"), P("b", 0, "blue"), P("c", 0, "red"), P("d", 0, "red")];
    const g: Game = { id: "g1", sides: [{ id: "blue", playerIds: ["a", "b"], teamId: "blue" }, { id: "red", playerIds: ["c", "d"], teamId: "red" }], scorerId: "a" };
    const r = round("r1", 1, [g], { play: "scramble", scoring: "stroke", holes: CARD.slice(0, 2) });
    const s = tournamentSummary(cfg(players, [r], { win: { kind: "scramble" } }), { r1: cards("g1", { blue: [3, 4], red: [4, 5] }) });
    expect(s.teamRows!.map((t) => [t.teamId, t.value, t.pos])).toEqual([
      ["blue", -1, 1],
      ["red", 1, 2],
    ]);
  });
});

describe("skins across the whole field", () => {
  // a, b, c in two groups, three holes, no shots.
  // Hole 1: 4 4 5 → tie. Hole 2: 5 4 5 → b alone. Hole 3: 3 3 3 → tie.
  const three = CARD.slice(0, 3);
  const players = [P("a"), P("b"), P("c")];
  const r = round("r1", 1, [group("g1", ["a", "b"]), group("g2", ["c"])], { holes: three, scoring: "skins" });
  const all = { r1: [...cards("g1", { a: [4, 5, 3], b: [4, 4, 3] }), ...cards("g2", { c: [5, 5, 3] })] };

  it("carries a tied hole to the next one", () => {
    const s = tournamentSummary(cfg(players, [r], { win: { kind: "skins", carry: true } }), all);
    expect(s.skins!.rows.find((x) => x.playerId === "b")!.skins).toBe(2); // holes 1 and 2
    expect(s.skins!.rows[0]).toMatchObject({ playerId: "b", pos: 1 });
    expect(s.skins!.holes.r1.map((h) => h.winner)).toEqual([null, "b", null]);
  });

  it("loses a tied hole's skin when ties don't carry", () => {
    const s = tournamentSummary(cfg(players, [r], { win: { kind: "skins", carry: false } }), all);
    expect(s.skins!.rows.find((x) => x.playerId === "b")!.skins).toBe(1);
  });

  it("waits for everyone to finish a hole, in hole order", () => {
    // c hasn't played hole 2 yet (but has the 3rd on the card): holes 2 and 3 wait; 1 skin carried
    const part = { r1: [...cards("g1", { a: [4, 5, 3], b: [4, 4, 3] }), ...cards("g2", { c: [5, null, 3] })] };
    const s = tournamentSummary(cfg(players, [r], { win: { kind: "skins", carry: true } }), part);
    expect(s.skins!.holes.r1.map((h) => h.decided)).toEqual([true, false, false]);
    expect(s.skins!.carrying.r1).toBe(1);
    expect(s.skins!.rows.every((x) => x.skins === 0)).toBe(true);
  });
});

describe("match play knockout", () => {
  it("seeds a bracket so the top seeds meet last", () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(bracketSize(6)).toBe(8);
    expect(bracketSize(2)).toBe(2);
    expect(stageName(0, 3)).toBe("Quarter-finals");
    expect(stageName(2, 3)).toBe("Final");
  });

  // Six players, seeded by handicap (p1 lowest): byes for the top two seeds.
  const players = [1, 2, 3, 4, 5, 6].map((n) => P(`p${n}`, n));
  const entrants = players.map((p) => ({ id: p.id, playerIds: [p.id] }));
  const slots = drawBracket(entrants, "seeded", players);
  const ko = (tie: Knockout["tie"]): Knockout => ({ pairs: false, tie, draw: "seeded", entrants, slots });
  const rounds = [1, 2, 3].map((n) => round(`r${n}`, n, [], { scoring: "match" }));

  it("gives the byes to the top seeds", () => {
    expect(slots).toEqual(["p1", null, "p4", "p5", "p2", null, "p3", "p6"]);
  });

  /** The tournament with each stage's games made from the results so far. */
  function play(k: Knockout, entries: Record<string, HoleEntry[]>) {
    let c = cfg(players, rounds, { win: { kind: "knockout", knockout: k } });
    const games = knockoutGames(c, entries, k);
    c = { ...c, rounds: c.rounds.map((r) => ({ ...r, games: games[r.id] ?? [] })) };
    return { c, games, state: knockoutState(c, entries, k) };
  }

  // p4 wins the 1st and halves the rest (1 up). p3 v p6: p3 wins the 1st, p6 the 18th, all else halved.
  const r1 = [
    ...cards("ko1-2", { p4: pars({ 1: -1 }), p5: pars() }),
    ...cards("ko1-4", { p3: pars({ 1: -1 }), p6: pars({ 18: -1 }) }),
  ];

  it("plays only the real matches in the first stage", () => {
    const { games } = play(ko("backnine"), {});
    expect(games.r1.map((g) => g.id)).toEqual(["ko1-2", "ko1-4"]);
  });

  it("settles a level match on the back nine", () => {
    const { state, games } = play(ko("backnine"), { r1 });
    expect(state.stages[0].map((m) => m.winner)).toEqual(["p1", "p4", "p2", "p6"]);
    expect(state.stages[0][3]).toMatchObject({ how: "backnine" });
    // Stage two: p1 v p4, p2 v p6; p5 and p3 play for the prizes
    expect(games.r2.filter((g) => !g.free).map((g) => g.sides.map((s) => s.id))).toEqual([
      ["p1", "p4"],
      ["p2", "p6"],
    ]);
    expect(games.r2.find((g) => g.free)!.sides.map((s) => s.id).sort()).toEqual(["p3", "p5"]);
  });

  it("settles a level match on extra holes", () => {
    const extra = cards("ko1-4", { p3: [3], p6: [4] }, 19); // the 19th, played as the 1st: p3 wins it
    const { state } = play(ko("extra"), { r1: [...r1, ...extra] });
    expect(state.stages[0][3]).toMatchObject({ winner: "p3", how: "extra" });
  });

  it("names the champion", () => {
    const r2 = [...cards("ko2-1", { p1: pars({ 2: -1 }), p4: pars() }), ...cards("ko2-2", { p2: pars({ 2: -1 }), p6: pars() })];
    const r3 = cards("ko3-1", { p1: pars(), p2: pars({ 5: -1 }) });
    const { state } = play(ko("backnine"), { r1, r2, r3 });
    expect(state.stages[2][0]).toMatchObject({ a: "p1", b: "p2", winner: "p2" });
    expect(state.champion).toBe("p2");
  });
});

describe("prizes", () => {
  // Two players, every hole in par except: Neil birdies the 10th, Ronan birdies the 1st.
  // Front nine: Ronan 19, Neil 18. Back nine: Neil 19, Ronan 18. Both 37 for the round.
  const players = [P("neil"), P("ronan")];
  const r = round("r1", 1, [group("g1", ["neil", "ronan"])]);
  const entries = cards("g1", { neil: pars({ 10: -1 }), ronan: pars({ 1: -1 }) });
  entries.find((e) => e.hole === 3)!.ctpWinner = "neil"; // a par 3
  entries.find((e) => e.hole === 1)!.ctpWinner = "ronan"; // a par 4: not a closest-the-pin hole
  const run = (prizes: TournamentCfg["prizes"], win: TournamentCfg["win"] = { kind: "stableford" }) =>
    tournamentSummary(cfg(players, [r], { prizes, win }), { r1: entries });

  it("counts closest the pin on the par 3s, or on the holes chosen", () => {
    expect(run([{ kind: "ctp", per: "trip" }]).prizes[0].leaders).toEqual(["neil"]);
    expect(run([{ kind: "ctp", per: "trip", holes: [1] }]).prizes[0].leaders).toEqual(["ronan"]);
  });

  it("gives the front nine and back nine separately", () => {
    const [front, back] = run([{ kind: "nines", per: "round" }]).prizes;
    expect([front.nine, front.leaders, back.nine, back.leaders]).toEqual(["front", ["ronan"], "back", ["neil"]]);
    expect(front.decided).toBe(true);
  });

  it("shares a tied best round, and keeps prizes out of the standings", () => {
    const s = run([{ kind: "bestround", per: "trip" }, { kind: "birdies", per: "trip" }]);
    expect(s.prizes[0].leaders.sort()).toEqual(["neil", "ronan"]);
    expect(s.prizes[1].value).toEqual({ neil: 1, ronan: 1 });
    expect(s.playerTotal).toEqual({ neil: 0, ronan: 0 });
  });

  it("counts a prize as points only when it's given points", () => {
    const s = run([{ kind: "ctp", per: "trip", points: 5 }], { kind: "points" });
    expect(s.playerTotal).toEqual({ neil: 5, ronan: 0 });
  });
});

describe("points race bonus points", () => {
  it("adds points for every birdie", () => {
    const players = [P("neil"), P("ronan")];
    const r = round("r1", 1, [group("g1", ["neil", "ronan"])]);
    const s = tournamentSummary(cfg(players, [r], { win: { kind: "points", bonus: { birdies: 2 } } }), {
      r1: cards("g1", { neil: pars({ 4: -1, 6: -1 }), ronan: pars() }),
    });
    expect(s.bonus).toEqual({ neil: 4, ronan: 0 });
    expect(s.playerTotal.neil).toBe(4);
  });
});

describe("count-back on tied totals", () => {
  // Both 36 points. Neil bogeys the 1st and birdies the 18th; Ronan the other way round.
  // Last nine: Neil 19, Ronan 17, so Neil wins once it's all over; while it's still going they're tied.
  const players = [P("neil"), P("ronan")];
  const r = round("r1", 1, [group("g1", ["neil", "ronan"])]);
  const entries = { r1: cards("g1", { neil: pars({ 1: 1, 18: -1 }), ronan: pars({ 1: -1, 18: 1 }) }) };

  it("settles the tie on the last nine once the tournament is complete", () => {
    const s = tournamentSummary(cfg(players, [r], { win: { kind: "stableford" } }), entries);
    expect(s.complete).toBe(true);
    expect(s.totals!.rows.map((x) => [x.playerId, x.value, x.pos, x.tied])).toEqual([
      ["neil", 36, 1, false],
      ["ronan", 36, 2, false],
    ]);
  });

  it("shows a tie while it's still being played", () => {
    // A third player still out on the course: not over yet, so no count-back
    const r3 = round("r1", 1, [group("g1", ["neil", "ronan"]), group("g2", ["shane"])]);
    const s = tournamentSummary(cfg([...players, P("shane")], [r3], { win: { kind: "stableford" } }), entries);
    expect(s.complete).toBe(false);
    expect(s.totals!.rows.filter((x) => x.holes).map((x) => [x.value, x.pos, x.tied])).toEqual([
      [36, 1, true],
      [36, 1, true],
    ]);
  });
});
