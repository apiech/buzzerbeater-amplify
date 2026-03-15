"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Authenticator, ThemeProvider } from "@aws-amplify/ui-react";

import { client } from "@/app/amplify-client";
import { OperationsPanel } from "@/app/operations-panel";
import { PredictionPanel } from "@/app/prediction-panel";
import { LineupPlanner } from "@/app/team-tools";
import type {
  BbConnectionRecord,
  ConnectBbAccountInput,
  ConnectBbAccountResult,
  DashboardWorkspace,
  HomeWorkspacePayload,
  JsonLookupResponse,
  LeagueIntelPayload,
  MatchBoxscorePayload,
  PlayerLabPayload,
  PlayerSummary,
  PlayerTrendPayload,
  SalaryProjection,
  ScoutWorkspacePayload,
  TeamHubPayload,
  WorkspaceResponse,
} from "@/app/types";
import { Alert } from "@/app/ui/primitives/alert";
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
import { authTheme } from "@/app/ui/workspace/auth-theme";
import { PlayerTrendChart } from "@/app/ui/workspace/player-trend-chart";
import { WorkspaceRouteNav } from "@/app/ui/workspace/workspace-route-nav";
import {
  type WorkspaceSection,
} from "@/app/workspace-sections";

type AuthenticatedProps = {
  signOut?: () => void;
  user?: {
    username?: string;
    signInDetails?: {
      loginId?: string;
    };
  };
};

type ConnectionFormState = ConnectBbAccountInput;

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
const ratingGridClassName =
  "grid min-w-[30rem] grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,0.9fr))] gap-x-3 gap-y-2";

const authenticatorComponents = {
  Header() {
    return (
      <div className="mb-5 grid gap-3">
        <p className="text-[0.76rem] font-bold uppercase tracking-[0.18em] text-accent">
          BB Amplify
        </p>
        <h2 className="text-2xl font-semibold tracking-[-0.04em] text-ink">
          Sign in, then connect your BuzzerBeater account.
        </h2>
        <p className={statusCopyClassName}>
          App authentication stays separate from BuzzerBeater credentials. The
          sync layer is server-side TypeScript, so this workspace can own live
          imports, caching, and analytics without a Python runtime boundary.
        </p>
      </div>
    );
  },
};

const authenticatorFormFields = {
  signIn: {
    username: {
      label: "Email",
      placeholder: "coach@example.com",
    },
  },
  signUp: {
    email: {
      order: 1,
      label: "Email",
      placeholder: "coach@example.com",
    },
    password: {
      order: 2,
      label: "Password",
      placeholder: "Create a password",
    },
    confirm_password: {
      order: 3,
      label: "Confirm password",
      placeholder: "Confirm your password",
    },
  },
};

export default function DashboardHomePage() {
  return <DashboardApp activeSection="home" />;
}

export function DashboardApp({
  activeSection,
}: {
  activeSection: WorkspaceSection;
}) {
  return (
    <main className="grid min-h-screen gap-6 p-4 sm:p-6 lg:grid-cols-[1.05fr,0.95fr]">
      <Panel
        as="section"
        className="justify-between gap-8 rounded-panel p-8 sm:rounded-[2rem]"
      >
        <div className="grid gap-4">
          <p className="text-[0.76rem] font-bold uppercase tracking-[0.18em] text-accent">
            TypeScript Canonical
          </p>
          <h1 className="max-w-none text-[clamp(2.4rem,4vw,4.4rem)] font-semibold leading-none tracking-[-0.06em] text-ink lg:max-w-[10ch]">
            Modern BuzzerBeater intelligence on Amplify Gen 2.
          </h1>
          <p className="max-w-[56ch] text-base leading-8 text-ink-muted">
            `bb-amplify` now owns the BB XML transport, parsing, sync jobs, and
            app-facing workspaces. Python remains useful for offline tooling and
            analysis, but the product runtime is TypeScript-native end to end.
          </p>
        </div>

        <div className="grid gap-4">
          <article className="grid gap-2 rounded-[1.35rem] border border-black/5 bg-surface-strong p-5">
            <h2 className="text-lg font-semibold tracking-[-0.02em] text-ink">
              Canonical BBAPI layer
            </h2>
            <p className={statusCopyClassName}>
              Native TypeScript client, shared XML fixtures, and parser goldens
              for the BB endpoints this app actively uses.
            </p>
          </article>
          <article className="grid gap-2 rounded-[1.35rem] border border-black/5 bg-surface-strong p-5">
            <h2 className="text-lg font-semibold tracking-[-0.02em] text-ink">
              Secure account boundary
            </h2>
            <p className={statusCopyClassName}>
              Users authenticate with Amplify, then store BB credentials in an
              encrypted server-side record with owner-scoped access.
            </p>
          </article>
          <article className="grid gap-2 rounded-[1.35rem] border border-black/5 bg-surface-strong p-5">
            <h2 className="text-lg font-semibold tracking-[-0.02em] text-ink">
              Workspace-first UX
            </h2>
            <p className={statusCopyClassName}>
              Home, team, opponent, league, and player views are rendered from a
              cached analytics workspace instead of a legacy page clone.
            </p>
          </article>
        </div>
      </Panel>

      <Panel
        as="section"
        className="bb-auth-shell rounded-panel p-6 sm:rounded-[2rem]"
      >
        <ThemeProvider theme={authTheme}>
          <Authenticator
            components={authenticatorComponents}
            formFields={authenticatorFormFields}
            loginMechanisms={["email"]}
          >
            {({ signOut, user }) => (
              <AuthenticatedWorkspace
                activeSection={activeSection}
                signOut={signOut}
                user={user}
              />
            )}
          </Authenticator>
        </ThemeProvider>
      </Panel>
    </main>
  );
}

function AuthenticatedWorkspace({
  activeSection,
  signOut,
  user,
}: AuthenticatedProps & { activeSection: WorkspaceSection }) {
  const [connection, setConnection] = useState<BbConnectionRecord | null>(null);
  const [workspace, setWorkspace] = useState<DashboardWorkspace | null>(null);
  const [isLoadingConnection, setIsLoadingConnection] = useState(true);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [showCredentialForm, setShowCredentialForm] = useState(false);

  async function loadConnection(): Promise<BbConnectionRecord | null> {
    setIsLoadingConnection(true);
    setConnectionError(null);

    const { data, errors } = await client.models.BbConnection.list({ limit: 1 });

    if (errors?.length) {
      setConnection(null);
      setConnectionError(formatAmplifyErrors(errors));
      setIsLoadingConnection(false);
      return null;
    }

    const record = data[0] ?? null;
    setConnection(record);
    setIsLoadingConnection(false);
    return record;
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

    const [teamHubResponse, scoutResponse, leagueIntelResponse, playerLabResponse] =
      await Promise.all([
        client.queries.getTeamHub(),
        client.queries.getScoutWorkspace({}),
        client.queries.getLeagueIntel(),
        client.queries.getPlayerLab(),
      ]);

    const allErrors = [
      ...(teamHubResponse.errors ?? []),
      ...(scoutResponse.errors ?? []),
      ...(leagueIntelResponse.errors ?? []),
      ...(playerLabResponse.errors ?? []),
    ];

    if (
      allErrors.length ||
      !teamHubResponse.data ||
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
      home: readPayload<HomeWorkspacePayload>(homeResponse.data),
      teamHub: readPayload<TeamHubPayload>(teamHubResponse.data),
      scout: readPayload<ScoutWorkspacePayload>(scoutResponse.data),
      leagueIntel: readPayload<LeagueIntelPayload>(leagueIntelResponse.data),
      playerLab: readPayload<PlayerLabPayload>(playerLabResponse.data),
      syncedAt: homeResponse.data.syncedAt ?? null,
    });
    setIsLoadingWorkspace(false);
  }

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      const record = await loadConnection();
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
  const loginEmail = user?.signInDetails?.loginId ?? user?.username ?? "Signed in";

  async function handleRefresh(): Promise<void> {
    await loadWorkspace(true);
    await loadConnection();
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
    <div className="grid gap-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <p className="text-[0.76rem] font-bold uppercase tracking-[0.18em] text-accent">
            Authenticated
          </p>
          <h2 className="text-xl font-semibold tracking-[-0.03em] text-ink">
            {loginEmail}
          </h2>
        </div>
        <Button onClick={signOut} variant="secondary">
          Sign out
        </Button>
      </header>

      <WorkspaceRouteNav activeSection={activeSection} />

      {isLoadingConnection ? (
        <Panel>
          <SectionHeading title="Checking your workspace" titleAs="h4" />
          <p className={statusCopyClassName}>
            Loading your current BuzzerBeater connection.
          </p>
        </Panel>
      ) : connectionError ? (
        <Panel variant="danger">
          <SectionHeading title="Connection status unavailable" titleAs="h4" />
          <p className={statusCopyClassName}>{connectionError}</p>
        </Panel>
      ) : !connected || showCredentialForm ? (
        <ConnectionOnboarding
          connection={connection}
          onCancel={connected ? () => setShowCredentialForm(false) : undefined}
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
                    {humanizeStatus(connection.status)}
                  </StatusBadge>
                  <Button loading={isLoadingWorkspace} onClick={() => void handleRefresh()}>
                    Refresh data
                  </Button>
                  <Button
                    onClick={() => setShowCredentialForm(true)}
                    variant="secondary"
                  >
                    Replace credentials
                  </Button>
                  <Button
                    loading={isDisconnecting}
                    onClick={() => void handleDisconnect()}
                    variant="secondary"
                  >
                    Disconnect
                  </Button>
                </>
              }
              eyebrow="Workspace"
              title={connection.teamName ?? "Connected BuzzerBeater workspace"}
            />

            <div className={summaryGridClassName}>
              <StatCard
                detail={connection.accessKeyLast4 ?? "Access key stored server-side"}
                label="BuzzerBeater login"
                value={connection.bbLoginName || "Not set"}
              />
              <StatCard
                detail={connection.countryName ?? "Country unavailable"}
                label="League"
                value={connection.leagueName ?? "Unassigned"}
              />
              <StatCard
                detail={`Connected ${formatTimestamp(connection.connectedAt)}`}
                label="Last validation"
                value={formatTimestamp(connection.lastValidatedAt)}
              />
              <StatCard
                detail={connection.lastSyncError ?? "Workspace cache is healthy."}
                label="Last sync"
                value={formatTimestamp(workspace?.syncedAt ?? connection.lastSyncAt)}
              />
            </div>

            {workspaceError ? <Alert>{workspaceError}</Alert> : null}
          </Panel>

          {isLoadingWorkspace && !workspace ? (
            <Panel>
              <SectionHeading title="Building your dashboard" titleAs="h4" />
              <p className={statusCopyClassName}>
                Pulling your team, upcoming opponent, league table, and player
                comparison workspace.
              </p>
            </Panel>
          ) : workspace ? (
            <WorkspaceDashboard
              activeSection={activeSection}
              workspace={workspace}
            />
          ) : (
            <Panel>
              <SectionHeading title="Workspace is ready to sync" titleAs="h4" />
              <p className={statusCopyClassName}>
                Refresh the connection or reconnect your BuzzerBeater account to
                populate the dashboard.
              </p>
            </Panel>
          )}
        </>
      )}
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
      setSubmitError(result.data.lastSyncError ?? "Unable to validate those credentials.");
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
            Enter your BuzzerBeater login name and access key. The server validates
            them immediately, stores the key in encrypted form, and runs the initial
            sync into the TypeScript workspace cache.
          </>
        }
        eyebrow="Connect BuzzerBeater"
        title={
          connection?.status === "CONNECTED"
            ? "Replace or revalidate your credentials."
            : "Unlock your scouting workspace."
        }
      />

      <form className="grid gap-4" onSubmit={(event) => void handleSubmit(event)}>
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
            placeholder="Enter your BB access key"
            required
            type="password"
            value={formState.accessKey}
          />
        </Field>

        {submitError ? <Alert>{submitError}</Alert> : null}

        <div className="flex flex-wrap gap-3">
          <Button loading={isSubmitting} type="submit">
            Validate and sync
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
  workspace,
}: {
  activeSection: WorkspaceSection;
  workspace: DashboardWorkspace;
}) {
  const home = workspace.home;
  const [scout, setScout] = useState(workspace.scout);
  const [selectedScoutTeamId, setSelectedScoutTeamId] = useState(
    workspace.scout.requestedTeamId ?? workspace.scout.teamId ?? "",
  );
  const [scoutError, setScoutError] = useState<string | null>(null);
  const [isLoadingScout, setIsLoadingScout] = useState(false);
  const [boxscoreDetails, setBoxscoreDetails] = useState<MatchBoxscorePayload | null>(
    null,
  );
  const [boxscoreError, setBoxscoreError] = useState<string | null>(null);
  const [loadingMatchId, setLoadingMatchId] = useState<string | null>(null);
  const [playerTrend, setPlayerTrend] = useState<PlayerTrendPayload | null>(null);
  const [playerTrendError, setPlayerTrendError] = useState<string | null>(null);
  const [loadingTrendPlayerId, setLoadingTrendPlayerId] = useState<string | null>(
    null,
  );
  const [salaryProjection, setSalaryProjection] = useState<SalaryProjection | null>(
    null,
  );
  const [salaryProjectionError, setSalaryProjectionError] = useState<string | null>(
    null,
  );
  const [loadingSalaryPlayerId, setLoadingSalaryPlayerId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setScout(workspace.scout);
    setSelectedScoutTeamId(workspace.scout.requestedTeamId ?? workspace.scout.teamId ?? "");
    setScoutError(null);
  }, [workspace.scout]);

  const displayWorkspace = {
    ...workspace,
    scout,
  };

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

    setScout(readPayload<ScoutWorkspacePayload>(response.data));
    setIsLoadingScout(false);
  }

  async function handleLoadBoxscore(matchId: string) {
    setLoadingMatchId(matchId);
    setBoxscoreError(null);

    const response = await client.queries.getMatchBoxscoreDetails({ matchId });
    if (response.errors?.length || !response.data) {
      setBoxscoreDetails(null);
      setBoxscoreError(formatAmplifyErrors(response.errors));
      setLoadingMatchId(null);
      return;
    }

    setBoxscoreDetails(readPayload<MatchBoxscorePayload>(response.data));
    setLoadingMatchId(null);
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

    setPlayerTrend(readPayload<PlayerTrendPayload>(response.data));
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
            eyebrow="Home"
            title={home.team.teamName ?? "Team overview"}
          />

          <div className={summaryGridClassName}>
            <StatCard
              detail={home.team.shortName ?? "Primary team"}
              label="Record"
              value={formatRecord(home.team.record)}
            />
            <StatCard
              detail={
                home.nextMatch
                  ? `${formatMatchVenue(home.nextMatch.isHome)} • ${formatTimestamp(home.nextMatch.startTime)}`
                  : "Schedule feed has no future match."
              }
              label="Next matchup"
              value={home.nextMatch?.opponentTeamName ?? "No upcoming game"}
            />
            <StatCard
              detail={
                home.nextOpponent?.record
                  ? `Record ${formatRecord(home.nextOpponent.record)}`
                  : "No scouting record available."
              }
              label="Opponent readiness"
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
              <SectionHeading title="Top players" titleAs="h4" />
              <ul className={listClassName}>
                {home.team.topPlayers.length ? (
                  home.team.topPlayers.map((player) => (
                    <li
                      className={listItemClassName}
                      key={player.playerId ?? player.fullName}
                    >
                      <strong className="text-sm text-ink">{player.fullName}</strong>
                      <span className={statusCopyClassName}>{formatPlayerMeta(player)}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-ink-muted">
                    No player ranking is available yet.
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
                      key={match.matchId ?? `${match.startTime}-${match.opponentTeamName}`}
                    >
                      <div className={listCopyClassName}>
                        <strong className="text-sm text-ink">
                          {match.opponentTeamName ?? "Unknown opponent"}
                        </strong>
                        <span className={statusCopyClassName}>
                          {formatMatchResult(match)}
                        </span>
                      </div>
                      {match.matchId && match.hasBoxscore ? (
                        <Button
                          loading={loadingMatchId === match.matchId}
                          onClick={() => void handleLoadBoxscore(match.matchId ?? "")}
                          size="sm"
                          variant="secondary"
                        >
                          Boxscore
                        </Button>
                      ) : (
                        <span className={mutedMetaClassName}>No cached boxscore</span>
                      )}
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-ink-muted">
                    No completed games are cached yet.
                  </li>
                )}
              </ul>
            </Panel>
          </div>
        </Panel>
      ) : null}

      {activeSection === "home" ? (
        <>
          <Panel>
            <SectionHeading
              eyebrow="Team Hub"
              title="Roster and lineup context"
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
                  <TableHeadCell>Starts</TableHeadCell>
                </tr>
              </thead>
              <tbody>
                {workspace.teamHub.roster.length ? (
                  workspace.teamHub.roster.map((player) => (
                    <tr key={player.playerId ?? player.fullName}>
                      <TableCell>{player.fullName}</TableCell>
                      <TableCell>{player.bestPosition ?? "N/A"}</TableCell>
                      <TableCell>{player.age ?? "N/A"}</TableCell>
                      <TableCell>{formatCurrency(player.salary)}</TableCell>
                      <TableCell>{player.gameShape ?? "N/A"}</TableCell>
                      <TableCell>{player.dmi ?? "N/A"}</TableCell>
                      <TableCell>{formatInjury(player.injuryWeeks)}</TableCell>
                      <TableCell>{player.projectedStarterCount ?? 0}</TableCell>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <TableCell className="text-ink-muted" colSpan={8}>
                      No roster data is cached yet.
                    </TableCell>
                  </tr>
                )}
              </tbody>
            </TableShell>
          </Panel>
          <Panel>
            <SectionHeading
              eyebrow="Lineup Tools"
              title="Starter planning and saved scenarios"
            />
            <LineupPlanner />
          </Panel>
        </>
      ) : null}

      {activeSection === "scout" ? (
        <Panel>
          <SectionHeading
            actions={
              <>
                <Field className="w-full md:min-w-80" label="Scout team">
                  <Select
                    onChange={(event) => setSelectedScoutTeamId(event.target.value)}
                    value={selectedScoutTeamId}
                  >
                    <option value="">Select a league opponent</option>
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
                  Load scout
                </Button>
              </>
            }
            eyebrow="Scout"
            title={scout.summary?.teamName ?? "Upcoming opponent intelligence"}
          />
          {scoutError ? <Alert>{scoutError}</Alert> : null}
          {scout.summary ? (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard
                  detail={scout.summary.teamName ?? "Scouted opponent"}
                  label="Record"
                  value={formatRecord(scout.summary.record)}
                />
                <StatCard
                  detail={
                    scout.recentMatchups.length
                      ? "Head-to-head history available"
                      : "No recent matchups"
                  }
                  label="Recent games"
                  value={String(scout.summary.recentGames.length)}
                />
                <StatCard
                  detail="Prediction Lab updates when scout target changes."
                  label="Tracked matchup"
                  value={scout.summary.matchupPerspective.opponentTeamId ?? "Unavailable"}
                />
              </div>

              <div className={twoColumnGridClassName}>
                <Panel as="article" padding="sm" variant="solid">
                  <SectionHeading title="Tendencies" titleAs="h4" />
                  <div className="flex flex-wrap gap-2">
                    {renderTrendChips("Off", scout.summary.tendencies.offense)}
                    {renderTrendChips("Def", scout.summary.tendencies.defense)}
                  </div>
                  <div className="h-1" />
                  <SectionHeading title="Top threats" titleAs="h4" />
                  <ul className={listClassName}>
                    {scout.summary.topPlayers.map((player) => (
                      <li
                        className={listItemClassName}
                        key={player.playerId ?? player.fullName}
                      >
                        <strong className="text-sm text-ink">{player.fullName}</strong>
                        <span className={statusCopyClassName}>{formatPlayerMeta(player)}</span>
                      </li>
                    ))}
                  </ul>
                </Panel>

                <Panel as="article" padding="sm" variant="solid">
                  <SectionHeading title="Recent games" titleAs="h4" />
                  <ul className={listClassName}>
                    {scout.summary.recentGames.length ? (
                      scout.summary.recentGames.map((match) => (
                        <li
                          className={listRowClassName}
                          key={match.matchId ?? `${match.startTime}-${match.opponentTeamName}`}
                        >
                          <div className={listCopyClassName}>
                            <strong className="text-sm text-ink">
                              {match.opponentTeamName ?? "Unknown opponent"}
                            </strong>
                            <span className={statusCopyClassName}>
                              {formatMatchResult(match)}
                            </span>
                          </div>
                          {match.matchId && match.hasBoxscore ? (
                            <Button
                              loading={loadingMatchId === match.matchId}
                              onClick={() => void handleLoadBoxscore(match.matchId ?? "")}
                              size="sm"
                              variant="secondary"
                            >
                              Boxscore
                            </Button>
                          ) : (
                            <span className={mutedMetaClassName}>No cached boxscore</span>
                          )}
                        </li>
                      ))
                    ) : (
                      <li className="text-sm text-ink-muted">
                        No recent opponent games are available yet.
                      </li>
                    )}
                  </ul>
                </Panel>
              </div>

              <Panel as="article" padding="sm" variant="solid">
                <SectionHeading title="Recent matchups" titleAs="h4" />
                <ul className={listClassName}>
                  {scout.recentMatchups.length ? (
                    scout.recentMatchups.map((match) => (
                      <li
                        className={listRowClassName}
                        key={`matchup-${match.matchId ?? match.startTime}`}
                      >
                        <div className={listCopyClassName}>
                          <strong className="text-sm text-ink">
                            {match.opponentTeamName ?? "Unknown opponent"}
                          </strong>
                          <span className={statusCopyClassName}>
                            {formatMatchResult(match)}
                          </span>
                        </div>
                        {match.matchId && match.hasBoxscore ? (
                          <Button
                            loading={loadingMatchId === match.matchId}
                            onClick={() => void handleLoadBoxscore(match.matchId ?? "")}
                            size="sm"
                            variant="secondary"
                          >
                            Boxscore
                          </Button>
                        ) : (
                          <span className={mutedMetaClassName}>No cached boxscore</span>
                        )}
                      </li>
                    ))
                  ) : (
                    <li className="text-sm text-ink-muted">
                      No recent head-to-head history is cached yet.
                    </li>
                  )}
                </ul>
              </Panel>
            </>
          ) : (
            <p className={statusCopyClassName}>
              {scout.message ?? "No opponent workspace is available yet."}
            </p>
          )}
        </Panel>
      ) : null}

      {activeSection === "scout" && (boxscoreDetails || boxscoreError) ? (
        <Panel>
          <SectionHeading
            eyebrow="Boxscore Drilldown"
            title={boxscoreDetails?.opponentTeamName ?? "Cached boxscore detail"}
          />
          {boxscoreError ? <Alert>{boxscoreError}</Alert> : null}
          {boxscoreDetails ? (
            <div className={twoColumnGridClassName}>
              <Panel as="article" padding="sm" variant="solid">
                <SectionHeading title="Strategy snapshot" titleAs="h4" />
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <dt className="text-[0.78rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                      Your offense
                    </dt>
                    <dd className="m-0 font-semibold text-ink">
                      {boxscoreDetails.offStrategy ?? "N/A"}
                    </dd>
                  </div>
                  <div className="grid gap-1">
                    <dt className="text-[0.78rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                      Your defense
                    </dt>
                    <dd className="m-0 font-semibold text-ink">
                      {boxscoreDetails.defStrategy ?? "N/A"}
                    </dd>
                  </div>
                  <div className="grid gap-1">
                    <dt className="text-[0.78rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                      Opponent offense
                    </dt>
                    <dd className="m-0 font-semibold text-ink">
                      {boxscoreDetails.opponentOffStrategy ?? "N/A"}
                    </dd>
                  </div>
                  <div className="grid gap-1">
                    <dt className="text-[0.78rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                      Opponent defense
                    </dt>
                    <dd className="m-0 font-semibold text-ink">
                      {boxscoreDetails.opponentDefStrategy ?? "N/A"}
                    </dd>
                  </div>
                </dl>
              </Panel>

              <Panel as="article" padding="sm" variant="solid">
                <SectionHeading title="Ratings snapshot" titleAs="h4" />
                <div className="overflow-x-auto">
                  <div className={ratingGridClassName}>
                    <div className="text-[0.78rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                      Metric
                    </div>
                    <div className="text-[0.78rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                      You
                    </div>
                    <div className="text-[0.78rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                      Opponent
                    </div>
                    {renderBoxscoreMetricRows(
                      boxscoreDetails.teamRatings,
                      boxscoreDetails.opponentRatings,
                    )}
                  </div>
                </div>
              </Panel>

              <Panel as="article" padding="sm" variant="solid">
                <SectionHeading title="Efficiency snapshot" titleAs="h4" />
                <div className="overflow-x-auto">
                  <div className={ratingGridClassName}>
                    <div className="text-[0.78rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                      Metric
                    </div>
                    <div className="text-[0.78rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                      You
                    </div>
                    <div className="text-[0.78rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                      Opponent
                    </div>
                    {renderBoxscoreMetricRows(
                      boxscoreDetails.teamEfficiency,
                      boxscoreDetails.opponentEfficiency,
                    )}
                  </div>
                </div>
              </Panel>

              <Panel as="article" padding="sm" variant="solid">
                <SectionHeading title="Raw game context" titleAs="h4" />
                <p className={statusCopyClassName}>
                  Match {boxscoreDetails.matchId}. Boxscore JSON is cached server-side and
                  used to resolve connected predictions.
                </p>
                <div className="flex flex-wrap gap-2">
                  {renderBoxscoreContext(boxscoreDetails.boxscore)}
                </div>
              </Panel>
            </div>
          ) : null}
        </Panel>
      ) : null}

      {activeSection === "predictions" ? (
        <PredictionPanel workspace={displayWorkspace} />
      ) : null}

      {activeSection === "league" ? (
        <Panel>
          <SectionHeading
            eyebrow="League Intel"
            title={workspace.leagueIntel.league?.name ?? "League standings"}
          />
          <div className={twoColumnGridClassName}>
            {workspace.leagueIntel.standings.length ? (
              workspace.leagueIntel.standings.map((conference) => (
                <Panel as="article" key={conference.index} padding="sm" variant="solid">
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
                          <TableCell>{formatSigned(team.pointMargin)}</TableCell>
                        </tr>
                      ))}
                    </tbody>
                  </TableShell>
                </Panel>
              ))
            ) : (
              <Panel as="article" padding="sm" variant="solid">
                <p className={statusCopyClassName}>No standings snapshot is cached yet.</p>
              </Panel>
            )}
          </div>
        </Panel>
      ) : null}

      {activeSection === "players" ? (
        <Panel>
          <SectionHeading
            eyebrow="Player Lab"
            title="Comparison, salary, and flag fit"
          />
          {playerTrendError ? <Alert>{playerTrendError}</Alert> : null}
          {salaryProjectionError ? <Alert>{salaryProjectionError}</Alert> : null}
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
                    <TableCell>{player.gameShape ?? "N/A"}</TableCell>
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
                    Player lab data is not available yet.
                  </TableCell>
                </tr>
              )}
            </tbody>
          </TableShell>

          <div className={twoColumnGridClassName}>
            <Panel as="article" padding="sm" variant="solid">
              <SectionHeading
                description="Weekly snapshots from the cached workspace history."
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
                    Need at least two weekly snapshots to draw a trend chart.
                  </p>
                )
              ) : (
                <p className={statusCopyClassName}>
                  Load a player trend to inspect weekly salary, DMI, and availability changes.
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
                    value={salaryProjection.fullName ?? "Unknown player"}
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
                    detail={salaryProjection.flagReason ?? "No flag guidance available."}
                    label="Flag fit"
                    value={salaryProjection.isFlagTarget ? "Aligned" : "Not aligned"}
                  />
                </div>
              ) : (
                <p className={statusCopyClassName}>
                  Load a salary projection to estimate next-week movement and flag fit.
                </p>
              )}
            </Panel>
          </div>
        </Panel>
      ) : null}

      {activeSection === "ops" ? <OperationsPanel /> : null}
    </>
  );
}

function readPayload<T>(response: WorkspaceResponse | JsonLookupResponse): T {
  return (response.payload ?? {}) as T;
}

function renderTrendChips(prefix: string, values: Record<string, number>) {
  const entries = Object.entries(values);
  if (!entries.length) {
    return (
      <span className="inline-flex rounded-full bg-black/5 px-3 py-1.5 text-sm font-semibold text-ink-muted">
        {prefix}: no data
      </span>
    );
  }

  return entries.map(([label, count]) => (
    <span
      className="inline-flex rounded-full bg-note-bg px-3 py-1.5 text-sm font-semibold text-note"
      key={`${prefix}-${label}`}
    >
      {prefix}: {label} ({count})
    </span>
  ));
}

function renderBoxscoreMetricRows(
  left: Record<string, unknown> | null,
  right: Record<string, unknown> | null,
) {
  const keys = Array.from(
    new Set([...(left ? Object.keys(left) : []), ...(right ? Object.keys(right) : [])]),
  )
    .filter((key) => !key.startsWith("__"))
    .sort((leftKey, rightKey) => leftKey.localeCompare(rightKey));

  if (!keys.length) {
    return (
      <div className="contents" key="empty-metrics">
        <span className="font-semibold text-ink">No cached metrics</span>
        <span className="text-ink-muted">-</span>
        <span className="text-ink-muted">-</span>
      </div>
    );
  }

  return keys.slice(0, 8).map((key) => (
    <div className="contents" key={key}>
      <span className="font-semibold text-ink">{humanizeKey(key)}</span>
      <span className="text-sm text-ink">{formatMetricValue(left?.[key])}</span>
      <span className="text-sm text-ink">{formatMetricValue(right?.[key])}</span>
    </div>
  ));
}

function renderBoxscoreContext(boxscore: Record<string, unknown> | null) {
  if (!boxscore) {
    return (
      <span className="inline-flex rounded-full bg-black/5 px-3 py-1.5 text-sm font-semibold text-ink-muted">
        No raw boxscore context
      </span>
    );
  }

  const homeTeam = toRecord(boxscore.homeTeam);
  const awayTeam = toRecord(boxscore.awayTeam);
  const tags = [
    homeTeam?.teamName ? `Home: ${String(homeTeam.teamName)}` : null,
    awayTeam?.teamName ? `Away: ${String(awayTeam.teamName)}` : null,
    boxscore.effortDelta !== undefined ? `Effort Δ: ${String(boxscore.effortDelta)}` : null,
    boxscore.neutral !== undefined ? `Neutral: ${String(boxscore.neutral)}` : null,
  ].filter((value): value is string => Boolean(value));

  if (!tags.length) {
    return (
      <span className="inline-flex rounded-full bg-black/5 px-3 py-1.5 text-sm font-semibold text-ink-muted">
        No raw boxscore context
      </span>
    );
  }

  return tags.map((tag) => (
    <span
      className="inline-flex rounded-full bg-note-bg px-3 py-1.5 text-sm font-semibold text-note"
      key={tag}
    >
      {tag}
    </span>
  ));
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

function humanizeStatus(status: BbConnectionRecord["status"]) {
  if (!status) {
    return "Unknown";
  }

  return status
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
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

function formatRecord(record: { wins: number | null; losses: number | null } | null): string {
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
  outcome: string | null;
  teamScore: number | null;
  opponentScore: number | null;
  startTime?: string | null;
}): string {
  const scoreline =
    match.teamScore !== null && match.opponentScore !== null
      ? `${match.teamScore}-${match.opponentScore}`
      : null;

  if (scoreline) {
    return `${match.outcome ?? "PENDING"} • ${scoreline}`;
  }

  return match.startTime ? formatTimestamp(match.startTime) : match.outcome ?? "PENDING";
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

function humanizeKey(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatPlayerMeta(player: PlayerSummary): string {
  const parts = [
    player.bestPosition,
    player.salary !== null && player.salary !== undefined
      ? formatCurrency(player.salary)
      : null,
    player.stats && typeof player.stats.ppg === "number"
      ? `${player.stats.ppg} PPG`
      : null,
  ];

  return parts.filter(Boolean).join(" • ") || "No profile details yet.";
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
