"use client";

import { useEffect, useEffectEvent, useState } from "react";

import { client } from "@/app/amplify-client";
import { fetchBillingSummary } from "@/app/billing-client";
import {
  COMMERCIAL_MODE_DISABLED_SENTINEL,
  formatAmplifyErrors,
  formatClientError,
} from "@/app/dashboard/remote-errors";
import type {
  BillingSummary,
  BbConnectionRecord,
  DashboardWorkspace,
} from "@/app/types";

export function useAuthenticatedWorkspace(args: {
  commercialModeEnabled: boolean;
}) {
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(
    null,
  );
  const [connection, setConnection] = useState<BbConnectionRecord | null>(null);
  const [workspace, setWorkspace] = useState<DashboardWorkspace | null>(null);
  const [billingError, setBillingError] = useState<string | null>(
    args.commercialModeEnabled ? null : COMMERCIAL_MODE_DISABLED_SENTINEL,
  );
  const [isLoadingBilling, setIsLoadingBilling] = useState(
    args.commercialModeEnabled,
  );
  const [isLoadingConnection, setIsLoadingConnection] = useState(true);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [showCredentialForm, setShowCredentialForm] = useState(false);

  async function loadConnection(): Promise<BbConnectionRecord | null> {
    setIsLoadingConnection(true);
    setConnectionError(null);

    const { data, errors } = await client.reads.getCurrentBbConnection();

    if (errors?.length) {
      setConnection(null);
      setConnectionError(formatAmplifyErrors(errors));
      setIsLoadingConnection(false);
      return null;
    }

    const record = data ?? null;
    setConnection(record);
    setIsLoadingConnection(false);
    return record;
  }

  async function loadBilling(): Promise<BillingSummary | null> {
    if (!args.commercialModeEnabled) {
      setBillingSummary(null);
      setBillingError(COMMERCIAL_MODE_DISABLED_SENTINEL);
      setIsLoadingBilling(false);
      return null;
    }

    setIsLoadingBilling(true);
    setBillingError(null);

    try {
      const summary = await fetchBillingSummary();
      setBillingSummary(summary);
      setIsLoadingBilling(false);
      return summary;
    } catch (error) {
      setBillingSummary(null);
      setBillingError(formatClientError(error));
      setIsLoadingBilling(false);
      return null;
    }
  }

  async function loadWorkspace(force = false): Promise<void> {
    setIsLoadingWorkspace(true);
    setWorkspaceError(null);

    const homeResponse = force
      ? await client.mutations.refreshWorkspace()
      : await client.queries.getHomeWorkspace();

    if (homeResponse.errors?.length || !homeResponse.data) {
      setWorkspace(null);
      setWorkspaceError(formatAmplifyErrors(homeResponse.errors));
      setIsLoadingWorkspace(false);
      return;
    }

    const [
      lineupHelperResponse,
      scoutResponse,
      leagueIntelResponse,
      playerLabResponse,
    ] = await Promise.all([
      client.queries.getLineupHelperWorkspace(),
      client.queries.getScoutWorkspace({}),
      client.queries.getLeagueIntel(),
      client.queries.getPlayerLab(),
    ]);

    const allErrors = [
      ...(lineupHelperResponse.errors ?? []),
      ...(scoutResponse.errors ?? []),
      ...(leagueIntelResponse.errors ?? []),
      ...(playerLabResponse.errors ?? []),
    ];

    if (
      allErrors.length ||
      !lineupHelperResponse.data ||
      !scoutResponse.data ||
      !leagueIntelResponse.data ||
      !playerLabResponse.data
    ) {
      setWorkspace(null);
      setWorkspaceError(formatAmplifyErrors(allErrors));
      setIsLoadingWorkspace(false);
      return;
    }

    setWorkspace({
      home: homeResponse.data,
      lineupHelper: lineupHelperResponse.data,
      scout: scoutResponse.data,
      leagueIntel: leagueIntelResponse.data,
      playerLab: playerLabResponse.data,
      syncedAt: homeResponse.data.syncedAt ?? null,
    });
    setIsLoadingWorkspace(false);
  }

  const initializeWorkspaceEffect = useEffectEvent(
    async (isCancelled: () => boolean) => {
      const [record] = await Promise.all([loadConnection(), loadBilling()]);
      if (isCancelled()) {
        return;
      }

      if (record?.status === "CONNECTED") {
        await loadWorkspace(false);
      } else {
        setWorkspace(null);
      }
    },
  );

  useEffect(() => {
    let cancelled = false;
    void initializeWorkspaceEffect(() => cancelled);

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleRefresh(): Promise<void> {
    await loadWorkspace(true);
    await loadConnection();
    await loadBilling();
  }

  async function handleDisconnect(): Promise<void> {
    setIsDisconnecting(true);

    const result = await client.mutations.disconnectBbAccount();
    if (result.errors?.length) {
      setWorkspaceError(formatAmplifyErrors(result.errors));
      setIsDisconnecting(false);
      return;
    }

    setWorkspace(null);
    setShowCredentialForm(false);
    await loadConnection();
    setIsDisconnecting(false);
  }

  return {
    billingError,
    billingSummary,
    connected: connection?.status === "CONNECTED",
    connection,
    connectionError,
    handleDisconnect,
    handleRefresh,
    isDisconnecting,
    isLoadingBilling,
    isLoadingConnection,
    isLoadingWorkspace,
    loadConnection,
    loadWorkspace,
    setShowCredentialForm,
    setWorkspace,
    showCredentialForm,
    workspace,
    workspaceError,
  };
}
