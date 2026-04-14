import type {
  BBApiBoxScore,
  BBXmlApiClient,
  BBXmlApiClientOptions,
} from "../../../lib/bbapi";

import type {
  MatchBoxscoreCacheReadResult,
  MatchBoxscoreRecord,
} from "./repository";
import {
  inflateStoredMatchBoxscore,
  toStoredMatchBoxscore,
} from "./stored-boxscore";

type GraphqlEnv = Record<string, string | undefined>;

type CachedMatchBoxscoreRecord = {
  boxscoreJson?: unknown;
};

type BbConnectionLike = {
  bbLoginName?: string | null;
};

export type NormalizedCachedMatchBoxscore<
  TRecord extends CachedMatchBoxscoreRecord = CachedMatchBoxscoreRecord,
> = {
  boxscore: BBApiBoxScore;
  record: TRecord;
};

type RepairableMatchBoxscoreRecord = Pick<
  MatchBoxscoreRecord,
  "boxscoreJson" | "fetchedAt" | "matchId" | "userId"
>;

type RecentMatchBoxscoreRepairDependencies = {
  createBbClient: (
    options: BBXmlApiClientOptions,
  ) => Pick<BBXmlApiClient, "getBoxScore">;
  getBbConnection: (
    env: GraphqlEnv,
    userId: string,
  ) => Promise<BbConnectionLike | null>;
  readRecord: (
    env: GraphqlEnv,
    userId: string,
    matchId: string,
  ) => Promise<MatchBoxscoreCacheReadResult>;
  resolveBbAccessKey: (env: GraphqlEnv, userId: string) => Promise<string>;
  upsertMatchBoxscore: (
    env: GraphqlEnv,
    record: RepairableMatchBoxscoreRecord,
  ) => Promise<void>;
};

export async function getNormalizedCachedMatchBoxscore<
  TRecord extends CachedMatchBoxscoreRecord,
>(args: {
  env: GraphqlEnv;
  getRecord: (
    env: GraphqlEnv,
    userId: string,
    matchId: string,
  ) => Promise<TRecord | null>;
  matchId: string;
  userId: string;
}): Promise<NormalizedCachedMatchBoxscore<TRecord> | null> {
  const record = await args.getRecord(args.env, args.userId, args.matchId);
  return normalizeCachedMatchBoxscoreRecord(record);
}

export function normalizeCachedMatchBoxscoreRecord<
  TRecord extends CachedMatchBoxscoreRecord,
>(
  record: TRecord | null | undefined,
): NormalizedCachedMatchBoxscore<TRecord> | null {
  if (!record) {
    return null;
  }

  const boxscore = inflateStoredMatchBoxscore(record.boxscoreJson);
  if (!boxscore) {
    return null;
  }

  return {
    boxscore,
    record,
  };
}

export async function getOrRepairRecentCachedMatchBoxscore(args: {
  createBbClient: RecentMatchBoxscoreRepairDependencies["createBbClient"];
  env: GraphqlEnv;
  getBbConnection: RecentMatchBoxscoreRepairDependencies["getBbConnection"];
  matchId: string;
  readRecord: RecentMatchBoxscoreRepairDependencies["readRecord"];
  resolveBbAccessKey: RecentMatchBoxscoreRepairDependencies["resolveBbAccessKey"];
  source?: string;
  upsertMatchBoxscore: RecentMatchBoxscoreRepairDependencies["upsertMatchBoxscore"];
  userId: string;
}): Promise<
  NormalizedCachedMatchBoxscore<RepairableMatchBoxscoreRecord> | null
> {
  const readResult = await args.readRecord(args.env, args.userId, args.matchId);
  if (readResult.status === "hit") {
    const normalized = normalizeCachedMatchBoxscoreRecord(readResult.record);
    if (normalized) {
      return normalized;
    }
  } else if (readResult.status === "missing") {
    return null;
  }

  return await repairUnreadableRecentCachedMatchBoxscore(args);
}

async function repairUnreadableRecentCachedMatchBoxscore(args: {
  createBbClient: RecentMatchBoxscoreRepairDependencies["createBbClient"];
  env: GraphqlEnv;
  getBbConnection: RecentMatchBoxscoreRepairDependencies["getBbConnection"];
  matchId: string;
  resolveBbAccessKey: RecentMatchBoxscoreRepairDependencies["resolveBbAccessKey"];
  source?: string;
  upsertMatchBoxscore: RecentMatchBoxscoreRepairDependencies["upsertMatchBoxscore"];
  userId: string;
}): Promise<
  NormalizedCachedMatchBoxscore<RepairableMatchBoxscoreRecord> | null
> {
  try {
    const connection = await args.getBbConnection(args.env, args.userId);
    const bbLoginName = connection?.bbLoginName?.trim();
    if (!bbLoginName) {
      return null;
    }

    const accessKey = await args.resolveBbAccessKey(args.env, args.userId);
    const liveBoxscore = await args
      .createBbClient({
        securityCode: accessKey,
        username: bbLoginName,
      })
      .getBoxScore(args.matchId);
    const storedBoxscore = toStoredMatchBoxscore({
      boxscore: liveBoxscore,
      source: args.source ?? "WORKSPACE_CACHE",
    });
    if (!storedBoxscore) {
      return null;
    }

    const repairedRecord: RepairableMatchBoxscoreRecord = {
      boxscoreJson: storedBoxscore,
      fetchedAt: liveBoxscore.retrievedAt ?? new Date().toISOString(),
      matchId: storedBoxscore.matchId,
      userId: args.userId,
    };
    try {
      await args.upsertMatchBoxscore(args.env, repairedRecord);
    } catch {
      // Best-effort repair should not fail the caller if persistence is unavailable.
    }

    return normalizeCachedMatchBoxscoreRecord(repairedRecord);
  } catch {
    return null;
  }
}
