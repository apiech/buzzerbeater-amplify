import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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

mkdirSync(jsonDir, { recursive: true });

for (const [name, parser] of Object.entries(parsers)) {
  const xml = readFileSync(join(xmlDir, `${name}.xml`), "utf8");
  const parsed = parser(xml);
  writeFileSync(
    join(jsonDir, `${name}.json`),
    `${JSON.stringify(parsed, null, 2)}\n`,
    "utf8",
  );
}

console.log(`Wrote ${Object.keys(parsers).length} BBAPI golden files to ${jsonDir}`);
