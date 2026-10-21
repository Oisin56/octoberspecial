/**
 * Tournament setup: a tournament as it stands, turned back into the wizard's answers, so the same screens can
 * show and change it. Player keys are the players' ids.
 */
import type { PointsRule } from "@/lib/engine";
import type { RoundRow, TournamentState } from "@/lib/types";
import { courseRefOf, defaultWin, formatOfRound, handicapFor, isMatch, type RoundPoints, type WinChoice, type Who } from "@/lib/wizard";
import { TEAM_COLOURS, fresh, type DPlayer, type DRound, type Draft } from "./model";

function pointsOf(r: RoundRow, f: DRound["format"]): RoundPoints | undefined {
  const p: PointsRule = r.points_rule ?? { front: r.nine_points, back: r.nine_points, full: r.full_points };
  const nines = p.front || p.back ? { front: p.front, back: p.back } : null;
  if (!f) return undefined;
  if (isMatch(f)) return { win: p.full, nines };
  if (f === "skins") return { skin: p.skin ?? 1 };
  if (p.positions?.length) return { positions: p.positions, nines };
  return undefined;
}

export function fromState(s: Pick<TournamentState, "tournament" | "players" | "rounds">): Draft {
  const t = s.tournament;
  const players = [...s.players].sort((a, b) => a.sort - b.sort);
  const rounds = [...s.rounds].sort((a, b) => a.number - b.number);
  const teams = (t.teams ?? []).map((x, i) => ({ name: x.name, color: x.color || TEAM_COLOURS[i % TEAM_COLOURS.length] }));
  const who: Who = teams.length >= 2 ? "teams" : players.length <= 1 ? "solo" : "individuals";
  const win: WinChoice = (t.win?.kind as WinChoice | undefined) ?? (t.standings === "stableford" || t.standings === "stroke" ? t.standings : who === "teams" ? "matches" : who === "solo" ? "stableford" : "points");

  // The organiser first when playing (the wizard puts them there)
  const ordered = t.organiser_player_id ? [...players.filter((p) => p.id === t.organiser_player_id), ...players.filter((p) => p.id !== t.organiser_player_id)] : players;
  const ps: DPlayer[] = ordered.map((p) => {
    const team = teams.length ? (t.teams ?? []).findIndex((x) => x.id === p.team_id) : -1;
    return {
      key: p.id,
      name: p.name,
      index: p.handicap == null ? "" : String(Math.abs(p.handicap)),
      plus: (p.handicap ?? 0) < 0,
      team: team >= 0 ? team : null,
      nickname: p.nickname ?? "",
      line: p.bio ?? "",
    };
  });

  const ko = t.win?.kind === "knockout" ? t.win.knockout : null;
  const draft: Draft = {
    ...fresh(),
    step: "",
    who,
    name: t.name,
    subtitle: t.subtitle ?? "",
    organiserPlays: who === "solo" ? true : !!t.organiser_player_id,
    players: ps,
    teams: teams.length ? teams : fresh().teams,
    win: who === "solo" ? null : win,
    ko: ko
      ? {
          pairs: ko.pairs,
          draw: ko.draw,
          tie: ko.tie,
          slots: ko.slots.map((x) => (x ? x.replace(/^pair:/, "") : null)),
          pairsPicked: ko.pairs ? ko.entrants.map((e) => e.playerIds) : null,
        }
      : fresh().ko,
    skinsCarry: t.win?.kind === "skins" ? t.win.carry : true,
    teamCount: t.win?.kind === "teamscore" ? t.win.count : 2,
    bonus: t.win?.kind === "points" ? { ...(t.win.bonus ?? {}) } : {},
    count: rounds.length,
    draw: "pick",
    prizes: t.prizes ?? [],
    extras: { feed: t.feed_on !== false, ai: t.ai_on !== false, video: t.video_enabled !== false },
    tone: t.tone ?? "broadsheet",
    units: t.units ?? "yards",
    share: t.share_shape ?? "portrait",
    theme: t.theme,
    rounds: rounds.map((r) => {
      const format = formatOfRound(r, who);
      const card = r.all_holes ?? r.holes ?? [];
      const manual = r.course_slug.startsWith("manual:");
      return {
        courseRef: courseRefOf(r.course_slug),
        courseName: r.course_name,
        location: r.course_location,
        lat: r.lat,
        lon: r.lon,
        tees: r.tees?.length ? r.tees : undefined,
        tee: r.tee,
        playerTees: { ...(r.player_tees ?? {}) },
        holeSet: card.length === 9 ? "all" : (r.hole_set ?? "all"),
        manual,
        manualCard: manual ? card.map((h) => ({ par: h.par, si: h.si })) : null,
        format,
        date: r.play_date,
        time: r.tee_time ? r.tee_time.slice(0, 5) : null,
        points: pointsOf(r, format),
        picks: (r.games ?? []).map((g) => g.sides.map((sd) => [...sd.playerIds])),
      };
    }),
  };

  // The handicap allowance, when it isn't the official one for the first round
  const first = rounds[0];
  const f0 = draft.rounds[0]?.format;
  if (first?.handicap_rule?.mode === "allowance" && f0) {
    const official = handicapFor(f0, draft.win, null).pct;
    draft.allowance = first.handicap_rule.pct === official ? null : first.handicap_rule.pct;
  }
  if (!draft.win && who !== "solo") draft.win = defaultWin(who, teams.length);
  return draft;
}
