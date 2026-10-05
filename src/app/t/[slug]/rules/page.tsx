"use client";

import { useT } from "@/components/Providers";
import { Loading, pts } from "@/components/ui";
import { roundPointsAvailable } from "@/lib/engine";
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
  skins: "Skins: each hole is a skin, won outright by the best net score. Ties carry the skin to the next hole.",
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

  return (
    <article className="article" style={{ maxWidth: 760 }}>
      <h2>The rules</h2>
      <div className="byline">Generated from the tournament settings</div>
      <p>
        {cfg.rounds.length} round{cfg.rounds.length === 1 ? "" : "s"}, {pts(summary.pointsAvailable)} points available in total.
        {teamMode ? ` Team event: ${cfg.teams.map((t) => t.name).join(" v ")}. Every point a side wins goes to its team.` : ""} The site keeps points
        only. Any money is settled separately.
      </p>

      <h3>The rounds</h3>
      {cfg.rounds.map((r) => {
        const row = state.rounds.find((x) => x.id === r.id)!;
        const rc = toRoundCfg(row, state.players);
        const field = rc.games.some((g) => g.sides.length > 2);
        const pointsText =
          rc.scoring === "skins"
            ? `${pts(rc.points.skin ?? 1)} point per skin`
            : field && rc.points.positions?.length
              ? `points by finishing position: ${rc.points.positions.map(pts).join(", ")}`
              : [rc.points.front > 0 && `front 9 ${pts(rc.points.front)}`, rc.points.back > 0 && `back 9 ${pts(rc.points.back)}`, `the 18 ${pts(rc.points.full)}`]
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
              }${rc.handicap.relative ? ", strokes given off the lowest" : ""}`
            : Object.values(rc.handicap.shots).some((v) => v > 0)
              ? "shots set by the organiser"
              : "flat (off scratch)";
        return (
          <p key={r.id}>
            <strong>
              R{r.number} {r.name}
            </strong>
            : {PLAY_LABEL[rc.play]}, {SCORING_LABEL[rc.scoring].toLowerCase()}. {rc.games.length > 1 ? `${rc.games.length} matches. ` : ""}
            Worth {pts(roundPointsAvailable(rc))}: {pointsText}. Handicaps: {hcp}.
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
      <p>Any segment (nine, 18, or match) that finishes level splits its points. Shots are taken on the holes with the lowest stroke index first.</p>

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
