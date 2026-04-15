import {
  assertConnectionResult,
  assertStoredTeamInfo,
  assertWorkspaceCacheConnection,
  readWorkspaceCachePayloadContract,
  type ConnectionResultShape,
  type WorkspaceCacheConnectionShape,
} from "../../../lib/owned-data/contracts";

type ConnectionProjectionSource = {
  accessKeyLast4?: unknown;
  bbLoginName?: unknown;
  connectedAt?: unknown;
  countryId?: unknown;
  countryName?: unknown;
  lastSyncAt?: unknown;
  lastSyncError?: unknown;
  lastValidatedAt?: unknown;
  leagueId?: unknown;
  leagueName?: unknown;
  leagueTimeZone?: unknown;
  profileJson?: unknown;
  status?: unknown;
  teamId?: unknown;
  teamName?: unknown;
  workspaceCacheJson?: unknown;
};

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readStringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function buildBaseConnectionProjection(
  source: ConnectionProjectionSource,
  label: string,
) {
  return {
    accessKeyLast4: readOptionalString(source.accessKeyLast4),
    bbLoginName: readStringOrDefault(source.bbLoginName, ""),
    connectedAt: readOptionalString(source.connectedAt),
    countryId: readOptionalString(source.countryId),
    countryName: readOptionalString(source.countryName),
    lastSyncAt: readOptionalString(source.lastSyncAt),
    lastSyncError: readOptionalString(source.lastSyncError),
    lastValidatedAt: readOptionalString(source.lastValidatedAt),
    leagueId: readOptionalString(source.leagueId),
    leagueName: readOptionalString(source.leagueName),
    leagueTimeZone: readOptionalString(source.leagueTimeZone),
    profileJson:
      source.profileJson == null
        ? null
        : assertStoredTeamInfo(source.profileJson, `${label} profileJson`),
    status: readStringOrDefault(source.status, "UNSET"),
    teamId: readOptionalString(source.teamId),
    teamName: readOptionalString(source.teamName),
  };
}

export function projectCurrentConnectionResult(
  source: ConnectionProjectionSource,
  label: string,
): ConnectionResultShape {
  return assertConnectionResult(
    {
      ...buildBaseConnectionProjection(source, label),
      workspaceCacheJson: readWorkspaceCachePayloadContract(source.workspaceCacheJson),
    },
    label,
  );
}

export function projectEmbeddedConnectionResult(
  source: ConnectionProjectionSource,
  label: string,
): ConnectionResultShape {
  return assertConnectionResult(buildBaseConnectionProjection(source, label), label);
}

export function projectWorkspaceCacheConnection(
  source: ConnectionProjectionSource,
  label: string,
): WorkspaceCacheConnectionShape {
  return assertWorkspaceCacheConnection(
    buildBaseConnectionProjection(source, label),
    label,
  );
}
