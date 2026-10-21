# Set-up redesign: technical plan

Signed-off blueprint (Oisin, 21 Oct 2026): https://claude.ai/artifact/DLxfW7XXZKPse6bKSas6A7
Branch: `setup-redesign`. Read the blueprint for what people see; this file is how it's built and where it's at.

## Decisions (settled)
- Seven ways to win: Stableford total, stroke total (net), points race, match play knockout, most skins (group);
  matches won (two teams), team score with best N counting per hole (any number of teams, up to 6).
- Points race defaults: places 1 (two players) / 3-2-1 (3–9) / 5-4-3-2-1 (10+); match win 1, half ½; skin 1;
  optional front 9 + back 9 points per round; bonus points per birdie / eagle / GIR / CTP won / LD won (off).
- Handicap allowances: Stableford and stroke 95%, singles match 100% of difference, fourball 90% off the low,
  foursomes 50% of combined difference, team score 85%, skins 100%. Overrides under More options.
- Ties: Stableford and stroke totals on count-back (last round, then its last 9, 6, 3, 1). Knockout: asked in the
  wizard; Better back nine (default: holes won on the back 9, then last 6, 3, 1) or Extra holes.
- Knockout: singles or pairs; draw random / seeded by handicap / picked; byes to top seeds; one stage per round;
  knocked-out players keep playing for prizes (no Plate yet); season knockouts with play-by dates: later.
- Different tees per player per round; course handicap from each player's own tee (index × slope ÷ 113 + CR − par).
- Prizes separate from the winner, all off by default: CTP, LD, front 9 and back 9, most birdies, most GIR,
  skins (when not the main game), best round. Per trip or per round. Count as points only in a points race.
- Texas scramble now as a team format; greensomes later.
- Names: tab "Organiser"; "Tournament setup" is its first tile; Fine-tune and Admin words removed.

## Data model
- `tournaments.win` jsonb (new): `WinRule` in `src/lib/engine.ts`. Absent on old tournaments: derived from
  `standings` + `side_games` (legacy behaviour kept exactly, so the October Special is unchanged).
- `tournaments.prizes` jsonb (new): `Prize[]`. New tournaments write `side_games: []`.
- `rounds.tees` jsonb (new): every tee of the course `{name, par[], si[], yards[], slope, rating}`.
- `rounds.player_tees` jsonb (new): `{playerId: teeName}` overrides of the round's tee.
- Knockout bracket in `win.knockout`: entrants, draw order; later stages are worked out from results.

## Steps (tick as done)
- [x] 1. Engine: WinRule, per-player tees, team score, Texas scramble, skins across the field, knockout bracket +
         ties + extra holes + prize-only groups, prizes, points-race bonus, count-back. `src/lib/compete.test.ts`.
         (Defaults — allowances, two-player points — live in the wizard model, step 2.)
- [x] 2. Wizard: new screen order and screens (`src/components/setup/`, `src/app/new`), rules in `src/lib/wizard.ts`,
         creation in `wizard-server.ts`; knockout rounds fill in after each score (`knockout-server.ts`); extra holes
         19-27 allowed. Still to do elsewhere: entering extra holes on the scorecard (on-course work).
- [ ] 3. Tournament setup page from the wizard's screens.
- [ ] 4. Course guide library + fixes table.
- [ ] 5. Display: boards for team score, skins, knockout bracket, prizes; rules page; AI writer standings text;
         film final standings card. Organiser home wording.
- [ ] 6. Walk-throughs per tournament type, existing suites, October Special check, front page screens.
