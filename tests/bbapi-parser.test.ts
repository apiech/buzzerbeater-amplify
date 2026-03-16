import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseArena,
  parseBoxScore,
  parseEconomy,
  parseLeagues,
  parsePlayer,
  parseRoster,
  parseSchedule,
  parseSeasons,
  parseStandings,
  parseTeamInfo,
  parseTeamStats,
} from "../lib/bbapi";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const fixturesRoot = join(currentDir, "..", "bb-api-fixtures");
const xmlDir = join(fixturesRoot, "xml");
const jsonDir = join(fixturesRoot, "json");

const parsers = {
  arena: parseArena,
  boxscore: parseBoxScore,
  economy: parseEconomy,
  leagues: parseLeagues,
  player: parsePlayer,
  roster: parseRoster,
  schedule: parseSchedule,
  seasons: parseSeasons,
  standings: parseStandings,
  teaminfo: parseTeamInfo,
  teamstats: parseTeamStats,
} as const;

for (const [name, parser] of Object.entries(parsers)) {
  test(`parser golden: ${name}`, () => {
    const xml = readFileSync(join(xmlDir, `${name}.xml`), "utf8");
    const expected = JSON.parse(
      readFileSync(join(jsonDir, `${name}.json`), "utf8"),
    );

    assert.deepStrictEqual(parser(xml), expected);
  });
}

test("parseSeasons reads season bounds from child elements", () => {
  const xml = readFileSync(join(xmlDir, "seasons.xml"), "utf8");

  assert.deepStrictEqual(parseSeasons(xml), {
    version: "1",
    seasons: [
      {
        id: 71,
        start: "2025-10-01",
        finish: "2025-12-31",
      },
      {
        id: 72,
        start: "2026-01-01",
        finish: "2026-03-31",
      },
    ],
  });
});
