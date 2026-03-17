import type {
  BBApiArena,
  BBApiBoxScore,
  BBApiCurrentWorkspace,
  BBApiEconomy,
  BBApiLeagues,
  BBApiPlayer,
  BBApiRoster,
  BBApiSchedule,
  BBApiSeasons,
  BBApiStandings,
  BBApiTeamInfo,
  BBApiTeamStats,
} from "./types";
import {
  parseArena,
  parseBoxScore,
  parseEconomy,
  parseLeagues,
  parsePlayer,
  parseRoster,
  parseSchedule,
  parseSeasons,
  parseStandings,
  parseTeamInfo,
  parseTeamStats,
} from "./parser";

const DEFAULT_BASE_URL = "http://bbapi.buzzerbeater.com";
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_REQUEST_ATTEMPTS = 3;

export class BBXmlApiError extends Error {
  constructor(
    message: string,
    readonly endpoint?: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "BBXmlApiError";
  }
}

export type BBXmlApiClientOptions = {
  username: string;
  securityCode: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export class BBXmlApiClient {
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly securityCode: string;
  private readonly fetchImpl: typeof fetch;
  private cookieHeader: string | null = null;

  constructor(options: BBXmlApiClientOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.username = options.username;
    this.securityCode = options.securityCode;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async login(extraParams?: { secondteam?: boolean; quickinfo?: boolean }): Promise<string> {
    const xml = await this.request("login.aspx", {
      login: this.username,
      code: this.securityCode,
      ...(extraParams?.secondteam ? { secondteam: 1 } : {}),
      ...(extraParams?.quickinfo ? { quickinfo: 1 } : {}),
    }, false);

    if (!/<loggedIn\b/i.test(xml) && !extraParams?.quickinfo) {
      throw new BBXmlApiError(
        extractErrorMessage(xml) ?? "BuzzerBeater login failed.",
        "login.aspx",
        200,
        xml,
      );
    }

    return xml;
  }

  async logout(): Promise<void> {
    try {
      await this.request("logout.aspx", undefined, false);
    } finally {
      this.cookieHeader = null;
    }
  }

  async getTeamInfo(teamId?: string): Promise<BBApiTeamInfo> {
    return parseTeamInfo(await this.request("teaminfo.aspx", teamId ? { teamid: teamId } : undefined));
  }

  async getRoster(teamId?: string): Promise<BBApiRoster> {
    return parseRoster(await this.request("roster.aspx", teamId ? { teamid: teamId } : undefined));
  }

  async getPlayer(playerId: string): Promise<BBApiPlayer> {
    return parsePlayer(await this.request("player.aspx", { playerid: playerId }));
  }

  async getSchedule(teamId?: string, season?: number): Promise<BBApiSchedule> {
    const params: Record<string, string | number> = {};
    if (teamId) {
      params.teamid = teamId;
    }
    if (season !== undefined) {
      params.season = season;
    }
    return parseSchedule(await this.request("schedule.aspx", Object.keys(params).length ? params : undefined));
  }

  async getSeasons(): Promise<BBApiSeasons> {
    return parseSeasons(await this.request("seasons.aspx"));
  }

  async getSeasonsXml(): Promise<string> {
    return this.request("seasons.aspx");
  }

  async getStandings(leagueId?: string, season?: number): Promise<BBApiStandings> {
    const params: Record<string, string | number> = {};
    if (leagueId) {
      params.leagueid = leagueId;
    }
    if (season !== undefined) {
      params.season = season;
    }
    return parseStandings(await this.request("standings.aspx", Object.keys(params).length ? params : undefined));
  }

  async getBoxScore(matchId?: string): Promise<BBApiBoxScore> {
    return parseBoxScore(await this.request("boxscore.aspx", matchId ? { matchid: matchId } : undefined));
  }

  async getBoxScoreXml(matchId?: string): Promise<string> {
    return this.request("boxscore.aspx", matchId ? { matchid: matchId } : undefined);
  }

  async getArena(teamId?: string): Promise<BBApiArena> {
    return parseArena(await this.request("arena.aspx", teamId ? { teamid: teamId } : undefined));
  }

  async getEconomy(): Promise<BBApiEconomy> {
    return parseEconomy(await this.request("economy.aspx"));
  }

  async getTeamStats(teamId?: string, season?: number, mode: "averages" | "totals" = "averages"): Promise<BBApiTeamStats> {
    const params: Record<string, string | number> = { mode };
    if (teamId) {
      params.teamid = teamId;
    }
    if (season !== undefined) {
      params.season = season;
    }
    return parseTeamStats(await this.request("teamstats.aspx", params));
  }

  async getLeagues(countryId: string, level: number): Promise<BBApiLeagues> {
    return parseLeagues(await this.request("leagues.aspx", { countryid: countryId, level }));
  }

  async getCurrentWorkspace(): Promise<BBApiCurrentWorkspace> {
    const seasons = await this.getSeasons();
    const currentSeason = seasons.seasons
      .map((season) => season.id)
      .filter((seasonId): seasonId is number => seasonId !== null)
      .sort((left, right) => right - left)[0];

    const teamInfo = await this.getTeamInfo();
    const [roster, schedule, teamStats] = await Promise.all([
      this.getRoster(teamInfo.teamId ?? undefined),
      this.getSchedule(teamInfo.teamId ?? undefined, currentSeason),
      this.getTeamStats(teamInfo.teamId ?? undefined, currentSeason, "averages"),
    ]);

    const standings = teamInfo.league?.id
      ? await this.getStandings(teamInfo.league.id, currentSeason)
      : null;

    return {
      teamInfo,
      roster,
      schedule,
      standings,
      teamStats,
    };
  }

  private async request(
    endpoint: string,
    params?: Record<string, string | number>,
    autoLogin = true,
  ): Promise<string> {
    if (!this.cookieHeader && autoLogin) {
      await this.login();
    }

    const url = new URL(`${this.baseUrl}/${endpoint}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      url.searchParams.set(key, String(value));
    }

    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.fetchImpl(url, {
          method: "GET",
          headers: this.cookieHeader ? { cookie: this.cookieHeader } : undefined,
          cache: "no-store",
        });

        const body = await response.text();

        if (!response.ok) {
          const error = new BBXmlApiError(
            `BB API request failed for ${endpoint}: ${response.status} ${response.statusText}`,
            endpoint,
            response.status,
            body,
          );
          if (shouldRetryRequest(error) && attempt < MAX_REQUEST_ATTEMPTS - 1) {
            await waitForRetry(attempt);
            continue;
          }
          throw error;
        }

        this.captureCookies(response);

        const errorMessage = extractErrorMessage(body);
        if (errorMessage) {
          throw new BBXmlApiError(errorMessage, endpoint, response.status, body);
        }

        return body;
      } catch (error) {
        lastError = error;
        if (!shouldRetryRequest(error) || attempt >= MAX_REQUEST_ATTEMPTS - 1) {
          throw error;
        }
        await waitForRetry(attempt);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("The BB API request failed after retries.");
  }

  private captureCookies(response: Response): void {
    const headers = response.headers as Headers & Partial<{ getSetCookie: () => string[] }>;
    const rawCookies =
      "getSetCookie" in headers && typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : splitSetCookieHeader(response.headers.get("set-cookie"));
    if (!rawCookies.length) {
      return;
    }
    const cookiePairs = rawCookies
      .map((cookie) => (cookie.split(";", 1)[0] ?? "").trim())
      .filter((cookie): cookie is string => Boolean(cookie));
    if (!cookiePairs.length) {
      return;
    }
    this.cookieHeader = cookiePairs.join("; ");
  }
}

export function extractErrorMessage(xml: string): string | null {
  const match = xml.match(/<error\b[^>]*message=['"]([^'"]+)['"]/i);
  return match?.[1] ?? null;
}

function splitSetCookieHeader(headerValue: string | null): string[] {
  if (!headerValue) {
    return [];
  }
  return headerValue.split(/,(?=[^;]+=[^;]+)/g);
}

function shouldRetryRequest(error: unknown): boolean {
  if (error instanceof BBXmlApiError) {
    return Boolean(error.status && RETRYABLE_STATUS_CODES.has(error.status));
  }

  return error instanceof Error;
}

async function waitForRetry(attempt: number): Promise<void> {
  const delayMs = 250 * 2 ** attempt;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
