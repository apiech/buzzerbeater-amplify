import {
  BBXmlApiClient,
  type BBApiScheduleMatch,
  type BBXmlApiClientOptions,
} from "../../../lib/bbapi";
import type { Schema } from "../resource";
import { resolveBbAccessKey } from "./credentials";
import { getOrRefreshWorkspace } from "./workspace";

type GraphqlEnv = Record<string, string | undefined>;

type ResolverResult<TKey extends keyof Schema> = NonNullable<
  Schema[TKey] extends { returnType: infer TReturn } ? TReturn : never
>;

type RivalsWorkspaceResult = ResolverResult<"getRivalsWorkspace">;
type RivalsWorkspaceSummary = RivalsWorkspaceResult["summary"];
type RivalryMatch = RivalsWorkspaceResult["matches"][number];

type CreateBbClient = (
  options: BBXmlApiClientOptions,
) => Pick<BBXmlApiClient, "getSchedule" | "getSeasons" | "login">;

type RivalsDependencies = {
  createBbClient: CreateBbClient;
  now: () => Date;
  resolveBbAccessKey: typeof resolveBbAccessKey;
};

type ScheduleFetchResult =
  | {
      matches: BBApiScheduleMatch[];
      season: number;
    }
  | {
      error: string;
      season: number;
    };

type NormalizedCompetition = {
  competitionKey: RivalryMatch["competitionKey"];
  competitionLabel: RivalryMatch["competitionLabel"];
  isTvGame: boolean;
  stageKey: RivalryMatch["stageKey"];
  stageLabel: RivalryMatch["stageLabel"];
};

const DEFAULT_FETCH_CONCURRENCY = 4;

const defaultDependencies: RivalsDependencies = {
  createBbClient: (options) => new BBXmlApiClient(options),
  now: () => new Date(),
  resolveBbAccessKey,
};

export const __testing = {
  buildRivalryMatch,
  classifyScheduleMatchType,
  formatStageToken,
};

export async function getRivalsWorkspace(
  args: {
    env: GraphqlEnv;
    identity: unknown;
  },
  dependencies: RivalsDependencies = defaultDependencies,
): Promise<RivalsWorkspaceResult> {
  const workspace = await getOrRefreshWorkspace({
    env: args.env,
    identity: args.identity,
  });

  const teamId =
    workspace.connection.teamId ??
    workspace.home.team.teamId ??
    workspace.teamHub.team.teamId ??
    null;
  if (!teamId) {
    throw new Error("An active team is required before loading rivals.");
  }

  const accessKey = await dependencies.resolveBbAccessKey(
    args.env,
    workspace.connection.userId,
  );
  const bbClient = dependencies.createBbClient({
    securityCode: accessKey,
    username: workspace.connection.bbLoginName,
  });

  await bbClient.login();
  const seasonsResponse = await bbClient.getSeasons();
  const seasons = seasonsResponse.seasons
    .map((season) => season.id)
    .filter((seasonId): seasonId is number => Number.isInteger(seasonId))
    .sort((left, right) => left - right);

  const scheduleResults = await mapWithConcurrency(
    seasons,
    DEFAULT_FETCH_CONCURRENCY,
    async (season): Promise<ScheduleFetchResult> => {
      try {
        const schedule = await bbClient.getSchedule(teamId, season);
        return {
          matches: schedule.matches,
          season,
        };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
          season,
        };
      }
    },
  );

  const rivalryMatchesById = new Map<string, RivalryMatch>();
  const failedSeasons: number[] = [];
  const seasonsWithGames = new Set<number>();

  for (const result of scheduleResults) {
    if ("error" in result) {
      failedSeasons.push(result.season);
      continue;
    }

    for (const match of result.matches) {
      const rivalryMatch = buildRivalryMatch({
        match,
        season: result.season,
        teamId,
      });
      if (!rivalryMatch) {
        continue;
      }

      rivalryMatchesById.set(rivalryMatch.matchId, rivalryMatch);
      seasonsWithGames.add(result.season);
    }
  }

  const matches = Array.from(rivalryMatchesById.values()).sort((left, right) =>
    compareTimestamps(right.startTime, left.startTime),
  );
  const wins = matches.filter((match) => match.outcome === "WIN").length;
  const losses = matches.filter((match) => match.outcome === "LOSS").length;
  const tvGames = matches.filter((match) => match.isTvGame).length;
  const opponents = new Set(matches.map((match) => match.opponentTeamId));
  const summary: RivalsWorkspaceSummary = {
    failedSeasonCount: failedSeasons.length,
    failedSeasons,
    firstSeason: seasons[0] ?? null,
    lastSeason: seasons.at(-1) ?? null,
    losses,
    seasonsScanned: seasons.length,
    seasonsWithGames: seasonsWithGames.size,
    totalCompletedGames: matches.length,
    totalOpponents: opponents.size,
    tvGames,
    wins,
  };

  return {
    generatedAt: dependencies.now().toISOString(),
    matches,
    summary,
    syncedAt: workspace.home.syncedAt ?? null,
    team: {
      shortName:
        workspace.teamHub.team.shortName ??
        workspace.connection.shortName ??
        null,
      teamId,
      teamName:
        workspace.teamHub.team.teamName ??
        workspace.connection.teamName ??
        null,
    },
    warning: buildWarning(failedSeasons),
  };
}

function buildRivalryMatch(args: {
  match: BBApiScheduleMatch;
  season: number;
  teamId: string;
}): RivalryMatch | null {
  const { match, season, teamId } = args;
  const matchId = match.id?.trim();
  if (!matchId) {
    return null;
  }

  const teamScore = deriveTeamScore(match, teamId);
  const opponentScore = deriveOpponentScore(match, teamId);
  const opponentTeamId = deriveOpponentTeamId(match, teamId);
  const opponentTeamName = deriveOpponentTeamName(match, teamId);
  if (
    teamScore === null ||
    opponentScore === null ||
    !opponentTeamId ||
    !opponentTeamName
  ) {
    return null;
  }

  const competition = classifyScheduleMatchType(match.type);

  return {
    competitionKey: competition.competitionKey,
    competitionLabel: competition.competitionLabel,
    gameDate: toGameDate(match.startTime),
    isHome: isTeamHome(match, teamId),
    isTvGame: competition.isTvGame,
    margin: teamScore - opponentScore,
    matchId,
    opponentScore,
    opponentTeamId,
    opponentTeamName,
    outcome: teamScore > opponentScore ? "WIN" : "LOSS",
    rawType: match.type ?? null,
    season,
    stageKey: competition.stageKey,
    stageLabel: competition.stageLabel,
    startTime: match.startTime ?? null,
    teamScore,
    venue: isTeamHome(match, teamId) ? "HOME" : "ROAD",
  };
}

function classifyScheduleMatchType(
  type: string | null | undefined,
): NormalizedCompetition {
  const normalizedType = normalizeScheduleType(type);
  const segments = normalizedType
    ? normalizedType.split(".").filter(Boolean)
    : [];
  const nonTvSegments = segments.filter((segment) => segment !== "tv");
  const isTvGame = segments.includes("tv");

  if (
    nonTvSegments[0] === "league" &&
    (!nonTvSegments[1] ||
      nonTvSegments[1] === "rs" ||
      nonTvSegments[1] === "regularseason")
  ) {
    return {
      competitionKey: "LEAGUE_REGULAR_SEASON",
      competitionLabel: "League regular season",
      isTvGame,
      stageKey: "REGULAR_SEASON",
      stageLabel: "Regular season",
    };
  }

  if (nonTvSegments[0] === "league") {
    const stageKey = normalizeStageKey(nonTvSegments[1] ?? null);
    return {
      competitionKey: "PLAYOFFS",
      competitionLabel: "Playoffs",
      isTvGame,
      stageKey,
      stageLabel: formatStageToken(stageKey),
    };
  }

  if (nonTvSegments[0] === "friendly" || nonTvSegments[0] === "scrimmage") {
    return {
      competitionKey: "SCRIMMAGE",
      competitionLabel: "Scrimmage",
      isTvGame,
      stageKey: null,
      stageLabel: null,
    };
  }

  if (
    nonTvSegments.some(
      (segment) => segment === "private" || segment.startsWith("private"),
    )
  ) {
    return {
      competitionKey: "PRIVATE_LEAGUE",
      competitionLabel: "Private league",
      isTvGame,
      stageKey: normalizeStageKey(nonTvSegments[1] ?? null),
      stageLabel: formatStageToken(normalizeStageKey(nonTvSegments[1] ?? null)),
    };
  }

  if (nonTvSegments[0] === "cup") {
    const stageKey = normalizeStageKey(nonTvSegments[1] ?? null);
    return {
      competitionKey: "CUP",
      competitionLabel: "Cup",
      isTvGame,
      stageKey,
      stageLabel: formatStageToken(stageKey),
    };
  }

  if (
    nonTvSegments[0] === "bbb" ||
    normalizedType?.includes("buzzerbeatersbest") ||
    normalizedType?.includes("buzzer-beaters-best")
  ) {
    return {
      competitionKey: "BUZZERBEATER_BEST",
      competitionLabel: "BuzzerBeater's Best",
      isTvGame,
      stageKey: normalizeStageKey(nonTvSegments[1] ?? null),
      stageLabel: formatStageToken(normalizeStageKey(nonTvSegments[1] ?? null)),
    };
  }

  if (
    nonTvSegments[0] === "bbm" ||
    normalizedType?.includes("buzzerbeatersmadness") ||
    normalizedType?.includes("buzzer-beaters-madness") ||
    normalizedType?.includes("madness")
  ) {
    return {
      competitionKey: "BUZZERBEATER_MADNESS",
      competitionLabel: "BuzzerBeater Madness",
      isTvGame,
      stageKey: normalizeStageKey(nonTvSegments[1] ?? null),
      stageLabel: formatStageToken(normalizeStageKey(nonTvSegments[1] ?? null)),
    };
  }

  return {
    competitionKey: "OTHER",
    competitionLabel: "Other",
    isTvGame,
    stageKey: normalizeStageKey(nonTvSegments[1] ?? nonTvSegments[0] ?? null),
    stageLabel: formatStageToken(
      normalizeStageKey(nonTvSegments[1] ?? nonTvSegments[0] ?? null),
    ),
  };
}

function normalizeScheduleType(type: string | null | undefined): string | null {
  const normalized = type?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function normalizeStageKey(value: string | null): string | null {
  return value ? value.replace(/[^a-z0-9]+/g, "_") : null;
}

function formatStageToken(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/_/g, "");
  const mappedLabel = STAGE_LABELS[normalized];
  if (mappedLabel) {
    return mappedLabel;
  }

  const roundMatch = /^round(\d+)$/.exec(normalized);
  if (roundMatch) {
    return `Round ${roundMatch[1]}`;
  }

  return value
    .replace(/_/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

const STAGE_LABELS: Record<string, string> = {
  bronze: "Bronze game",
  final: "Final",
  finals: "Final",
  playin: "Play-in",
  quarterfinal: "Quarterfinal",
  quarterfinals: "Quarterfinal",
  regularseason: "Regular season",
  roundof16: "Round of 16",
  roundof32: "Round of 32",
  roundof64: "Round of 64",
  rs: "Regular season",
  semifinal: "Semifinal",
  semifinals: "Semifinal",
  thirdplace: "Third place",
};

function deriveOpponentTeamId(
  match: BBApiScheduleMatch,
  teamId: string,
): string | null {
  return match.homeTeam.id === teamId ? match.awayTeam.id : match.homeTeam.id;
}

function deriveOpponentTeamName(
  match: BBApiScheduleMatch,
  teamId: string,
): string | null {
  return match.homeTeam.id === teamId
    ? match.awayTeam.teamName
    : match.homeTeam.teamName;
}

function deriveTeamScore(
  match: BBApiScheduleMatch,
  teamId: string,
): number | null {
  return match.homeTeam.id === teamId
    ? match.homeTeam.score
    : match.awayTeam.score;
}

function deriveOpponentScore(
  match: BBApiScheduleMatch,
  teamId: string,
): number | null {
  return match.homeTeam.id === teamId
    ? match.awayTeam.score
    : match.homeTeam.score;
}

function isTeamHome(match: BBApiScheduleMatch, teamId: string): boolean {
  return match.homeTeam.id === teamId;
}

function toGameDate(startTime: string | null): string | null {
  if (!startTime) {
    return null;
  }

  const parsed = new Date(startTime);
  if (Number.isNaN(parsed.getTime())) {
    return startTime.slice(0, 10);
  }

  return parsed.toISOString().slice(0, 10);
}

function compareTimestamps(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  return parseTimestamp(left) - parseTimestamp(right);
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function buildWarning(failedSeasons: readonly number[]): string | null {
  if (!failedSeasons.length) {
    return null;
  }

  const listedSeasons = failedSeasons.slice(0, 6).join(", ");
  const suffix =
    failedSeasons.length > 6 ? `, and ${failedSeasons.length - 6} more` : "";
  return `Live history is partial. The schedule scan failed for season${failedSeasons.length === 1 ? "" : "s"} ${listedSeasons}${suffix}.`;
}

async function mapWithConcurrency<TInput, TResult>(
  items: readonly TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const item = items[currentIndex];
      if (item === undefined) {
        return;
      }

      results[currentIndex] = await mapper(item, currentIndex);
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}
