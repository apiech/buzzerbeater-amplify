import { XMLParser } from "fast-xml-parser";
import {
  TEAM_RATING_KEYS,
  type TeamRatings,
} from "../buzzerbeater/team-ratings";
import { OWNED_ROSTER_SKILL_KEYS } from "./types";

import type {
  BBApiArena,
  BBApiArenaSeat,
  BBApiBoxScore,
  BBApiBoxScorePlayer,
  BBApiBoxScoreTeam,
  BBApiConferenceStandings,
  BBApiConferenceTeam,
  BBApiEconomy,
  BBApiEconomyTransaction,
  BBApiLeague,
  BBApiLeagues,
  BBApiNamedReference,
  BBApiPlayer,
  BBApiRoster,
  BBApiRosterPlayer,
  BBApiRosterPlayerSkills,
  BBApiRequiredNamedReference,
  BBApiSchedule,
  BBApiScheduleMatch,
  BBApiScheduleMatchSide,
  BBApiSeason,
  BBApiSeasons,
  BBApiStandings,
  BBApiTeamInfo,
  BBApiTeamStats,
} from "./types";

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
});

type XmlObject = Record<string, unknown>;

export function parseTeamInfo(xml: string): BBApiTeamInfo {
  const root = parseRoot(xml);
  const container = requireObject(root.bbapi.team, "team");
  return {
    version: asString(root.bbapi["@_version"]) ?? "1",
    retrievedAt: asString(container["@_retrieved"]),
    teamId: asString(container["@_id"]),
    teamName: readText(container.teamName),
    shortName: readText(container.shortName),
    ownerName: readText(container.owner),
    isBot: container.botTeam !== undefined,
    league: parseNamedReference(container.league),
    country: parseNamedReference(container.country),
    rival: parseNamedReference(container.rival),
    fields: stripKeys(container, [
      "@_retrieved",
      "@_id",
      "teamName",
      "shortName",
      "owner",
      "botTeam",
      "league",
      "country",
      "rival",
    ]),
  };
}

export function parseRoster(xml: string): BBApiRoster {
  const root = parseRoot(xml);
  const container = requireObject(root.bbapi.roster, "roster");
  const players = toArray(container.player).map(parseRosterPlayer);
  return {
    version: asString(root.bbapi["@_version"]) ?? "1",
    retrievedAt: requireStringValue(
      container["@_retrieved"],
      "roster retrieved timestamp",
    ),
    teamId: requireStringValue(container["@_teamid"], "roster team id"),
    players,
  };
}

export function parsePlayer(xml: string): BBApiPlayer {
  const root = parseRoot(xml);
  const container = requireObject(root.bbapi.player, "player");
  const firstName = readText(container.firstName);
  const lastName = readText(container.lastName);
  return {
    version: asString(root.bbapi["@_version"]) ?? "1",
    retrievedAt: asString(container["@_retrieved"]),
    playerId: asString(container["@_id"]),
    firstName,
    lastName,
    fullName: [firstName, lastName].filter(Boolean).join(" "),
    salary: asNumber(readText(container.salary)),
    bestPosition: readText(container.bestPosition),
    age: asNumber(readText(container.age)),
    fields: stripKeys(container, [
      "@_retrieved",
      "@_id",
      "firstName",
      "lastName",
      "salary",
      "bestPosition",
      "age",
    ]),
  };
}

export function parseSchedule(xml: string): BBApiSchedule {
  const root = parseRoot(xml);
  const container = requireObject(root.bbapi.schedule, "schedule");
  return {
    version: asString(root.bbapi["@_version"]) ?? "1",
    retrievedAt: asString(container["@_retrieved"]),
    teamId: asString(container["@_teamid"]),
    season: asNumber(container["@_season"]),
    matches: toArray(container.match).map(parseScheduleMatch),
  };
}

export function parseSeasons(xml: string): BBApiSeasons {
  const root = parseRoot(xml);
  const container = requireObject(root.bbapi.seasons, "seasons");
  const seasons = toArray(container.season).map(
    (season): BBApiSeason => ({
      id: asNumber(getObject(season)?.["@_id"]),
      start: readText(getObject(season)?.start),
      finish: readText(getObject(season)?.finish),
    }),
  );
  return {
    version: asString(root.bbapi["@_version"]) ?? "1",
    seasons,
  };
}

export function parseStandings(xml: string): BBApiStandings {
  const root = parseRoot(xml);
  const container = requireObject(root.bbapi.standings, "standings");
  const regularSeason = getObject(container.regularSeason);
  const conferences = toArray(regularSeason?.conference).map(
    (conference, index): BBApiConferenceStandings => ({
      index,
      teams: toArray(getObject(conference)?.team).map(parseConferenceTeam),
    }),
  );
  const playoffEntries = getObject(container.playoffs);
  const brackets = Object.entries(playoffEntries ?? {})
    .filter(([key]) => !key.startsWith("@_"))
    .map(([key, value]) => ({
      name: key,
      matches: toArray(value).flatMap((entry) =>
        toArray(getObject(entry)?.match).map(parseScheduleMatch),
      ),
    }));

  return {
    version: asString(root.bbapi["@_version"]) ?? "1",
    retrievedAt: asString(container["@_retrieved"]),
    season: asNumber(container["@_season"]),
    league: parseNamedReference(container.league),
    country: parseNamedReference(container.country),
    conferences,
    brackets,
  };
}

export function parseBoxScore(xml: string): BBApiBoxScore {
  const root = parseRoot(xml);
  const container = requireObject(root.bbapi.match, "match");
  return {
    version: asString(root.bbapi["@_version"]) ?? "1",
    retrievedAt: asString(container["@_retrieved"]),
    matchId: asString(container["@_id"]),
    type: asString(container["@_type"]),
    startTime: readText(container.startTime),
    endTime: readText(container.endTime),
    neutral: asBoolean(readText(container.neutral)),
    effortDelta: asNumber(readText(container.effortDelta)),
    attendance: mapNumberChildren(container.attendance),
    awayTeam: parseBoxScoreTeam(container.awayTeam),
    homeTeam: parseBoxScoreTeam(container.homeTeam),
    details: stripKeys(container, [
      "@_retrieved",
      "@_id",
      "@_type",
      "startTime",
      "endTime",
      "neutral",
      "effortDelta",
      "attendance",
      "awayTeam",
      "homeTeam",
    ]),
  };
}

export function parseArena(xml: string): BBApiArena {
  const root = parseRoot(xml);
  const container = requireObject(root.bbapi.arena, "arena");
  const seatsObject = getObject(container.seats);
  const seats = Object.entries(seatsObject ?? {}).reduce<Record<string, BBApiArenaSeat>>(
    (accumulator, [section, value]) => {
      if (section.startsWith("@_")) {
        return accumulator;
      }
      const seat = getObject(value);
      accumulator[section] = {
        section,
        capacity: asNumber(readText(value)),
        price: asNumber(seat?.["@_price"]),
        nextPrice: asNumber(seat?.["@_nextPrice"]),
      };
      return accumulator;
    },
    {},
  );
  const expansionObject = getObject(container.expansion);
  return {
    version: asString(root.bbapi["@_version"]) ?? "1",
    retrievedAt: asString(container["@_retrieved"]),
    teamId: asString(container["@_teamid"]),
    name: readText(container.name),
    seats,
    expansion: expansionObject
      ? {
          daysLeft: asNumber(expansionObject["@_daysLeft"]),
          sections: Object.entries(expansionObject).reduce<Record<string, number | null>>(
            (accumulator, [section, value]) => {
              if (!section.startsWith("@_")) {
                accumulator[section] = asNumber(readText(value));
              }
              return accumulator;
            },
            {},
          ),
        }
      : null,
  };
}

export function parseEconomy(xml: string): BBApiEconomy {
  const root = parseRoot(xml);
  const container = requireObject(root.bbapi.economy, "economy");
  const transactions = toArray(container.transaction).map(
    (transaction): BBApiEconomyTransaction => {
      const node = getObject(transaction);
      return {
        kind: asString(node?.["@_kind"]),
        amount: asNumber(readText(node?.amount)) ?? readText(node?.amount),
        date: readText(node?.date),
        attributes: readAttributes(node),
        fields: stripKeys(node, ["@_kind", "amount", "date"]),
      };
    },
  );
  return {
    version: asString(root.bbapi["@_version"]) ?? "1",
    retrievedAt: asString(container["@_retrieved"]),
    fields: stripKeys(container, ["@_retrieved", "transaction"]),
    transactions,
  };
}

export function parseTeamStats(xml: string): BBApiTeamStats {
  const root = parseRoot(xml);
  const container = requireObject(root.bbapi.teamstats ?? root.bbapi.teamStats, "teamstats");
  const categories = Object.entries(container)
    .filter(([key, value]) => !key.startsWith("@_") && isObject(value) && key !== "player")
    .reduce<Record<string, Record<string, number | string | null>>>(
      (accumulator, [key, value]) => {
        accumulator[key] = mapScalarChildren(value);
        return accumulator;
      },
      {},
    );
  const players = toArray(container.player).map((player) => {
    const node = getObject(player);
    const firstName = readText(node?.firstName);
    const lastName = readText(node?.lastName);
    return {
      id: asString(node?.["@_id"]),
      firstName,
      lastName,
      fullName: [firstName, lastName].filter(Boolean).join(" "),
      stats: mapScalarChildren(node?.stats),
    };
  });

  return {
    version: asString(root.bbapi["@_version"]) ?? "1",
    retrievedAt: asString(container["@_retrieved"]),
    teamId: asString(container["@_teamid"]),
    season: asNumber(container["@_season"]),
    mode: asString(container["@_mode"]),
    fields: Object.entries(container)
      .filter(([key, value]) => !key.startsWith("@_") && !isObject(value))
      .reduce<Record<string, unknown>>((accumulator, [key, value]) => {
        accumulator[key] = normalizeScalar(value);
        return accumulator;
      }, {}),
    categories,
    players,
  };
}

export function parseLeagues(xml: string): BBApiLeagues {
  const root = parseRoot(xml);
  const container = requireObject(root.bbapi.leagues ?? root.bbapi.division, "leagues");
  const leagues = toArray(container.league).map(
    (league): BBApiLeague => {
      const node = getObject(league);
      return {
        id: asString(node?.["@_id"]),
        name: readText(node),
        level: asNumber(node?.["@_level"]) ?? asNumber(container["@_level"]),
        attributes: readAttributes(node),
      };
    },
  );
  return {
    version: asString(root.bbapi["@_version"]) ?? "1",
    retrievedAt: asString(container["@_retrieved"]),
    country: parseNamedReference(container.country),
    level: asNumber(container["@_level"]),
    leagues,
  };
}

function parseRosterPlayer(player: unknown): BBApiRosterPlayer {
  const node = getObject(player);
  if (!node) {
    throw new Error("Expected roster player node.");
  }

  const firstName = requireNodeText(node.firstName, "roster player firstName");
  const lastName = requireNodeText(node.lastName, "roster player lastName");
  return {
    id: requireStringValue(node["@_id"], "roster player id"),
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    salary: requireNodeNumber(node.salary, "roster player salary"),
    bestPosition: requireNodeText(
      node.bestPosition,
      "roster player bestPosition",
    ),
    age: requireNodeNumber(node.age, "roster player age"),
    height: requireNodeNumber(node.height, "roster player height"),
    dmi: requireNodeNumber(node.dmi, "roster player dmi"),
    injuryWeeks:
      node.injury === undefined
        ? 0
        : requireNodeNumber(node.injury, "roster player injury"),
    nationality: requireNamedReference(
      node.nationality,
      "roster player nationality",
    ),
    skills: parseRosterPlayerSkills(node.skills),
  };
}

function parseScheduleMatch(match: unknown): BBApiScheduleMatch {
  const node = getObject(match);
  return {
    id: asString(node?.["@_id"]),
    startTime: asString(node?.["@_start"]),
    type: asString(node?.["@_type"]),
    awayTeam: parseScheduleMatchSide(node?.awayTeam),
    homeTeam: parseScheduleMatchSide(node?.homeTeam),
  };
}

function parseScheduleMatchSide(side: unknown): BBApiScheduleMatchSide {
  const node = getObject(side);
  return {
    id: asString(node?.["@_id"]),
    teamName: readText(node?.teamName),
    score: asNumber(readText(node?.score)),
  };
}

function parseConferenceTeam(team: unknown): BBApiConferenceTeam {
  const node = getObject(team);
  return {
    id: asString(node?.["@_id"]),
    teamName: readText(node?.teamName),
    wins: asNumber(readText(node?.wins)),
    losses: asNumber(readText(node?.losses)),
    pf: asNumber(readText(node?.pf)),
    pa: asNumber(readText(node?.pa)),
    isBot: asBoolean(readText(node?.isBot)),
    forfeits: asNumber(readText(node?.forfeits)),
    fields: stripKeys(node, [
      "@_id",
      "teamName",
      "wins",
      "losses",
      "pf",
      "pa",
      "isBot",
      "forfeits",
    ]),
  };
}

function parseBoxScoreTeam(team: unknown): BBApiBoxScoreTeam {
  const node = getObject(team);
  const scoreNode = getObject(node?.score);
  const partials = asString(scoreNode?.["@_partials"])
    ?.split(",")
    .map((value) => asNumber(value.trim()))
    .filter((value): value is number => value !== null) ?? [];
  return {
    id: asString(node?.["@_id"]),
    teamName: readText(node?.teamName),
    shortName: readText(node?.shortName),
    offStrategy: readText(node?.offStrategy),
    defStrategy: readText(node?.defStrategy),
    score: asNumber(readText(node?.score)),
    partialScores: partials,
    teamTotals: mapRequiredNumberChildren(
      getObject(node?.boxscore)?.teamTotals,
      "boxscore teamTotals",
    ),
    ratings: parseBoxScoreTeamRatings(node?.ratings),
    efficiency: mapRequiredNumberChildren(
      node?.efficiency,
      "boxscore efficiency",
    ),
    gdp: mapScalarChildren(node?.gdp),
    players: toArray(getObject(node?.boxscore)?.player).map(parseBoxScorePlayer),
    details: stripKeys(node, [
      "@_id",
      "teamName",
      "shortName",
      "offStrategy",
      "defStrategy",
      "score",
      "boxscore",
      "ratings",
      "efficiency",
      "gdp",
    ]),
  };
}

function parseBoxScorePlayer(player: unknown): BBApiBoxScorePlayer {
  const node = getObject(player);
  const firstName = readText(node?.firstName);
  const lastName = readText(node?.lastName);
  return {
    id: asString(node?.["@_id"]),
    firstName,
    lastName,
    fullName: [firstName, lastName].filter(Boolean).join(" "),
    performance: mapRequiredNumberChildren(
      node?.performance,
      "boxscore player performance",
    ),
    minutesByPosition: mapRequiredNumberChildren(
      node?.minutes,
      "boxscore player minutes",
    ),
    details: stripKeys(node, ["@_id", "firstName", "lastName", "performance", "minutes"]),
  };
}

function parseNamedReference(node: unknown): BBApiNamedReference | null {
  const object = getObject(node);
  if (!object) {
    return null;
  }
  return {
    id: asString(object["@_id"]),
    name: readText(object),
    attributes: readAttributes(object),
  };
}

function requireNamedReference(
  node: unknown,
  label: string,
): BBApiRequiredNamedReference {
  const reference = parseNamedReference(node);
  if (!reference?.id || !reference.name) {
    throw new Error(`Expected ${label}.`);
  }
  return reference as BBApiRequiredNamedReference;
}

function parseRosterPlayerSkills(node: unknown): BBApiRosterPlayerSkills {
  const skillsNode = requireObject(node, "roster player skills");
  const gameShape = requireNodeNumber(
    skillsNode.gameShape,
    "roster player skills.gameShape",
  );
  const potential = requireNodeNumber(
    skillsNode.potential,
    "roster player skills.potential",
  );

  const hasOwnedSkills = OWNED_ROSTER_SKILL_KEYS.some((key) => {
    if (key === "gameShape" || key === "potential") {
      return false;
    }
    return skillsNode[key] !== undefined;
  });

  if (!hasOwnedSkills) {
    return {
      gameShape,
      potential,
    };
  }

  return {
    gameShape,
    potential,
    jumpShot: requireNodeNumber(
      skillsNode.jumpShot,
      "roster player skills.jumpShot",
    ),
    range: requireNodeNumber(skillsNode.range, "roster player skills.range"),
    outsideDef: requireNodeNumber(
      skillsNode.outsideDef,
      "roster player skills.outsideDef",
    ),
    handling: requireNodeNumber(
      skillsNode.handling,
      "roster player skills.handling",
    ),
    driving: requireNodeNumber(
      skillsNode.driving,
      "roster player skills.driving",
    ),
    passing: requireNodeNumber(
      skillsNode.passing,
      "roster player skills.passing",
    ),
    insideShot: requireNodeNumber(
      skillsNode.insideShot,
      "roster player skills.insideShot",
    ),
    insideDef: requireNodeNumber(
      skillsNode.insideDef,
      "roster player skills.insideDef",
    ),
    rebound: requireNodeNumber(
      skillsNode.rebound,
      "roster player skills.rebound",
    ),
    block: requireNodeNumber(skillsNode.block, "roster player skills.block"),
    stamina: requireNodeNumber(
      skillsNode.stamina,
      "roster player skills.stamina",
    ),
    freeThrow: requireNodeNumber(
      skillsNode.freeThrow,
      "roster player skills.freeThrow",
    ),
    experience: requireNodeNumber(
      skillsNode.experience,
      "roster player skills.experience",
    ),
  };
}

function parseBoxScoreTeamRatings(node: unknown): TeamRatings | null {
  const ratingsNode = getObject(node);
  if (!ratingsNode) {
    return null;
  }

  const keys = Object.keys(ratingsNode).filter((key) => !key.startsWith("@_"));
  if (!keys.length) {
    return null;
  }

  const ratings = {} as TeamRatings;
  for (const key of TEAM_RATING_KEYS) {
    ratings[key] = requireNodeNumber(
      ratingsNode[key],
      `boxscore ratings.${key}`,
    );
  }
  return ratings;
}

function parseRoot(xml: string): { bbapi: XmlObject } {
  const parsed = parser.parse(xml) as { bbapi?: XmlObject };
  if (!parsed.bbapi || typeof parsed.bbapi !== "object") {
    throw new Error("Expected BB API root node.");
  }
  const error = getObject(parsed.bbapi.error);
  if (error) {
    throw new Error(asString(error["@_message"]) ?? "Unknown BB API error");
  }
  return { bbapi: parsed.bbapi };
}

function requireObject(value: unknown, label: string): XmlObject {
  const object = getObject(value);
  if (!object) {
    throw new Error(`Expected ${label} node.`);
  }
  return object;
}

function getObject(value: unknown): XmlObject | null {
  return isObject(value) ? (value as XmlObject) : null;
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function readText(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (isObject(value)) {
    const text = (value as XmlObject)["#text"];
    return typeof text === "string" || typeof text === "number"
      ? String(text)
      : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function requireStringValue(value: unknown, label: string): string {
  const text = asString(value);
  if (!text) {
    throw new Error(`Expected ${label}.`);
  }
  return text;
}

function requireNodeText(value: unknown, label: string): string {
  const text = readText(value);
  if (!text) {
    throw new Error(`Expected ${label}.`);
  }
  return text;
}

function asNumber(value: unknown): number | null {
  const stringValue = asString(value);
  if (!stringValue) {
    return null;
  }
  const parsed = Number(stringValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function requireNodeNumber(value: unknown, label: string): number {
  const numeric = asNumber(readText(value));
  if (numeric === null) {
    throw new Error(`Expected ${label}.`);
  }
  return numeric;
}

function asBoolean(value: unknown): boolean | null {
  const stringValue = asString(value);
  if (stringValue === null) {
    return null;
  }
  const normalizedValue = stringValue.toLowerCase();
  if (["1", "true", "yes"].includes(normalizedValue)) {
    return true;
  }
  if (["0", "false", "no"].includes(normalizedValue)) {
    return false;
  }
  return null;
}

function mapScalarChildren(node: unknown): Record<string, number | string | null> {
  return Object.entries(getObject(node) ?? {}).reduce<Record<string, number | string | null>>(
    (accumulator, [key, value]) => {
      if (!key.startsWith("@_")) {
        accumulator[key] = normalizeScalar(readText(value));
      }
      return accumulator;
    },
    {},
  );
}

function mapNumberChildren(node: unknown): Record<string, number | null> {
  return Object.entries(getObject(node) ?? {}).reduce<Record<string, number | null>>(
    (accumulator, [key, value]) => {
      if (!key.startsWith("@_")) {
        accumulator[key] = asNumber(readText(value));
      }
      return accumulator;
    },
    {},
  );
}

function mapRequiredNumberChildren(
  node: unknown,
  label: string,
): Record<string, number> {
  return Object.entries(getObject(node) ?? {}).reduce<Record<string, number>>(
    (accumulator, [key, value]) => {
      if (!key.startsWith("@_")) {
        accumulator[key] = requireNodeNumber(value, `${label}.${key}`);
      }
      return accumulator;
    },
    {},
  );
}

function normalizeScalar(value: unknown): number | string | null {
  const numeric = asNumber(value);
  if (numeric !== null) {
    return numeric;
  }
  return asString(value);
}

function stripKeys(
  node: XmlObject | null,
  excludedKeys: string[],
): Record<string, unknown> {
  return Object.entries(node ?? {}).reduce<Record<string, unknown>>(
    (accumulator, [key, value]) => {
      if (!excludedKeys.includes(key)) {
        accumulator[key] = value;
      }
      return accumulator;
    },
    {},
  );
}

function readAttributes(node: XmlObject | null): Record<string, string | null> {
  return Object.entries(node ?? {}).reduce<Record<string, string | null>>(
    (accumulator, [key, value]) => {
      if (key.startsWith("@_")) {
        accumulator[key.slice(2)] = asString(value);
      }
      return accumulator;
    },
    {},
  );
}
