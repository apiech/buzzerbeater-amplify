"use client";

import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { client } from "@/app/amplify-client";
import { fetchBillingSummary } from "@/app/billing-client";
import { formatAmplifyErrors } from "@/app/dashboard/remote-errors";
import type {
  BillingSummary,
  BbConnectionRecord,
  HomeWorkspacePayload,
  LeagueIntelPayload,
  LineupHelperWorkspaceRecord,
  NextGameRecommendationInput,
  NextGameRecommendationSnapshot,
  OpponentForecastSnapshot,
  PlayerLabPayload,
  ScoutSchedulePayload,
  ScoutTeamSummaryPayload,
} from "@/app/types";

const genericObjectSchema = z.object({}).passthrough();
const connectionSchema = genericObjectSchema
  .extend({
    status: z.string().nullable().optional(),
  })
  .nullable();
const billingSummarySchema = genericObjectSchema.extend({
  planId: z.string().nullable().optional(),
});
const homeWorkspaceSchema = genericObjectSchema.extend({
  league: genericObjectSchema,
  recentMatches: z.array(genericObjectSchema),
  team: genericObjectSchema,
});
const lineupHelperWorkspaceSchema = genericObjectSchema.extend({
  roster: z.array(genericObjectSchema),
});
const leagueIntelSchema = genericObjectSchema.extend({
  standings: z.array(genericObjectSchema),
});
const playerLabSchema = genericObjectSchema.extend({
  players: z.array(genericObjectSchema),
});
const scoutWorkspaceSchema = genericObjectSchema.extend({
  availableOpponents: z.array(genericObjectSchema),
  recentMatchups: z.array(genericObjectSchema),
});
const scoutScheduleSchema = genericObjectSchema.extend({
  availableSeasons: z.array(z.number()),
  competitionOptions: z.array(genericObjectSchema),
  rows: z.array(genericObjectSchema),
  summary: genericObjectSchema,
});
const opponentForecastSchema = genericObjectSchema
  .extend({
    jobId: z.string(),
    status: z.string(),
  })
  .nullable();
const nextGameRecommendationSchema = genericObjectSchema
  .extend({
    jobId: z.string(),
    status: z.string(),
  })
  .nullable();

type SharedWorkspaceSectionKey =
  | "lineupHelper"
  | "leagueIntel"
  | "playerLab";

export const workspaceQueryKeys = {
  billing: ["billing", "summary"] as const,
  connection: ["workspace", "connection"] as const,
  home: ["workspace", "home"] as const,
  leagueIntel: ["workspace", "leagueIntel"] as const,
  lineupHelper: ["workspace", "lineupHelper"] as const,
  nextGameRecommendation: (input: NextGameRecommendationInput) =>
    [
      "workspace",
      "recommendation",
      input.enthusiasm,
      input.defensiveSwitch.pg,
      input.defensiveSwitch.sg,
      input.defensiveSwitch.sf,
      input.defensiveSwitch.pf,
      input.defensiveSwitch.c,
    ] as const,
  opponentForecast: (teamId: string | null | undefined) =>
    ["workspace", "forecast", teamId ?? "none"] as const,
  playerLab: ["workspace", "playerLab"] as const,
  root: ["workspace"] as const,
  scoutSchedule: (args: {
    competitionKeys?: readonly string[] | null;
    season?: number | null;
    teamId?: string | null;
  }) =>
    [
      "workspace",
      "scout",
      "schedule",
      args.teamId ?? "default",
      args.season ?? "latest",
      ...(args.competitionKeys ?? []).slice().sort(),
    ] as const,
  scoutSummary: (teamId: string | null | undefined) =>
    ["workspace", "scout", "summary", teamId ?? "default"] as const,
} as const;

function normalizeCompetitionKeys(
  competitionKeys?: readonly string[] | null,
): string[] | undefined {
  const normalized = (competitionKeys ?? []).filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );

  return normalized.length ? [...normalized].sort() : undefined;
}

function readAmplifyDataOrThrow<T>(
  response: {
    data?: unknown;
    errors?: ReadonlyArray<{ message?: string }> | null;
  },
  schema: z.ZodType<T>,
  emptyMessage: string,
): T {
  if (response.errors?.length) {
    throw new Error(formatAmplifyErrors([...response.errors]));
  }
  if (response.data == null) {
    throw new Error(emptyMessage);
  }

  return schema.parse(response.data);
}

function readAmplifyNullableDataOrThrow<T>(
  response: {
    data?: unknown;
    errors?: ReadonlyArray<{ message?: string }> | null;
  },
  schema: z.ZodType<T>,
): T | null {
  if (response.errors?.length) {
    throw new Error(formatAmplifyErrors([...response.errors]));
  }
  if (response.data == null) {
    return null;
  }

  return schema.parse(response.data);
}

export async function fetchConnectionRecord(): Promise<BbConnectionRecord | null> {
  const response = await client.reads.getCurrentBbConnection();
  return readAmplifyNullableDataOrThrow(response, connectionSchema) as BbConnectionRecord | null;
}

export async function fetchBillingSummaryQuery(): Promise<BillingSummary> {
  return billingSummarySchema.parse(await fetchBillingSummary()) as BillingSummary;
}

export async function fetchHomeWorkspaceQuery(args?: {
  force?: boolean;
}): Promise<HomeWorkspacePayload> {
  const response = args?.force
    ? await client.mutations.refreshWorkspace()
    : await client.queries.getHomeWorkspace();

  return readAmplifyDataOrThrow(
    response,
    homeWorkspaceSchema,
    "Unable to load your club workspace.",
  ) as HomeWorkspacePayload;
}

export async function fetchLineupHelperWorkspaceQuery(args?: {
  force?: boolean;
}): Promise<LineupHelperWorkspaceRecord | null> {
  const response = await client.queries.getLineupHelperWorkspace(
    args?.force ? { force: true } : undefined,
  );

  return readAmplifyNullableDataOrThrow(
    response,
    lineupHelperWorkspaceSchema,
  ) as LineupHelperWorkspaceRecord | null;
}

export async function fetchLeagueIntelQuery(args?: {
  force?: boolean;
}): Promise<LeagueIntelPayload | null> {
  const response = await client.queries.getLeagueIntel(
    args?.force ? { force: true } : undefined,
  );

  return readAmplifyNullableDataOrThrow(
    response,
    leagueIntelSchema,
  ) as LeagueIntelPayload | null;
}

export async function fetchPlayerLabQuery(args?: {
  force?: boolean;
}): Promise<PlayerLabPayload | null> {
  const response = await client.queries.getPlayerLab(
    args?.force ? { force: true } : undefined,
  );

  return readAmplifyNullableDataOrThrow(
    response,
    playerLabSchema,
  ) as PlayerLabPayload | null;
}

export async function fetchScoutTeamSummaryQuery(args?: {
  force?: boolean;
  teamId?: string | null;
}): Promise<ScoutTeamSummaryPayload | null> {
  const response = await client.queries.getScoutTeamSummary({
    ...(args?.force ? { force: true } : {}),
    ...(args?.teamId ? { teamId: args.teamId } : {}),
  });

  return readAmplifyNullableDataOrThrow(
    response,
    scoutWorkspaceSchema,
  ) as ScoutTeamSummaryPayload | null;
}

export async function fetchScoutScheduleQuery(args: {
  competitionKeys?: readonly string[] | null;
  force?: boolean;
  season?: number | null;
  teamId?: string | null;
}): Promise<ScoutSchedulePayload | null> {
  const competitionKeys = normalizeCompetitionKeys(args.competitionKeys);
  const response = await client.queries.getScoutSchedule({
    ...(competitionKeys ? { competitionKeys } : {}),
    ...(args.force ? { force: true } : {}),
    ...(typeof args.season === "number" ? { season: args.season } : {}),
    ...(args.teamId ? { teamId: args.teamId } : {}),
  });

  return readAmplifyNullableDataOrThrow(
    response,
    scoutScheduleSchema,
  ) as ScoutSchedulePayload | null;
}

export async function fetchLatestOpponentForecastQuery(args: {
  teamId: string;
}): Promise<OpponentForecastSnapshot | null> {
  const response = await client.queries.getLatestOpponentForecast({
    teamId: args.teamId,
  });

  return readAmplifyNullableDataOrThrow(
    response,
    opponentForecastSchema,
  ) as OpponentForecastSnapshot | null;
}

export async function fetchLatestNextGameRecommendationQuery(args: {
  input: NextGameRecommendationInput;
}): Promise<NextGameRecommendationSnapshot | null> {
  const response = await client.queries.getLatestNextGameRecommendation({
    input: args.input,
  });

  return readAmplifyNullableDataOrThrow(
    response,
    nextGameRecommendationSchema,
  ) as NextGameRecommendationSnapshot | null;
}

export function connectionQueryOptions() {
  return queryOptions({
    queryFn: fetchConnectionRecord,
    queryKey: workspaceQueryKeys.connection,
  });
}

export function billingSummaryQueryOptions() {
  return queryOptions({
    queryFn: fetchBillingSummaryQuery,
    queryKey: workspaceQueryKeys.billing,
  });
}

export function homeWorkspaceQueryOptions() {
  return queryOptions({
    queryFn: () => fetchHomeWorkspaceQuery(),
    queryKey: workspaceQueryKeys.home,
  });
}

export function lineupHelperWorkspaceQueryOptions() {
  return queryOptions({
    queryFn: () => fetchLineupHelperWorkspaceQuery(),
    queryKey: workspaceQueryKeys.lineupHelper,
  });
}

export function leagueIntelQueryOptions() {
  return queryOptions({
    queryFn: () => fetchLeagueIntelQuery(),
    queryKey: workspaceQueryKeys.leagueIntel,
  });
}

export function playerLabQueryOptions() {
  return queryOptions({
    queryFn: () => fetchPlayerLabQuery(),
    queryKey: workspaceQueryKeys.playerLab,
  });
}

export function scoutTeamSummaryQueryOptions(args?: {
  teamId?: string | null;
}) {
  return queryOptions({
    queryFn: () => fetchScoutTeamSummaryQuery(args),
    queryKey: workspaceQueryKeys.scoutSummary(args?.teamId),
  });
}

export function scoutScheduleQueryOptions(args: {
  competitionKeys?: readonly string[] | null;
  season?: number | null;
  teamId?: string | null;
}) {
  return queryOptions({
    queryFn: () => fetchScoutScheduleQuery(args),
    queryKey: workspaceQueryKeys.scoutSchedule(args),
  });
}

export function opponentForecastQueryOptions(args: { teamId: string }) {
  return queryOptions({
    queryFn: () => fetchLatestOpponentForecastQuery(args),
    queryKey: workspaceQueryKeys.opponentForecast(args.teamId),
  });
}

export function nextGameRecommendationQueryOptions(args: {
  input: NextGameRecommendationInput;
}) {
  return queryOptions({
    queryFn: () => fetchLatestNextGameRecommendationQuery(args),
    queryKey: workspaceQueryKeys.nextGameRecommendation(args.input),
  });
}

export async function refreshHomeWorkspace(queryClient: QueryClient) {
  const home = await fetchHomeWorkspaceQuery({ force: true });
  queryClient.setQueryData(workspaceQueryKeys.home, home);
  return home;
}

export async function refreshSharedWorkspaceSection(
  queryClient: QueryClient,
  sectionKey: SharedWorkspaceSectionKey,
) {
  if (sectionKey === "lineupHelper") {
    const data = await fetchLineupHelperWorkspaceQuery({ force: true });
    queryClient.setQueryData(workspaceQueryKeys.lineupHelper, data);
    return data;
  }
  if (sectionKey === "leagueIntel") {
    const data = await fetchLeagueIntelQuery({ force: true });
    queryClient.setQueryData(workspaceQueryKeys.leagueIntel, data);
    return data;
  }

  const data = await fetchPlayerLabQuery({ force: true });
  queryClient.setQueryData(workspaceQueryKeys.playerLab, data);
  return data;
}
