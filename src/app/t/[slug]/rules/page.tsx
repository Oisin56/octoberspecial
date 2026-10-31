"use client";

import { useT } from "@/components/Providers";
import { Loading, pts } from "@/components/ui";
import { acrossField, bonusOn, openBonusWords, roundPointsAvailable, stageName } from "@/lib/engine";
import { SIDE_KINDS, SIDE_NAME, isOn, sideLine, sideSetupOf, type SideKind } from "@/lib/sidegames";
import { PLAY_LABEL, SCORING_LABEL, SIDE_GAME_LABEL, toRoundCfg } from "@/lib/types";

const PLAY_RULE: Record<string, string> = {
  singles: "Everyone plays their own ball.",
  fourball: "Pairs, each playing their own ball. The better score on each hole counts for the pair.",
  foursomes: "Pairs share one ball and take alternate shots, alternating tee shots too.",
  greensomes: "Both partners drive, the pair picks the better drive, then alternate shots from there.",
  scramble: "Everyone in the team hits, the team picks the best shot, and all play from there.",
};
const SCORING_RULE: Record<string, string> = {
  stableford: "Stableford: points per hole against net par (net par 2, net birdie 3, and so on). More points wins.",
  stroke: "Stroke play: fewest net strokes wins.",
  match: "Match play: each hole is won, lost or halved on net score. More holes won wins.",
  skins: "Skins: each hole is a skin, won outright by the best net score. Ties carry the skin to the next hole. Skins still carried after the 18th are void.",
};

export default function Rules() {
  const { state, summary, cfg } = useT();
  if (!state || !summary || !cfg) return <Loading />;
  const plays = [...new Set(cfg.rounds.map((r) => r.play))];
  const scorings = [...new Set(cfg.rounds.map((r) => r.scoring))];
  const enabled = cfg.sideGames.filter((g) => g.enabled);
  const sidePts = enabled.filter((g) => g.points > 0);
  const tallyOnly = enabled.filter((g) => g.points === 0);
  const teamMode = cfg.teams.length >= 2;

  const win = summary.win;
  const counted = win.kind === "points" || win.kind === "matches" || (!summary.totals && !summary.teamRows && !summary.skins && !summary.knockout);
  const countback = "A tie is settled on count-back: the better last round, then its last 9, 6, 3 and last hole.";
  const sideCount = SIDE_KINDS.filter((k) => isOn(sideSetupOf(cfg), k)).length;
  const how = (() => {
    switch (win.kind) {
      case "stableford":
        return `Won on the most Stableford points, added up over every round. ${countback}`;
      case "stroke":
        return `Won on the lowest net total: strokes taken less handicap shots, added up over every round. A hole without a score counts as net double bogey. ${countback}`;
      case "teamscore":
        return `Team score: on every hole, ${win.count ? `the best ${win.count} Stableford score${win.count === 1 ? "" : "s"} in each team count` : "every Stableford score in each team counts"}, added up over every round. The team with the most points wins.`;
      case "scramble":
        return "Texas scramble: each team plays one ball. The lowest net total to par, added up over every round, wins.";
      case "skins":
        return `Most skins: every hole is a skin, won outright by the lowest net score across the whole field. ${win.carry ? "A tied hole's skin carries to the next hole; skins still carried after the last hole aren't won." : "A tied hole wins nobody a skin."} Most skins wins.`;
      case "knockout": {
        const k = win.knockout;
        const n = cfg.rounds.length;
        const names = Array.from({ length: n }, (_, i) => stageName(i, n).toLowerCase());
        return `A match play knockout, ${k.pairs ? "pairs playing fourballs" : "one against one"}, one round for each stage (${names.join(", ")}). The draw was ${k.draw === "seeded" ? "seeded by handicap, so the lowest handicaps meet last" : k.draw === "pick" ? "made by the organiser" : "made at random"}; any byes go to the top of the draw. Level after 18: ${k.tie === "backnine" ? "the better back nine goes through (holes won on the back nine, then the last 6, 3 and last hole)" : "they play on from the 1st until one wins a hole"}. Players knocked out play on for the prizes.`;
      }
      case "matches":
        return `Matches won: every match is worth points to its team (below). ${pts(summary.pointsAvailable)} points in all; the team with the most wins.`;
      default:
        return `A points race: points from every round${sideCount ? " and the side games" : ""} (below), ${pts(summary.pointsAvailable)} in all${bonusOn(cfg) ? `, with ${openBonusWords(cfg)} on top` : ""}. Most points wins.`;
    }
  })();
  // Side games: a line each (how it counts, what it's worth, which holes), then what it is
  const side = sideSetupOf(cfg);
  const SIDE_RULE: Record<SideKind, string> = {
    ctp: "Nearest the hole from the tee; the ball must finish on the green.",
    ld: "The longest drive that finishes on the fairway.",
    birdies: "Gross birdies.",
    eagles: "Gross eagles.",
    gir: "On the green in par minus two.",
    nines: "The best score on the front 9 and on the back 9.",
    skins: "Holes won outright on net score, ties carried.",
    bestround: "The best single round.",
  };
  const sideOn = SIDE_KINDS.map((k) => ({ k, line: sideLine(side, k) })).filter((x): x is { k: SideKind; line: string } => !!x.line);
  const sharedPts = win.kind === "points" && (cfg.prizes ?? []).some((p) => (p.points ?? 0) > 0);

  return (
    <article className="article" style={{ maxWidth: 760 }}>
      <h2>The rules</h2>
      <div className="byline">Generated from the tournament settings</div>
      <p>
        {cfg.rounds.length} round{cfg.rounds.length === 1 ? "" : "s"}. {how}
        {teamMode && win.kind !== "teamscore" && win.kind !== "scramble" ? ` Team event: ${cfg.teams.map((t) => t.name).join(" v ")}.` : ""} The site keeps the scores only. Any money is settled separately.
      </p>

      <h3>The rounds</h3>
      {cfg.rounds.map((r) => {
        const row = state.rounds.find((x) => x.id === r.id)!;
        const rc = toRoundCfg(row, state.players);
        const field = rc.games.some((g) => g.sides.length > 2);
        const pointsText =
          rc.scoring === "skins"
            ? `${pts(rc.points.skin ?? 1)} point per skin`
            : summary.totals
              ? "counts towards the running totals"
              : acrossField(rc) || (field && rc.points.positions?.length)
              ? [
                  rc.holes.length > 9 && rc.points.front > 0 && `front 9 ${pts(rc.points.front)}`,
                  rc.holes.length > 9 && rc.points.back > 0 && `back 9 ${pts(rc.points.back)}`,
                  `the ${rc.holes.length > 9 ? "18" : `${rc.holes.length} holes`} by finishing position${acrossField(rc) && rc.games.length > 1 ? " across the whole field" : ""}: ${(rc.points.positions ?? []).map((v, i) => `${["1st", "2nd", "3rd", "4th", "5th", "6th"][i]} ${pts(v)}`).join(", ")}`,
                ]
                  .filter(Boolean)
                  .join(", ")
              : (rc.holes.length <= 9
                  ? [`the ${rc.holes.length} holes ${pts(rc.points.full)}`]
                  : [rc.points.front > 0 && `front 9 ${pts(rc.points.front)}`, rc.points.back > 0 && `back 9 ${pts(rc.points.back)}`, `the 18 ${pts(rc.points.full)}`])
                  .filter(Boolean)
                  .join(", ") + (rc.games.length > 1 ? " (per match)" : "");
        const hcp =
          rc.handicap.mode === "allowance"
            ? `${
                rc.play === "foursomes"
                  ? `${rc.handicap.pct}% of the pair's combined handicaps`
                  : rc.play === "greensomes"
                    ? "60% of the lower plus 40% of the higher handicap"
                    : rc.play === "scramble"
                      ? "35% of the lower plus 15% of the higher (pairs); 25/20/15/10% for teams of four"
                      : `${rc.handicap.pct}% of handicap`
              }${rc.handicap.course?.slope ? ` (course handicap from the index: slope ${rc.handicap.course.slope}, rating ${rc.handicap.course.rating})` : ""}${rc.handicap.relative ? ", strokes given off the lowest" : ""}`
            : Object.values(rc.handicap.shots).some((v) => v > 0)
              ? "shots set by the organiser"
              : "flat (off scratch)";
        return (
          <p key={r.id}>
            <strong>
              R{r.number} {r.name}
            </strong>
            : {PLAY_LABEL[rc.play]}, {SCORING_LABEL[rc.scoring].toLowerCase()}. {rc.games.length > 1 ? `${rc.games.length} matches. ` : ""}
            {counted ? `Worth ${pts(roundPointsAvailable(rc))}: ${pointsText}. ` : ""}Handicaps: {hcp}.
            {rc.holes.length <= 9 &&
              ` ${rc.holes.length} holes${rc.holes[0].number >= 10 ? " (the back nine)" : rc.holes.length < 18 && row.all_holes && row.all_holes.length > 9 ? " (the front nine)" : ""}: ${rc.handicap.mode === "allowance" ? "half the usual handicap shots, " : ""}given on the toughest of the nine by stroke index.`}
          </p>
        );
      })}

      <h3>Formats</h3>
      {plays.map((p) => (
        <p key={p}>
          <strong>{PLAY_LABEL[p]}.</strong> {PLAY_RULE[p]}
        </p>
      ))}
      {scorings.map((s) => (
        <p key={s}>{SCORING_RULE[s]}</p>
      ))}
      <p>
        {counted ? "Any segment (nine, 18, or match) that finishes level splits its points. " : ""}Shots are taken on the holes with the lowest stroke index first.
      </p>

      {sideOn.length > 0 && <h3>Side games</h3>}
      {sideOn.map(({ k, line }) => (
        <p key={k}>
          <strong>{SIDE_NAME[k]}</strong>
          {line.slice(SIDE_NAME[k].length)} {SIDE_RULE[k]}
        </p>
      ))}
      {sideOn.length > 0 && <p>{sharedPts ? "A prize's points are shared if it's tied. " : ""}Prizes not worth points are played for alongside the winner and don&apos;t change the standings.</p>}

      {enabled.length > 0 && <h3>Side games, across the whole event</h3>}
      {sidePts.map((g) => (
        <p key={g.kind}>
          <strong>{SIDE_GAME_LABEL[g.kind]}</strong>:{" "}
          {g.kind === "ctp"
            ? "on every par 3, ball must finish on the green. "
            : g.kind === "ld"
              ? "on every par 5, ball must finish on the fairway. "
              : g.kind === "gir"
                ? "on every hole. "
                : "gross. "}
          Most won {teamMode && cfg.sideGamesBy === "team" ? "by a team" : ""} takes {pts(g.points)} points. A tie splits them.
          {(g.kind === "ctp" || g.kind === "ld") && " If nobody qualifies on a hole, nobody wins it."}
        </p>
      ))}
      {tallyOnly.length > 0 && <p>Kept as a tally with no points: {tallyOnly.map((g) => SIDE_GAME_LABEL[g.kind].toLowerCase()).join(", ")}. Birdies and eagles are gross.</p>}
    </article>
  );
}
