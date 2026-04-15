import {
  buildActiveTrackedTeamCredentialProjection,
  type ActiveTrackedTeamCredentialProjection,
} from "./active-tracked-teams";
import { resolveBbAccessKey } from "./credentials";
import {
  assertStoredTeamInfo,
  assertWorkspaceCachePayload,
} from "../../../lib/owned-data/contracts";
import {
  getBbCredential,
  type BbConnectionRecord,
  type BbCredentialRecord,
} from "./repository";

type GraphqlEnv = Record<string, string | undefined>;

type Identity = {
  sub?: string;
  claims?: Record<string, unknown>;
};

export type ActiveTrackedTeamCredentialContext =
  ActiveTrackedTeamCredentialProjection & {
    bbLoginName: string;
  };

export function resolveUserId(identity: unknown): string | null {
  if (!identity || typeof identity !== "object") {
    return null;
  }

  const typedIdentity = identity as Identity;
  if (typeof typedIdentity.sub === "string" && typedIdentity.sub) {
    return typedIdentity.sub;
  }

  const claimsSub = typedIdentity.claims?.sub;
  return typeof claimsSub === "string" && claimsSub ? claimsSub : null;
}

export async function loadActiveTrackedTeamCredentialContext(
  env: GraphqlEnv,
  userId: string,
  bbLoginName: string,
  credentialOverride?: BbCredentialRecord,
): Promise<ActiveTrackedTeamCredentialContext> {
  const credential =
    credentialOverride ?? (await requireBbCredentialRecord(env, userId));
  return buildActiveTrackedTeamCredentialContext(bbLoginName, credential);
}

export async function resolveAccessKey(
  env: GraphqlEnv,
  userId: string,
): Promise<string> {
  return resolveBbAccessKey(env, userId);
}

export function buildConnectionRecord(
  userId: string,
  existingConnection: BbConnectionRecord | null,
  updates: Partial<BbConnectionRecord>,
): BbConnectionRecord {
  return {
    userId,
    bbLoginName: resolveConnectionField(
      existingConnection,
      updates,
      "bbLoginName",
      "",
    ),
    status: resolveConnectionField(
      existingConnection,
      updates,
      "status",
      "UNSET",
    ),
    accessKeyLast4: resolveConnectionField(
      existingConnection,
      updates,
      "accessKeyLast4",
      null,
    ),
    teamId: resolveConnectionField(existingConnection, updates, "teamId", null),
    teamName: resolveConnectionField(
      existingConnection,
      updates,
      "teamName",
      null,
    ),
    shortName: resolveConnectionField(
      existingConnection,
      updates,
      "shortName",
      null,
    ),
    leagueId: resolveConnectionField(
      existingConnection,
      updates,
      "leagueId",
      null,
    ),
    leagueName: resolveConnectionField(
      existingConnection,
      updates,
      "leagueName",
      null,
    ),
    countryId: resolveConnectionField(
      existingConnection,
      updates,
      "countryId",
      null,
    ),
    countryName: resolveConnectionField(
      existingConnection,
      updates,
      "countryName",
      null,
    ),
    leagueTimeZone: resolveConnectionField(
      existingConnection,
      updates,
      "leagueTimeZone",
      null,
    ),
    connectedAt: resolveConnectionField(
      existingConnection,
      updates,
      "connectedAt",
      null,
    ),
    lastValidatedAt: resolveConnectionField(
      existingConnection,
      updates,
      "lastValidatedAt",
      null,
    ),
    lastSyncAt: resolveConnectionField(
      existingConnection,
      updates,
      "lastSyncAt",
      null,
    ),
    lastSyncError: resolveConnectionField(
      existingConnection,
      updates,
      "lastSyncError",
      null,
    ),
    profileJson: resolveConnectionProfile(existingConnection, updates),
    workspaceCacheJson: resolveConnectionWorkspaceCache(
      existingConnection,
      updates,
    ),
  };
}

async function requireBbCredentialRecord(
  env: GraphqlEnv,
  userId: string,
): Promise<BbCredentialRecord> {
  const credential = await getBbCredential(env, userId);
  if (!credential) {
    throw new Error("No encrypted BuzzerBeater credential is available.");
  }
  return credential;
}

function buildActiveTrackedTeamCredentialContext(
  bbLoginName: string,
  credential: BbCredentialRecord,
): ActiveTrackedTeamCredentialContext {
  return {
    bbLoginName,
    ...buildActiveTrackedTeamCredentialProjection(credential),
  };
}

function resolveConnectionField<Key extends keyof BbConnectionRecord>(
  existingConnection: BbConnectionRecord | null,
  updates: Partial<BbConnectionRecord>,
  key: Key,
  fallback: BbConnectionRecord[Key],
): BbConnectionRecord[Key] {
  const value = hasOwnConnectionField(updates, key)
    ? updates[key]
    : existingConnection?.[key];

  return value === undefined ? fallback : value;
}

function resolveConnectionProfile(
  existingConnection: BbConnectionRecord | null,
  updates: Partial<BbConnectionRecord>,
): BbConnectionRecord["profileJson"] {
  const value = hasOwnConnectionField(updates, "profileJson")
    ? updates.profileJson
    : existingConnection?.profileJson;

  if (value == null) {
    return null;
  }

  return assertStoredTeamInfo(
    value,
    "workspace connection record profileJson",
  );
}

function resolveConnectionWorkspaceCache(
  existingConnection: BbConnectionRecord | null,
  updates: Partial<BbConnectionRecord>,
): BbConnectionRecord["workspaceCacheJson"] {
  const value = hasOwnConnectionField(updates, "workspaceCacheJson")
    ? updates.workspaceCacheJson
    : existingConnection?.workspaceCacheJson;

  if (value == null) {
    return null;
  }

  return assertWorkspaceCachePayload(
    value,
    "workspace connection record workspaceCacheJson",
  );
}

function hasOwnConnectionField<Key extends keyof BbConnectionRecord>(
  value: Partial<BbConnectionRecord>,
  key: Key,
): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
