"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { client } from "@/app/amplify-client";
import { BillingPanel, PremiumFeatureGatePanel } from "@/app/billing-panel";
import { fetchBillingSummary } from "@/app/billing-client";
import { HighlightsPanel } from "@/app/highlights-panel";
import { LeagueHistoryPanel } from "@/app/league-history-panel";
import { LineupHelper } from "@/app/lineup-helper";
import { OperationsPanel } from "@/app/operations-panel";
import {
  applyForecastScenarioToDraft,
  createDefaultPredictionDraft,
  readPredictionDraftFromStorage,
  reconcilePredictionDraft,
  writePredictionDraftToStorage,
} from "@/app/prediction-panel-state";
import { PredictionPanel } from "@/app/prediction-panel";
import { RecapPanel } from "@/app/recap-panel";
import { RivalsPanel } from "@/app/rivals-panel";
import type {
  BillingSummary,
  BbConnectionRecord,
  ConnectBbAccountInput,
  ConnectBbAccountResult,
  DashboardWorkspace,
  LineupHelperRosterPlayer,
  OpponentForecastSnapshot,
  PredictionDraftState,
  PlayerSummary,
  PlayerTrendPayload,
  SalaryProjection,
  ScoutWorkspacePayload,
  TrendCountEntry,
} from "@/app/types";
import { Alert } from "@/app/ui/primitives/alert";
import { BuzzerBeaterRatingText } from "@/app/ui/primitives/buzzerbeater-rating-text";
import { Button } from "@/app/ui/primitives/button";
import { cn } from "@/app/ui/primitives/cn";
import { Field, Input, Select } from "@/app/ui/primitives/field";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";
import { StatCard } from "@/app/ui/primitives/stat-card";
import {
  StatusBadge,
  statusToneFromValue,
} from "@/app/ui/primitives/status-badge";
import {
  TableCell,
  TableHeadCell,
  TableShell,
} from "@/app/ui/primitives/table-shell";
import { PlayerTrendChart } from "@/app/ui/workspace/player-trend-chart";
import { ThemeSelect } from "@/app/ui/theme/theme-select";
import { WorkspaceRouteNav } from "@/app/ui/workspace/workspace-route-nav";
import { formatConnectionStatus } from "@/app/ui/presentation";
import { hasFeature } from "@/lib/billing/plans";
import { type WorkspaceSection } from "@/app/workspace-sections";

type ConnectionFormState = ConnectBbAccountInput;
type OwnerRosterSkillKey = keyof LineupHelperRosterPlayer["skills"];
type OwnerRosterSortKey =
  | "player"
  | "pos"
  | "age"
  | "salary"
  | "shape"
  | "dmi"
  | OwnerRosterSkillKey;

const twoColumnGridClassName = "grid gap-4 xl:grid-cols-2";
const summaryGridClassName = "grid gap-4 sm:grid-cols-2 xl:grid-cols-4";
const statusCopyClassName = "text-sm leading-7 text-ink-muted";
const listClassName = "grid list-none gap-3 p-0";
const listItemClassName =
  "grid gap-1 border-b border-black/8 pb-3 last:border-b-0 last:pb-0";
const listRowClassName =
  "flex flex-wrap items-start justify-between gap-3 border-b border-black/8 pb-3 last:border-b-0 last:pb-0";
const listCopyClassName = "grid gap-1";
const mutedMetaClassName = "text-xs font-semibold text-ink-muted";
const boxscoreLinkClassName =
  "inline-flex min-h-9 items-center justify-center rounded-full border border-border-soft bg-white/70 px-3.5 text-xs font-semibold text-ink shadow-sm transition duration-150 hover:-translate-y-px hover:border-accent/35 hover:bg-white/90";
const numericTableCellClassName = "text-right tabular-nums";
const numericTableHeadClassName = "text-right";
const ownerRosterSkillColumns = [
  { key: "js", label: "JS" },
  { key: "jr", label: "JR" },
  { key: "od", label: "OD" },
  { key: "ha", label: "HA" },
  { key: "dr", label: "DR" },
  { key: "pa", label: "PA" },
  { key: "is", label: "IS" },
  { key: "id", label: "ID" },
  { key: "rb", label: "RB" },
  { key: "sb", label: "SB" },
  { key: "st", label: "ST" },
  { key: "ft", label: "FT" },
  { key: "ex", label: "EX" },
  { key: "gs", label: "GS" },
] as const satisfies ReadonlyArray<{
  key: OwnerRosterSkillKey;
  label: string;
}>;
const terminalOpponentForecastStatuses = new Set(["SUCCEEDED", "FAILED"]);

export default function DashboardHomePage() {
  return <DashboardApp activeSection="home" viewerLabel={null} />;
}

export function DashboardApp({
  activeSection,
  viewerLabel,
}: {
  activeSection: WorkspaceSection;
  viewerLabel: string | null;
}) {
  return (
    <main className="grid min-h-screen gap-6 p-4 sm:p-6">
      <AuthenticatedWorkspace
        activeSection={activeSection}
        viewerLabel={viewerLabel}
      />
    </main>
  );
}

function AuthenticatedWorkspace({
  activeSection,
  viewerLabel,
}: {
  activeSection: WorkspaceSection;
  viewerLabel: string | null;
}) {
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(
    null,
  );
  const [connection, setConnection] = useState<BbConnectionRecord | null>(null);
  const [workspace, setWorkspace] = useState<DashboardWorkspace | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [isLoadingBilling, setIsLoadingBilling] = useState(true);
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

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      const [record] = await Promise.all([loadConnection(), loadBilling()]);
      if (cancelled) {
        return;
      }

      if (record?.status === "CONNECTED") {
        await loadWorkspace(false);
      } else {
        setWorkspace(null);
      }
    }

    void initialize();

    return () => {
      cancelled = true;
    };
  }, []);

  const connected = connection?.status === "CONNECTED";
  const viewerLabelText = viewerLabel ?? "Signed in";

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

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
      <WorkspaceRouteNav
        accountActions={
          <>
            <div className="grid gap-1">
              <p className="text-ink-muted m-0 text-[0.72rem] font-bold tracking-[0.16em] uppercase">
                Signed in
              </p>
              <strong className="text-ink text-sm">{viewerLabelText}</strong>
            </div>
            <Link
              className="border-border-soft bg-surface-strong text-ink hover:border-accent/25 hover:text-accent inline-flex min-h-11 items-center justify-center rounded-full border px-4 text-sm font-semibold shadow-sm transition hover:-translate-y-px"
              href="/api/auth/sign-out"
            >
              Sign out
            </Link>
          </>
        }
        activeSection={activeSection}
        currentTeamName={
          workspace?.home.team.teamName ?? connection?.teamName ?? null
        }
        currentTeamRecord={
          workspace
            ? `Record ${formatRecord(workspace.home.team.record)}`
            : (connection?.leagueName ?? "Connect a club to see team context.")
        }
        nextOpponentName={workspace?.home.nextMatch?.opponentTeamName ?? null}
        secondaryActions={<ThemeSelect />}
      />

      <main className="grid gap-4">
        {isLoadingConnection ? (
          <Panel>
            <SectionHeading title="Checking your club link" titleAs="h4" />
            <p className={statusCopyClassName}>
              Looking up your saved BuzzerBeater connection.
            </p>
          </Panel>
        ) : connectionError ? (
          <Panel variant="danger">
            <SectionHeading title="Club link unavailable" titleAs="h4" />
            <p className={statusCopyClassName}>{connectionError}</p>
          </Panel>
        ) : !connected || showCredentialForm ? (
          <ConnectionOnboarding
            connection={connection}
            onCancel={
              connected ? () => setShowCredentialForm(false) : undefined
            }
            onConnected={async (status) => {
              await loadConnection();
              if (status === "CONNECTED") {
                setShowCredentialForm(false);
                await loadWorkspace(false);
              } else {
                setWorkspace(null);
              }
            }}
          />
        ) : (
          <>
            <Panel>
              <SectionHeading
                actions={
                  <>
                    <StatusBadge tone={statusToneFromValue(connection.status)}>
                      {formatConnectionStatus(connection.status)}
                    </StatusBadge>
                    <Button
                      loading={isLoadingWorkspace}
                      onClick={() => void handleRefresh()}
                    >
                      Refresh club data
                    </Button>
                    <Button
                      onClick={() => setShowCredentialForm(true)}
                      variant="secondary"
                    >
                      Update credentials
                    </Button>
                    <Button
                      loading={isDisconnecting}
                      onClick={() => void handleDisconnect()}
                      variant="secondary"
                    >
                      Disconnect club
                    </Button>
                  </>
                }
                eyebrow="Club connection"
                title={connection.teamName ?? "Connected club"}
              />

              <div className={summaryGridClassName}>
                <StatCard
                  detail="Used for your BuzzerBeater connection."
                  label="Login name"
                  value={connection.bbLoginName || "Not set"}
                />
                <StatCard
                  detail={
                    [connection.leagueName, connection.countryName]
                      .filter(Boolean)
                      .join(" • ") || "Club details update after refresh."
                  }
                  label="Club"
                  value={connection.teamName ?? "Connected club"}
                />
                <StatCard
                  detail={
                    connection.lastValidatedAt
                      ? `Last checked ${formatTimestamp(connection.lastValidatedAt)}`
                      : "No validation has run yet."
                  }
                  label="Connection health"
                  value={formatConnectionStatus(connection.status)}
                />
                <StatCard
                  detail={
                    connection.lastSyncError ?? "Club data is up to date."
                  }
                  label="Latest refresh"
                  value={
                    (workspace?.syncedAt ?? connection.lastSyncAt)
                      ? formatTimestamp(
                          workspace?.syncedAt ?? connection.lastSyncAt,
                        )
                      : "Waiting to refresh"
                  }
                />
              </div>

              {workspaceError ? <Alert>{workspaceError}</Alert> : null}
            </Panel>

            {isLoadingWorkspace && !workspace ? (
              <Panel>
                <SectionHeading title="Building your club view" titleAs="h4" />
                <p className={statusCopyClassName}>
                  Pulling your team, next opponent, league table, and player
                  history.
                </p>
              </Panel>
            ) : workspace ? (
              <WorkspaceDashboard
                activeSection={activeSection}
                billingError={billingError}
                billingSummary={billingSummary}
                isLoadingBilling={isLoadingBilling}
                workspace={workspace}
              />
            ) : (
              <Panel>
                <SectionHeading
                  title="Your club is ready to load"
                  titleAs="h4"
                />
                <p className={statusCopyClassName}>
                  Refresh your club link or reconnect your BuzzerBeater account
                  to start filling in the companion view.
                </p>
              </Panel>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function ConnectionOnboarding({
  connection,
  onConnected,
  onCancel,
}: {
  connection: BbConnectionRecord | null;
  onConnected: (status: ConnectBbAccountResult["status"]) => Promise<void>;
  onCancel?: () => void;
}) {
  const [formState, setFormState] = useState<ConnectionFormState>({
    bbLoginName: connection?.bbLoginName ?? "",
    accessKey: "",
  });
  const [submitError, setSubmitError] = useState<string | null>(
    connection?.lastSyncError ?? null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setFormState({
      bbLoginName: connection?.bbLoginName ?? "",
      accessKey: "",
    });
    setSubmitError(connection?.lastSyncError ?? null);
  }, [connection?.bbLoginName, connection?.lastSyncError]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);

    const result = await client.mutations.connectBbAccount({
      bbLoginName: formState.bbLoginName.trim(),
      accessKey: formState.accessKey.trim(),
    });

    if (result.errors?.length || !result.data) {
      setSubmitError(formatAmplifyErrors(result.errors));
      setIsSubmitting(false);
      return;
    }

    if (result.data.status !== "CONNECTED") {
      setSubmitError(
        result.data.lastSyncError ?? "Unable to validate those credentials.",
      );
      setIsSubmitting(false);
      await onConnected(result.data.status);
      return;
    }

    await onConnected(result.data.status);
    setIsSubmitting(false);
  }

  return (
    <Panel>
      <SectionHeading
        description={
          <>
            Enter your BuzzerBeater login name and access key. The app checks
            them right away, stores the key securely, and starts your first club
            refresh.
          </>
        }
        eyebrow="Connect BuzzerBeater"
        title={
          connection?.status === "CONNECTED"
            ? "Replace or revalidate your credentials."
            : "Unlock your club companion."
        }
      />

      <form
        className="grid gap-4"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <Field label="BuzzerBeater login name">
          <Input
            onChange={(event) =>
              setFormState((current) => ({
                ...current,
                bbLoginName: event.target.value,
              }))
            }
            placeholder="apiech"
            required
            value={formState.bbLoginName}
          />
        </Field>
        <Field label="Access key">
          <Input
            onChange={(event) =>
              setFormState((current) => ({
                ...current,
                accessKey: event.target.value,
              }))
            }
            placeholder="Enter your BuzzerBeater access key"
            required
            type="password"
            value={formState.accessKey}
          />
        </Field>

        {submitError ? <Alert>{submitError}</Alert> : null}

        <div className="flex flex-wrap gap-3">
          <Button loading={isSubmitting} type="submit">
            Connect and refresh
          </Button>
          {onCancel ? (
            <Button onClick={onCancel} variant="secondary">
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
    </Panel>
  );
}

function WorkspaceDashboard({
  activeSection,
  billingError,
  billingSummary,
  isLoadingBilling,
  workspace,
}: {
  activeSection: WorkspaceSection;
  billingError: string | null;
  billingSummary: BillingSummary | null;
  isLoadingBilling: boolean;
  workspace: DashboardWorkspace;
}) {
  const router = useRouter();
  const home = workspace.home;
  const [scout, setScout] = useState(workspace.scout);
  const [selectedScoutTeamId, setSelectedScoutTeamId] = useState(
    workspace.scout.requestedTeamId ?? workspace.scout.teamId ?? "",
  );
  const [scoutError, setScoutError] = useState<string | null>(null);
  const [isLoadingScout, setIsLoadingScout] = useState(false);
  const [playerTrend, setPlayerTrend] = useState<PlayerTrendPayload | null>(
    null,
  );
  const [playerTrendError, setPlayerTrendError] = useState<string | null>(null);
  const [loadingTrendPlayerId, setLoadingTrendPlayerId] = useState<
    string | null
  >(null);
  const [salaryProjection, setSalaryProjection] =
    useState<SalaryProjection | null>(null);
  const [salaryProjectionError, setSalaryProjectionError] = useState<
    string | null
  >(null);
  const [loadingSalaryPlayerId, setLoadingSalaryPlayerId] = useState<
    string | null
  >(null);
  const [opponentForecast, setOpponentForecast] =
    useState<OpponentForecastSnapshot | null>(null);
  const [opponentForecastError, setOpponentForecastError] = useState<
    string | null
  >(null);
  const [isLoadingOpponentForecast, setIsLoadingOpponentForecast] =
    useState(false);
  const [isRefreshingOpponentForecast, setIsRefreshingOpponentForecast] =
    useState(false);
  const didRestorePredictionDraftRef = useRef(false);
  const [predictionDraft, setPredictionDraft] = useState<PredictionDraftState>(
    () => createDefaultPredictionDraft(workspace),
  );
  const loadLatestOpponentForecastEffect = useEffectEvent((teamId: string) => {
    void loadLatestOpponentForecast(teamId);
  });

  useEffect(() => {
    setScout(workspace.scout);
    setSelectedScoutTeamId(
      workspace.scout.requestedTeamId ?? workspace.scout.teamId ?? "",
    );
    setScoutError(null);
    setOpponentForecast(null);
    setOpponentForecastError(null);
  }, [workspace.scout]);

  useEffect(() => {
    if (didRestorePredictionDraftRef.current) {
      return;
    }
    didRestorePredictionDraftRef.current = true;

    const storedDraft = readPredictionDraftFromStorage(
      typeof window === "undefined" ? null : window.sessionStorage,
      {
        ...workspace,
        scout,
      },
    );
    if (!storedDraft) {
      return;
    }
    setPredictionDraft(storedDraft);
  }, [scout, workspace]);

  useEffect(() => {
    const teamId = resolveForecastTeamId(scout);
    if (!teamId) {
      setOpponentForecast(null);
      setOpponentForecastError(null);
      return;
    }

    loadLatestOpponentForecastEffect(teamId);
  }, [scout]);

  useEffect(() => {
    const teamId = resolveForecastTeamId(scout);
    if (!teamId) {
      return;
    }

    if (
      !opponentForecast ||
      isOpponentForecastTerminalStatus(opponentForecast.status)
    ) {
      return;
    }

    const intervalId = window.setInterval(() => {
      loadLatestOpponentForecastEffect(teamId);
    }, 4000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [opponentForecast, scout]);

  useEffect(() => {
    setPredictionDraft((current) =>
      reconcilePredictionDraft(
        {
          ...workspace,
          scout,
        },
        current,
      ),
    );
  }, [scout, workspace]);

  useEffect(() => {
    writePredictionDraftToStorage(
      typeof window === "undefined" ? null : window.sessionStorage,
      predictionDraft,
    );
  }, [predictionDraft]);

  const displayWorkspace = {
    ...workspace,
    scout,
  };
  const billingPlanId =
    billingSummary?.planId === "premium" ? "premium" : "free";
  const canUsePredictions = billingSummary
    ? hasFeature(billingPlanId, "predictions")
    : false;
  const canUseLeagueWriteups = billingSummary
    ? hasFeature(billingPlanId, "leagueWriteups")
    : false;
  const canUseTeamHighlights = billingSummary
    ? hasFeature(billingPlanId, "teamHighlights")
    : false;

  function handleUseScenarioInPreview(
    scenario: NonNullable<
      NonNullable<OpponentForecastSnapshot["result"]>
    >["topScenarios"][number],
  ) {
    const sourceTeamId = resolveForecastTeamId(scout);
    if (!sourceTeamId || !opponentForecast) {
      return;
    }

    const nextDraft = applyForecastScenarioToDraft({
      draft: predictionDraft,
      scenario,
      snapshot: opponentForecast,
      sourceTeamId,
      workspace: displayWorkspace,
    });
    writePredictionDraftToStorage(
      typeof window === "undefined" ? null : window.sessionStorage,
      nextDraft,
    );
    setPredictionDraft(nextDraft);
    router.push("/workspace/predictions");
  }

  async function handleScoutLoad() {
    if (!selectedScoutTeamId) {
      return;
    }

    setIsLoadingScout(true);
    setScoutError(null);

    const response = await client.queries.getScoutWorkspace({
      teamId: selectedScoutTeamId,
    });

    if (response.errors?.length || !response.data) {
      setScoutError(formatAmplifyErrors(response.errors));
      setIsLoadingScout(false);
      return;
    }

    setScout(response.data);
    const teamId = resolveForecastTeamId(response.data);
    if (teamId) {
      void loadLatestOpponentForecast(teamId);
    } else {
      setOpponentForecast(null);
      setOpponentForecastError(null);
    }
    setIsLoadingScout(false);
  }

  async function loadLatestOpponentForecast(teamId: string) {
    setIsLoadingOpponentForecast(true);
    setOpponentForecastError(null);

    try {
      const response = await client.queries.getLatestOpponentForecast({
        teamId,
      });

      if (response.errors?.length) {
        setOpponentForecast(null);
        setOpponentForecastError(formatAmplifyErrors(response.errors));
        setIsLoadingOpponentForecast(false);
        return;
      }

      setOpponentForecast(response.data ?? null);
      setIsLoadingOpponentForecast(false);
    } catch (error) {
      setOpponentForecast(null);
      setOpponentForecastError(formatClientError(error));
      setIsLoadingOpponentForecast(false);
    }
  }

  async function handleRefreshOpponentForecast() {
    const teamId = resolveForecastTeamId(scout);
    if (!teamId) {
      return;
    }

    setIsRefreshingOpponentForecast(true);
    setOpponentForecastError(null);

    try {
      const response = await client.mutations.submitOpponentForecastJob({
        teamId,
      });
      if (response.errors?.length) {
        setOpponentForecastError(formatAmplifyErrors(response.errors));
        setIsRefreshingOpponentForecast(false);
        return;
      }

      await loadLatestOpponentForecast(teamId);
    } catch (error) {
      setOpponentForecastError(formatClientError(error));
    } finally {
      setIsRefreshingOpponentForecast(false);
    }
  }

  async function handleLoadPlayerTrend(player: PlayerSummary) {
    if (!player.playerId) {
      return;
    }

    setLoadingTrendPlayerId(player.playerId);
    setPlayerTrendError(null);

    const response = await client.queries.getPlayerTrend({
      playerId: player.playerId,
    });

    if (response.errors?.length || !response.data) {
      setPlayerTrend(null);
      setPlayerTrendError(formatAmplifyErrors(response.errors));
      setLoadingTrendPlayerId(null);
      return;
    }

    setPlayerTrend(response.data);
    setLoadingTrendPlayerId(null);
  }

  async function handleLoadSalaryProjection(player: PlayerSummary) {
    if (!player.playerId) {
      return;
    }

    setLoadingSalaryPlayerId(player.playerId);
    setSalaryProjectionError(null);

    const response = await client.queries.getSalaryProjection({
      playerId: player.playerId,
    });

    if (response.errors?.length || !response.data) {
      setSalaryProjection(null);
      setSalaryProjectionError(formatAmplifyErrors(response.errors));
      setLoadingSalaryPlayerId(null);
      return;
    }

    setSalaryProjection(response.data);
    setLoadingSalaryPlayerId(null);
  }

  return (
    <>
      {activeSection === "home" ? (
        <Panel>
          <SectionHeading
            eyebrow="My Team"
            title={home.team.teamName ?? "Club overview"}
          />

          <div className={summaryGridClassName}>
            <StatCard
              detail={home.team.shortName ?? "Current club"}
              label="Record"
              value={formatRecord(home.team.record)}
            />
            <StatCard
              detail={
                home.nextMatch
                  ? `${formatMatchVenue(home.nextMatch.isHome)} • ${formatTimestamp(home.nextMatch.startTime)}`
                  : "No future game is listed yet."
              }
              label="Next matchup"
              value={home.nextMatch?.opponentTeamName ?? "No upcoming game"}
            />
            <StatCard
              detail={
                home.nextOpponent?.record
                  ? `Record ${formatRecord(home.nextOpponent.record)}`
                  : "No opponent data available."
              }
              label="Next opponent"
              value={home.nextOpponent?.teamName ?? "No opponent"}
            />
            <StatCard
              detail={
                home.team.injuries.length
                  ? `${home.team.injuries[0]?.fullName ?? "Player"} needs attention`
                  : "Full roster available."
              }
              label="Current injuries"
              value={String(home.team.injuries.length)}
            />
          </div>

          <div className={twoColumnGridClassName}>
            <Panel as="article" padding="sm" variant="solid">
              <SectionHeading title="Core rotation" titleAs="h4" />
              <ul className={listClassName}>
                {home.team.topPlayers.length ? (
                  home.team.topPlayers.map((player) => (
                    <li
                      className={listItemClassName}
                      key={player.playerId ?? player.fullName}
                    >
                      <strong className="text-ink text-sm">
                        {player.fullName}
                      </strong>
                      <span className={statusCopyClassName}>
                        {formatPlayerMeta(player)}
                      </span>
                    </li>
                  ))
                ) : (
                  <li className="text-ink-muted text-sm">
                    No rotation data is available yet.
                  </li>
                )}
              </ul>
            </Panel>

            <Panel as="article" padding="sm" variant="solid">
              <SectionHeading title="Recent results" titleAs="h4" />
              <ul className={listClassName}>
                {home.recentMatches.length ? (
                  home.recentMatches.map((match) => (
                    <li
                      className={listRowClassName}
                      key={
                        match.matchId ??
                        `${match.startTime}-${match.opponentTeamName}`
                      }
                    >
                      <div className={listCopyClassName}>
                        <strong className="text-ink text-sm">
                          {match.opponentTeamName ?? "Unknown opponent"}
                        </strong>
                        <span className={statusCopyClassName}>
                          {formatMatchResult(match)}
                        </span>
                      </div>
                      {match.matchId && match.hasBoxscore ? (
                        <BoxscoreLink matchId={match.matchId} />
                      ) : (
                        <span className={mutedMetaClassName}>
                          Box score not ready
                        </span>
                      )}
                    </li>
                  ))
                ) : (
                  <li className="text-ink-muted text-sm">
                    No completed games are ready yet.
                  </li>
                )}
              </ul>
            </Panel>
          </div>
        </Panel>
      ) : null}

      {activeSection === "home" ? (
        <Panel>
          <SectionHeading
            eyebrow="Roster"
            title="Owner roster and lineup context"
          />
          <HomeOwnerRosterTable roster={workspace.lineupHelper.roster} />
        </Panel>
      ) : null}

      {activeSection === "lineups" ? (
        <Panel>
          <SectionHeading
            eyebrow="Lineups"
            title="Lineup helper and rating outputs"
          />
          <LineupHelper />
        </Panel>
      ) : null}

      {activeSection === "scout" ? (
        <Panel>
          <SectionHeading
            actions={
              <>
                <Field className="w-full md:min-w-80" label="View team">
                  <Select
                    onChange={(event) =>
                      setSelectedScoutTeamId(event.target.value)
                    }
                    value={selectedScoutTeamId}
                  >
                    <option value="">Select a league team</option>
                    {scout.availableOpponents.map((opponent) => (
                      <option
                        key={opponent.teamId ?? opponent.teamName ?? "unknown"}
                        value={opponent.teamId ?? ""}
                      >
                        {opponent.teamName ?? "Unknown team"}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button
                  disabled={!selectedScoutTeamId}
                  loading={isLoadingScout}
                  onClick={() => void handleScoutLoad()}
                  variant="secondary"
                >
                  Open team view
                </Button>
              </>
            }
            eyebrow="Opponents"
            title={scout.summary?.teamName ?? "Opponent and team view"}
          />
          {scoutError ? <Alert>{scoutError}</Alert> : null}
          {scout.summary ? (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard
                  detail={scout.summary.teamName ?? "Selected team"}
                  label="Record"
                  value={formatRecord(scout.summary.record)}
                />
                <StatCard
                  detail={
                    scout.recentMatchups.length
                      ? "Recent head-to-head history available"
                      : "No recent head-to-head games"
                  }
                  label="Recent games"
                  value={String(scout.summary.recentGames.length)}
                />
                <StatCard
                  detail="Lineup tools stay anchored to your current club."
                  label="Scouting focus"
                  value={scout.summary.teamName ?? "Selected team"}
                />
              </div>

              <div className={twoColumnGridClassName}>
                <Panel as="article" padding="sm" variant="solid">
                  <SectionHeading
                    actions={
                      <Button
                        disabled={!canUsePredictions}
                        loading={
                          isRefreshingOpponentForecast ||
                          (isLoadingOpponentForecast &&
                            opponentForecast?.status !== "SUCCEEDED")
                        }
                        onClick={() => void handleRefreshOpponentForecast()}
                        size="sm"
                        variant="secondary"
                      >
                        Refresh forecast
                      </Button>
                    }
                    title="Scout forecast"
                    titleAs="h4"
                  />
                  {opponentForecastError ? (
                    <Alert>{opponentForecastError}</Alert>
                  ) : null}
                  {!canUsePredictions ? (
                    <p className={statusCopyClassName}>
                      Premium access is required to generate new opponent
                      forecasts.
                    </p>
                  ) : null}
                  {opponentForecast ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge
                          tone={statusToneFromValue(opponentForecast.status)}
                        >
                          {formatOpponentForecastStatus(opponentForecast.status)}
                        </StatusBadge>
                        <span className={mutedMetaClassName}>
                          Requested {formatTimestamp(opponentForecast.requestedAt)}
                        </span>
                        {opponentForecast.completedAt ? (
                          <span className={mutedMetaClassName}>
                            Completed{" "}
                            {formatTimestamp(opponentForecast.completedAt)}
                          </span>
                        ) : null}
                      </div>
                      {opponentForecast.error ? (
                        <p className={statusCopyClassName}>
                          {opponentForecast.error}
                        </p>
                      ) : null}
                      {opponentForecast.result ? (
                        <>
                          <div className="mt-4 grid gap-4 sm:grid-cols-3">
                            <StatCard
                              detail={
                                opponentForecast.result.topScenarios[0]
                                  ? `${opponentForecast.result.topScenarios[0].offense} / ${opponentForecast.result.topScenarios[0].defense}`
                                  : "No primary scenario yet"
                              }
                              label="Top scenario"
                              value={
                                opponentForecast.result.topScenarios[0]
                                  ? formatPercent(
                                      opponentForecast.result.topScenarios[0]
                                        .probability,
                                    )
                                  : "N/A"
                              }
                            />
                            <StatCard
                              detail="Model confidence across the full scenario bundle"
                              label="Confidence"
                              value={formatPercent(
                                opponentForecast.result.confidence,
                              )}
                            />
                            <StatCard
                              detail={`Recent ${opponentForecast.result.coverage.recentGamesConsidered} • H2H ${opponentForecast.result.coverage.headToHeadGamesConsidered}`}
                              label="Analogs"
                              value={
                                opponentForecast.result.coverage
                                  .analogGamesConsidered
                              }
                            />
                          </div>

                          <div className="mt-4 grid gap-4">
                            {opponentForecast.result.topScenarios.map(
                              (scenario) => (
                                <Panel
                                  as="article"
                                  key={scenario.scenarioId}
                                  padding="sm"
                                  variant="solid"
                                >
                                  <SectionHeading
                                    actions={
                                      canUsePredictions ? (
                                        <Button
                                          onClick={() =>
                                            handleUseScenarioInPreview(scenario)
                                          }
                                          size="sm"
                                          variant="secondary"
                                        >
                                          Use in preview
                                        </Button>
                                      ) : null
                                    }
                                    title={`${scenario.label} • ${formatPercent(scenario.probability)}`}
                                    titleAs="h4"
                                  />
                                  <div className="flex flex-wrap gap-2">
                                    {[
                                      `Off ${scenario.offense}`,
                                      `Def ${scenario.defense}`,
                                      `GDP focus ${scenario.gdpFocus ?? "N/A"}`,
                                      `GDP pace ${scenario.gdpPace ?? "N/A"}`,
                                      `Enthusiasm ${scenario.enthusiasmBand ?? "Unknown"}`,
                                      `Effort ${scenario.effortChoice}`,
                                    ].map((tag) => (
                                      <span
                                        className="bg-note-bg text-note inline-flex rounded-full px-3 py-1.5 text-sm font-semibold"
                                        key={`${scenario.scenarioId}-${tag}`}
                                      >
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                  <div className="mt-3 grid gap-4 xl:grid-cols-2">
                                    <div>
                                      <SectionHeading
                                        title="Likely starters"
                                        titleAs="h4"
                                      />
                                      <ul className={listClassName}>
                                        {scenario.starters.length ? (
                                          scenario.starters.map((player) => (
                                            <li
                                              className={listItemClassName}
                                              key={
                                                player.playerId ??
                                                `${scenario.scenarioId}-${player.fullName}`
                                              }
                                            >
                                              <strong className="text-ink text-sm">
                                                {player.fullName}
                                              </strong>
                                              <span className={statusCopyClassName}>
                                                {formatForecastPlayerProjection(
                                                  player,
                                                )}
                                              </span>
                                            </li>
                                          ))
                                        ) : (
                                          <li className="text-ink-muted text-sm">
                                            No starter projection available.
                                          </li>
                                        )}
                                      </ul>
                                    </div>
                                    <div>
                                      <SectionHeading
                                        title="Rotation and evidence"
                                        titleAs="h4"
                                      />
                                      <ul className={listClassName}>
                                        {scenario.rotation.length ? (
                                          scenario.rotation.map((player) => (
                                            <li
                                              className={listItemClassName}
                                              key={
                                                player.playerId ??
                                                `${scenario.scenarioId}-rotation-${player.fullName}`
                                              }
                                            >
                                              <strong className="text-ink text-sm">
                                                {player.fullName}
                                              </strong>
                                              <span className={statusCopyClassName}>
                                                {formatForecastPlayerProjection(
                                                  player,
                                                )}
                                              </span>
                                            </li>
                                          ))
                                        ) : (
                                          <li className="text-ink-muted text-sm">
                                            No rotation projection available.
                                          </li>
                                        )}
                                      </ul>
                                      {scenario.evidence.length ? (
                                        <p className={`${statusCopyClassName} mt-3`}>
                                          {scenario.evidence.join(" • ")}
                                        </p>
                                      ) : null}
                                    </div>
                                  </div>
                                </Panel>
                              ),
                            )}
                          </div>

                          <div className="mt-4 grid gap-4 xl:grid-cols-2">
                            <Panel as="article" padding="sm" variant="solid">
                              <SectionHeading
                                title="Model signals"
                                titleAs="h4"
                              />
                              <div className="flex flex-wrap gap-2">
                                {opponentForecast.result.featureSignals.length ? (
                                  opponentForecast.result.featureSignals.map(
                                    (signal) => (
                                      <span
                                        className="bg-note-bg text-note inline-flex rounded-full px-3 py-1.5 text-sm font-semibold"
                                        key={signal.key}
                                      >
                                        {signal.label}: {signal.value}
                                      </span>
                                    ),
                                  )
                                ) : (
                                  <span className="text-ink-muted text-sm">
                                    No model signals were returned.
                                  </span>
                                )}
                              </div>
                            </Panel>

                            <Panel as="article" padding="sm" variant="solid">
                              <SectionHeading
                                title="Closest analog games"
                                titleAs="h4"
                              />
                              <ul className={listClassName}>
                                {opponentForecast.result.analogGames.length ? (
                                  opponentForecast.result.analogGames.map(
                                    (game) => (
                                      <li
                                        className={listItemClassName}
                                        key={game.matchId}
                                      >
                                        <strong className="text-ink text-sm">
                                          {game.opponentTeamName ??
                                            game.matchId}
                                        </strong>
                                        <span className={statusCopyClassName}>
                                          {[
                                            `Similarity ${formatPercent(
                                              game.similarity,
                                            )}`,
                                            game.startTime
                                              ? formatTimestamp(game.startTime)
                                              : null,
                                            game.offense
                                              ? `Off ${game.offense}`
                                              : null,
                                            game.defense
                                              ? `Def ${game.defense}`
                                              : null,
                                          ]
                                            .filter(
                                              (value): value is string =>
                                                Boolean(value),
                                            )
                                            .join(" • ")}
                                        </span>
                                      </li>
                                    ),
                                  )
                                ) : (
                                  <li className="text-ink-muted text-sm">
                                    No analog games were returned.
                                  </li>
                                )}
                              </ul>
                            </Panel>
                          </div>
                        </>
                      ) : (
                        <p className={statusCopyClassName}>
                          {isLoadingOpponentForecast
                            ? "Loading the latest stored forecast."
                            : "No stored opponent forecast is available yet."}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className={statusCopyClassName}>
                      {isLoadingOpponentForecast
                        ? "Loading the latest stored forecast."
                        : "No stored opponent forecast is available yet."}
                    </p>
                  )}
                </Panel>

                <Panel as="article" padding="sm" variant="solid">
                  <SectionHeading title="Team tendencies" titleAs="h4" />
                  <div className="flex flex-wrap gap-2">
                    {renderTrendChips("Off", scout.summary.tendencies.offense)}
                    {renderTrendChips("Def", scout.summary.tendencies.defense)}
                  </div>
                  <div className="h-1" />
                  <SectionHeading title="Key players" titleAs="h4" />
                  <ul className={listClassName}>
                    {scout.summary.topPlayers.map((player) => (
                      <li
                        className={listItemClassName}
                        key={player.playerId ?? player.fullName}
                      >
                        <strong className="text-ink text-sm">
                          {player.fullName}
                        </strong>
                        <span className={statusCopyClassName}>
                          {formatPlayerMeta(player)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Panel>

                <Panel as="article" padding="sm" variant="solid">
                  <SectionHeading
                    title="Recent games and effort clues"
                    titleAs="h4"
                  />
                  <ul className={listClassName}>
                    {scout.summary.recentGames.length ? (
                      scout.summary.recentGames.map((match) => (
                        <li
                          className={listRowClassName}
                          key={
                            match.matchId ??
                            `${match.startTime}-${match.opponentTeamName}`
                          }
                        >
                          <div className={listCopyClassName}>
                            <strong className="text-ink text-sm">
                              {match.opponentTeamName ?? "Unknown opponent"}
                            </strong>
                            <span className={statusCopyClassName}>
                              {formatMatchResult(match)}
                            </span>
                            <span className={mutedMetaClassName}>
                              {formatEffortDelta(match.effortDelta)}
                            </span>
                          </div>
                          {match.matchId && match.hasBoxscore ? (
                            <BoxscoreLink matchId={match.matchId} />
                          ) : (
                            <span className={mutedMetaClassName}>
                              Box score not ready
                            </span>
                          )}
                        </li>
                      ))
                    ) : (
                      <li className="text-ink-muted text-sm">
                        No recent games are available yet.
                      </li>
                    )}
                  </ul>
                </Panel>
              </div>

              <Panel as="article" padding="sm" variant="solid">
                <SectionHeading
                  description="Public team view only. Hidden skills stay hidden, but salary, shape, DMI, and injuries still help frame the matchup."
                  title="Public roster"
                  titleAs="h4"
                />
                <TableShell>
                  <thead>
                    <tr>
                      <TableHeadCell>Player</TableHeadCell>
                      <TableHeadCell>Role</TableHeadCell>
                      <TableHeadCell>Age</TableHeadCell>
                      <TableHeadCell>Salary</TableHeadCell>
                      <TableHeadCell>Shape</TableHeadCell>
                      <TableHeadCell>DMI</TableHeadCell>
                      <TableHeadCell>Injury</TableHeadCell>
                    </tr>
                  </thead>
                  <tbody>
                    {scout.summary.roster.length ? (
                      scout.summary.roster.map((player) => (
                        <tr key={player.playerId ?? player.fullName}>
                          <TableCell>{player.fullName}</TableCell>
                          <TableCell>{player.bestPosition ?? "N/A"}</TableCell>
                          <TableCell>{player.age ?? "N/A"}</TableCell>
                          <TableCell>{formatCurrency(player.salary)}</TableCell>
                          <TableCell>
                            <BuzzerBeaterRatingText
                              label={player.gameShape}
                              scale="game_shape"
                            >
                              {player.gameShape ?? "N/A"}
                            </BuzzerBeaterRatingText>
                          </TableCell>
                          <TableCell>{player.dmi ?? "N/A"}</TableCell>
                          <TableCell>
                            {formatInjury(player.injuryWeeks)}
                          </TableCell>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <TableCell className="text-ink-muted" colSpan={7}>
                          Public roster data is not ready yet.
                        </TableCell>
                      </tr>
                    )}
                  </tbody>
                </TableShell>
              </Panel>

              <Panel as="article" padding="sm" variant="solid">
                <SectionHeading
                  title="Recent matchups with your club"
                  titleAs="h4"
                />
                <ul className={listClassName}>
                  {scout.recentMatchups.length ? (
                    scout.recentMatchups.map((match) => (
                      <li
                        className={listRowClassName}
                        key={`matchup-${match.matchId ?? match.startTime}`}
                      >
                        <div className={listCopyClassName}>
                          <strong className="text-ink text-sm">
                            {match.opponentTeamName ?? "Unknown opponent"}
                          </strong>
                          <span className={statusCopyClassName}>
                            {formatMatchResult(match)}
                          </span>
                        </div>
                        {match.matchId && match.hasBoxscore ? (
                          <BoxscoreLink matchId={match.matchId} />
                        ) : (
                          <span className={mutedMetaClassName}>
                            Box score not ready
                          </span>
                        )}
                      </li>
                    ))
                  ) : (
                    <li className="text-ink-muted text-sm">
                      No recent head-to-head history is ready yet.
                    </li>
                  )}
                </ul>
              </Panel>
            </>
          ) : (
            <p className={statusCopyClassName}>
              {scout.message ?? "No opponent view is available yet."}
            </p>
          )}
        </Panel>
      ) : null}

      {activeSection === "predictions" ? (
        canUsePredictions ? (
          <PredictionPanel
            draft={predictionDraft}
            onDraftChange={setPredictionDraft}
            workspace={displayWorkspace}
          />
        ) : (
          <PremiumFeatureGatePanel
            billingSummary={billingSummary}
            error={billingError}
            featureName="Matchup previews"
            isLoading={isLoadingBilling}
            message="Run matchup forecasts from saved games or manual inputs with a premium plan."
          />
        )
      ) : null}

      {activeSection === "highlights" ? (
        canUseTeamHighlights ? (
          <HighlightsPanel workspace={displayWorkspace} />
        ) : (
          <PremiumFeatureGatePanel
            billingSummary={billingSummary}
            error={billingError}
            featureName="Team highlights"
            isLoading={isLoadingBilling}
            message="Scan your club's full history and browse all-time buzzerbeater-derived moments with a premium subscription."
          />
        )
      ) : null}

      {activeSection === "recaps" ? (
        canUseLeagueWriteups ? (
          <RecapPanel workspace={displayWorkspace} />
        ) : (
          <PremiumFeatureGatePanel
            billingSummary={billingSummary}
            error={billingError}
            featureName="League writeups"
            isLoading={isLoadingBilling}
            message="Generate game day recaps and league writeups with a premium subscription."
          />
        )
      ) : null}

      {activeSection === "league" ? (
        <Panel>
          <SectionHeading
            eyebrow="League"
            title={workspace.leagueIntel.league?.name ?? "League standings"}
          />
          <div className={twoColumnGridClassName}>
            {workspace.leagueIntel.standings.length ? (
              workspace.leagueIntel.standings.map((conference) => (
                <Panel
                  as="article"
                  key={conference.index}
                  padding="sm"
                  variant="solid"
                >
                  <SectionHeading
                    title={`Conference ${conference.index + 1}`}
                    titleAs="h4"
                  />
                  <TableShell compact>
                    <thead>
                      <tr>
                        <TableHeadCell className="pl-0">Team</TableHeadCell>
                        <TableHeadCell>W-L</TableHeadCell>
                        <TableHeadCell>Margin</TableHeadCell>
                      </tr>
                    </thead>
                    <tbody>
                      {conference.teams.map((team) => (
                        <tr key={team.teamId ?? team.teamName}>
                          <TableCell className="pl-0">
                            {team.teamName ?? "Unknown team"}
                          </TableCell>
                          <TableCell>
                            {team.wins ?? 0}-{team.losses ?? 0}
                          </TableCell>
                          <TableCell>
                            {formatSigned(team.pointMargin)}
                          </TableCell>
                        </tr>
                      ))}
                    </tbody>
                  </TableShell>
                </Panel>
              ))
            ) : (
              <Panel as="article" padding="sm" variant="solid">
                <p className={statusCopyClassName}>
                  No standings are ready yet.
                </p>
              </Panel>
            )}
          </div>
        </Panel>
      ) : null}

      {activeSection === "league-history" ? (
        <LeagueHistoryPanel workspace={displayWorkspace} />
      ) : null}

      {activeSection === "rivals" ? (
        <RivalsPanel workspace={displayWorkspace} />
      ) : null}

      {activeSection === "players" ? (
        <Panel>
          <SectionHeading
            eyebrow="Players"
            title="Trend lines, salary movement, and roster calls"
          />
          {playerTrendError ? <Alert>{playerTrendError}</Alert> : null}
          {salaryProjectionError ? (
            <Alert>{salaryProjectionError}</Alert>
          ) : null}
          <TableShell>
            <thead>
              <tr>
                <TableHeadCell>Player</TableHeadCell>
                <TableHeadCell>Role</TableHeadCell>
                <TableHeadCell>Salary</TableHeadCell>
                <TableHeadCell>Shape</TableHeadCell>
                <TableHeadCell>DMI</TableHeadCell>
                <TableHeadCell>Starts</TableHeadCell>
                <TableHeadCell>Analysis</TableHeadCell>
              </tr>
            </thead>
            <tbody>
              {workspace.playerLab.players.length ? (
                workspace.playerLab.players.map((player) => (
                  <tr key={player.playerId ?? player.fullName}>
                    <TableCell>{player.fullName}</TableCell>
                    <TableCell>{player.bestPosition ?? "N/A"}</TableCell>
                    <TableCell>{formatCurrency(player.salary)}</TableCell>
                    <TableCell>
                      <BuzzerBeaterRatingText
                        label={player.gameShape}
                        scale="game_shape"
                      >
                        {player.gameShape ?? "N/A"}
                      </BuzzerBeaterRatingText>
                    </TableCell>
                    <TableCell>{player.dmi ?? "N/A"}</TableCell>
                    <TableCell>{player.projectedStarterCount ?? 0}</TableCell>
                    <TableCell className="flex flex-wrap gap-2">
                      <Button
                        disabled={!player.playerId}
                        loading={loadingTrendPlayerId === player.playerId}
                        onClick={() => void handleLoadPlayerTrend(player)}
                        size="sm"
                        variant="secondary"
                      >
                        Trend
                      </Button>
                      <Button
                        disabled={!player.playerId}
                        loading={loadingSalaryPlayerId === player.playerId}
                        onClick={() => void handleLoadSalaryProjection(player)}
                        size="sm"
                        variant="secondary"
                      >
                        Salary
                      </Button>
                    </TableCell>
                  </tr>
                ))
              ) : (
                <tr>
                  <TableCell className="text-ink-muted" colSpan={7}>
                    Player data is not available yet.
                  </TableCell>
                </tr>
              )}
            </tbody>
          </TableShell>

          <div className={twoColumnGridClassName}>
            <Panel as="article" padding="sm" variant="solid">
              <SectionHeading
                description="Weekly updates from your saved club history."
                title={`${String(playerTrend?.player.fullName ?? "Player")} trend`}
                titleAs="h4"
              />
              {playerTrend ? (
                playerTrend.history.length > 1 ? (
                  <PlayerTrendChart
                    formatCurrency={formatCurrency}
                    formatInjury={formatInjury}
                    formatTimestamp={formatTimestamp}
                    history={playerTrend.history}
                  />
                ) : (
                  <p className={statusCopyClassName}>
                    Need at least two weekly updates to draw a trend chart.
                  </p>
                )
              ) : (
                <p className={statusCopyClassName}>
                  Load a player trend to inspect weekly salary, DMI, and
                  availability changes.
                </p>
              )}
            </Panel>

            <Panel as="article" padding="sm" variant="solid">
              <SectionHeading title="Salary projection" titleAs="h4" />
              {salaryProjection ? (
                <div className={summaryGridClassName}>
                  <StatCard
                    detail={salaryProjection.bestPosition ?? "No listed role"}
                    label="Player"
                    value={salaryProjection.fullName}
                  />
                  <StatCard
                    detail={`Trend ${salaryProjection.trend}`}
                    label="Current salary"
                    value={formatCurrency(salaryProjection.currentSalary)}
                  />
                  <StatCard
                    detail={`Δ ${formatSigned((salaryProjection.weeklyDelta ?? 0) / 1)}`}
                    label="Projected next week"
                    value={formatCurrency(salaryProjection.projectedSalary)}
                  />
                  <StatCard
                    detail={
                      salaryProjection.flagReason ??
                      "No flag guidance available."
                    }
                    label="Flag fit"
                    value={
                      salaryProjection.isFlagTarget ? "Aligned" : "Not aligned"
                    }
                  />
                </div>
              ) : (
                <p className={statusCopyClassName}>
                  Load a salary projection to estimate next-week movement and
                  flag fit.
                </p>
              )}
            </Panel>
          </div>
        </Panel>
      ) : null}

      {activeSection === "ops" ? (
        <>
          <BillingPanel
            error={billingError}
            isLoading={isLoadingBilling}
            summary={billingSummary}
          />
          <Panel>
            <SectionHeading
              description="Choose the look you want for your companion app. The selection is saved to your account."
              eyebrow="Appearance"
              title="Theme and account preferences"
            />
            <div className="max-w-sm">
              <ThemeSelect />
            </div>
          </Panel>
          <OperationsPanel />
        </>
      ) : null}
    </>
  );
}

function formatEffortDelta(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "Effort clue unavailable";
  }

  if (value === 0) {
    return "Effort looked even";
  }

  return value > 0 ? `Effort edge: +${value}` : `Effort edge: ${value}`;
}

function renderTrendChips(prefix: string, values: TrendCountEntry[]) {
  const entries = values.map((entry) => [entry.key, entry.count] as const);
  if (!entries.length) {
    return (
      <span className="text-ink-muted inline-flex rounded-full bg-black/5 px-3 py-1.5 text-sm font-semibold">
        {prefix}: no data
      </span>
    );
  }

  return entries.map(([label, count]) => (
    <span
      className="bg-note-bg text-note inline-flex rounded-full px-3 py-1.5 text-sm font-semibold"
      key={`${prefix}-${label}`}
    >
      {prefix}: {label} ({count})
    </span>
  ));
}

function resolveForecastTeamId(
  scout: ScoutWorkspacePayload,
): string | null {
  return (
    scout.summary?.matchupPerspective.opponentTeamId ??
    scout.requestedTeamId ??
    scout.teamId ??
    null
  );
}

function formatOpponentForecastStatus(value: string): string {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function isOpponentForecastTerminalStatus(value: string): boolean {
  return terminalOpponentForecastStatuses.has(value);
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "N/A";
  }

  return `${Math.round(value * 100)}%`;
}

function formatForecastPlayerProjection(player: {
  bestPosition?: string | null;
  expectedMinutes?: number | null;
  gameShape?: string | null;
  injuryWeeks?: number | null;
  minuteBandHigh?: number | null;
  minuteBandLow?: number | null;
  starterProbability?: number | null;
}): string {
  const parts = [
    player.bestPosition ?? null,
    player.expectedMinutes !== null && player.expectedMinutes !== undefined
      ? `Exp ${player.expectedMinutes}m`
      : null,
    player.minuteBandLow !== null &&
    player.minuteBandLow !== undefined &&
    player.minuteBandHigh !== null &&
    player.minuteBandHigh !== undefined
      ? `Band ${player.minuteBandLow}-${player.minuteBandHigh}m`
      : null,
    player.starterProbability !== null &&
    player.starterProbability !== undefined
      ? `Start ${formatPercent(player.starterProbability)}`
      : null,
    player.gameShape ? `Shape ${player.gameShape}` : null,
    player.injuryWeeks ? `Injury ${player.injuryWeeks}w` : null,
  ].filter((value): value is string => Boolean(value));

  return parts.join(" • ") || "No projection detail";
}

function BoxscoreLink({ matchId }: { matchId: string }) {
  return (
    <Link
      className={boxscoreLinkClassName}
      href={`/workspace/boxscores/${encodeURIComponent(matchId)}`}
      prefetch={false}
    >
      Boxscore
    </Link>
  );
}

function HomeOwnerRosterTable({
  roster,
}: {
  roster: DashboardWorkspace["lineupHelper"]["roster"];
}) {
  const [sortKey, setSortKey] = useState<OwnerRosterSortKey>("player");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const sortedRoster = sortLineupHelperRoster(roster, sortKey, sortDirection);

  function handleSort(nextKey: OwnerRosterSortKey) {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextKey);
    setSortDirection(isOwnerRosterNumericKey(nextKey) ? "desc" : "asc");
  }

  return (
    <TableShell>
      <thead>
        <tr>
          <SortableHeadCell
            currentDirection={sortDirection}
            currentKey={sortKey}
            label="Player"
            onSort={handleSort}
            sortKey="player"
          />
          <SortableHeadCell
            currentDirection={sortDirection}
            currentKey={sortKey}
            label="Pos"
            onSort={handleSort}
            sortKey="pos"
          />
          <SortableHeadCell
            className={numericTableHeadClassName}
            currentDirection={sortDirection}
            currentKey={sortKey}
            label="Age"
            onSort={handleSort}
            sortKey="age"
          />
          <SortableHeadCell
            className={numericTableHeadClassName}
            currentDirection={sortDirection}
            currentKey={sortKey}
            label="Salary"
            onSort={handleSort}
            sortKey="salary"
          />
          <SortableHeadCell
            className={numericTableHeadClassName}
            currentDirection={sortDirection}
            currentKey={sortKey}
            label="Shape"
            onSort={handleSort}
            sortKey="shape"
          />
          <SortableHeadCell
            className={numericTableHeadClassName}
            currentDirection={sortDirection}
            currentKey={sortKey}
            label="DMI"
            onSort={handleSort}
            sortKey="dmi"
          />
          {ownerRosterSkillColumns.map((column) => (
            <SortableHeadCell
              className={numericTableHeadClassName}
              currentDirection={sortDirection}
              currentKey={sortKey}
              key={column.key}
              label={column.label}
              onSort={handleSort}
              sortKey={column.key}
            />
          ))}
        </tr>
      </thead>
      <tbody>
        {sortedRoster.length ? (
          sortedRoster.map((player) => (
            <tr
              className={cn(
                player.injuryWeeks
                  ? "bg-[rgba(193,90,47,0.08)]"
                  : undefined,
              )}
              key={player.playerId}
            >
              <TableCell>
                <div className="grid gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{player.fullName}</span>
                    {player.injuryWeeks ? (
                      <span className="inline-flex rounded-full bg-accent/12 px-2 py-0.5 text-[0.7rem] font-semibold text-accent-strong">
                        {player.injuryWeeks}w
                      </span>
                    ) : null}
                  </div>
                  {!player.available && player.snapshotWarning ? (
                    <span className="text-xs text-ink-muted">
                      {player.snapshotWarning}
                    </span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell>{player.bestPosition ?? "N/A"}</TableCell>
              <TableCell className={numericTableCellClassName}>
                {formatNumericTableValue(player.age)}
              </TableCell>
              <TableCell className={numericTableCellClassName}>
                {formatCurrency(player.salary)}
              </TableCell>
              <TableCell className={numericTableCellClassName}>
                <BuzzerBeaterRatingText
                  label={player.gameShape}
                  scale="game_shape"
                >
                  {player.gameShape ?? "N/A"}
                </BuzzerBeaterRatingText>
              </TableCell>
              <TableCell className={numericTableCellClassName}>
                {formatNumericTableValue(player.dmi)}
              </TableCell>
              {ownerRosterSkillColumns.map((column) => (
                <TableCell
                  className={numericTableCellClassName}
                  key={`${player.playerId}-${column.key}`}
                >
                  {formatLineupHelperSkillValue(player, column.key)}
                </TableCell>
              ))}
            </tr>
          ))
        ) : (
          <tr>
            <TableCell className="text-ink-muted" colSpan={20}>
              No owner roster data is ready yet.
            </TableCell>
          </tr>
        )}
      </tbody>
    </TableShell>
  );
}

function SortableHeadCell({
  className,
  currentDirection,
  currentKey,
  label,
  onSort,
  sortKey,
}: {
  className?: string;
  currentDirection: "asc" | "desc";
  currentKey: OwnerRosterSortKey;
  label: string;
  onSort: (sortKey: OwnerRosterSortKey) => void;
  sortKey: OwnerRosterSortKey;
}) {
  const active = currentKey === sortKey;

  return (
    <TableHeadCell className={className}>
      <button
        className={cn(
          "inline-flex w-full items-center gap-1 font-inherit uppercase tracking-inherit",
          className?.includes("text-right") ? "justify-end" : "justify-start",
        )}
        onClick={() => onSort(sortKey)}
        type="button"
      >
        <span>{label}</span>
        <span aria-hidden="true">{active ? (currentDirection === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    </TableHeadCell>
  );
}

function formatAmplifyErrors(
  errors: Array<{ message?: string }> | null | undefined,
): string {
  if (!errors?.length) {
    return "The operation failed without a detailed error message.";
  }

  return errors
    .map((error) => error.message?.trim())
    .filter((message): message is string => Boolean(message))
    .join(" ");
}

function formatClientError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "Unavailable";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatRecord(
  record:
    | {
        wins?: number | null;
        losses?: number | null;
      }
    | null
    | undefined,
): string {
  if (!record) {
    return "No record";
  }

  return `${record.wins ?? 0}-${record.losses ?? 0}`;
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "N/A";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatInjury(value: number | null | undefined): string {
  if (!value) {
    return "Healthy";
  }

  return `${value}w`;
}

function formatMatchVenue(isHome: boolean | null | undefined): string {
  if (isHome === null || isHome === undefined) {
    return "Venue TBD";
  }

  return isHome ? "Home" : "Away";
}

function formatSigned(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "N/A";
  }

  return value > 0 ? `+${value}` : String(value);
}

function formatMatchResult(match: {
  outcome?: string | null;
  teamScore?: number | null;
  opponentScore?: number | null;
  startTime?: string | null | undefined;
}): string {
  const scoreline =
    match.teamScore !== null && match.opponentScore !== null
      ? `${match.teamScore}-${match.opponentScore}`
      : null;

  if (scoreline) {
    return `${match.outcome ?? "PENDING"} • ${scoreline}`;
  }

  return match.startTime
    ? formatTimestamp(match.startTime)
    : (match.outcome ?? "PENDING");
}

function formatMetricValue(value: unknown): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  if (typeof value === "string" && value.trim()) {
    return value;
  }

  return "N/A";
}

function formatNumericTableValue(value: number | null | undefined): string {
  return value === null || value === undefined ? "--" : String(value);
}

function formatLineupHelperSkillValue(
  player: DashboardWorkspace["lineupHelper"]["roster"][number],
  key: OwnerRosterSkillKey,
): string {
  return player.available ? String(player.skills[key]) : "--";
}

function sortLineupHelperRoster(
  roster: DashboardWorkspace["lineupHelper"]["roster"],
  sortKey: OwnerRosterSortKey,
  sortDirection: "asc" | "desc",
) {
  return [...roster].sort((left, right) => {
    const leftValue = readOwnerRosterSortValue(left, sortKey);
    const rightValue = readOwnerRosterSortValue(right, sortKey);

    if (leftValue === null && rightValue !== null) {
      return 1;
    }
    if (rightValue === null && leftValue !== null) {
      return -1;
    }

    const comparison = compareOwnerRosterValues(leftValue, rightValue);
    if (comparison !== 0) {
      return sortDirection === "asc" ? comparison : -comparison;
    }

    return left.fullName.localeCompare(right.fullName);
  });
}

function compareOwnerRosterValues(
  left: number | string | null,
  right: number | string | null,
): number {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left).localeCompare(String(right));
}

function readOwnerRosterSortValue(
  player: DashboardWorkspace["lineupHelper"]["roster"][number],
  sortKey: OwnerRosterSortKey,
): number | string | null {
  switch (sortKey) {
    case "player":
      return player.fullName;
    case "pos":
      return player.bestPosition ?? null;
    case "age":
      return player.age ?? null;
    case "salary":
      return player.salary ?? null;
    case "shape":
      return readGameShapeSortValue(player.gameShape);
    case "dmi":
      return player.dmi ?? null;
    case "js":
    case "jr":
    case "od":
    case "ha":
    case "dr":
    case "pa":
    case "is":
    case "id":
    case "rb":
    case "sb":
    case "st":
    case "ft":
    case "ex":
    case "gs":
      return player.available ? player.skills[sortKey] : null;
  }
}

function readGameShapeSortValue(value: string | null | undefined): number | null {
  switch ((value ?? "").toLowerCase()) {
    case "proficient":
      return 5;
    case "strong":
      return 4;
    case "respectable":
      return 3;
    case "mediocre":
      return 2;
    case "inept":
      return 1;
    default:
      return null;
  }
}

function isOwnerRosterNumericKey(value: OwnerRosterSortKey): boolean {
  return value !== "player" && value !== "pos";
}

function formatPlayerMeta(player: PlayerSummary): string {
  const parts = [
    player.bestPosition,
    player.salary !== null ? formatCurrency(player.salary) : null,
    typeof player.recentStartCount === "number" && player.recentStartCount > 0
      ? `${player.recentStartCount} GS`
      : null,
    typeof player.recentAvgMinutes === "number"
      ? `${formatMetricValue(player.recentAvgMinutes)} MPG`
      : typeof player.ppg === "number"
        ? `${player.ppg} PPG`
        : null,
  ];

  return parts.filter(Boolean).join(" • ") || "No profile details yet.";
}

function readPayload<T>(response: { payload: T | string }): T {
  return typeof response.payload === "string"
    ? (JSON.parse(response.payload) as T)
    : response.payload;
}

export const __testing = {
  compareOwnerRosterValues,
  formatPlayerMeta,
  isOpponentForecastTerminalStatus,
  readGameShapeSortValue,
  readOwnerRosterSortValue,
  readPayload,
  sortLineupHelperRoster,
};
