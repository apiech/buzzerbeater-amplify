export type JsonRecord = Record<string, unknown>;

export function asOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
  }

  return null;
}

export function asOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

export function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

export function toRecordArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonRecord => Boolean(entry));
}

export function getBoxscoreSides(value: unknown): {
  awayTeam: JsonRecord | null;
  boxscore: JsonRecord | null;
  homeTeam: JsonRecord | null;
} {
  const boxscore = asRecord(value);
  return {
    boxscore,
    homeTeam: asRecord(boxscore?.homeTeam),
    awayTeam: asRecord(boxscore?.awayTeam),
  };
}

export function selectBoxscorePerspective(
  value: unknown,
  teamId: string | null | undefined,
): {
  awayTeam: JsonRecord | null;
  boxscore: JsonRecord | null;
  homeTeam: JsonRecord | null;
  opponent: JsonRecord | null;
  team: JsonRecord | null;
  teamLocation: "AWAY" | "HOME" | null;
} {
  const { boxscore, homeTeam, awayTeam } = getBoxscoreSides(value);
  const normalizedTeamId = teamId?.trim() || null;
  const homeTeamId = readTeamIdentifier(homeTeam);
  const awayTeamId = readTeamIdentifier(awayTeam);

  if (normalizedTeamId && homeTeamId === normalizedTeamId) {
    return {
      boxscore,
      homeTeam,
      awayTeam,
      team: homeTeam,
      opponent: awayTeam,
      teamLocation: "HOME",
    };
  }

  if (normalizedTeamId && awayTeamId === normalizedTeamId) {
    return {
      boxscore,
      homeTeam,
      awayTeam,
      team: awayTeam,
      opponent: homeTeam,
      teamLocation: "AWAY",
    };
  }

  return {
    boxscore,
    homeTeam,
    awayTeam,
    team: null,
    opponent: null,
    teamLocation: null,
  };
}

function readTeamIdentifier(team: JsonRecord | null): string | null {
  return asOptionalString(team?.id) ?? asOptionalString(team?.teamId);
}
