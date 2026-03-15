"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  Authenticator,
  Button,
  Heading,
  Text,
  TextField,
  View,
} from "@aws-amplify/ui-react";

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
import {
  workspaceSections,
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

const authenticatorComponents = {
  Header() {
    return (
      <View className="authenticator-copy">
        <Text className="eyebrow">BB Amplify</Text>
        <Heading level={2}>Sign in, then connect your BuzzerBeater account.</Heading>
        <Text>
          App authentication stays separate from BuzzerBeater credentials. The
          sync layer is server-side TypeScript, so this workspace can own live
          imports, caching, and analytics without a Python runtime boundary.
        </Text>
      </View>
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
    <main className="page-shell">
      <section className="info-panel">
        <div>
          <Text className="eyebrow">TypeScript Canonical</Text>
          <Heading level={1}>Modern BuzzerBeater intelligence on Amplify Gen 2.</Heading>
          <Text className="lede">
            `bb-amplify` now owns the BB XML transport, parsing, sync jobs, and
            app-facing workspaces. Python remains useful for offline tooling and
            analysis, but the product runtime is TypeScript-native end to end.
          </Text>
        </div>

        <div className="feature-stack">
          <article className="feature-card">
            <Heading level={4}>Canonical BBAPI layer</Heading>
            <Text>
              Native TypeScript client, shared XML fixtures, and parser goldens
              for the BB endpoints this app actively uses.
            </Text>
          </article>
          <article className="feature-card">
            <Heading level={4}>Secure account boundary</Heading>
            <Text>
              Users authenticate with Amplify, then store BB credentials in an
              encrypted server-side record with owner-scoped access.
            </Text>
          </article>
          <article className="feature-card">
            <Heading level={4}>Workspace-first UX</Heading>
            <Text>
              Home, team, opponent, league, and player views are rendered from a
              cached analytics workspace instead of a legacy page clone.
            </Text>
          </article>
        </div>
      </section>

      <section className="auth-panel">
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
      </section>
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
    <div className="workspace-shell">
      <header className="workspace-header">
        <div>
          <Text className="eyebrow">Authenticated</Text>
          <Heading level={3}>{loginEmail}</Heading>
        </div>
        <Button className="secondary-button" onClick={signOut}>
          Sign out
        </Button>
      </header>

      <nav className="workspace-route-nav" aria-label="Workspace sections">
        {workspaceSections.map((section) => (
          <Link
            key={section.id}
            className={`workspace-route-link ${
              activeSection === section.id ? "active" : ""
            }`}
            href={`/workspace/${section.id}`}
          >
            <span>{section.label}</span>
            <small>{section.description}</small>
          </Link>
        ))}
      </nav>

      {isLoadingConnection ? (
        <section className="dashboard-card">
          <Heading level={4}>Checking your workspace</Heading>
          <Text>Loading your current BuzzerBeater connection.</Text>
        </section>
      ) : connectionError ? (
        <section className="dashboard-card error-card">
          <Heading level={4}>Connection status unavailable</Heading>
          <Text>{connectionError}</Text>
        </section>
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
          <section className="dashboard-card">
            <div className="section-header">
              <div>
                <Text className="eyebrow">Workspace</Text>
                <Heading level={2}>
                  {connection.teamName ?? "Connected BuzzerBeater workspace"}
                </Heading>
              </div>
              <div className="workspace-actions">
                <span className={`status-badge status-${connection.status?.toLowerCase()}`}>
                  {humanizeStatus(connection.status)}
                </span>
                <Button onClick={() => void handleRefresh()} isLoading={isLoadingWorkspace}>
                  Refresh data
                </Button>
                <Button
                  className="secondary-button"
                  onClick={() => setShowCredentialForm(true)}
                >
                  Replace credentials
                </Button>
                <Button
                  className="secondary-button"
                  onClick={() => void handleDisconnect()}
                  isLoading={isDisconnecting}
                >
                  Disconnect
                </Button>
              </div>
            </div>

            <div className="summary-strip">
              <SummaryCard
                label="BuzzerBeater login"
                value={connection.bbLoginName || "Not set"}
                detail={connection.accessKeyLast4 ?? "Access key stored server-side"}
              />
              <SummaryCard
                label="League"
                value={connection.leagueName ?? "Unassigned"}
                detail={connection.countryName ?? "Country unavailable"}
              />
              <SummaryCard
                label="Last validation"
                value={formatTimestamp(connection.lastValidatedAt)}
                detail={`Connected ${formatTimestamp(connection.connectedAt)}`}
              />
              <SummaryCard
                label="Last sync"
                value={formatTimestamp(workspace?.syncedAt ?? connection.lastSyncAt)}
                detail={connection.lastSyncError ?? "Workspace cache is healthy."}
              />
            </div>

            {workspaceError ? (
              <div className="inline-alert">{workspaceError}</div>
            ) : null}
          </section>

          {isLoadingWorkspace && !workspace ? (
            <section className="dashboard-card">
              <Heading level={4}>Building your dashboard</Heading>
              <Text>
                Pulling your team, upcoming opponent, league table, and player
                comparison workspace.
              </Text>
            </section>
          ) : workspace ? (
            <WorkspaceDashboard
              activeSection={activeSection}
              workspace={workspace}
            />
          ) : (
            <section className="dashboard-card">
              <Heading level={4}>Workspace is ready to sync</Heading>
              <Text>
                Refresh the connection or reconnect your BuzzerBeater account to
                populate the dashboard.
              </Text>
            </section>
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
    <section className="dashboard-card">
      <Text className="eyebrow">Connect BuzzerBeater</Text>
      <Heading level={2}>
        {connection?.status === "CONNECTED"
          ? "Replace or revalidate your credentials."
          : "Unlock your scouting workspace."}
      </Heading>
      <Text className="status-copy">
        Enter your BuzzerBeater login name and access key. The server validates
        them immediately, stores the key in encrypted form, and runs the initial
        sync into the TypeScript workspace cache.
      </Text>

      <form className="connection-form" onSubmit={(event) => void handleSubmit(event)}>
        <TextField
          label="BuzzerBeater login name"
          value={formState.bbLoginName}
          onChange={(event) =>
            setFormState((current) => ({
              ...current,
              bbLoginName: event.target.value,
            }))
          }
          placeholder="apiech"
          isRequired
        />
        <TextField
          label="Access key"
          type="password"
          value={formState.accessKey}
          onChange={(event) =>
            setFormState((current) => ({
              ...current,
              accessKey: event.target.value,
            }))
          }
          placeholder="Enter your BB access key"
          isRequired
        />

        {submitError ? <div className="inline-alert">{submitError}</div> : null}

        <div className="action-row">
          <Button type="submit" isLoading={isSubmitting}>
            Validate and sync
          </Button>
          {onCancel ? (
            <Button className="secondary-button" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
    </section>
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
        <section className="dashboard-card">
          <div className="section-header">
            <div>
              <Text className="eyebrow">Home</Text>
              <Heading level={2}>{home.team.teamName ?? "Team overview"}</Heading>
            </div>
        </div>

        <div className="summary-strip">
          <SummaryCard
            label="Record"
            value={formatRecord(home.team.record)}
            detail={home.team.shortName ?? "Primary team"}
          />
          <SummaryCard
            label="Next matchup"
            value={home.nextMatch?.opponentTeamName ?? "No upcoming game"}
            detail={
              home.nextMatch
                ? `${formatMatchVenue(home.nextMatch.isHome)} • ${formatTimestamp(home.nextMatch.startTime)}`
                : "Schedule feed has no future match."
            }
          />
          <SummaryCard
            label="Opponent readiness"
            value={home.nextOpponent?.teamName ?? "No opponent"}
            detail={
              home.nextOpponent?.record
                ? `Record ${formatRecord(home.nextOpponent.record)}`
                : "No scouting record available."
            }
          />
          <SummaryCard
            label="Current injuries"
            value={String(home.team.injuries.length)}
            detail={
              home.team.injuries.length
                ? `${home.team.injuries[0]?.fullName ?? "Player"} needs attention`
                : "Full roster available."
            }
          />
        </div>

        <div className="dashboard-grid two-column">
          <article className="subpanel">
            <Heading level={4}>Top players</Heading>
            <ul className="data-list">
              {home.team.topPlayers.length ? (
                home.team.topPlayers.map((player) => (
                  <li key={player.playerId ?? player.fullName}>
                    <strong>{player.fullName}</strong>
                    <span>{formatPlayerMeta(player)}</span>
                  </li>
                ))
              ) : (
                <li>No player ranking is available yet.</li>
              )}
            </ul>
          </article>

          <article className="subpanel">
            <Heading level={4}>Recent results</Heading>
            <ul className="data-list">
              {home.recentMatches.length ? (
                home.recentMatches.map((match) => (
                  <li
                    className="data-list-row"
                    key={match.matchId ?? `${match.startTime}-${match.opponentTeamName}`}
                  >
                    <div className="data-list-copy">
                      <strong>{match.opponentTeamName ?? "Unknown opponent"}</strong>
                      <span>{formatMatchResult(match)}</span>
                    </div>
                    {match.matchId && match.hasBoxscore ? (
                      <Button
                        size="small"
                        className="secondary-button"
                        onClick={() => void handleLoadBoxscore(match.matchId ?? "")}
                        isLoading={loadingMatchId === match.matchId}
                      >
                        Boxscore
                      </Button>
                    ) : (
                      <span className="inline-meta">No cached boxscore</span>
                    )}
                  </li>
                ))
              ) : (
                <li>No completed games are cached yet.</li>
              )}
            </ul>
          </article>
        </div>
        </section>
      ) : null}

      {activeSection === "home" ? (
        <>
          <section className="dashboard-card">
            <Text className="eyebrow">Team Hub</Text>
            <Heading level={2}>Roster and lineup context</Heading>
            <div className="table-wrap">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Role</th>
                    <th>Age</th>
                    <th>Salary</th>
                    <th>Shape</th>
                    <th>DMI</th>
                    <th>Injury</th>
                    <th>Starts</th>
                  </tr>
                </thead>
                <tbody>
                  {workspace.teamHub.roster.length ? (
                    workspace.teamHub.roster.map((player) => (
                      <tr key={player.playerId ?? player.fullName}>
                        <td>{player.fullName}</td>
                        <td>{player.bestPosition ?? "N/A"}</td>
                        <td>{player.age ?? "N/A"}</td>
                        <td>{formatCurrency(player.salary)}</td>
                        <td>{player.gameShape ?? "N/A"}</td>
                        <td>{player.dmi ?? "N/A"}</td>
                        <td>{formatInjury(player.injuryWeeks)}</td>
                        <td>{player.projectedStarterCount ?? 0}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8}>No roster data is cached yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <section className="dashboard-card">
            <Text className="eyebrow">Lineup Tools</Text>
            <Heading level={2}>Starter planning and saved scenarios</Heading>
            <LineupPlanner />
          </section>
        </>
      ) : null}

      {activeSection === "scout" ? (
        <section className="dashboard-card">
          <div className="section-header">
            <div>
              <Text className="eyebrow">Scout</Text>
              <Heading level={2}>
                {scout.summary?.teamName ?? "Upcoming opponent intelligence"}
              </Heading>
            </div>
            <div className="action-row">
              <label className="field-group inline-field">
                <span>Scout team</span>
                <select
                  className="prediction-select"
                  value={selectedScoutTeamId}
                  onChange={(event) => setSelectedScoutTeamId(event.target.value)}
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
                </select>
              </label>
              <Button
                className="secondary-button"
                onClick={() => void handleScoutLoad()}
                isLoading={isLoadingScout}
                isDisabled={!selectedScoutTeamId}
              >
                Load scout
              </Button>
            </div>
          </div>
          {scoutError ? <div className="inline-alert">{scoutError}</div> : null}
          {scout.summary ? (
            <>
              <div className="summary-strip">
                <SummaryCard
                  label="Record"
                  value={formatRecord(scout.summary.record)}
                  detail={scout.summary.teamName ?? "Scouted opponent"}
                />
                <SummaryCard
                  label="Recent games"
                  value={String(scout.summary.recentGames.length)}
                  detail={scout.recentMatchups.length ? "Head-to-head history available" : "No recent matchups"}
                />
                <SummaryCard
                  label="Tracked matchup"
                  value={scout.summary.matchupPerspective.opponentTeamId ?? "Unavailable"}
                  detail="Prediction Lab updates when scout target changes."
                />
              </div>

              <div className="dashboard-grid two-column">
                <article className="subpanel">
                  <Heading level={4}>Tendencies</Heading>
                  <div className="chip-group">
                    {renderTrendChips("Off", scout.summary.tendencies.offense)}
                    {renderTrendChips("Def", scout.summary.tendencies.defense)}
                  </div>
                  <div className="subpanel-spacer" />
                  <Heading level={4}>Top threats</Heading>
                  <ul className="data-list">
                    {scout.summary.topPlayers.map((player) => (
                      <li key={player.playerId ?? player.fullName}>
                        <strong>{player.fullName}</strong>
                        <span>{formatPlayerMeta(player)}</span>
                      </li>
                    ))}
                  </ul>
                </article>

                <article className="subpanel">
                  <Heading level={4}>Recent games</Heading>
                  <ul className="data-list">
                    {scout.summary.recentGames.length ? (
                      scout.summary.recentGames.map((match) => (
                        <li
                          className="data-list-row"
                          key={match.matchId ?? `${match.startTime}-${match.opponentTeamName}`}
                        >
                          <div className="data-list-copy">
                            <strong>{match.opponentTeamName ?? "Unknown opponent"}</strong>
                            <span>{formatMatchResult(match)}</span>
                          </div>
                          {match.matchId && match.hasBoxscore ? (
                            <Button
                              size="small"
                              className="secondary-button"
                              onClick={() => void handleLoadBoxscore(match.matchId ?? "")}
                              isLoading={loadingMatchId === match.matchId}
                            >
                              Boxscore
                            </Button>
                          ) : (
                            <span className="inline-meta">No cached boxscore</span>
                          )}
                        </li>
                      ))
                    ) : (
                      <li>No recent opponent games are available yet.</li>
                    )}
                  </ul>
                </article>
              </div>

              <article className="subpanel">
                <Heading level={4}>Recent matchups</Heading>
                <ul className="data-list">
                  {scout.recentMatchups.length ? (
                    scout.recentMatchups.map((match) => (
                      <li
                        className="data-list-row"
                        key={`matchup-${match.matchId ?? match.startTime}`}
                      >
                        <div className="data-list-copy">
                          <strong>{match.opponentTeamName ?? "Unknown opponent"}</strong>
                          <span>{formatMatchResult(match)}</span>
                        </div>
                        {match.matchId && match.hasBoxscore ? (
                          <Button
                            size="small"
                            className="secondary-button"
                            onClick={() => void handleLoadBoxscore(match.matchId ?? "")}
                            isLoading={loadingMatchId === match.matchId}
                          >
                            Boxscore
                          </Button>
                        ) : (
                          <span className="inline-meta">No cached boxscore</span>
                        )}
                      </li>
                    ))
                  ) : (
                    <li>No recent head-to-head history is cached yet.</li>
                  )}
                </ul>
              </article>
            </>
          ) : (
            <Text>{scout.message ?? "No opponent workspace is available yet."}</Text>
          )}
        </section>
      ) : null}

      {activeSection === "scout" && (boxscoreDetails || boxscoreError) ? (
        <section className="dashboard-card">
          <div className="section-header">
            <div>
              <Text className="eyebrow">Boxscore Drilldown</Text>
              <Heading level={2}>
                {boxscoreDetails?.opponentTeamName ?? "Cached boxscore detail"}
              </Heading>
            </div>
          </div>
          {boxscoreError ? <div className="inline-alert">{boxscoreError}</div> : null}
          {boxscoreDetails ? (
            <div className="dashboard-grid two-column">
              <article className="subpanel">
                <Heading level={4}>Strategy snapshot</Heading>
                <dl className="detail-grid">
                  <div>
                    <dt>Your offense</dt>
                    <dd>{boxscoreDetails.offStrategy ?? "N/A"}</dd>
                  </div>
                  <div>
                    <dt>Your defense</dt>
                    <dd>{boxscoreDetails.defStrategy ?? "N/A"}</dd>
                  </div>
                  <div>
                    <dt>Opponent offense</dt>
                    <dd>{boxscoreDetails.opponentOffStrategy ?? "N/A"}</dd>
                  </div>
                  <div>
                    <dt>Opponent defense</dt>
                    <dd>{boxscoreDetails.opponentDefStrategy ?? "N/A"}</dd>
                  </div>
                </dl>
              </article>

              <article className="subpanel">
                <Heading level={4}>Ratings snapshot</Heading>
                <div className="rating-table compact-rating-table">
                  <div className="rating-table-header">Metric</div>
                  <div className="rating-table-header">You</div>
                  <div className="rating-table-header">Opponent</div>
                  {renderBoxscoreMetricRows(
                    boxscoreDetails.teamRatings,
                    boxscoreDetails.opponentRatings,
                  )}
                </div>
              </article>

              <article className="subpanel">
                <Heading level={4}>Efficiency snapshot</Heading>
                <div className="rating-table compact-rating-table">
                  <div className="rating-table-header">Metric</div>
                  <div className="rating-table-header">You</div>
                  <div className="rating-table-header">Opponent</div>
                  {renderBoxscoreMetricRows(
                    boxscoreDetails.teamEfficiency,
                    boxscoreDetails.opponentEfficiency,
                  )}
                </div>
              </article>

              <article className="subpanel">
                <Heading level={4}>Raw game context</Heading>
                <Text className="status-copy">
                  Match {boxscoreDetails.matchId}. Boxscore JSON is cached server-side and
                  used to resolve connected predictions.
                </Text>
                <div className="chip-group">
                  {renderBoxscoreContext(boxscoreDetails.boxscore)}
                </div>
              </article>
            </div>
          ) : null}
        </section>
      ) : null}

      {activeSection === "predictions" ? (
        <PredictionPanel workspace={displayWorkspace} />
      ) : null}

      {activeSection === "league" ? (
        <section className="dashboard-card">
          <Text className="eyebrow">League Intel</Text>
          <Heading level={2}>
            {workspace.leagueIntel.league?.name ?? "League standings"}
          </Heading>
          <div className="dashboard-grid two-column">
            {workspace.leagueIntel.standings.length ? (
              workspace.leagueIntel.standings.map((conference) => (
                <article className="subpanel" key={conference.index}>
                  <Heading level={4}>Conference {conference.index + 1}</Heading>
                  <div className="table-wrap">
                    <table className="dashboard-table compact-table">
                      <thead>
                        <tr>
                          <th>Team</th>
                          <th>W-L</th>
                          <th>Margin</th>
                        </tr>
                      </thead>
                      <tbody>
                        {conference.teams.map((team) => (
                          <tr key={team.teamId ?? team.teamName}>
                            <td>{team.teamName ?? "Unknown team"}</td>
                            <td>
                              {team.wins ?? 0}-{team.losses ?? 0}
                            </td>
                            <td>{formatSigned(team.pointMargin)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>
              ))
            ) : (
              <article className="subpanel">
                <Text>No standings snapshot is cached yet.</Text>
              </article>
            )}
          </div>
        </section>
      ) : null}

      {activeSection === "players" ? (
        <section className="dashboard-card">
          <Text className="eyebrow">Player Lab</Text>
          <Heading level={2}>Comparison, salary, and flag fit</Heading>
          {playerTrendError ? <div className="inline-alert">{playerTrendError}</div> : null}
          {salaryProjectionError ? (
            <div className="inline-alert">{salaryProjectionError}</div>
          ) : null}
          <div className="table-wrap">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Role</th>
                  <th>Salary</th>
                  <th>Shape</th>
                  <th>DMI</th>
                  <th>Starts</th>
                  <th>Analysis</th>
                </tr>
              </thead>
              <tbody>
                {workspace.playerLab.players.length ? (
                  workspace.playerLab.players.map((player) => (
                    <tr key={player.playerId ?? player.fullName}>
                      <td>{player.fullName}</td>
                      <td>{player.bestPosition ?? "N/A"}</td>
                      <td>{formatCurrency(player.salary)}</td>
                      <td>{player.gameShape ?? "N/A"}</td>
                      <td>{player.dmi ?? "N/A"}</td>
                      <td>{player.projectedStarterCount ?? 0}</td>
                      <td className="analysis-actions">
                        <Button
                          size="small"
                          className="secondary-button"
                          onClick={() => void handleLoadPlayerTrend(player)}
                          isLoading={loadingTrendPlayerId === player.playerId}
                          isDisabled={!player.playerId}
                        >
                          Trend
                        </Button>
                        <Button
                          size="small"
                          className="secondary-button"
                          onClick={() => void handleLoadSalaryProjection(player)}
                          isLoading={loadingSalaryPlayerId === player.playerId}
                          isDisabled={!player.playerId}
                        >
                          Salary
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7}>Player lab data is not available yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="dashboard-grid two-column">
            <article className="subpanel">
              <div className="section-header">
                <div>
                  <Heading level={4}>
                    {String(playerTrend?.player.fullName ?? "Player")} trend
                  </Heading>
                  <Text className="status-copy">
                    Weekly snapshots from the cached workspace history.
                  </Text>
                </div>
              </div>
              {playerTrend ? (
                <>
                  {playerTrend.history.length > 1 ? (
                    <PlayerTrendChart history={playerTrend.history} />
                  ) : (
                    <Text>Need at least two weekly snapshots to draw a trend chart.</Text>
                  )}
                  <div className="snapshot-grid">
                    {playerTrend.history.slice(-4).reverse().map((point) => (
                      <article
                        className="summary-card"
                        key={point.weekKey ?? point.fetchedAt ?? "snapshot"}
                      >
                        <span className="summary-label">{point.weekKey ?? "Snapshot"}</span>
                        <strong className="summary-value">
                          {formatCurrency(point.salary)}
                        </strong>
                        <span className="summary-detail">
                          DMI {point.dmi ?? "N/A"} • {point.gameShape ?? "N/A"} • Injury {formatInjury(point.injuryWeeks)}
                        </span>
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <Text className="status-copy">
                  Load a player trend to inspect weekly salary, DMI, and availability changes.
                </Text>
              )}
            </article>

            <article className="subpanel">
              <Heading level={4}>Salary projection</Heading>
              {salaryProjection ? (
                <div className="summary-strip">
                  <article className="summary-card">
                    <span className="summary-label">Player</span>
                    <strong className="summary-value">
                      {salaryProjection.fullName ?? "Unknown player"}
                    </strong>
                    <span className="summary-detail">
                      {salaryProjection.bestPosition ?? "No listed role"}
                    </span>
                  </article>
                  <article className="summary-card">
                    <span className="summary-label">Current salary</span>
                    <strong className="summary-value">
                      {formatCurrency(salaryProjection.currentSalary)}
                    </strong>
                    <span className="summary-detail">
                      Trend {salaryProjection.trend}
                    </span>
                  </article>
                  <article className="summary-card">
                    <span className="summary-label">Projected next week</span>
                    <strong className="summary-value">
                      {formatCurrency(salaryProjection.projectedSalary)}
                    </strong>
                    <span className="summary-detail">
                      Δ {formatSigned((salaryProjection.weeklyDelta ?? 0) / 1)}
                    </span>
                  </article>
                  <article className="summary-card">
                    <span className="summary-label">Flag fit</span>
                    <strong className="summary-value">
                      {salaryProjection.isFlagTarget ? "Aligned" : "Not aligned"}
                    </strong>
                    <span className="summary-detail">
                      {salaryProjection.flagReason ?? "No flag guidance available."}
                    </span>
                  </article>
                </div>
              ) : (
                <Text className="status-copy">
                  Load a salary projection to estimate next-week movement and flag fit.
                </Text>
              )}
            </article>
          </div>
        </section>
      ) : null}

      {activeSection === "ops" ? <OperationsPanel /> : null}
    </>
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="summary-card">
      <span className="summary-label">{label}</span>
      <strong className="summary-value">{value}</strong>
      <span className="summary-detail">{detail}</span>
    </article>
  );
}

function readPayload<T>(response: WorkspaceResponse | JsonLookupResponse): T {
  return (response.payload ?? {}) as T;
}

function renderTrendChips(prefix: string, values: Record<string, number>) {
  const entries = Object.entries(values);
  if (!entries.length) {
    return <span className="chip muted-chip">{prefix}: no data</span>;
  }

  return entries.map(([label, count]) => (
    <span className="chip" key={`${prefix}-${label}`}>
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
      <div className="rating-table-row" key="empty-metrics">
        <span className="rating-label">No cached metrics</span>
        <span className="rating-label">-</span>
        <span className="rating-label">-</span>
      </div>
    );
  }

  return keys.slice(0, 8).map((key) => (
    <div className="rating-table-row" key={key}>
      <span className="rating-label">{humanizeKey(key)}</span>
      <span>{formatMetricValue(left?.[key])}</span>
      <span>{formatMetricValue(right?.[key])}</span>
    </div>
  ));
}

function renderBoxscoreContext(boxscore: Record<string, unknown> | null) {
  if (!boxscore) {
    return <span className="chip muted-chip">No raw boxscore context</span>;
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
    return <span className="chip muted-chip">No raw boxscore context</span>;
  }

  return tags.map((tag) => (
    <span className="chip" key={tag}>
      {tag}
    </span>
  ));
}

function PlayerTrendChart({ history }: { history: PlayerTrendPayload["history"] }) {
  const width = 720;
  const height = 220;
  const padding = 20;
  const salarySeries = buildTrendSeries(history, (point) => point.salary, width, height, padding);
  const dmiSeries = buildTrendSeries(history, (point) => point.dmi, width, height, padding);

  return (
    <div className="trend-card">
      <svg
        className="trend-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Player trend chart"
      >
        <rect x="0" y="0" width={width} height={height} rx="20" className="trend-surface" />
        <line
          x1={padding}
          y1={height - padding}
          x2={width - padding}
          y2={height - padding}
          className="trend-axis-line"
        />
        {salarySeries ? (
          <polyline
            fill="none"
            stroke="var(--accent)"
            strokeWidth="4"
            points={salarySeries}
          />
        ) : null}
        {dmiSeries ? (
          <polyline
            fill="none"
            stroke="#235573"
            strokeWidth="3"
            strokeDasharray="8 6"
            points={dmiSeries}
          />
        ) : null}
      </svg>
      <div className="trend-legend">
        <span className="chip">Salary</span>
        <span className="chip secondary-chip">DMI</span>
      </div>
      <div className="trend-labels">
        {history.map((point) => (
          <span key={point.weekKey ?? point.fetchedAt ?? "trend-point"}>
            {point.weekKey ?? formatTimestamp(point.fetchedAt)}
          </span>
        ))}
      </div>
    </div>
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

function buildTrendSeries(
  history: PlayerTrendPayload["history"],
  readValue: (point: PlayerTrendPayload["history"][number]) => number | null,
  width: number,
  height: number,
  padding: number,
): string | null {
  const values = history
    .map((point) => readValue(point))
    .filter((value): value is number => value !== null);

  if (values.length < 2) {
    return null;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const xStep = history.length > 1 ? (width - padding * 2) / (history.length - 1) : 0;
  const yRange = max - min || 1;

  return history
    .map((point, index) => {
      const value = readValue(point);
      if (value === null) {
        return null;
      }

      const x = padding + index * xStep;
      const y = height - padding - ((value - min) / yRange) * (height - padding * 2);
      return `${x},${y}`;
    })
    .filter((point): point is string => Boolean(point))
    .join(" ");
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asDisplayString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
