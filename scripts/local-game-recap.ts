import process from "node:process";

import {
  __testing,
  type GameDayRecapCostPayload,
  type GameDayRecapResultPayload,
  type SlateGame,
} from "../amplify/data/_backend/game-day-recap";
import type {
  RecapGenerationApproachValue,
  RecapQualityTier,
} from "../amplify/data/_backend/game-day-recap-request";
import {
  RecapGenerationApproach,
  RecapInterviewIntensity,
} from "../amplify/data/schema-enums";
import type { BbConnectionRecord } from "../amplify/data/_backend/repository";
import {
  BBXmlApiClient,
  fetchPublicMatchPlayByPlay,
  type BBApiBoxScore,
  type BBApiBoxScoreTeam,
  type BBApiStandings,
} from "../lib/bbapi";

type PromptPayload = Awaited<
  ReturnType<typeof __testing.buildGameDayRecapPromptPayload>
>;
type PromptGame = PromptPayload["games"][number];

type CliOptions = {
  accessKey: string;
  gameDate: string | null;
  generationApproach: RecapGenerationApproachValue;
  interviewIntensity: RecapInterviewIntensity;
  leagueId: string | null;
  matchId: string;
  modelId: string | null;
  modelJudgeEnabled: boolean;
  qualityTier: RecapQualityTier;
  region: string | null;
  season: number | null;
  showFacts: boolean;
  username: string;
};

type RuntimeModelIds = {
  judgeModelId: string | null;
  retryModelId: string | null;
  writerModelId: string;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const env = process.env as Record<string, string | undefined>;
  const bb = new BBXmlApiClient({
    securityCode: options.accessKey,
    username: options.username,
  });

  try {
    const boxScore = await bb.getBoxScore(options.matchId);
    const gameDate = options.gameDate ?? resolveGameDate(boxScore);
    const leagueId = options.leagueId ?? (await resolveLeagueId(bb, boxScore));
    const season =
      options.season ?? (await resolveSeason(bb, leagueId, gameDate));
    const standings = await bb.getStandings(leagueId, season);
    const requestedGame = buildSlateGame(options.matchId, boxScore);
    const targetKey = `${leagueId}#${options.matchId}#local#${formatGenerationModeForTargetKey(
      options.generationApproach,
    )}`;

    const builtPromptPayload = await __testing.buildGameDayRecapPromptPayload({
      bb,
      connection: createDebugConnection({
        leagueId,
        options,
        standings,
      }),
      fetchPublicMatchPlayByPlay,
      now: new Date(),
      requestedGames: [requestedGame],
      request: {
        gameDate,
        gameDayNumber: null,
        generationApproach: options.generationApproach,
        interviewIntensity: options.interviewIntensity,
        kind: "SINGLE_GAME",
        label: `${standings.league?.name ?? leagueId} ${options.matchId}`,
        leagueId,
        leagueName: standings.league?.name ?? null,
        matchId: options.matchId,
        season,
        timeZone: null,
      },
      season,
      standings,
      targetKey,
      userId: "local-debug",
    });

    const promptPayload = __testing.buildGameDayRecapWriterPayloadFromFactStore({
      coverage: builtPromptPayload.coverage,
      factStore: builtPromptPayload.factStore,
    });
    if (!promptPayload.games.length) {
      throw new Error(`No prompt game was built for match ${options.matchId}.`);
    }

    const runtimeConfig = __testing.resolveGameDayRecapRuntimeConfig(env);
    const modelIds = resolveRuntimeModelIds(options, env);
    const region =
      options.region ??
      env.AWS_REGION?.trim() ??
      env.AWS_DEFAULT_REGION?.trim() ??
      undefined;
    const writerProvider = __testing.createBedrockGameDayRecapProvider({
      modelId: modelIds.writerModelId,
      region,
      stage: "writer",
    });
    const retryProvider =
      options.generationApproach !==
        RecapGenerationApproach.SIMPLE_FACT_LIBRARY &&
      options.qualityTier === "premium" && modelIds.retryModelId
        ? __testing.createBedrockGameDayRecapProvider({
            modelId: modelIds.retryModelId,
            region,
            stage: "retry_writer",
          })
        : null;
    const judgeProvider =
      options.generationApproach !==
        RecapGenerationApproach.SIMPLE_FACT_LIBRARY &&
      options.modelJudgeEnabled && modelIds.judgeModelId
        ? __testing.createBedrockGameDayRecapProvider({
            modelId: modelIds.judgeModelId,
            region,
            stage: "judge",
          })
        : null;

    const generatedRecap = await __testing.generateResolvedGameDayRecap({
      judgeProvider,
      payload: promptPayload,
      qualityTier: options.qualityTier,
      retryProvider,
      runtimeConfig,
      targetKey,
      userId: "local-debug",
      writerProvider,
    });
    const cost = __testing.buildGameDayRecapCostPayload({
      providers: [writerProvider, retryProvider, judgeProvider],
      result: generatedRecap.result,
    });

    printGeneratedRecap({
      cost,
      gameDate,
      generated: generatedRecap.result,
      generationApproach: options.generationApproach,
      leagueName: standings.league?.name ?? leagueId,
      modelJudgeEnabled:
        options.generationApproach !==
          RecapGenerationApproach.SIMPLE_FACT_LIBRARY &&
        options.modelJudgeEnabled,
      modelIds,
      promptGame: promptPayload.games[0]!,
      qualityTier: options.qualityTier,
      showFacts: options.showFacts,
    });
  } finally {
    await bb.logout().catch(() => {});
  }
}

function parseArgs(argv: string[]): CliOptions {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const values = new Map<string, string>();
  let showFacts = false;
  let modelJudgeEnabled = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      break;
    }
    if (token === "--show-facts") {
      showFacts = true;
      continue;
    }
    if (token === "--model-judge") {
      modelJudgeEnabled = true;
      continue;
    }
    if (token === "--no-model-judge") {
      modelJudgeEnabled = false;
      continue;
    }
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }
    values.set(token, value);
    index += 1;
  }

  const matchId = values.get("--match-id")?.trim();
  const username =
    values.get("--username")?.trim() ??
    process.env.BB_LOGIN?.trim() ??
    process.env.BBAPI_LOGIN?.trim() ??
    "";
  const accessKey =
    values.get("--access-key")?.trim() ??
    process.env.BB_ACCESS_KEY?.trim() ??
    process.env.BBAPI_CODE?.trim() ??
    "";
  const seasonRaw = values.get("--season")?.trim();
  const season =
    seasonRaw === undefined ? null : Number.parseInt(seasonRaw, 10);
  const generationApproach = parseGenerationApproach(
    values.get("--generation-mode")?.trim() ??
      values.get("--approach")?.trim() ??
      values.get("--mode")?.trim(),
  );
  const qualityTier = parseQualityTier(values.get("--quality-tier")?.trim());
  const interviewIntensity = parseInterviewIntensity(
    values.get("--interview-intensity")?.trim(),
  );

  if (!matchId || !username || !accessKey) {
    printUsage();
    throw new Error(
      "local-game-recap requires --match-id and BuzzerBeater credentials.",
    );
  }
  if (
    seasonRaw !== undefined &&
    (season === null || !Number.isInteger(season) || season <= 0)
  ) {
    throw new Error(`Invalid --season value: ${seasonRaw}`);
  }

  return {
    accessKey,
    gameDate: values.get("--game-date")?.trim() ?? null,
    generationApproach,
    interviewIntensity,
    leagueId: values.get("--league-id")?.trim() ?? null,
    matchId,
    modelId: values.get("--model-id")?.trim() ?? null,
    modelJudgeEnabled,
    qualityTier,
    region: values.get("--region")?.trim() ?? null,
    season,
    showFacts,
    username,
  };
}

function parseGenerationApproach(
  value: string | undefined,
): RecapGenerationApproachValue {
  switch (value?.toLowerCase()) {
    case undefined:
    case "":
    case "fact-library":
    case "fact_library":
    case "fact-library-first":
    case "fact_library_first":
      return RecapGenerationApproach.FACT_LIBRARY_FIRST;
    case "legacy":
      return RecapGenerationApproach.LEGACY;
    case "simple":
    case "simple-fact-library":
    case "simple_fact_library":
      return RecapGenerationApproach.SIMPLE_FACT_LIBRARY;
    default:
      throw new Error(
        "--generation-mode must be legacy, fact-library, or simple-fact-library.",
      );
  }
}

function parseQualityTier(value: string | undefined): RecapQualityTier {
  if (value === undefined || value === "") {
    return "standard";
  }
  if (value === "standard" || value === "premium") {
    return value;
  }
  throw new Error("--quality-tier must be standard or premium.");
}

function parseInterviewIntensity(
  value: string | undefined,
): RecapInterviewIntensity {
  switch (value) {
    case undefined:
    case "":
    case RecapInterviewIntensity.PG13:
      return RecapInterviewIntensity.PG13;
    case RecapInterviewIntensity.CLEAN:
      return RecapInterviewIntensity.CLEAN;
    case RecapInterviewIntensity.FULL_HEAT:
      return RecapInterviewIntensity.FULL_HEAT;
    case RecapInterviewIntensity.NONE:
      return RecapInterviewIntensity.NONE;
    default:
      throw new Error("--interview-intensity must be clean, pg13, full_heat, or none.");
  }
}

function printUsage(): void {
  console.error(
    [
      "Usage:",
      "  node --import tsx ./scripts/local-game-recap.ts --match-id <id> [--show-facts]",
      "",
      "Optional:",
      "  --league-id <id> --season <season> --game-date <YYYY-MM-DD>",
      "  --generation-mode legacy|fact-library|simple-fact-library",
      "  --model-id <bedrock model id> --region <aws region>",
      "  --quality-tier standard|premium --model-judge",
      "  --interview-intensity clean|pg13|full_heat|none",
      "  --username <bb login> --access-key <bb access key>",
      "",
      "Credentials can also come from BB_LOGIN and BB_ACCESS_KEY.",
      "Legacy BBAPI_LOGIN and BBAPI_CODE env names are also accepted.",
      "Model config can come from GAME_DAY_RECAP_MODEL_ID and AWS_REGION.",
    ].join("\n"),
  );
}

function formatGenerationModeForTargetKey(
  approach: RecapGenerationApproachValue,
): string {
  switch (approach) {
    case RecapGenerationApproach.LEGACY:
      return "legacy";
    case RecapGenerationApproach.SIMPLE_FACT_LIBRARY:
      return "simple-fact-library";
    case RecapGenerationApproach.FACT_LIBRARY_FIRST:
    default:
      return "fact-library";
  }
}

function resolveRuntimeModelIds(
  options: Pick<CliOptions, "modelId" | "qualityTier">,
  env: Record<string, string | undefined>,
): RuntimeModelIds {
  const configured = __testing.resolveConfiguredRecapStageModelIds(
    env,
    options.qualityTier,
  );
  if (!options.modelId) {
    return configured;
  }

  return {
    judgeModelId: configured.judgeModelId ?? options.modelId,
    retryModelId:
      options.qualityTier === "premium"
        ? (configured.retryModelId ?? options.modelId)
        : null,
    writerModelId: options.modelId,
  };
}

function resolveGameDate(boxScore: BBApiBoxScore): string {
  const match = boxScore.startTime?.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (!match) {
    throw new Error(
      "The boxscore did not include a date. Pass --game-date <YYYY-MM-DD>.",
    );
  }
  return match[0];
}

async function resolveLeagueId(
  bb: Pick<BBXmlApiClient, "getTeamInfo">,
  boxScore: BBApiBoxScore,
): Promise<string> {
  const teamId = boxScore.homeTeam.id ?? boxScore.awayTeam.id;
  if (!teamId) {
    throw new Error("The boxscore did not include a team id. Pass --league-id.");
  }

  const teamInfo = await bb.getTeamInfo(teamId);
  const leagueId = teamInfo.league?.id?.trim();
  if (!leagueId) {
    throw new Error("Could not resolve league id from teaminfo. Pass --league-id.");
  }
  return leagueId;
}

async function resolveSeason(
  bb: Pick<BBXmlApiClient, "getSeasons" | "getStandings">,
  leagueId: string,
  gameDate: string,
): Promise<number> {
  try {
    return __testing.resolveSeasonForDate(await bb.getSeasons(), gameDate);
  } catch {
    const standings = await bb.getStandings(leagueId);
    if (standings.season) {
      return standings.season;
    }
    throw new Error(`Could not resolve a season for ${gameDate}. Pass --season.`);
  }
}

function buildSlateGame(matchId: string, boxScore: BBApiBoxScore): SlateGame {
  return {
    awayTeamId: requireTeamId(boxScore.awayTeam, "away"),
    awayTeamName: requireTeamName(boxScore.awayTeam, "away"),
    homeTeamId: requireTeamId(boxScore.homeTeam, "home"),
    homeTeamName: requireTeamName(boxScore.homeTeam, "home"),
    isScheduleFinal:
      boxScore.awayTeam.score !== null && boxScore.homeTeam.score !== null,
    matchId,
    scheduledAwayScore: boxScore.awayTeam.score,
    scheduledHomeScore: boxScore.homeTeam.score,
    startTime: boxScore.startTime,
    type: boxScore.type,
  };
}

function requireTeamId(team: BBApiBoxScoreTeam, side: "away" | "home"): string {
  if (!team.id) {
    throw new Error(`The ${side} team is missing an id.`);
  }
  return team.id;
}

function requireTeamName(team: BBApiBoxScoreTeam, side: "away" | "home"): string {
  if (!team.teamName) {
    throw new Error(`The ${side} team is missing a name.`);
  }
  return team.teamName;
}

function createDebugConnection(args: {
  leagueId: string;
  options: CliOptions;
  standings: BBApiStandings;
}): BbConnectionRecord {
  return {
    bbLoginName: args.options.username,
    leagueId: args.leagueId,
    leagueName: args.standings.league?.name ?? null,
    leagueTimeZone: null,
    status: "CONNECTED",
    userId: "local-debug",
  };
}

function printGeneratedRecap(args: {
  cost: GameDayRecapCostPayload | null;
  gameDate: string;
  generated: GameDayRecapResultPayload;
  generationApproach: RecapGenerationApproachValue;
  leagueName: string;
  modelJudgeEnabled: boolean;
  modelIds: RuntimeModelIds;
  promptGame: PromptGame;
  qualityTier: RecapQualityTier;
  showFacts: boolean;
}): void {
  console.log(
    `Generated recap (${args.leagueName}, ${args.gameDate}, ${args.qualityTier}, ${formatGenerationModeForTargetKey(
      args.generationApproach,
    )})`,
  );
  console.log(`Writer model: ${args.modelIds.writerModelId}`);
  if (args.modelJudgeEnabled && args.modelIds.judgeModelId) {
    console.log(`Judge model: ${args.modelIds.judgeModelId}`);
  }
  if (args.cost?.estimatedTotalCostUsd !== undefined) {
    console.log(`Estimated cost: $${args.cost.estimatedTotalCostUsd}`);
  }
  console.log("");

  for (const game of args.generated.games) {
    console.log(game.headline);
    console.log("");
    console.log(game.writeup);
    if (game.validation) {
      console.log("");
      console.log(
        `Validation: ${game.validation.status} (${game.validation.issueCount} issue(s))`,
      );
      for (const issue of game.validation.issues) {
        console.log(`- ${issue.kind}: ${issue.reason}`);
      }
    }
    printInterviews(game);
  }

  if (args.showFacts) {
    console.log("");
    console.log("Selected gameStory beats:");
    for (const beat of args.promptGame.factsLibrary?.gameStory.selectedBeats ?? []) {
      console.log(`- ${beat.beatRole} (${beat.factId}): ${beat.text}`);
    }
  }
}

function printInterviews(
  game: GameDayRecapResultPayload["games"][number],
): void {
  const interviews =
    "postgameInterviews" in game && Array.isArray(game.postgameInterviews)
      ? game.postgameInterviews
      : game.postgameInterview
        ? [game.postgameInterview]
        : [];
  for (const interview of interviews) {
    if (!interview) {
      continue;
    }
    console.log("");
    console.log(interview.title);
    console.log(`${interview.personalityType ?? "unknown"} / ${interview.personalitySource ?? "unknown"}`);
    console.log(`${interview.playerName} - ${interview.teamName}`);
    for (const exchange of interview.qa) {
      console.log(`Q: ${exchange.question}`);
      console.log(`A: ${exchange.answer}`);
    }
  }

  const diagnostics =
    "postgameInterviewDiagnostics" in game &&
    Array.isArray(game.postgameInterviewDiagnostics)
      ? game.postgameInterviewDiagnostics
      : [];
  if (diagnostics.length) {
    console.log("");
    console.log("Interview diagnostics:");
    for (const diagnostic of diagnostics) {
      if (!diagnostic) {
        continue;
      }
      const reason = diagnostic.reason ? ` - ${diagnostic.reason}` : "";
      console.log(`- ${diagnostic.side}: ${diagnostic.status}${reason}`);
      for (const detail of diagnostic.details ?? []) {
        console.log(`  ${detail}`);
      }
    }
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
