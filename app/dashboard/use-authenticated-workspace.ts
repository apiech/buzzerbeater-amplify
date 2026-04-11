"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { client } from "@/app/amplify-client";
import {
  COMMERCIAL_MODE_DISABLED_SENTINEL,
  formatAmplifyErrors,
  formatClientError,
} from "@/app/dashboard/remote-errors";
import {
  billingSummaryQueryOptions,
  connectionQueryOptions,
  homeWorkspaceQueryOptions,
  leagueIntelQueryOptions,
  lineupHelperWorkspaceQueryOptions,
  playerLabQueryOptions,
  refreshHomeWorkspace,
  refreshSharedWorkspaceSection,
} from "@/app/dashboard/workspace-query-client";
import type {
  BillingSummary,
  BbConnectionRecord,
  DashboardWorkspace,
  HomeWorkspacePayload,
} from "@/app/types";
import type { WorkspaceSection } from "@/app/workspace-sections";

type WorkspaceExtraSectionKey = "lineupHelper" | "leagueIntel" | "playerLab";

const sectionDependencies: Record<WorkspaceSection, WorkspaceExtraSectionKey[]> = {
  highlights: [],
  home: ["lineupHelper"],
  league: ["leagueIntel"],
  "league-history": [],
  lineups: ["lineupHelper"],
  ops: [],
  players: ["playerLab"],
  predictions: [],
  recaps: [],
  rivals: [],
  scout: [],
};

function createWorkspaceFromHome(
  home: HomeWorkspacePayload,
  sections: {
    leagueIntel?: DashboardWorkspace["leagueIntel"];
    lineupHelper?: DashboardWorkspace["lineupHelper"];
    playerLab?: DashboardWorkspace["playerLab"];
  },
): DashboardWorkspace {
  return {
    home,
    leagueIntel: sections.leagueIntel ?? null,
    lineupHelper: sections.lineupHelper ?? null,
    playerLab: sections.playerLab ?? null,
    scout: null,
    syncedAt: home.syncedAt ?? null,
  };
}

function formatQueryErrorMessage(error: unknown): string | null {
  if (!error) {
    return null;
  }

  return formatClientError(error);
}

export function useAuthenticatedWorkspace(args: {
  activeSection: WorkspaceSection;
  commercialModeEnabled: boolean;
}) {
  const queryClient = useQueryClient();
  const [showCredentialForm, setShowCredentialForm] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [workspaceActionError, setWorkspaceActionError] = useState<string | null>(
    null,
  );
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
  const leagueIntelQuery = useQuery({
    ...leagueIntelQueryOptions(),
    enabled: connected && requiredSections.includes("leagueIntel"),
  });
  const playerLabQuery = useQuery({
    ...playerLabQueryOptions(),
    enabled: connected && requiredSections.includes("playerLab"),
  });

  useEffect(() => {
    if (connectionQuery.data?.status !== "CONNECTED") {
      setShowCredentialForm(false);
    }
  }, [connectionQuery.data?.status]);

  const workspace = homeQuery.data
    ? createWorkspaceFromHome(homeQuery.data, {
        leagueIntel: leagueIntelQuery.data ?? null,
        lineupHelper: lineupHelperQuery.data ?? null,
        playerLab: playerLabQuery.data ?? null,
      })
    : null;

  const workspaceError =
    workspaceActionError ??
    formatQueryErrorMessage(homeQuery.error) ??
    (requiredSections.includes("lineupHelper")
      ? formatQueryErrorMessage(lineupHelperQuery.error)
      : null) ??
    (requiredSections.includes("leagueIntel")
      ? formatQueryErrorMessage(leagueIntelQuery.error)
      : null) ??
    (requiredSections.includes("playerLab")
      ? formatQueryErrorMessage(playerLabQuery.error)
      : null);

  const isLoadingWorkspace =
    connected &&
    (homeQuery.isPending ||
      (requiredSections.includes("lineupHelper") && lineupHelperQuery.isPending) ||
      (requiredSections.includes("leagueIntel") && leagueIntelQuery.isPending) ||
      (requiredSections.includes("playerLab") && playerLabQuery.isPending));

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
        if (sectionKey === "lineupHelper") {
          return queryClient.ensureQueryData(lineupHelperWorkspaceQueryOptions());
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
    try {
      await loadWorkspace(true);
      await Promise.all([loadConnection(), loadBilling()]);
    } catch (error) {
      setWorkspaceActionError(formatClientError(error));
    }
  }

  async function handleDisconnect(): Promise<void> {
    setIsDisconnecting(true);
    setWorkspaceActionError(null);

    const result = await client.mutations.disconnectBbAccount();
    if (result.errors?.length) {
      setWorkspaceActionError(formatAmplifyErrors(result.errors));
      setIsDisconnecting(false);
      return;
    }

    queryClient.removeQueries({ queryKey: ["workspace"] });
    queryClient.removeQueries({ queryKey: ["billing"] });
    setShowCredentialForm(false);
    await loadConnection();
    setIsDisconnecting(false);
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
    isDisconnecting,
    isLoadingBilling: args.commercialModeEnabled ? billingQuery.isPending : false,
    isLoadingConnection: connectionQuery.isPending,
    isLoadingWorkspace,
    loadConnection,
    loadWorkspace,
    setShowCredentialForm,
    showCredentialForm,
    workspace,
    workspaceError,
  };
}
