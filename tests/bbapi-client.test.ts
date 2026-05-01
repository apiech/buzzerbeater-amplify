import assert from "node:assert/strict";
import test from "node:test";

import {
  BBXmlApiClient,
  BBXmlApiError,
  BBXmlApiParseError,
} from "../lib/bbapi/client";

test("BBXmlApiClient retries transient upstream failures", async () => {
  let attempts = 0;
  const client = new BBXmlApiClient({
    username: "coach",
    securityCode: "secret",
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response("upstream unavailable", {
          status: 503,
          statusText: "Service Unavailable",
        });
      }

      return new Response("<loggedIn />", {
        status: 200,
        headers: {
          "set-cookie": "bb_session=ok; Path=/; HttpOnly",
        },
      });
    },
  });

  await client.login();

  assert.equal(attempts, 2);
});

test("BBXmlApiClient does not retry invalid credentials", async () => {
  let attempts = 0;
  const client = new BBXmlApiClient({
    username: "coach",
    securityCode: "bad-secret",
    fetchImpl: async () => {
      attempts += 1;
      return new Response('<error message="BuzzerBeater login failed." />', {
        status: 200,
      });
    },
  });

  await assert.rejects(() => client.login(), BBXmlApiError);
  assert.equal(attempts, 1);
});

test("BBXmlApiClient exposes raw seasons XML", async () => {
  const requests: string[] = [];
  const client = new BBXmlApiClient({
    username: "coach",
    securityCode: "secret",
    fetchImpl: async (input) => {
      const url = input instanceof URL ? input : new URL(String(input));
      requests.push(url.pathname);

      if (url.pathname.endsWith("/login.aspx")) {
        return new Response("<loggedIn />", {
          status: 200,
          headers: {
            "set-cookie": "bb_session=ok; Path=/; HttpOnly",
          },
        });
      }

      return new Response("<bbapi><seasons /></bbapi>", {
        status: 200,
      });
    },
  });

  const xml = await client.getSeasonsXml();

  assert.equal(xml, "<bbapi><seasons /></bbapi>");
  assert.deepStrictEqual(requests, ["/login.aspx", "/seasons.aspx"]);
});

test("BBXmlApiClient classifies malformed boxscore payloads as parse errors", async () => {
  const client = new BBXmlApiClient({
    username: "coach",
    securityCode: "secret",
    fetchImpl: async (input) => {
      const url = input instanceof URL ? input : new URL(String(input));
      if (url.pathname.endsWith("/login.aspx")) {
        return new Response("<loggedIn />", {
          status: 200,
          headers: {
            "set-cookie": "bb_session=ok; Path=/; HttpOnly",
          },
        });
      }

      return new Response(
        `<?xml version='1.0' encoding='utf-8'?>
<bbapi version='1'>
  <match id='m1'>
    <awayTeam id='10'>
      <teamName>Away</teamName>
      <score partials='0,0,0,0'>0</score>
      <boxscore>
        <player id='p1'>
          <firstName>Away</firstName>
          <lastName>Example</lastName>
          <minutes>
            <PG>0</PG>
            <SG>0</SG>
            <SF>0</SF>
            <PF>0</PF>
            <C>0</C>
          </minutes>
          <performance>
            <fgm>0</fgm>
            <fga>0</fga>
            <tpm>0</tpm>
            <tpa>0</tpa>
            <ftm>0</ftm>
            <fta>0</fta>
            <oreb>0</oreb>
            <reb>0</reb>
            <ast>0</ast>
            <to>0</to>
            <stl>0</stl>
            <blk>0</blk>
            <pf>0</pf>
            <pts>0</pts>
            <rating>mystery</rating>
          </performance>
        </player>
      </boxscore>
    </awayTeam>
    <homeTeam id='11'>
      <teamName>Home</teamName>
      <score partials='0,0,0,0'>0</score>
      <boxscore>
        <player id='p2'>
          <firstName>Home</firstName>
          <lastName>Baseline</lastName>
          <minutes>
            <PG>5</PG>
            <SG>0</SG>
            <SF>0</SF>
            <PF>0</PF>
            <C>0</C>
          </minutes>
          <performance>
            <fgm>1</fgm>
            <fga>1</fga>
            <tpm>0</tpm>
            <tpa>0</tpa>
            <ftm>0</ftm>
            <fta>0</fta>
            <oreb>0</oreb>
            <reb>1</reb>
            <ast>0</ast>
            <to>0</to>
            <stl>0</stl>
            <blk>0</blk>
            <pf>0</pf>
            <pts>2</pts>
            <rating>12</rating>
          </performance>
        </player>
      </boxscore>
    </homeTeam>
  </match>
</bbapi>`,
        {
          status: 200,
        },
      );
    },
  });

  await assert.rejects(
    () => client.getBoxScore("m1"),
    (error: unknown) => {
      assert.ok(error instanceof BBXmlApiParseError);
      assert.equal(error.endpoint, "boxscore.aspx");
      assert.match(error.message, /Unexpected boxscore player performance\.rating value: mystery\./);
      assert.match(error.bodyPreview ?? "", /<bbapi version='1'>/);
      return true;
    },
  );
});

test("BBXmlApiClient getCurrentWorkspace prefers the schedule season over the highest season id", async () => {
  let requestedStandingsSeason: number | null = null;
  let requestedTeamStatsSeason: number | null = null;

  class StubClient extends BBXmlApiClient {
    async getSeasons() {
      return {
        seasons: [{ id: 72 }, { id: 71 }],
        version: "1",
      } as any;
    }

    async getTeamInfo() {
      return {
        league: { id: "league-1", name: "NBBA" },
        teamId: "team-1",
      } as any;
    }

    async getRoster() {
      return {
        players: [],
      } as any;
    }

    async getSchedule() {
      return {
        matches: [],
        season: 71,
      } as any;
    }

    async getTeamStats(_teamId?: string, season?: number) {
      requestedTeamStatsSeason = season ?? null;
      return null as any;
    }

    async getStandings(_leagueId?: string, season?: number) {
      requestedStandingsSeason = season ?? null;
      return {
        conferences: [],
        season,
      } as any;
    }

    async getArena() {
      return {} as any;
    }

    async getEconomy() {
      return {} as any;
    }
  }

  const client = new StubClient({
    username: "coach",
    securityCode: "secret",
    fetchImpl: async () => new Response(""),
  });

  const workspace = await client.getCurrentWorkspace();

  assert.equal(workspace.currentSeason, 71);
  assert.equal(requestedTeamStatsSeason, 71);
  assert.equal(requestedStandingsSeason, 71);
});

test("BBXmlApiClient getCurrentWorkspace falls back to the highest season id when the schedule season is missing", async () => {
  let requestedStandingsSeason: number | null = null;

  class StubClient extends BBXmlApiClient {
    async getSeasons() {
      return {
        seasons: [{ id: 72 }, { id: 71 }],
        version: "1",
      } as any;
    }

    async getTeamInfo() {
      return {
        league: { id: "league-1", name: "NBBA" },
        teamId: "team-1",
      } as any;
    }

    async getRoster() {
      return {
        players: [],
      } as any;
    }

    async getSchedule() {
      return {
        matches: [],
        season: null,
      } as any;
    }

    async getTeamStats() {
      return null as any;
    }

    async getStandings(_leagueId?: string, season?: number) {
      requestedStandingsSeason = season ?? null;
      return {
        conferences: [],
        season,
      } as any;
    }

    async getArena() {
      return {} as any;
    }

    async getEconomy() {
      return {} as any;
    }
  }

  const client = new StubClient({
    username: "coach",
    securityCode: "secret",
    fetchImpl: async () => new Response(""),
  });

  const workspace = await client.getCurrentWorkspace();

  assert.equal(workspace.currentSeason, 72);
  assert.equal(requestedStandingsSeason, 72);
});
