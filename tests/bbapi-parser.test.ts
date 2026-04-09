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

test("parseRoster keeps the live owned-roster skill tags and ignores pop attributes", () => {
  const xml = readFileSync(join(xmlDir, "roster.xml"), "utf8");
  const roster = parseRoster(xml);
  const firstPlayer = roster.players[0];
  const secondPlayer = roster.players[1];

  assert.equal("teamName" in roster, false);
  assert.ok(firstPlayer);
  assert.ok(secondPlayer);
  assert.deepStrictEqual(firstPlayer.skills, {
    gameShape: 8,
    potential: 10,
    jumpShot: 9,
    range: 7,
    outsideDef: 10,
    handling: 11,
    driving: 11,
    passing: 8,
    insideShot: 11,
    insideDef: 7,
    rebound: 6,
    block: 7,
    stamina: 7,
    freeThrow: 7,
    experience: 1,
  });
  assert.equal(secondPlayer.injuryWeeks, 0);
  assert.equal(
    (secondPlayer.skills as Record<string, number>).jumpShot,
    11,
  );
  assert.equal(
    (secondPlayer.skills as Record<string, number>).insideShot,
    11,
  );
});

test("parseRoster accepts the public roster contract without owned hidden skills", () => {
  const xml = `<?xml version='1.0' encoding='utf-8'?>
<bbapi version='1'>
  <roster teamid='29608' retrieved='2026-04-09T06:01:35Z'>
    <player id='49129256'>
      <firstName>Anthony</firstName>
      <lastName>Galindo</lastName>
      <nationality id='1'>USA</nationality>
      <age>48</age>
      <height>84</height>
      <dmi>19700</dmi>
      <salary>4056</salary>
      <bestPosition>C</bestPosition>
      <forSale>0</forSale>
      <skills>
        <gameShape>7</gameShape>
        <potential>8</potential>
      </skills>
    </player>
  </roster>
</bbapi>`;

  assert.deepStrictEqual(parseRoster(xml), {
    version: "1",
    retrievedAt: "2026-04-09T06:01:35Z",
    teamId: "29608",
    players: [
      {
        id: "49129256",
        firstName: "Anthony",
        lastName: "Galindo",
        fullName: "Anthony Galindo",
        salary: 4056,
        bestPosition: "C",
        age: 48,
        height: 84,
        dmi: 19700,
        injuryWeeks: 0,
        nationality: {
          id: "1",
          name: "USA",
          attributes: {
            id: "1",
          },
        },
        skills: {
          gameShape: 7,
          potential: 8,
        },
      },
    ],
  });
});

test("parseRoster throws when an owned roster player is missing a required skill", () => {
  const xml = `<?xml version='1.0' encoding='utf-8'?>
<bbapi version='1'>
  <roster teamid='29656' retrieved='2026-04-09T05:54:00Z'>
    <player id='54901056'>
      <firstName>Charles</firstName>
      <lastName>Desroches</lastName>
      <nationality id='1'>USA</nationality>
      <age>19</age>
      <height>75</height>
      <dmi>79200</dmi>
      <salary>6408</salary>
      <bestPosition>PG</bestPosition>
      <skills>
        <gameShape>8</gameShape>
        <potential>10</potential>
        <jumpShot>9</jumpShot>
      </skills>
    </player>
  </roster>
</bbapi>`;

  assert.throws(
    () => parseRoster(xml),
    /Expected roster player skills\.range\./,
  );
});
