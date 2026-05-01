"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useState } from "react";

import {
  COMMERCIAL_MODE_DISABLED_SENTINEL,
  formatClientError,
} from "@/app/dashboard/remote-errors";
import {
  arenaWorkspaceQueryOptions,
  billingSummaryQueryOptions,
  connectionQueryOptions,
  disconnectBbAccountMutation,
  homeWorkspaceQueryOptions,
  leagueIntelQueryOptions,
  lineupHelperWorkspaceQueryOptions,
  playerLabQueryOptions,
  refreshHomeWorkspace,
  refreshLeagueIntelWorkspace,
  refreshSharedWorkspaceSection,
  workspaceQueryKeys,
} from "@/app/dashboard/workspace-query-client";
import type {
  ArenaWorkspacePayload,
  BillingSummary,
  BbConnectionRecord,
  DashboardShellData,
  HomeWorkspacePayload,
  LineupHelperDependencyState,
} from "@/app/types";
import type { WorkspaceSection } from "@/app/workspace-sections";

type WorkspaceExtraSectionKey =
  | "arena"
  | "lineupHelper"
  | "leagueIntel"
  | "playerLab";

const LEAGUE_INTEL_AUTO_REFRESH_INTERVAL_MS = 60_000;

const sectionDependencies: Record<
  WorkspaceSection,
  WorkspaceExtraSectionKey[]
> = {
  arena: ["arena"],
  highlights: [],
  home: ["lineupHelper"],
  league: ["leagueIntel"],
  "league-history": [],
  lineups: ["lineupHelper"],
  "next-game": ["lineupHelper"],
  "opponent-schedule": [],
  ops: [],
  players: ["playerLab"],
  predictions: [],
  recaps: ["playerLab"],
  rivals: [],
  scout: [],
  "staff-market": [],
};

function createWorkspaceFromHome(
  home: HomeWorkspacePayload,
  sections: {
    arena?: ArenaWorkspacePayload | null;
    leagueIntel?: DashboardShellData["leagueIntel"];
    lineupHelper?: DashboardShellData["lineupHelper"];
    playerLab?: DashboardShellData["playerLab"];
  },
): DashboardShellData {
  return {
    home,
    arena: sections.arena ?? null,
    leagueIntel: sections.leagueIntel ?? null,
    lineupHelper: sections.lineupHelper ?? null,
    playerLab: sections.playerLab ?? null,
    syncedAt: home.syncedAt ?? null,
  };
}

function formatQueryErrorMessage(error: unknown): string | null {
  if (!error) {
    return null;
  }

  return formatClientError(error);
}

function resolveLineupHelperDependencyState(args: {
  connected: boolean;
  errorMessage: string | null;
  isPending: boolean;
  required: boolean;
}): LineupHelperDependencyState {
  if (!args.connected || !args.required) {
    return {
      errorMessage: null,
      status: "ready",
    };
  }

  if (args.isPending) {
    return {
      errorMessage: null,
      status: "loading",
    };
  }

  if (args.errorMessage) {
    return {
      errorMessage: args.errorMessage,
      status: "error",
    };
  }

  return {
    errorMessage: null,
    status: "ready",
  };
}

function shouldAutoRefreshWorkspace(args: {
  connected: boolean;
  hasAttemptedAutoRefresh: boolean;
  hasWorkspace: boolean;
  isLoadingWorkspaceData: boolean;
  isRefreshingWorkspace: boolean;
  showCredentialForm: boolean;
}) {
  if (!args.connected || args.showCredentialForm || args.hasWorkspace) {
    return false;
  }

  if (args.hasAttemptedAutoRefresh || args.isRefreshingWorkspace) {
    return false;
  }

  return !args.isLoadingWorkspaceData;
}

function shouldAutoRefreshLeagueIntel(args: {
  activeSection: WorkspaceSection;
  connected: boolean;
  freshnessStatus: "FRESH" | "UNAVAILABLE" | null;
  isLoadingWorkspaceData: boolean;
  isRefreshingWorkspace: boolean;
  showCredentialForm: boolean;
}) {
  if (
    args.activeSection !== "league" ||
    !args.connected ||
    args.showCredentialForm
  ) {
    return false;
  }

  if (args.freshnessStatus !== "UNAVAILABLE") {
    return false;
  }

  return !args.isLoadingWorkspaceData && !args.isRefreshingWorkspace;
}

export function useAuthenticatedWorkspace(args: {
  activeSection: WorkspaceSection;
  commercialModeEnabled: boolean;
}) {
  const queryClient = useQueryClient();
  const [hasAttemptedAutoRefresh, setHasAttemptedAutoRefresh] =
    useState(false);
  const [isRefreshingWorkspace, setIsRefreshingWorkspace] = useState(false);
  const [showCredentialForm, setShowCredentialForm] = useState(false);
  const [workspaceActionError, setWorkspaceActionError] = useState<
    string | null
  >(null);
  const requiredSections = sectionDependencies[args.activeSection];

  const connectionQuery = useQuery(connectionQueryOptions());
  const connected = connectionQuery.data?.status === "CONNECTED";

  const billingQuery = useQuery({
    ...billingSummaryQueryOptions(),
    enabled: args.commercialModeEnabled,
  });
  const homeQuery = useQuery({
    ...homeWorkspaceQueryOptions(),
    enabled: connected,
  });
  const lineupHelperQuery = useQuery({
    ...lineupHelperWorkspaceQueryOptions(),
    enabled: connected && requiredSections.includes("lineupHelper"),
  });
  const arenaQuery = useQuery({
    ...arenaWorkspaceQueryOptions(),
    enabled: connected && requiredSections.includes("arena"),
  });
  const leagueIntelQuery = useQuery({
    ...leagueIntelQueryOptions(),
    enabled: connected && requiredSections.includes("leagueIntel"),
  });
  const playerLabQuery = useQuery({
    ...playerLabQueryOptions(),
    enabled: connected && requiredSections.includes("playerLab"),
  });
  const disconnectMutation = useMutation({
    mutationFn: disconnectBbAccountMutation,
  });

  const baseIsLoadingWorkspaceData =
    connected &&
    (homeQuery.isPending ||
      (requiredSections.includes("arena") && arenaQuery.isPending) ||
      (requiredSections.includes("lineupHelper") &&
        lineupHelperQuery.isPending) ||
      (requiredSections.includes("leagueIntel") &&
        leagueIntelQuery.isPending) ||
      (requiredSections.includes("playerLab") && playerLabQuery.isPending));
  const shouldRunLeagueIntelAutoRefresh = shouldAutoRefreshLeagueIntel({
    activeSection: args.activeSection,
    connected,
    freshnessStatus: leagueIntelQuery.data?.freshnessStatus ?? null,
    isLoadingWorkspaceData: baseIsLoadingWorkspaceData,
    isRefreshingWorkspace,
    showCredentialForm,
  });
  const leagueIntelAutoRefreshQuery = useQuery({
    enabled: shouldRunLeagueIntelAutoRefresh,
    queryFn: () => refreshLeagueIntelWorkspace(queryClient),
    queryKey: workspaceQueryKeys.leagueIntelAutoRefresh,
    refetchInterval: (query) => {
      const data = query.state.data ?? leagueIntelQuery.data ?? null;
      if (data?.freshnessStatus !== "UNAVAILABLE") {
        return false;
      }

      return shouldRunLeagueIntelAutoRefresh
        ? LEAGUE_INTEL_AUTO_REFRESH_INTERVAL_MS
        : false;
    },
    retry: false,
  });

  useEffect(() => {
    if (connectionQuery.data?.status !== "CONNECTED") {
      setShowCredentialForm(false);
    }
  }, [connectionQuery.data?.status]);

  useEffect(() => {
    if (!connected) {
      setHasAttemptedAutoRefresh(false);
      setIsRefreshingWorkspace(false);
    }
  }, [connected]);

  const lineupHelperError = formatQueryErrorMessage(lineupHelperQuery.error);
  const lineupHelperDependencyState = resolveLineupHelperDependencyState({
    connected,
    errorMessage: lineupHelperError,
    isPending: lineupHelperQuery.isPending,
    required: requiredSections.includes("lineupHelper"),
  });

  const workspace = homeQuery.data
    ? createWorkspaceFromHome(homeQuery.data, {
        arena: arenaQuery.data ?? null,
        leagueIntel: leagueIntelQuery.data ?? null,
        lineupHelper: lineupHelperQuery.data ?? null,
        playerLab: playerLabQuery.data ?? null,
      })
    : null;

  const workspaceError =
    workspaceActionError ??
    formatQueryErrorMessage(homeQuery.error) ??
    (requiredSections.includes("arena")
      ? formatQueryErrorMessage(arenaQuery.error)
      : null) ??
    (requiredSections.includes("lineupHelper") ? lineupHelperError : null) ??
    (requiredSections.includes("leagueIntel")
      ? formatQueryErrorMessage(leagueIntelQuery.error)
      : null) ??
    (requiredSections.includes("leagueIntel")
      ? formatQueryErrorMessage(leagueIntelAutoRefreshQuery.error)
      : null) ??
    (requiredSections.includes("playerLab")
      ? formatQueryErrorMessage(playerLabQuery.error)
      : null);

  const isLoadingWorkspaceData =
    baseIsLoadingWorkspaceData || leagueIntelAutoRefreshQuery.isFetching;
  const isLoadingWorkspace =
    connected && (isLoadingWorkspaceData || isRefreshingWorkspace);
  const hasWorkspace = Boolean(workspace);

  async function loadConnection(): Promise<BbConnectionRecord | null> {
    try {
      return await queryClient.fetchQuery(connectionQueryOptions());
    } catch {
      return null;
    }
  }

  async function loadBilling(): Promise<BillingSummary | null> {
    if (!args.commercialModeEnabled) {
      return null;
    }

    try {
      return await queryClient.fetchQuery(billingSummaryQueryOptions());
    } catch {
      return null;
    }
  }

  async function loadWorkspace(force = false): Promise<void> {
    setWorkspaceActionError(null);
    const connection = await loadConnection();
    if (connection?.status !== "CONNECTED") {
      return;
    }

    if (force) {
      await refreshHomeWorkspace(queryClient);
      await Promise.all(
        requiredSections.map((sectionKey) =>
          refreshSharedWorkspaceSection(queryClient, sectionKey),
        ),
      );
      return;
    }

    await queryClient.ensureQueryData(homeWorkspaceQueryOptions());
    await Promise.all(
      requiredSections.map((sectionKey) => {
        if (sectionKey === "arena") {
          return queryClient.ensureQueryData(arenaWorkspaceQueryOptions());
        }
        if (sectionKey === "lineupHelper") {
          return queryClient.ensureQueryData(
            lineupHelperWorkspaceQueryOptions(),
          );
        }
        if (sectionKey === "leagueIntel") {
          return queryClient.ensureQueryData(leagueIntelQueryOptions());
        }

        return queryClient.ensureQueryData(playerLabQueryOptions());
      }),
    );
  }

  async function handleRefresh(): Promise<void> {
    setWorkspaceActionError(null);
    setIsRefreshingWorkspace(true);
    try {
      await loadWorkspace(true);
      await Promise.all([loadConnection(), loadBilling()]);
    } catch (error) {
      setWorkspaceActionError(formatClientError(error));
    } finally {
      setIsRefreshingWorkspace(false);
    }
  }

  const triggerAutoRefresh = useEffectEvent(() => {
    void handleRefresh();
  });

  useEffect(() => {
    if (
      !shouldAutoRefreshWorkspace({
        connected,
        hasAttemptedAutoRefresh,
        hasWorkspace,
        isLoadingWorkspaceData,
        isRefreshingWorkspace,
        showCredentialForm,
      })
    ) {
      return;
    }

    setHasAttemptedAutoRefresh(true);
    triggerAutoRefresh();
  }, [
    connected,
    hasAttemptedAutoRefresh,
    hasWorkspace,
    isLoadingWorkspaceData,
    isRefreshingWorkspace,
    showCredentialForm,
  ]);

  async function handleDisconnect(): Promise<void> {
    setWorkspaceActionError(null);

    try {
      await disconnectMutation.mutateAsync();
      queryClient.removeQueries({ queryKey: ["workspace"] });
      queryClient.removeQueries({ queryKey: ["billing"] });
      setShowCredentialForm(false);
      await loadConnection();
    } catch (error) {
      setWorkspaceActionError(formatClientError(error));
    }
  }

  return {
    billingError: args.commercialModeEnabled
      ? formatQueryErrorMessage(billingQuery.error)
      : COMMERCIAL_MODE_DISABLED_SENTINEL,
    billingSummary: billingQuery.data ?? null,
    connected,
    connection: connectionQuery.data ?? null,
    connectionError: formatQueryErrorMessage(connectionQuery.error),
    handleDisconnect,
    handleRefresh,
    isDisconnecting: disconnectMutation.isPending,
    isLoadingBilling: args.commercialModeEnabled
      ? billingQuery.isPending
      : false,
    isLoadingConnection: connectionQuery.isPending,
    isLoadingWorkspace,
    lineupHelperDependencyState,
    loadConnection,
    loadWorkspace,
    setShowCredentialForm,
    showCredentialForm,
    workspace,
    workspaceError,
  };
}

export const __testing = {
  createWorkspaceFromHome,
  resolveLineupHelperDependencyState,
  shouldAutoRefreshLeagueIntel,
  shouldAutoRefreshWorkspace,
};
