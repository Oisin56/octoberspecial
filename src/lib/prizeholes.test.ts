import { describe, expect, it } from "vitest";
import { sideGameHoles, type TournamentCfg } from "./engine";
import { roundHandicap, shotsByHand } from "./wizard";

const holes = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5].map((par, i) => ({ number: i + 1, par, si: i + 1 }));
const round = { number: 2, holes };

describe("closest the pin and long drive: which holes", () => {
  it("older tournaments: every par 3 and par 5", () => {
    expect(sideGameHoles({ win: null, prizes: null }, round, "ctp")).toEqual([3, 7, 12, 16]);
  });
  it("not played for: none on the card", () => {
    expect(sideGameHoles({ win: { kind: "stableford" }, prizes: [] }, round, "ld")).toEqual([]);
  });
  it("a prize: every par 3 unless chosen", () => {
    const cfg: Pick<TournamentCfg, "win" | "prizes"> = { win: { kind: "stableford" }, prizes: [{ kind: "ctp", per: "trip" }] };
    expect(sideGameHoles(cfg, round, "ctp")).toEqual([3, 7, 12, 16]);
  });
  it("chosen holes, round by round; a round not chosen gets every par 3", () => {
    const cfg: Pick<TournamentCfg, "win" | "prizes"> = { win: { kind: "stableford" }, prizes: [{ kind: "ctp", per: "trip", holesByRound: { "2": [7, 16] } }] };
    expect(sideGameHoles(cfg, round, "ctp")).toEqual([7, 16]);
    expect(sideGameHoles(cfg, { ...round, number: 1 }, "ctp")).toEqual([3, 7, 12, 16]);
  });
  it("only par 3s count for closest the pin, whatever's chosen", () => {
    const cfg: Pick<TournamentCfg, "win" | "prizes"> = { win: { kind: "stableford" }, prizes: [{ kind: "ctp", per: "trip", holesByRound: { "2": [4, 7] } }] };
    expect(sideGameHoles(cfg, round, "ctp")).toEqual([7]);
  });
  it("a points race bonus for each one won: every par 5, or the holes chosen (the same as the prize's)", () => {
    expect(sideGameHoles({ win: { kind: "points", bonus: { ld: 1 } }, prizes: [] }, round, "ld")).toEqual([4, 9, 13, 18]);
    const cfg: Pick<TournamentCfg, "win" | "prizes"> = { win: { kind: "points", bonus: { ld: 1 } }, prizes: [{ kind: "ld", per: "trip", holesByRound: { "2": [4] } }] };
    expect(sideGameHoles(cfg, round, "ld")).toEqual([4]);
    const own: Pick<TournamentCfg, "win" | "prizes"> = { win: { kind: "points", bonus: { ld: 1 }, bonusHoles: { ld: { "2": [9, 18] } } }, prizes: [] };
    expect(sideGameHoles(own, round, "ld")).toEqual([9, 18]);
  });
  it("not in this round: an empty choice", () => {
    const cfg: Pick<TournamentCfg, "win" | "prizes"> = { win: { kind: "stableford" }, prizes: [{ kind: "ctp", per: "trip", holesByRound: { "2": [] } }] };
    expect(sideGameHoles(cfg, round, "ctp")).toEqual([]);
    expect(sideGameHoles(cfg, { ...round, number: 1 }, "ctp")).toEqual([3, 7, 12, 16]);
  });
});

describe("handicaps for one round", () => {
  const idOf = { a: "ann", b: "bob" };
  it("official: the allowance", () => {
    expect(roundHandicap("stableford", "stableford", null, null, { hcp: "official" }, idOf)).toMatchObject({ mode: "allowance", pct: 95 });
  });
  it("flat: no shots for anyone", () => {
    expect(roundHandicap("fourball", "matches", null, null, { hcp: "flat" }, idOf)).toEqual({ mode: "manual", shots: {} });
  });
  it("set by hand: by player", () => {
    expect(roundHandicap("match", "points", null, null, { hcp: "manual", shots: { a: 3, b: 0, x: 9 } }, idOf)).toEqual({ mode: "manual", shots: { ann: 3 } });
  });
  it("not for one ball between two (foursomes, scramble): the allowance instead", () => {
    expect(shotsByHand("foursomes")).toBe(false);
    expect(roundHandicap("foursomes", "matches", null, null, { hcp: "manual", shots: { a: 3 } }, idOf)).toMatchObject({ mode: "allowance", pct: 50 });
  });
});
