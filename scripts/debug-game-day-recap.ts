import process from "node:process";

import { __testing } from "../amplify/data/_backend/game-day-recap";
import type { BbConnectionRecord } from "../amplify/data/_backend/repository";
import { BBXmlApiClient } from "../lib/bbapi";
import type { BBApiStandings } from "../lib/bbapi/types";

type CliOptions = {
  accessKey: string;
  gameDate: string;
  includePrompt: boolean;
  leagueId: string;
  username: string;
};

type SelectedSlate = {
  probe: "current" | "historical";
  season: number;
  slate: Awaited<ReturnType<typeof __testing.resolveLeagueDaySlate>>;
  standings: BBApiStandings;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const bb = new BBXmlApiClient({
    securityCode: options.accessKey,
    username: options.username,
  });

  try {
    const currentStandings = await bb.getStandings(options.leagueId);
    const currentSeason = currentStandings.season;
    const currentSlate = currentSeason
      ? await __testing.resolveLeagueDaySlate({
          bb,
          gameDate: options.gameDate,
          standings: currentStandings,
        })
      : [];

    let seasonDiagnostics: ReturnType<typeof __testing.summarizeSeasonDiagnostics> = [];
    let candidateSeasons: number[] = [];
    const historicalProbes: Array<{ games: number; season: number }> = [];
    let selected: SelectedSlate | null = null;

    if (currentSeason && currentSlate.length > 0) {
      selected = {
        probe: "current",
        season: currentSeason,
        slate: currentSlate,
        standings: currentStandings,
      };
    } else {
      const seasons = await bb.getSeasons();
      seasonDiagnostics = __testing.summarizeSeasonDiagnostics(seasons, options.gameDate);
      candidateSeasons = __testing.resolveSeasonCandidatesForDate(
        seasons,
        options.gameDate,
      );

      for (const season of candidateSeasons) {
        if (season === currentSeason) {
          continue;
        }

        const standings = await bb.getStandings(options.leagueId, season);
        const slate = await __testing.resolveLeagueDaySlate({
          bb,
          gameDate: options.gameDate,
          standings,
        });
        historicalProbes.push({
          games: slate.length,
          season,
        });
        if (slate.length > 0) {
          selected = {
            probe: "historical",
            season,
            slate,
            standings,
          };
          break;
        }
      }
    }

    const output: Record<string, unknown> = {
      input: {
        gameDate: options.gameDate,
        leagueId: options.leagueId,
      },
      currentProbe: {
        games: currentSlate.length,
        leagueName: currentStandings.league?.name ?? null,
        season: currentStandings.season ?? null,
      },
      seasonDiagnostics,
      candidateSeasons,
      historicalProbes,
      selected:
        selected === null
          ? null
          : {
              coverage: null,
              leagueName: selected.standings.league?.name ?? null,
              probe: selected.probe,
              promptGames: null,
              season: selected.season,
              slate: selected.slate,
            },
    };

    if (selected !== null && options.includePrompt) {
      const promptPayload = await __testing.buildGameDayRecapPromptPayload({
        bb,
        connection: createDebugConnection(options, selected.standings),
        requestedGames: selected.slate,
        request: {
          gameDate: options.gameDate,
          gameDayNumber: null,
          kind: "LEAGUE_DATE",
          label: `${selected.standings.league?.name ?? options.leagueId} ${options.gameDate}`,
          leagueId: options.leagueId,
          leagueName: selected.standings.league?.name ?? null,
          matchId: null,
          season: selected.season,
          timeZone: null,
        },
        season: selected.season,
        standings: selected.standings,
      });
      output.selected = {
        coverage: promptPayload.coverage,
        leagueName: promptPayload.request.leagueName,
        probe: selected.probe,
        promptGames: promptPayload.games.length,
        promptPayload,
        season: selected.season,
        slate: selected.slate,
      };
    }

    console.log(JSON.stringify(output, null, 2));

    if (selected === null) {
      process.exitCode = 1;
    }
  } finally {
    await bb.logout().catch(() => {});
  }
}

function createDebugConnection(
  options: CliOptions,
  standings: BBApiStandings,
): BbConnectionRecord {
  return {
    bbLoginName: options.username,
    leagueId: options.leagueId,
    leagueName: standings.league?.name ?? null,
    leagueTimeZone: null,
    status: "CONNECTED",
    userId: "debug",
  };
}

function parseArgs(argv: string[]): CliOptions {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const values = new Map<string, string>();
  let includePrompt = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--include-prompt") {
      includePrompt = true;
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

  const leagueId = values.get("--league-id")?.trim();
  const gameDate = values.get("--game-date")?.trim();
  const username =
    values.get("--username")?.trim() ?? process.env.BB_LOGIN?.trim() ?? "";
  const accessKey =
    values.get("--access-key")?.trim() ?? process.env.BB_ACCESS_KEY?.trim() ?? "";

  if (!leagueId || !gameDate || !username || !accessKey) {
    printUsage();
    throw new Error(
      "debug-game-day-recap requires --league-id, --game-date, and BuzzerBeater credentials.",
    );
  }

  return {
    accessKey,
    gameDate,
    includePrompt,
    leagueId,
    username,
  };
}

function printUsage(): void {
  console.error(
    [
      "Usage:",
      "  node --import tsx ./scripts/debug-game-day-recap.ts \\",
      "    --league-id <id> --game-date <YYYY-MM-DD> \\",
      "    --username <bb login> --access-key <bb access key> [--include-prompt]",
      "",
      "You can also provide credentials via BB_LOGIN and BB_ACCESS_KEY.",
    ].join("\n"),
  );
}

void main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
