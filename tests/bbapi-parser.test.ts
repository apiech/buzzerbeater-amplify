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

function buildBoxScoreXmlWithAwayPlayer(args: {
  didNotPlay?: boolean;
  minutes?: Record<string, number>;
  rating: string;
}) {
  const minutes = {
    C: 0,
    PF: 0,
    PG: 0,
    SF: 0,
    SG: 0,
    ...(args.minutes ?? {}),
  };

  const awayPerformance = [
    "<fgm>0</fgm>",
    "<fga>0</fga>",
    "<tpm>0</tpm>",
    "<tpa>0</tpa>",
    "<ftm>0</ftm>",
    "<fta>0</fta>",
    "<oreb>0</oreb>",
    "<reb>1</reb>",
    "<ast>0</ast>",
    "<to>0</to>",
    "<stl>0</stl>",
    "<blk>0</blk>",
    "<pf>0</pf>",
    "<pts>0</pts>",
    `<rating>${args.rating}</rating>`,
    args.didNotPlay ? "<dnp/>" : "",
  ].join("");

  return `<?xml version='1.0' encoding='utf-8'?>
<bbapi version='1'>
  <match id='fixture-match' retrieved='2026-04-09T00:00:00Z'>
    <awayTeam id='10'>
      <teamName>Away Team</teamName>
      <score partials='0,0,0,0'>0</score>
      <boxscore>
        <player id='away-player'>
          <firstName>Away</firstName>
          <lastName>Sample</lastName>
          <minutes>
            <PG>${minutes.PG}</PG>
            <SG>${minutes.SG}</SG>
            <SF>${minutes.SF}</SF>
            <PF>${minutes.PF}</PF>
            <C>${minutes.C}</C>
          </minutes>
          <performance>${awayPerformance}</performance>
        </player>
      </boxscore>
    </awayTeam>
    <homeTeam id='11'>
      <teamName>Home Team</teamName>
      <score partials='0,0,0,0'>0</score>
      <boxscore>
        <player id='home-player'>
          <firstName>Home</firstName>
          <lastName>Baseline</lastName>
          <minutes>
            <PG>12</PG>
            <SG>0</SG>
            <SF>0</SF>
            <PF>0</PF>
            <C>0</C>
          </minutes>
          <performance>
            <fgm>1</fgm>
            <fga>2</fga>
            <tpm>0</tpm>
            <tpa>1</tpa>
            <ftm>0</ftm>
            <fta>0</fta>
            <oreb>0</oreb>
            <reb>1</reb>
            <ast>1</ast>
            <to>0</to>
            <stl>0</stl>
            <blk>0</blk>
            <pf>1</pf>
            <pts>2</pts>
            <rating>12</rating>
          </performance>
        </player>
      </boxscore>
    </homeTeam>
  </match>
</bbapi>`;
}

for (const scenario of [
  {
    didNotPlay: false,
    label: "numeric ratings without a dnp marker",
    minutes: { PG: 18 },
    rating: "16",
    ratingValue: 16,
  },
  {
    didNotPlay: false,
    label: "played players whose rating is N/A",
    minutes: { PG: 5 },
    rating: "N/A",
    ratingValue: null,
  },
  {
    didNotPlay: true,
    label: "dnp players whose rating is N/A",
    minutes: {},
    rating: "N/A",
    ratingValue: null,
  },
  {
    didNotPlay: true,
    label: "dnp players whose rating uses the -100000 sentinel",
    minutes: {},
    rating: "-100000",
    ratingValue: null,
  },
] as const) {
  test(`parseBoxScore accepts ${scenario.label}`, () => {
    const boxScore = parseBoxScore(
      buildBoxScoreXmlWithAwayPlayer({
        didNotPlay: scenario.didNotPlay,
        minutes: scenario.minutes,
        rating: scenario.rating,
      }),
    );
    const awayPlayer = boxScore.awayTeam.players[0];

    assert.ok(awayPlayer);
    assert.deepStrictEqual(awayPlayer.performanceStats, {
      ast: 0,
      blk: 0,
      fga: 0,
      fgm: 0,
      fta: 0,
      ftm: 0,
      oreb: 0,
      pf: 0,
      pts: 0,
      reb: 1,
      stl: 0,
      to: 0,
      tpa: 0,
      tpm: 0,
    });
    assert.equal(awayPlayer.ratingRaw, scenario.rating);
    assert.equal(awayPlayer.ratingValue, scenario.ratingValue);
    assert.equal(awayPlayer.didNotPlay, scenario.didNotPlay);
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
