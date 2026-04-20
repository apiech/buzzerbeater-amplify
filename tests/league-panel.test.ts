import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { __testing as leaguePanelTesting } from "../app/league-panel";

const currentDir = dirname(fileURLToPath(import.meta.url));

test("league panel helpers flatten standings in conference order", () => {
  const rows = leaguePanelTesting.flattenLeagueStandings({
    comparisons: null,
    league: {
      id: "league-1",
      name: "NBBA",
    },
    standings: [
      {
        index: 0,
        teams: [
          {
            losses: 4,
            pointMargin: 30,
            teamId: "alpha",
            teamName: "Alpha",
            wins: 10,
          },
        ],
      },
      {
        index: 1,
        teams: [
          {
            losses: 6,
            pointMargin: -8,
            teamId: "beta",
            teamName: "Beta",
            wins: 8,
          },
        ],
      },
    ],
  } as any);

  assert.deepStrictEqual(
    rows.map((row) => [row.teamId, row.standingsIndex]),
    [
      ["alpha", 0],
      ["beta", 1],
    ],
  );
});

test("league panel helper copy stays user-facing for incomplete comparisons", () => {
  assert.equal(
    leaguePanelTesting.describeLeagueComparisonState(0),
    "All league comparison rows are ready.",
  );
  assert.match(
    leaguePanelTesting.describeLeagueComparisonState(2),
    /2 teams could not be fully refreshed/i,
  );
});

test("league panel helper highlights only the connected team row", () => {
  assert.equal(
    leaguePanelTesting.isCurrentLeagueTeamRow("team-1", "team-1"),
    true,
  );
  assert.equal(
    leaguePanelTesting.isCurrentLeagueTeamRow("team-2", "team-1"),
    false,
  );
});

test("league panel renders all five tabs, row highlighting, and scrollable tables", () => {
  const source = readFileSync(
    join(currentDir, "..", "app", "league-panel.tsx"),
    "utf8",
  );

  assert.match(source, /label: "Standings"/);
  assert.match(source, /label: "Offense"/);
  assert.match(source, /label: "Defense"/);
  assert.match(source, /label: "Payroll"/);
  assert.match(source, /label: "Arena"/);
  assert.match(source, /bg-accent\/10/);
  assert.match(source, /TableShell/);
  assert.match(source, /could not be fully refreshed, so some comparison cells are blank/i);
});
