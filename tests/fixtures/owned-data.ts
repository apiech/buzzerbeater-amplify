import { WORKSPACE_CACHE_VERSION } from "../../amplify/data/_backend/workspace-cache";

export function createStoredTeamInfo(
  overrides: Record<string, unknown> = {},
) {
  return {
    country: null,
    isBot: false,
    league: null,
    ownerName: "Coach",
    rival: null,
    shortName: "Visionaries",
    teamId: "team-1",
    teamName: "Visionaries",
    ...overrides,
  };
}

export function createWorkspaceCacheConnection(
  overrides: Record<string, unknown> = {},
) {
  const profileJson =
    Object.prototype.hasOwnProperty.call(overrides, "profileJson")
      ? overrides.profileJson
      : createStoredTeamInfo();

  return {
    accessKeyLast4: "****1234",
    bbLoginName: "coach",
    connectedAt: null,
    countryId: "1",
    countryName: "USA",
    lastSyncAt: "2026-03-15T00:00:00.000Z",
    lastSyncError: null,
    lastValidatedAt: "2026-03-15T00:00:00.000Z",
    leagueId: "1000",
    leagueName: "NBBA",
    leagueTimeZone: "America/New_York",
    profileJson,
    status: "CONNECTED",
    teamId: "team-1",
    teamName: "Visionaries",
    ...overrides,
  };
}

export function createEmptyArenaWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    syncedAt: null,
    nextHomeMatch: null,
    arena: {
      name: null,
      seats: [],
      expansion: null,
    },
    economy: {
      cash: null,
      availableBalance: null,
      transactions: [],
    },
    recentHomeGames: [],
    recommendation: null,
    diagnostics: {
      comparableGameCount: 0,
      matchedSnapshotCount: 0,
      lowConfidenceReasons: [],
    },
    ...overrides,
  };
}

export function createWorkspaceCachePayload(
  overrides: Record<string, unknown> = {},
) {
  const homeOverrides = (overrides.home as Record<string, unknown> | undefined) ?? {};
  const teamHubOverrides =
    (overrides.teamHub as Record<string, unknown> | undefined) ?? {};
  const scoutOverrides =
    (overrides.scout as Record<string, unknown> | undefined) ?? {};
  const leagueIntelOverrides =
    (overrides.leagueIntel as Record<string, unknown> | undefined) ?? {};
  const playerLabOverrides =
    (overrides.playerLab as Record<string, unknown> | undefined) ?? {};

  const defaultHome = {
    connection: createWorkspaceCacheConnection(),
    league: {
      freshnessMessage: null,
      freshnessStatus: "FRESH",
      league: null,
      season: null,
      standings: [],
    },
    nextMatch: null,
    nextOpponent: null,
    nextScoutMatch: null,
    recentMatches: [],
    syncedAt: "2026-03-15T00:00:00.000Z",
    team: {
      injuries: [],
      record: null,
      shortName: "Visionaries",
      teamId: "team-1",
      teamName: "Visionaries",
      topPlayers: [],
    },
  };

  const defaultTeamHub = {
    roster: [],
    syncedAt: "2026-03-15T00:00:00.000Z",
    team: createStoredTeamInfo(),
  };

  const defaultScout = {
    availableOpponents: [],
    message: null,
    recentMatchups: [],
    requestedTeamId: null,
    schedule: null,
    summary: null,
    syncedAt: "2026-03-15T00:00:00.000Z",
    teamId: null,
  };

  const defaultLeagueIntel = {
    freshnessMessage: null,
    freshnessStatus: "FRESH",
    league: null,
    season: null,
    standings: [],
  };

  const defaultPlayerLab = {
    players: [],
    syncedAt: "2026-03-15T00:00:00.000Z",
  };

  return {
    version:
      typeof overrides.version === "number"
        ? overrides.version
        : WORKSPACE_CACHE_VERSION,
    home: {
      ...defaultHome,
      ...homeOverrides,
      connection: {
        ...defaultHome.connection,
        ...((homeOverrides.connection as Record<string, unknown> | undefined) ?? {}),
      },
      league: {
        ...defaultHome.league,
        ...((homeOverrides.league as Record<string, unknown> | undefined) ?? {}),
      },
      team: {
        ...defaultHome.team,
        ...((homeOverrides.team as Record<string, unknown> | undefined) ?? {}),
      },
    },
    teamHub: {
      ...defaultTeamHub,
      ...teamHubOverrides,
      team: {
        ...defaultTeamHub.team,
        ...((teamHubOverrides.team as Record<string, unknown> | undefined) ?? {}),
      },
    },
    scout: {
      ...defaultScout,
      ...scoutOverrides,
    },
    leagueIntel: {
      ...defaultLeagueIntel,
      ...leagueIntelOverrides,
    },
    playerLab: {
      ...defaultPlayerLab,
      ...playerLabOverrides,
    },
    arena: createEmptyArenaWorkspace(
      (overrides.arena as Record<string, unknown> | undefined) ?? {},
    ),
  };
}

export function createStoredOwnedRosterPlayer(
  overrides: Record<string, unknown> = {},
) {
  const skillsOverrides = overrides.skills as Record<string, unknown> | undefined;
  const nationalityOverrides =
    overrides.nationality as Record<string, unknown> | undefined;

  return {
    id: "p1",
    firstName: "Lead",
    lastName: "Guard",
    fullName: "Lead Guard",
    salary: 50000,
    bestPosition: "PG",
    age: 26,
    height: 74,
    dmi: 1500,
    injuryWeeks: 0,
    nationality: {
      id: "1",
      name: "USA",
      ...nationalityOverrides,
    },
    skills: {
      block: 2,
      driving: 7,
      experience: 6,
      freeThrow: 7,
      gameShape: 8,
      handling: 8,
      insideDef: 3,
      insideShot: 4,
      jumpShot: 7,
      outsideDef: 5,
      passing: 9,
      potential: 10,
      range: 6,
      rebound: 4,
      stamina: 8,
      ...skillsOverrides,
    },
    ...overrides,
  };
}
