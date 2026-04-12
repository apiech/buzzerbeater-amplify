import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { client } from "../app/amplify-client";
import {
  fetchHomeWorkspaceQuery,
  fetchScoutTeamSummaryQuery,
  fetchTeamHighlightsQuery,
} from "../app/dashboard/workspace-query-client";

function installQueryMock<
  TName extends keyof typeof client.queries,
>(
  t: TestContext,
  name: TName,
  handler: typeof client.queries[TName],
) {
  const original = client.queries[name];
  client.queries[name] = handler;
  t.after(() => {
    client.queries[name] = original;
  });
}

test("home workspace parsing accepts key-based tendencies and omits home connection userId", async (t) => {
  installQueryMock(t, "getHomeWorkspace", async () => ({
    data: {
      connection: {
        bbLoginName: "apiech",
        status: "CONNECTED",
        teamName: "Visionaries",
      },
      league: {
        league: {
          id: "nbba",
          name: "NBBA",
        },
        standings: [],
      },
      nextMatch: null,
      nextOpponent: {
        injuries: [],
        record: {
          losses: 8,
          wins: 8,
        },
        teamId: "opp-1",
        teamName: "Rivals",
        tendencies: {
          defense: [{ count: 1, key: "ManToMan" }],
          offense: [{ count: 2, key: "Push" }],
        },
      },
      nextScoutMatch: null,
      recentMatches: [],
      syncedAt: "2026-04-11T22:07:00.000Z",
      team: {
        injuries: [],
        record: {
          losses: 6,
          wins: 10,
        },
        shortName: "Visionaries",
        teamId: "our-1",
        teamName: "Visionaries",
        topPlayers: [],
      },
    },
    errors: null,
  }));

  const workspace = await fetchHomeWorkspaceQuery();

  assert.equal(workspace.connection.userId, undefined);
  assert.deepStrictEqual(workspace.nextOpponent?.tendencies.offense, [
    { count: 2, key: "Push" },
  ]);
});

test("scout summary parsing accepts key-based tendencies", async (t) => {
  installQueryMock(t, "getScoutTeamSummary", async () => ({
    data: {
      availableOpponents: [],
      message: null,
      recentMatchups: [],
      requestedTeamId: "opp-1",
      schedule: null,
      summary: {
        matchupPerspective: {
          opponentTeamId: "opp-1",
          ourTeamId: "our-1",
        },
        nextMatch: null,
        recentGames: [],
        record: {
          losses: 8,
          wins: 8,
        },
        roster: [],
        tendencies: {
          defense: [{ count: 1, key: "23Zone" }],
          offense: [{ count: 2, key: "Push" }],
        },
        teamName: "Rivals",
        topPlayers: [],
      },
      syncedAt: "2026-04-11T22:07:00.000Z",
      teamId: "opp-1",
    },
    errors: null,
  }));

  const scout = await fetchScoutTeamSummaryQuery({ teamId: "opp-1" });

  assert.ok(scout?.summary);
  assert.deepStrictEqual(scout.summary.tendencies.defense, [
    { count: 1, key: "23Zone" },
  ]);
});

test("team highlights parsing accepts string periods from the generated API contract", async (t) => {
  installQueryMock(t, "getMyTeamHighlights", async () => ({
    data: {
      filters: {
        onlyOutcomeChange: true,
        perspective: "BOTH",
      },
      items: [
        {
          comment: "Buzzer beater.",
          eventKind: "shot",
          matchId: "m-1",
          momentId: "moment-1",
          outcomeChanged: true,
          period: "Q4",
          perspective: "FOR",
          playerName: "Closer",
          recordId: "record-1",
          teamId: "team-1",
          viewerUrl: "https://example.com/viewer",
        },
      ],
      nextCursor: null,
      scanStatus: null,
      summary: {
        againstMoments: 0,
        filteredMoments: 1,
        forMoments: 1,
        outcomeChangeMoments: 1,
        totalMoments: 1,
      },
      team: {
        teamId: "team-1",
        teamName: "Visionaries",
      },
    },
    errors: null,
  }));

  const payload = await fetchTeamHighlightsQuery({
    onlyOutcomeChange: true,
    perspective: "BOTH",
  });

  assert.equal(payload?.items[0]?.period, "Q4");
});
