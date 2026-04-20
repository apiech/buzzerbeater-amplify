import { parseAsArrayOf, parseAsInteger, parseAsString } from "nuqs";

export const simpleScoutUrlStateParsers = {
  scoutSeason: parseAsInteger.withOptions({ history: "replace" }),
  scoutTeam: parseAsString.withOptions({ history: "replace" }),
  scoutTypes: parseAsArrayOf(parseAsString).withOptions({ history: "replace" }),
};

export type SimpleScoutUrlState = {
  scoutSeason: number | null;
  scoutTeam: string | null;
  scoutTypes: string[] | null;
};

export function normalizeSimpleScoutTeamId(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length ? normalized : null;
}

export function normalizeSimpleScoutCompetitionKeys(
  value: readonly string[] | null | undefined,
): string[] | null {
  const normalized = (value ?? [])
    .filter(
      (entry): entry is string =>
        typeof entry === "string" && entry.trim().length > 0,
    )
    .slice()
    .sort();

  return normalized.length ? normalized : null;
}

export function resolveSimpleScoutDefaultTeamId(args: {
  nextScoutTeamId: string | null | undefined;
  requestedScoutTeamId: string | null | undefined;
  scoutTeamId: string | null | undefined;
  urlTeamId: string | null | undefined;
}): string {
  return (
    normalizeSimpleScoutTeamId(args.urlTeamId) ??
    normalizeSimpleScoutTeamId(args.requestedScoutTeamId) ??
    normalizeSimpleScoutTeamId(args.scoutTeamId) ??
    normalizeSimpleScoutTeamId(args.nextScoutTeamId) ??
    ""
  );
}

export function resolveSimpleScoutTeamSelectionAction(args: {
  nextTeamId: string | null | undefined;
  resolvedTeamId: string | null | undefined;
  urlTeamId: string | null | undefined;
}):
  | { kind: "noop" }
  | { kind: "refetch" }
  | { kind: "update-url"; nextState: Partial<SimpleScoutUrlState> } {
  const nextTeamId = normalizeSimpleScoutTeamId(args.nextTeamId);
  if (!nextTeamId) {
    return { kind: "noop" };
  }

  const resolvedTeamId = normalizeSimpleScoutTeamId(args.resolvedTeamId);
  const urlTeamId = normalizeSimpleScoutTeamId(args.urlTeamId);

  if (resolvedTeamId !== nextTeamId) {
    return {
      kind: "update-url",
      nextState: {
        scoutSeason: null,
        scoutTeam: nextTeamId,
        scoutTypes: null,
      },
    };
  }

  if (urlTeamId !== nextTeamId) {
    return {
      kind: "update-url",
      nextState: {
        scoutTeam: nextTeamId,
      },
    };
  }

  return { kind: "refetch" };
}

export function resolveSimpleScoutFilterApplyAction(args: {
  currentCompetitionKeys: readonly string[] | null | undefined;
  currentSeason: number | null | undefined;
  nextCompetitionKeys: readonly string[] | null | undefined;
  nextSeason: number | null | undefined;
}):
  | { kind: "refetch" }
  | { kind: "update-url"; nextState: Partial<SimpleScoutUrlState> } {
  const currentCompetitionKeys = normalizeSimpleScoutCompetitionKeys(
    args.currentCompetitionKeys,
  );
  const nextCompetitionKeys = normalizeSimpleScoutCompetitionKeys(
    args.nextCompetitionKeys,
  );
  const currentSeason = args.currentSeason ?? null;
  const nextSeason = args.nextSeason ?? null;

  if (
    currentSeason === nextSeason &&
    areStringArraysEqual(
      currentCompetitionKeys ?? [],
      nextCompetitionKeys ?? [],
    )
  ) {
    return { kind: "refetch" };
  }

  return {
    kind: "update-url",
    nextState: {
      scoutSeason: nextSeason,
      scoutTypes: nextCompetitionKeys,
    },
  };
}

function areStringArraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export const __testing = {
  normalizeSimpleScoutCompetitionKeys,
  normalizeSimpleScoutTeamId,
  resolveSimpleScoutDefaultTeamId,
  resolveSimpleScoutFilterApplyAction,
  resolveSimpleScoutTeamSelectionAction,
};
