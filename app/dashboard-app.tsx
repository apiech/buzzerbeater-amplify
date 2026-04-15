"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  useQueryStates,
} from "nuqs";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { BillingPanel, PremiumFeatureGatePanel } from "@/app/billing-panel";
import { ArenaPanel } from "@/app/arena-panel";
import {
  COMMERCIAL_MODE_DISABLED_SENTINEL,
  formatClientError,
} from "@/app/dashboard/remote-errors";
import { PanelErrorBoundary } from "@/app/dashboard/panel-error-boundary";
import { useAuthenticatedWorkspace } from "@/app/dashboard/use-authenticated-workspace";
import {
  connectBbAccountMutation,
  manualSalaryEstimateQueryOptions,
  opponentForecastQueryOptions,
  playerTrendQueryOptions,
  salaryCalculatorSeedQueryOptions,
  salaryProjectionQueryOptions,
  scoutScheduleQueryOptions,
  scoutTeamSummaryQueryOptions,
  submitOpponentForecastJobMutation,
  workspaceQueryKeys,
} from "@/app/dashboard/workspace-query-client";
import { GamePredictionPanel } from "@/app/game-prediction-panel";
import { FeedbackPanel } from "@/app/feedback-panel";
import {
  createPredictionDraftFromScout,
  writePredictionDraftToStorage,
} from "@/app/game-prediction-state";
import { HighlightsPanel } from "@/app/highlights-panel";
import { LeagueHistoryPanel } from "@/app/league-history-panel";
import { LineupHelper } from "@/app/lineup-helper";
import { NextGameWizardPanel } from "@/app/next-game-wizard-panel";
import { OperationsPanel } from "@/app/operations-panel";
import { OpponentPicker } from "@/app/opponent-picker";
import { OpponentSchedulePanel } from "@/app/opponent-schedule-panel";
import { RecapPanel } from "@/app/recap-panel";
import { RivalsPanel } from "@/app/rivals-panel";
import { ScoutOpponentPanel } from "@/app/scout-opponent-panel";
import { StaffMarketPanel } from "@/app/staff-market-panel";
import type {
  BillingSummary,
  BbConnectionRecord,
  ConnectBbAccountInput,
  ConnectBbAccountResult,
  DashboardShellData,
  HighlightsPanelContext,
  HomeWorkspacePayload,
  LeagueHistoryPanelContext,
  LineupHelperWorkspaceRecord,
  ManualSalaryEstimate,
  LineupHelperRosterPlayer,
  OpponentForecastSnapshot,
  PlayerSummary,
  RecapPanelContext,
  RivalsPanelContext,
  SalaryCalculatorSeed,
  SalaryCalculatorSkillsInput,
  ScoutWorkspacePayload,
  ScoutedOpponentSheet,
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
import {
  captureAnalyticsEvent,
  registerAnalyticsProperties,
  resetAnalytics,
  setAnalyticsPersonProperties,
} from "@/lib/analytics/client";
import { safeJsonParse } from "@/lib/json-parsing";
import { type WorkspaceSection } from "@/app/workspace-sections";

type ConnectionFormState = ConnectBbAccountInput;
type OwnerRosterSkillKey = keyof LineupHelperRosterPlayer["skills"];
type SalaryCalculatorSkillKey = keyof SalaryCalculatorSkillsInput;
type SalaryCalculatorFormState = Record<SalaryCalculatorSkillKey, string>;
type SalaryCalculatorFormErrors = Partial<
  Record<SalaryCalculatorSkillKey, string>
>;
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
const salaryCalculatorSkillFields = [
  { key: "jumpShot", label: "Jump Shot", shortLabel: "JS" },
  { key: "jumpRange", label: "Jump Range", shortLabel: "JR" },
  { key: "outsideDefense", label: "Outside Defense", shortLabel: "OD" },
  { key: "handling", label: "Handling", shortLabel: "HA" },
  { key: "driving", label: "Driving", shortLabel: "DR" },
  { key: "passing", label: "Passing", shortLabel: "PA" },
  { key: "insideScoring", label: "Inside Scoring", shortLabel: "IS" },
  { key: "insideDefense", label: "Inside Defense", shortLabel: "ID" },
  { key: "rebounding", label: "Rebounding", shortLabel: "RB" },
  { key: "shotBlocking", label: "Shot Blocking", shortLabel: "SB" },
] as const satisfies ReadonlyArray<{
  key: SalaryCalculatorSkillKey;
  label: string;
  shortLabel: string;
}>;
const terminalOpponentForecastStatuses = new Set(["SUCCEEDED", "FAILED"]);
const terminalNextGameRecommendationStatuses = new Set(["SUCCEEDED", "FAILED"]);
const scoutUrlStateParsers = {
  scoutSeason: parseAsInteger.withOptions({ history: "replace" }),
  scoutTeam: parseAsString.withOptions({ history: "replace" }),
  scoutTypes: parseAsArrayOf(parseAsString).withOptions({ history: "replace" }),
};

type ScoutUrlState = {
  scoutSeason: number | null;
  scoutTeam: string | null;
  scoutTypes: string[] | null;
};

function readClientError(error: unknown): string | null {
  return error ? formatClientError(error) : null;
}

export default function DashboardHomePage() {
  return <DashboardApp activeSection="home" viewerLabel={null} />;
}

export function DashboardApp({
  activeSection,
  commercialModeEnabled = true,
  viewerLabel,
}: {
  activeSection: WorkspaceSection;
  commercialModeEnabled?: boolean;
  viewerLabel: string | null;
}) {
  return (
    <main className="grid min-h-screen gap-6 p-4 sm:p-6">
      <AuthenticatedWorkspace
        activeSection={activeSection}
        commercialModeEnabled={commercialModeEnabled}
        viewerLabel={viewerLabel}
      />
    </main>
  );
}

function AuthenticatedWorkspace({
  activeSection,
  commercialModeEnabled,
  viewerLabel,
}: {
  activeSection: WorkspaceSection;
  commercialModeEnabled: boolean;
  viewerLabel: string | null;
}) {
  const {
    billingError,
    billingSummary,
    connected,
    connection,
    connectionError,
    handleDisconnect,
    handleRefresh,
    isDisconnecting,
    isLoadingBilling,
    isLoadingConnection,
    isLoadingWorkspace,
    lineupHelperDependencyState,
    loadConnection,
    setShowCredentialForm,
    showCredentialForm,
    workspace,
    workspaceError,
  } = useAuthenticatedWorkspace({ activeSection, commercialModeEnabled });
  const viewerLabelText = viewerLabel ?? "Signed in";
  const connectedConnection = connection as BbConnectionRecord;
  const hasWorkspace = Boolean(workspace);
  const currentTeamName =
    workspace?.home.team.teamName ?? connection?.teamName ?? null;

  useEffect(() => {
    const analyticsProfile = {
      active_workspace_section: activeSection,
      bb_connection_status: connection?.status.toLowerCase() ?? null,
      billing_access_source: billingSummary?.accessSource ?? null,
      billing_plan_id: billingSummary?.planId ?? null,
      commercial_mode_enabled: commercialModeEnabled,
      has_bb_connection: connected,
      has_billing_customer: billingSummary?.hasBillingCustomer ?? false,
      has_lifetime_access: billingSummary?.hasLifetimeAccess ?? false,
      has_premium_access: billingSummary?.planId === "premium",
      has_workspace: hasWorkspace,
    } as const;

    registerAnalyticsProperties(analyticsProfile);
    setAnalyticsPersonProperties(analyticsProfile);
  }, [
    activeSection,
    billingSummary?.accessSource,
    billingSummary?.hasBillingCustomer,
    billingSummary?.hasLifetimeAccess,
    billingSummary?.planId,
    commercialModeEnabled,
    connected,
    connection?.status,
    hasWorkspace,
  ]);

  async function handleTrackedRefresh(): Promise<void> {
    captureAnalyticsEvent("workspace_refresh_requested", {
      active_section: activeSection,
    });
    await handleRefresh();
  }

  async function handleTrackedDisconnect(): Promise<void> {
    captureAnalyticsEvent("bb_connection_disconnect_requested", {
      source: "workspace_panel",
    });
    await handleDisconnect();
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
              className="border-border-soft text-ink hover:border-accent/35 inline-flex min-h-11 items-center justify-center rounded-full border bg-white/70 px-4 text-sm font-semibold shadow-sm transition hover:-translate-y-px hover:bg-white/90"
              href="/workspace/ops#feedback"
              onClick={() => {
                captureAnalyticsEvent("feedback_shortcut_clicked", {
                  source: "workspace_account_actions",
                });
              }}
            >
              Share feedback
            </Link>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- auth routes must hard-navigate to Cognito */}
            <a
              className="border-border-soft bg-surface-strong text-ink hover:border-accent/25 hover:text-accent inline-flex min-h-11 items-center justify-center rounded-full border px-4 text-sm font-semibold shadow-sm transition hover:-translate-y-px"
              href="/api/auth/sign-out"
              onClick={() => {
                captureAnalyticsEvent("auth_signed_out", {
                  source: "workspace_nav",
                });
                resetAnalytics();
              }}
            >
              Sign out
            </a>
          </>
        }
        activeSection={activeSection}
        currentTeamName={currentTeamName}
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
                await handleRefresh();
              }
            }}
          />
        ) : (
          <>
            <Panel>
              <SectionHeading
                actions={
                  <>
                    <StatusBadge
                      tone={statusToneFromValue(connectedConnection.status)}
                    >
                      {formatConnectionStatus(connectedConnection.status)}
                    </StatusBadge>
                    {activeSection !== "next-game" ? (
                      <Button
                        loading={isLoadingWorkspace}
                        onClick={() => void handleTrackedRefresh()}
                      >
                        {activeSection === "home"
                          ? "Refresh club data"
                          : "Refresh this section"}
                      </Button>
                    ) : null}
                    <Button
                      onClick={() => {
                        captureAnalyticsEvent(
                          "bb_connection_update_requested",
                          {
                            source: "workspace_panel",
                          },
                        );
                        setShowCredentialForm(true);
                      }}
                      variant="secondary"
                    >
                      Update credentials
                    </Button>
                    <Button
                      loading={isDisconnecting}
                      onClick={() => void handleTrackedDisconnect()}
                      variant="secondary"
                    >
                      Disconnect club
                    </Button>
                  </>
                }
                eyebrow="Club connection"
                title={connectedConnection.teamName ?? "Connected club"}
              />

              <div className={summaryGridClassName}>
                <StatCard
                  detail="Used for your BuzzerBeater connection."
                  label="Login name"
                  value={connectedConnection.bbLoginName || "Not set"}
                />
                <StatCard
                  detail={
                    [
                      connectedConnection.leagueName,
                      connectedConnection.countryName,
                    ]
                      .filter(Boolean)
                      .join(" • ") || "Club details update after refresh."
                  }
                  label="Club"
                  value={connectedConnection.teamName ?? "Connected club"}
                />
                <StatCard
                  detail={
                    connectedConnection.lastValidatedAt
                      ? `Last checked ${formatTimestamp(connectedConnection.lastValidatedAt)}`
                      : "No validation has run yet."
                  }
                  label="Connection health"
                  value={formatConnectionStatus(connectedConnection.status)}
                />
                <StatCard
                  detail={
                    connectedConnection.lastSyncError ??
                    "Club data is up to date."
                  }
                  label="Latest refresh"
                  value={
                    (workspace?.syncedAt ?? connectedConnection.lastSyncAt)
                      ? formatTimestamp(
                          workspace?.syncedAt ?? connectedConnection.lastSyncAt,
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
                lineupHelperDependencyState={lineupHelperDependencyState}
                viewerLabel={viewerLabel}
                workspace={workspace}
              />
            ) : (
              <Panel>
                <SectionHeading title="Preparing your club view" titleAs="h4" />
                <p className={statusCopyClassName}>
                  We&apos;re still waiting for your club data to settle. If this
                  sticks around, check the connection note above and the page
                  will refill automatically once the refresh succeeds.
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
  const [submitError, setSubmitError] = useState<string | null>(null);
  const connectMutation = useMutation({
    mutationFn: connectBbAccountMutation,
  });
  const savedConnectionError = connection?.lastSyncError ?? null;
  const hasEditedCredentials =
    formState.bbLoginName !== (connection?.bbLoginName ?? "") ||
    formState.accessKey.trim().length > 0;
  const visibleSavedConnectionError =
    submitError == null && !hasEditedCredentials ? savedConnectionError : null;

  useEffect(() => {
    setFormState({
      bbLoginName: connection?.bbLoginName ?? "",
      accessKey: "",
    });
    setSubmitError(null);
  }, [connection?.bbLoginName, connection?.lastSyncError]);

  function updateFormState(
    updater: (current: ConnectionFormState) => ConnectionFormState,
  ) {
    setFormState((current) => updater(current));
    setSubmitError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    captureAnalyticsEvent("bb_connection_submitted", {
      mode: connection?.status === "CONNECTED" ? "update" : "initial_connect",
    });

    try {
      const result = await connectMutation.mutateAsync({
        bbLoginName: formState.bbLoginName.trim(),
        accessKey: formState.accessKey.trim(),
      });

      if (result.status !== "CONNECTED") {
        captureAnalyticsEvent("bb_connection_result", {
          status: result.status,
          success: false,
        });
        setSubmitError(
          result.lastSyncError ?? "Unable to validate those credentials.",
        );
        await onConnected(result.status);
        return;
      }

      captureAnalyticsEvent("bb_connection_result", {
        status: result.status,
        success: true,
      });
      await onConnected(result.status);
    } catch (error) {
      captureAnalyticsEvent("bb_connection_result", {
        status: "request_failed",
        success: false,
      });
      setSubmitError(formatClientError(error));
      return;
    }
  }

  const isSubmitting = connectMutation.isPending;

  console.log("[dashboard-app] show me a log at all.")

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
              updateFormState((current) => ({
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
              updateFormState((current) => ({
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
        {visibleSavedConnectionError ? (
          <Alert tone="note">
            Saved connection issue from the last refresh attempt:{" "}
            {visibleSavedConnectionError}
          </Alert>
        ) : null}

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
  lineupHelperDependencyState,
  viewerLabel,
  workspace,
}: {
  activeSection: WorkspaceSection;
  billingError: string | null;
  billingSummary: BillingSummary | null;
  isLoadingBilling: boolean;
  lineupHelperDependencyState: ReturnType<
    typeof useAuthenticatedWorkspace
  >["lineupHelperDependencyState"];
  viewerLabel: string | null;
  workspace: DashboardShellData;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const home = workspace.home;
  const nextScoutMatch = home.nextScoutMatch ?? null;
  const nextOpponentTeamId = nextScoutMatch?.opponentTeamId ?? null;
  const shouldLoadScoutContext =
    activeSection === "scout" || activeSection === "opponent-schedule";
  const [scoutUrlState, setScoutUrlState] =
    useQueryStates(scoutUrlStateParsers);
  const selectedScoutTeamIdParam = scoutUrlState.scoutTeam;
  const selectedScoutSeasonParam = scoutUrlState.scoutSeason;
  const selectedScoutCompetitionKeysParam = scoutUrlState.scoutTypes;
  const scoutEventWindowMessage = resolveScoutEventWindowMessage({
    nextMatch: home.nextMatch ?? null,
    nextScoutMatch,
    selectedScoutTeamId: selectedScoutTeamIdParam ?? null,
  });
  const [scoutTeamDraftId, setScoutTeamDraftId] = useState(
    selectedScoutTeamIdParam ?? nextOpponentTeamId ?? "",
  );
  const [manualScoutTeamId, setManualScoutTeamId] = useState("");
  const [opponentPickerError, setOpponentPickerError] = useState<string | null>(
    null,
  );
  const [selectedTrendPlayerId, setSelectedTrendPlayerId] = useState<
    string | null
  >(null);
  const [selectedSalaryPlayerId, setSelectedSalaryPlayerId] = useState<
    string | null
  >(null);
  const [
    selectedSalaryCalculatorPlayerId,
    setSelectedSalaryCalculatorPlayerId,
  ] = useState("");
  const [salaryCalculatorForm, setSalaryCalculatorForm] =
    useState<SalaryCalculatorFormState>(() =>
      createEmptySalaryCalculatorFormState(),
    );
  const [salaryCalculatorFormErrors, setSalaryCalculatorFormErrors] =
    useState<SalaryCalculatorFormErrors>({});
  const [salaryCalculatorSeed, setSalaryCalculatorSeed] =
    useState<SalaryCalculatorSeed | null>(null);
  const [salaryCalculatorSeedError, setSalaryCalculatorSeedError] = useState<
    string | null
  >(null);
  const [salaryCalculatorEstimate, setSalaryCalculatorEstimate] =
    useState<ManualSalaryEstimate | null>(null);
  const [salaryCalculatorEstimateError, setSalaryCalculatorEstimateError] =
    useState<string | null>(null);
  const [isLoadingSalaryCalculatorSeed, setIsLoadingSalaryCalculatorSeed] =
    useState(false);
  const [isCalculatingSalaryEstimate, setIsCalculatingSalaryEstimate] =
    useState(false);
  const recapContext = useMemo<RecapPanelContext>(
    () => ({
      connection: {
        countryId: home.connection.countryId,
        countryName: home.connection.countryName,
        leagueId: home.connection.leagueId,
        leagueName: home.connection.leagueName,
        leagueTimeZone: home.connection.leagueTimeZone,
      },
      recentMatches: home.recentMatches,
    }),
    [
      home.connection.countryId,
      home.connection.countryName,
      home.connection.leagueId,
      home.connection.leagueName,
      home.connection.leagueTimeZone,
      home.recentMatches,
    ],
  );
  const highlightsContext = useMemo<HighlightsPanelContext>(
    () => ({
      team: {
        teamId: home.team.teamId,
        teamName: home.team.teamName,
      },
    }),
    [home.team.teamId, home.team.teamName],
  );
  const leagueHistoryContext = useMemo<LeagueHistoryPanelContext>(
    () => ({
      connection: {
        leagueId: home.connection.leagueId,
        leagueName: home.connection.leagueName,
      },
    }),
    [home.connection.leagueId, home.connection.leagueName],
  );
  const rivalsContext = useMemo<RivalsPanelContext>(
    () => ({
      team: {
        teamId: home.team.teamId,
        teamName: home.team.teamName,
      },
    }),
    [home.team.teamId, home.team.teamName],
  );
  const scoutSummaryQuery = useQuery({
    ...scoutTeamSummaryQueryOptions({
      teamId: selectedScoutTeamIdParam ?? undefined,
    }),
    enabled: shouldLoadScoutContext,
    placeholderData: (previous) => previous,
  });
  const resolvedScoutTeamId =
    selectedScoutTeamIdParam ??
    scoutSummaryQuery.data?.requestedTeamId ??
    scoutSummaryQuery.data?.teamId ??
    nextOpponentTeamId ??
    null;
  const scoutScheduleQuery = useQuery({
    ...scoutScheduleQueryOptions({
      competitionKeys: selectedScoutCompetitionKeysParam,
      season: selectedScoutSeasonParam,
      teamId: resolvedScoutTeamId,
    }),
    enabled:
      activeSection === "opponent-schedule" && Boolean(resolvedScoutTeamId),
    placeholderData: (previous) => previous,
  });
  const scout: ScoutWorkspacePayload | null = useMemo(() => {
    if (!scoutSummaryQuery.data) {
      return null;
    }

    return {
      ...scoutSummaryQuery.data,
      schedule:
        activeSection === "opponent-schedule"
          ? (scoutScheduleQuery.data ?? scoutSummaryQuery.data.schedule ?? null)
          : (scoutSummaryQuery.data.schedule ?? null),
    };
  }, [activeSection, scoutScheduleQuery.data, scoutSummaryQuery.data]);
  const scoutSummaryError = readClientError(scoutSummaryQuery.error);
  const scoutScheduleError =
    activeSection === "opponent-schedule"
      ? readClientError(scoutScheduleQuery.error)
      : null;
  const scoutError = scoutSummaryError;
  const scoutContextMessage = scout?.message ?? scoutEventWindowMessage;
  const scoutScheduleStatusMessage = resolveScoutScheduleStatusMessage({
    hasSchedule: Boolean(scout?.schedule),
    hasSummary: Boolean(scout?.summary),
    scheduleError: scoutScheduleError,
  });
  const isFetchingScout =
    shouldLoadScoutContext &&
    (scoutSummaryQuery.isFetching ||
      (activeSection === "opponent-schedule" && scoutScheduleQuery.isFetching));
  const forecastTeamId = resolveForecastTeamId(scout);
  const opponentForecastQuery = useQuery({
    ...opponentForecastQueryOptions({
      teamId: forecastTeamId ?? "",
    }),
    enabled: shouldLoadScoutContext && Boolean(forecastTeamId),
    refetchInterval: (query) => {
      const snapshot = query.state.data;
      if (!snapshot || isOpponentForecastTerminalStatus(snapshot.status)) {
        return false;
      }

      return 4000;
    },
  });
  const opponentForecastRefreshMutation = useMutation({
    mutationFn: (teamId: string) =>
      submitOpponentForecastJobMutation({ teamId }),
    onSuccess: async (_, teamId) => {
      await queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.opponentForecast(teamId),
      });
    },
  });
  const opponentForecast = opponentForecastQuery.data ?? null;
  const opponentForecastError =
    readClientError(opponentForecastRefreshMutation.error) ??
    readClientError(opponentForecastQuery.error);
  const isLoadingOpponentForecast =
    opponentForecastQuery.isPending || opponentForecastQuery.isFetching;
  const isRefreshingOpponentForecast =
    opponentForecastRefreshMutation.isPending;
  const isScoutViewingNextOpponent = Boolean(
    nextOpponentTeamId &&
    forecastTeamId &&
    forecastTeamId === nextOpponentTeamId,
  );

  useEffect(() => {
    setScoutTeamDraftId(
      selectedScoutTeamIdParam ??
        scout?.requestedTeamId ??
        scout?.teamId ??
        nextOpponentTeamId ??
        "",
    );
  }, [
    nextOpponentTeamId,
    scout?.requestedTeamId,
    scout?.teamId,
    selectedScoutTeamIdParam,
  ]);

  useEffect(() => {
    setOpponentPickerError(null);
  }, [resolvedScoutTeamId]);

  const commercialModeDisabled =
    billingError === COMMERCIAL_MODE_DISABLED_SENTINEL;
  const billingPlanId =
    billingSummary?.planId === "premium" ? "premium" : "free";
  const canUsePredictions = commercialModeDisabled
    ? true
    : billingSummary
      ? hasFeature(billingPlanId, "predictions")
      : false;
  const canUseLeagueWriteups = commercialModeDisabled
    ? true
    : billingSummary
      ? hasFeature(billingPlanId, "leagueWriteups")
      : false;
  const canUseTeamHighlights = commercialModeDisabled
    ? true
    : billingSummary
      ? hasFeature(billingPlanId, "teamHighlights")
      : false;
  const nextScoutMatchContext =
    isScoutViewingNextOpponent && nextScoutMatch
      ? `${formatTimestamp(nextScoutMatch.startTime)} • ${formatMatchVenue(nextScoutMatch.isHome)}`
      : null;
  const opponentScheduleHref = buildOpponentScheduleHref({
    teamId: resolvedScoutTeamId,
  });
  const playerTrendQuery = useQuery({
    ...playerTrendQueryOptions({
      playerId: selectedTrendPlayerId ?? "",
    }),
    enabled: Boolean(selectedTrendPlayerId),
    placeholderData: (previousData) => previousData,
  });
  const salaryProjectionQuery = useQuery({
    ...salaryProjectionQueryOptions({
      playerId: selectedSalaryPlayerId ?? "",
    }),
    enabled: Boolean(selectedSalaryPlayerId),
    placeholderData: (previousData) => previousData,
  });
  const playerTrend = playerTrendQuery.data ?? null;
  const playerTrendError = readClientError(playerTrendQuery.error);
  const loadingTrendPlayerId = playerTrendQuery.isFetching
    ? selectedTrendPlayerId
    : null;
  const salaryProjection = salaryProjectionQuery.data ?? null;
  const salaryProjectionError = readClientError(salaryProjectionQuery.error);
  const loadingSalaryPlayerId = salaryProjectionQuery.isFetching
    ? selectedSalaryPlayerId
    : null;
  const playerLabPlayers = workspace.playerLab?.players ?? [];
  const salaryCalculatorDelta =
    salaryCalculatorSeed?.currentSalary !== null &&
    salaryCalculatorSeed?.currentSalary !== undefined &&
    salaryCalculatorEstimate
      ? salaryCalculatorEstimate.predictedSalary -
        salaryCalculatorSeed.currentSalary
      : null;

  async function handleScoutLoad() {
    const nextTeamId = manualScoutTeamId.trim() || scoutTeamDraftId;
    if (!nextTeamId) {
      setOpponentPickerError("Select a scheduled opponent or enter a team ID.");
      return;
    }

    setOpponentPickerError(null);
    const action = resolveScoutTeamSelectionAction({
      nextTeamId,
      resolvedTeamId: resolvedScoutTeamId,
      urlTeamId: selectedScoutTeamIdParam ?? null,
    });
    if (action.kind === "noop") {
      return;
    }

    if (action.kind === "update-url") {
      await setScoutUrlState(action.nextState);
      return;
    }

    await scoutSummaryQuery.refetch();
    if (activeSection === "opponent-schedule") {
      await scoutScheduleQuery.refetch();
    }
  }

  async function handleRefreshOpponentForecast() {
    if (!forecastTeamId) {
      return;
    }

    try {
      await opponentForecastRefreshMutation.mutateAsync(forecastTeamId);
    } catch {
      // Mutation state carries the user-facing error.
    }
  }

  function handleSendScoutToPrediction(sheet: ScoutedOpponentSheet) {
    if (!canUsePredictions) {
      return;
    }

    const draft = createPredictionDraftFromScout({
      currentTeamId: home.team.teamId,
      currentTeamName: home.team.teamName,
      isNextOpponent: isScoutViewingNextOpponent,
      nextMatchIsHome: nextScoutMatch?.isHome ?? null,
      sheet,
    });

    writePredictionDraftToStorage(
      typeof window === "undefined" ? null : window.sessionStorage,
      draft,
    );
    router.push("/workspace/predictions");
  }

  async function handleLoadPlayerTrend(player: PlayerSummary) {
    if (!player.playerId) {
      return;
    }
    setSelectedTrendPlayerId(player.playerId);
  }

  async function handleLoadSalaryProjection(player: PlayerSummary) {
    if (!player.playerId) {
      return;
    }
    setSelectedSalaryPlayerId(player.playerId);
  }

  async function handleLoadSalaryCalculatorSeed() {
    if (!selectedSalaryCalculatorPlayerId) {
      return;
    }

    setIsLoadingSalaryCalculatorSeed(true);
    setSalaryCalculatorSeedError(null);
    setSalaryCalculatorEstimateError(null);

    try {
      const seed = await queryClient.fetchQuery(
        salaryCalculatorSeedQueryOptions({
          playerId: selectedSalaryCalculatorPlayerId,
        }),
      );

      if (!seed) {
        setSalaryCalculatorSeedError(
          "The selected player does not have synced salary skills yet.",
        );
        return;
      }

      setSalaryCalculatorSeed(seed);
      setSalaryCalculatorForm(createSalaryCalculatorFormState(seed.skills));
      setSalaryCalculatorFormErrors({});
      setSalaryCalculatorEstimate(null);
    } catch (error) {
      setSalaryCalculatorSeedError(formatClientError(error));
    } finally {
      setIsLoadingSalaryCalculatorSeed(false);
    }
  }

  async function handleCalculateSalaryEstimate() {
    const parsed = parseSalaryCalculatorFormState(salaryCalculatorForm);
    setSalaryCalculatorFormErrors(parsed.errors);

    if (!parsed.skills) {
      return;
    }

    setIsCalculatingSalaryEstimate(true);
    setSalaryCalculatorEstimateError(null);

    try {
      const estimate = await queryClient.fetchQuery(
        manualSalaryEstimateQueryOptions({
          input: {
            skills: parsed.skills,
          },
        }),
      );

      if (!estimate) {
        setSalaryCalculatorEstimateError(
          "No salary estimate was returned for these inputs.",
        );
        return;
      }

      setSalaryCalculatorEstimate(estimate);
    } catch (error) {
      setSalaryCalculatorEstimateError(formatClientError(error));
    } finally {
      setIsCalculatingSalaryEstimate(false);
    }
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
          {workspace.lineupHelper ? (
            <HomeOwnerRosterTable roster={workspace.lineupHelper.roster} />
          ) : (
            <p className={statusCopyClassName}>
              Loading your owner roster context.
            </p>
          )}
        </Panel>
      ) : null}

      {activeSection === "lineups" ? (
        <PanelErrorBoundary
          resetKeys={[
            activeSection,
            workspace.lineupHelper?.generatedAt ?? null,
          ]}
          title="Lineup helper"
        >
          <Panel>
            <SectionHeading
              eyebrow="Lineups"
              title="Lineup helper and rating outputs"
            />
            <LineupHelper
              initialWorkspace={workspace.lineupHelper ?? undefined}
              teamId={home.team.teamId ?? null}
            />
          </Panel>
        </PanelErrorBoundary>
      ) : null}

      {activeSection === "arena" ? (
        <PanelErrorBoundary
          resetKeys={[
            workspace.arena?.syncedAt ?? null,
            workspace.arena?.nextHomeMatch?.matchId ?? null,
          ]}
          title="Arena pricing advisor"
        >
          <ArenaPanel arena={workspace.arena ?? null} />
        </PanelErrorBoundary>
      ) : null}

      {activeSection === "scout" ? (
        <div className="grid gap-4">
          {scoutContextMessage ? <Alert>{scoutContextMessage}</Alert> : null}
          <OpponentPicker
            activeTeamName={scout?.summary?.teamName ?? null}
            availableOpponents={scout?.availableOpponents ?? []}
            error={opponentPickerError ?? scoutError}
            isLoading={isFetchingScout}
            manualTeamId={manualScoutTeamId}
            onApply={() => void handleScoutLoad()}
            onManualTeamIdChange={setManualScoutTeamId}
            onScheduledTeamIdChange={setScoutTeamDraftId}
            scheduledTeamId={scoutTeamDraftId}
          />

          {scout ? (
            <PanelErrorBoundary
              resetKeys={[
                scout.teamId ?? scout.requestedTeamId ?? null,
                opponentForecast?.jobId ?? null,
              ]}
              title="Scout opponent"
            >
              <ScoutOpponentPanel
                canUsePredictions={canUsePredictions}
                forecast={opponentForecast}
                forecastError={opponentForecastError}
                isLoadingForecast={isLoadingOpponentForecast}
                isNextOpponent={isScoutViewingNextOpponent}
                isRefreshingForecast={isRefreshingOpponentForecast}
                nextMatchContext={nextScoutMatchContext}
                onRefreshForecast={() => void handleRefreshOpponentForecast()}
                onSendToPrediction={handleSendScoutToPrediction}
                openScheduleHref={opponentScheduleHref}
                scout={scout}
              />
            </PanelErrorBoundary>
          ) : (
            <Panel>
              <SectionHeading
                eyebrow="Scout opponent"
                title="Loading opponent context"
              />
              <p className={statusCopyClassName}>
                Pulling the selected opponent&apos;s public scouting context.
              </p>
            </Panel>
          )}
        </div>
      ) : null}

      {activeSection === "opponent-schedule" ? (
        <div className="grid gap-4">
          {scoutContextMessage ? <Alert>{scoutContextMessage}</Alert> : null}
          <OpponentPicker
            activeTeamName={scout?.summary?.teamName ?? null}
            availableOpponents={scout?.availableOpponents ?? []}
            error={opponentPickerError ?? scoutError}
            isLoading={isFetchingScout}
            manualTeamId={manualScoutTeamId}
            onApply={() => void handleScoutLoad()}
            onManualTeamIdChange={setManualScoutTeamId}
            onScheduledTeamIdChange={setScoutTeamDraftId}
            scheduledTeamId={scoutTeamDraftId}
          />

          <PanelErrorBoundary
            resetKeys={[
              scout?.teamId ?? scout?.requestedTeamId ?? null,
              scout?.schedule?.selectedSeason ?? null,
              (scout?.schedule?.selectedCompetitionKeys ?? []).join(","),
            ]}
            title="Opponent schedule"
          >
            {scoutScheduleStatusMessage ? (
              <Alert>{scoutScheduleStatusMessage}</Alert>
            ) : null}
            <OpponentSchedulePanel
              isLoading={isFetchingScout}
              onApplyFilters={async (input) => {
                const action = resolveScoutFilterApplyAction({
                  currentCompetitionKeys:
                    selectedScoutCompetitionKeysParam ?? null,
                  currentSeason: selectedScoutSeasonParam ?? null,
                  nextCompetitionKeys: input.competitionKeys,
                  nextSeason: input.season ?? null,
                });

                if (action.kind === "update-url") {
                  await setScoutUrlState(action.nextState);
                  return;
                }

                await scoutScheduleQuery.refetch();
              }}
              emptyStateMessage={resolveScoutScheduleEmptyStateMessage({
                hasSummary: Boolean(scout?.summary),
                scoutMessage: scoutContextMessage ?? null,
                scheduleError: scoutScheduleError,
              })}
              schedule={scout?.schedule}
              teamName={scout?.summary?.teamName}
            />
          </PanelErrorBoundary>
        </div>
      ) : null}

      {activeSection === "predictions" ? (
        canUsePredictions ? (
          <PanelErrorBoundary
            resetKeys={[home.team.teamId ?? null, home.team.teamName ?? null]}
            title="Game prediction"
          >
            <GamePredictionPanel
              currentTeamId={home.team.teamId ?? null}
              currentTeamName={home.team.teamName ?? null}
            />
          </PanelErrorBoundary>
        ) : (
          <PremiumFeatureGatePanel
            billingSummary={billingSummary}
            error={billingError}
            featureName="Matchup previews"
            isLoading={isLoadingBilling}
            message="Run matchup forecasts from imported games or manual team sheets with a premium plan."
          />
        )
      ) : null}

      {activeSection === "next-game" ? (
        canUsePredictions ? (
          <PanelErrorBoundary
            resetKeys={[
              home.team.teamId ?? null,
              home.nextMatch?.matchId ?? null,
              workspace.lineupHelper?.generatedAt ?? null,
            ]}
            title="Next game wizard"
          >
            <NextGameWizardPanel
              home={home}
              initialLineupHelper={workspace.lineupHelper ?? null}
              lineupHelperState={lineupHelperDependencyState}
            />
          </PanelErrorBoundary>
        ) : (
          <PremiumFeatureGatePanel
            billingSummary={billingSummary}
            error={billingError}
            featureName="Next game wizard"
            isLoading={isLoadingBilling}
            message="Combine scouting, lineup planning, and matchup guidance into one guided prep flow with a premium plan."
          />
        )
      ) : null}

      {activeSection === "highlights" ? (
        canUseTeamHighlights ? (
          <HighlightsPanel context={highlightsContext} />
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
          <RecapPanel context={recapContext} />
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
        workspace.leagueIntel ? (
          <PanelErrorBoundary
            resetKeys={[
              workspace.leagueIntel.league?.id ?? null,
              workspace.leagueIntel.standings.length,
            ]}
            title="League standings"
          >
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
          </PanelErrorBoundary>
        ) : (
          <Panel>
            <SectionHeading eyebrow="League" title="Loading league standings" />
            <p className={statusCopyClassName}>
              Pulling the current conference table for this section.
            </p>
          </Panel>
        )
      ) : null}

      {activeSection === "league-history" ? (
        <LeagueHistoryPanel context={leagueHistoryContext} />
      ) : null}

      {activeSection === "rivals" ? (
        <RivalsPanel context={rivalsContext} />
      ) : null}

      {activeSection === "players" ? (
        <PanelErrorBoundary
          resetKeys={[workspace.playerLab?.syncedAt ?? null]}
          title="Player lab"
        >
          <Panel>
            <SectionHeading
              eyebrow="Players"
              title="Trend lines, salary movement, and roster calls"
            />
            {playerTrendError ? <Alert>{playerTrendError}</Alert> : null}
            {salaryProjectionError ? (
              <Alert>{salaryProjectionError}</Alert>
            ) : null}

            {workspace.playerLab ? (
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
                        <TableCell>
                          {player.projectedStarterCount ?? 0}
                        </TableCell>
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
                            onClick={() =>
                              void handleLoadSalaryProjection(player)
                            }
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
            ) : (
              <Panel as="article" padding="sm" variant="solid">
                <p className={statusCopyClassName}>
                  Synced player summaries are unavailable right now. You can
                  still use the manual salary calculator below.
                </p>
              </Panel>
            )}

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
                        salaryProjection.isFlagTarget
                          ? "Aligned"
                          : "Not aligned"
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

            <Panel as="article" padding="sm" variant="solid">
              <SectionHeading
                description="Load a synced player as a starting point or enter the 10 salary-priced skills manually. Values above 20 are supported."
                title="Salary calculator"
                titleAs="h4"
              />
              {salaryCalculatorSeedError ? (
                <Alert>{salaryCalculatorSeedError}</Alert>
              ) : null}
              {salaryCalculatorEstimateError ? (
                <Alert>{salaryCalculatorEstimateError}</Alert>
              ) : null}
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                <div className="grid gap-4">
                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                    <Field
                      hint={
                        playerLabPlayers.length
                          ? "Use a synced roster player as a starting point."
                          : "No synced players are available to seed the form yet."
                      }
                      label="Start from synced player"
                    >
                      <Select
                        onChange={(event) =>
                          setSelectedSalaryCalculatorPlayerId(
                            event.currentTarget.value,
                          )
                        }
                        value={selectedSalaryCalculatorPlayerId}
                      >
                        <option value="">Select a synced player</option>
                        {playerLabPlayers.map((player) =>
                          player.playerId ? (
                            <option
                              key={player.playerId}
                              value={player.playerId}
                            >
                              {player.fullName}
                            </option>
                          ) : null,
                        )}
                      </Select>
                    </Field>
                    <div className="flex items-end">
                      <Button
                        disabled={!selectedSalaryCalculatorPlayerId}
                        loading={isLoadingSalaryCalculatorSeed}
                        onClick={() => void handleLoadSalaryCalculatorSeed()}
                        variant="secondary"
                      >
                        Load player
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                    {salaryCalculatorSkillFields.map((field) => (
                      <Field
                        error={salaryCalculatorFormErrors[field.key]}
                        hint={`${field.shortLabel} • 1-99`}
                        key={field.key}
                        label={field.label}
                      >
                        <Input
                          inputMode="numeric"
                          min={1}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setSalaryCalculatorForm((current) => ({
                              ...current,
                              [field.key]: value,
                            }));
                            setSalaryCalculatorFormErrors((current) => {
                              if (!current[field.key]) {
                                return current;
                              }

                              const next = { ...current };
                              delete next[field.key];
                              return next;
                            });
                          }}
                          placeholder="1-99"
                          step={1}
                          type="number"
                          value={salaryCalculatorForm[field.key]}
                        />
                      </Field>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      loading={isCalculatingSalaryEstimate}
                      onClick={() => void handleCalculateSalaryEstimate()}
                    >
                      Calculate
                    </Button>
                    <span className={statusCopyClassName}>
                      {salaryCalculatorSeed
                        ? `Seeded from ${salaryCalculatorSeed.fullName}.`
                        : "Manual entry is available even without a synced seed."}
                    </span>
                  </div>
                </div>

                <div className="grid gap-4">
                  {salaryCalculatorEstimate ? (
                    <>
                      <div className={summaryGridClassName}>
                        <StatCard
                          detail={
                            salaryCalculatorSeed?.bestPosition ??
                            "No synced profile loaded"
                          }
                          label="Profile"
                          value={
                            salaryCalculatorSeed?.fullName ?? "Manual input"
                          }
                        />
                        <StatCard
                          detail="Synced club salary"
                          label="Current salary"
                          value={
                            salaryCalculatorSeed
                              ? formatCurrency(
                                  salaryCalculatorSeed.currentSalary,
                                )
                              : "Not loaded"
                          }
                        />
                        <StatCard
                          detail={
                            salaryCalculatorDelta === null
                              ? "No synced comparison loaded"
                              : `Δ ${formatSignedCurrencyValue(
                                  salaryCalculatorDelta,
                                )}`
                          }
                          label="Estimated salary"
                          value={formatCurrency(
                            salaryCalculatorEstimate.predictedSalary,
                          )}
                        />
                        <StatCard
                          detail={`${salaryCalculatorEstimate.modelSource} • ${salaryCalculatorEstimate.calibrationMode}`}
                          label="Best position"
                          value={salaryCalculatorEstimate.bestPosition}
                        />
                      </div>

                      <TableShell>
                        <thead>
                          <tr>
                            <TableHeadCell>Position</TableHeadCell>
                            <TableHeadCell
                              className={numericTableHeadClassName}
                            >
                              Estimated salary
                            </TableHeadCell>
                          </tr>
                        </thead>
                        <tbody>
                          {(["PG", "SG", "SF", "PF", "C"] as const).map(
                            (position) => (
                              <tr key={position}>
                                <TableCell>{position}</TableCell>
                                <TableCell
                                  className={numericTableCellClassName}
                                >
                                  {formatCurrency(
                                    salaryCalculatorEstimate.salaryByPosition[
                                      position
                                    ],
                                  )}
                                </TableCell>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </TableShell>

                      <p className={statusCopyClassName}>
                        Source: {salaryCalculatorEstimate.modelSource} (
                        {salaryCalculatorEstimate.modelSourceConfidence}) with{" "}
                        {salaryCalculatorEstimate.calibrationMode.toLowerCase()}{" "}
                        calibration at{" "}
                        {salaryCalculatorEstimate.correctionFactorApplied.toFixed(
                          2,
                        )}
                        x.
                      </p>
                    </>
                  ) : (
                    <p className={statusCopyClassName}>
                      Load a synced player or enter the 10 salary-priced skills
                      to estimate salary and see the position-by-position
                      breakdown.
                    </p>
                  )}
                </div>
              </div>
            </Panel>
          </Panel>
        </PanelErrorBoundary>
      ) : null}

      {activeSection === "staff-market" ? (
        <PanelErrorBoundary title="Staff market">
          <StaffMarketPanel />
        </PanelErrorBoundary>
      ) : null}

      {activeSection === "ops" ? (
        <>
          {!commercialModeDisabled ? (
            <BillingPanel
              error={billingError}
              isLoading={isLoadingBilling}
              summary={billingSummary}
            />
          ) : null}
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
          <FeedbackPanel
            currentTeamName={home.team.teamName ?? null}
            viewerLabel={viewerLabel ?? "Signed in"}
          />
          <OperationsPanel />
        </>
      ) : null}
    </>
  );
}

function resolveForecastTeamId(
  scout: ScoutWorkspacePayload | null,
): string | null {
  if (!scout) {
    return null;
  }

  return (
    scout.summary?.matchupPerspective.opponentTeamId ??
    scout.requestedTeamId ??
    scout.teamId ??
    null
  );
}

function isOpponentForecastTerminalStatus(value: string): boolean {
  return terminalOpponentForecastStatuses.has(value);
}

function isNextGameRecommendationTerminalStatus(value: string): boolean {
  return terminalNextGameRecommendationStatuses.has(value);
}

function resolveNextGameRecommendationBlockedReason(args: {
  isScoutViewingNextOpponent: boolean;
  isLoadingOpponentForecast: boolean;
  nextGameRecommendationError: string | null;
  nextMatch: HomeWorkspacePayload["nextMatch"];
  opponentForecast: OpponentForecastSnapshot | null;
}): string | null {
  if (!args.nextMatch) {
    return "No next match is scheduled yet.";
  }
  if (!args.isScoutViewingNextOpponent) {
    return "Open Scout on your actual scheduled next opponent to use this recommendation tool.";
  }
  if (
    !args.opponentForecast ||
    args.opponentForecast.status !== "SUCCEEDED" ||
    !args.opponentForecast.result
  ) {
    if (args.isLoadingOpponentForecast) {
      return null;
    }
    return "Generate a successful opponent forecast for this next opponent before requesting recommendations.";
  }
  if (
    args.nextGameRecommendationError &&
    /no usable opponent source boxscore/i.test(args.nextGameRecommendationError)
  ) {
    return "No usable opponent source boxscore with ratings is available yet.";
  }
  return null;
}

function resolveScoutEventWindowMessage(args: {
  nextMatch: HomeWorkspacePayload["nextMatch"];
  nextScoutMatch: HomeWorkspacePayload["nextScoutMatch"];
  selectedScoutTeamId: string | null | undefined;
}): string | null {
  if (normalizeScoutTeamId(args.selectedScoutTeamId)) {
    return null;
  }
  if (!args.nextMatch || !args.nextScoutMatch) {
    return null;
  }
  if (!didScoutTargetRollForward(args.nextMatch, args.nextScoutMatch)) {
    return null;
  }

  const opponentName =
    args.nextScoutMatch.opponentTeamName ?? "your next scheduled opponent";
  return `A live BuzzerBeater match is in progress, so this view is showing ${opponentName} as your next scheduled opponent until the current game window ends.`;
}

function normalizeScoutTeamId(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length ? normalized : null;
}

function didScoutTargetRollForward(
  nextMatch: HomeWorkspacePayload["nextMatch"],
  nextScoutMatch: HomeWorkspacePayload["nextScoutMatch"],
): boolean {
  if (!nextMatch || !nextScoutMatch) {
    return false;
  }

  if (nextMatch.matchId && nextScoutMatch.matchId) {
    return nextMatch.matchId !== nextScoutMatch.matchId;
  }

  return (
    nextMatch.opponentTeamId !== nextScoutMatch.opponentTeamId ||
    nextMatch.startTime !== nextScoutMatch.startTime
  );
}

function normalizeScoutCompetitionKeys(
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

function resolveScoutTeamSelectionAction(args: {
  nextTeamId: string | null | undefined;
  resolvedTeamId: string | null | undefined;
  urlTeamId: string | null | undefined;
}):
  | { kind: "noop" }
  | { kind: "refetch" }
  | { kind: "update-url"; nextState: Partial<ScoutUrlState> } {
  const nextTeamId = normalizeScoutTeamId(args.nextTeamId);
  if (!nextTeamId) {
    return { kind: "noop" };
  }

  const resolvedTeamId = normalizeScoutTeamId(args.resolvedTeamId);
  const urlTeamId = normalizeScoutTeamId(args.urlTeamId);

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

function resolveScoutFilterApplyAction(args: {
  currentCompetitionKeys: readonly string[] | null | undefined;
  currentSeason: number | null | undefined;
  nextCompetitionKeys: readonly string[] | null | undefined;
  nextSeason: number | null | undefined;
}):
  | { kind: "refetch" }
  | { kind: "update-url"; nextState: Partial<ScoutUrlState> } {
  const currentCompetitionKeys = normalizeScoutCompetitionKeys(
    args.currentCompetitionKeys,
  );
  const nextCompetitionKeys = normalizeScoutCompetitionKeys(
    args.nextCompetitionKeys,
  );
  const currentSeason = args.currentSeason ?? null;
  const nextSeason = args.nextSeason ?? null;
  const seasonChanged = currentSeason !== nextSeason;
  const competitionChanged = !areStringArraysEqual(
    currentCompetitionKeys ?? [],
    nextCompetitionKeys ?? [],
  );

  if (!seasonChanged && !competitionChanged) {
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

function buildOpponentScheduleHref(args: { teamId: string | null }): string {
  const params = new URLSearchParams();
  if (args.teamId) {
    params.set("scoutTeam", args.teamId);
  }

  const query = params.toString();
  return query
    ? `/workspace/opponent-schedule?${query}`
    : "/workspace/opponent-schedule";
}

function resolveScoutScheduleStatusMessage(args: {
  hasSchedule: boolean;
  hasSummary: boolean;
  scheduleError: string | null;
}): string | null {
  if (!args.scheduleError || !args.hasSummary) {
    return null;
  }

  return args.hasSchedule
    ? "The opponent summary stayed loaded, but the season schedule could not be refreshed. Showing the last successful schedule snapshot."
    : "The opponent summary stayed loaded, but the season schedule could not be refreshed. Try Apply again or reopen the team view.";
}

function resolveScoutScheduleEmptyStateMessage(args: {
  hasSummary: boolean;
  scoutMessage: string | null;
  scheduleError: string | null;
}): string | undefined {
  if (args.scheduleError && args.hasSummary) {
    return "The season schedule is unavailable right now. Try Apply again or reopen the team view.";
  }

  if (args.hasSummary && args.scoutMessage) {
    return args.scoutMessage;
  }

  return undefined;
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
  roster: LineupHelperWorkspaceRecord["roster"];
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
                player.injuryWeeks ? "bg-[rgba(193,90,47,0.08)]" : undefined,
              )}
              key={player.playerId}
            >
              <TableCell>
                <div className="grid gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{player.fullName}</span>
                    {player.injuryWeeks ? (
                      <span className="bg-accent/12 text-accent-strong inline-flex rounded-full px-2 py-0.5 text-[0.7rem] font-semibold">
                        {player.injuryWeeks}w
                      </span>
                    ) : null}
                  </div>
                  {!player.available && player.snapshotWarning ? (
                    <span className="text-ink-muted text-xs">
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
          "font-inherit tracking-inherit inline-flex w-full items-center gap-1 uppercase",
          className?.includes("text-right") ? "justify-end" : "justify-start",
        )}
        onClick={() => onSort(sortKey)}
        type="button"
      >
        <span>{label}</span>
        <span aria-hidden="true">
          {active ? (currentDirection === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </TableHeadCell>
  );
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

function formatSignedCurrencyValue(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "N/A";
  }

  const absoluteValue = formatCurrency(Math.abs(value));
  if (value === 0) {
    return absoluteValue;
  }

  return value > 0 ? `+${absoluteValue}` : `-${absoluteValue}`;
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
  player: LineupHelperWorkspaceRecord["roster"][number],
  key: OwnerRosterSkillKey,
): string {
  return player.available ? String(player.skills[key]) : "--";
}

function sortLineupHelperRoster(
  roster: LineupHelperWorkspaceRecord["roster"],
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

function areStringArraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function readOwnerRosterSortValue(
  player: LineupHelperWorkspaceRecord["roster"][number],
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

function readGameShapeSortValue(
  value: string | null | undefined,
): number | null {
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

function createEmptySalaryCalculatorFormState(): SalaryCalculatorFormState {
  return {
    driving: "",
    handling: "",
    insideDefense: "",
    insideScoring: "",
    jumpRange: "",
    jumpShot: "",
    outsideDefense: "",
    passing: "",
    rebounding: "",
    shotBlocking: "",
  };
}

function createSalaryCalculatorFormState(
  skills: Partial<Record<SalaryCalculatorSkillKey, number | null | undefined>>,
): SalaryCalculatorFormState {
  return {
    driving: toSalaryCalculatorFormValue(skills.driving),
    handling: toSalaryCalculatorFormValue(skills.handling),
    insideDefense: toSalaryCalculatorFormValue(skills.insideDefense),
    insideScoring: toSalaryCalculatorFormValue(skills.insideScoring),
    jumpRange: toSalaryCalculatorFormValue(skills.jumpRange),
    jumpShot: toSalaryCalculatorFormValue(skills.jumpShot),
    outsideDefense: toSalaryCalculatorFormValue(skills.outsideDefense),
    passing: toSalaryCalculatorFormValue(skills.passing),
    rebounding: toSalaryCalculatorFormValue(skills.rebounding),
    shotBlocking: toSalaryCalculatorFormValue(skills.shotBlocking),
  };
}

function parseSalaryCalculatorFormState(formState: SalaryCalculatorFormState): {
  errors: SalaryCalculatorFormErrors;
  skills: SalaryCalculatorSkillsInput | null;
} {
  const errors: SalaryCalculatorFormErrors = {};
  const skills = {} as SalaryCalculatorSkillsInput;

  for (const field of salaryCalculatorSkillFields) {
    const rawValue = formState[field.key].trim();
    if (!rawValue) {
      errors[field.key] = "Enter a whole number from 1 to 99.";
      continue;
    }

    const numericValue = Number(rawValue);
    if (!Number.isFinite(numericValue) || !Number.isInteger(numericValue)) {
      errors[field.key] = "Enter a whole number from 1 to 99.";
      continue;
    }

    if (numericValue < 1 || numericValue > 99) {
      errors[field.key] = "Enter a whole number from 1 to 99.";
      continue;
    }

    skills[field.key] = numericValue;
  }

  return {
    errors,
    skills: Object.keys(errors).length ? null : skills,
  };
}

function toSalaryCalculatorFormValue(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : "";
}

function readPayload<T>(response: { payload: T | string }): T {
  return typeof response.payload === "string"
    ? (safeJsonParse(response.payload) as T)
    : response.payload;
}

export const __testing = {
  areStringArraysEqual,
  compareOwnerRosterValues,
  createEmptySalaryCalculatorFormState,
  createSalaryCalculatorFormState,
  formatPlayerMeta,
  formatSignedCurrencyValue,
  isNextGameRecommendationTerminalStatus,
  isOpponentForecastTerminalStatus,
  parseSalaryCalculatorFormState,
  readGameShapeSortValue,
  readOwnerRosterSortValue,
  readPayload,
  resolveForecastTeamId,
  resolveNextGameRecommendationBlockedReason,
  resolveScoutEventWindowMessage,
  resolveScoutFilterApplyAction,
  resolveScoutScheduleEmptyStateMessage,
  resolveScoutScheduleStatusMessage,
  resolveScoutTeamSelectionAction,
  sortLineupHelperRoster,
};
