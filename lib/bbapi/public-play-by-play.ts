import { z } from "zod";

const PUBLIC_PLAY_BY_PLAY_BASE_URL = "https://api.buzzerbeater.com/BBAPI/";
const BODY_PREVIEW_LIMIT = 500;

const publicMatchPlayByPlayEventSchema = z
  .object({
    clock: z.string().nullable().optional(),
    eventText: z.string().nullable().optional(),
    homeScore: z.number(),
    awayScore: z.number(),
    id: z.number(),
    isScoringPlay: z.boolean(),
    keyPlayerId: z.number().nullable().optional(),
    quarter: z.number().int().nonnegative(),
    type: z.string(),
    wallClock: z.number().int().nonnegative(),
  })
  .passthrough();

const publicMatchPlayByPlaySchema = z
  .object({
    events: z.array(publicMatchPlayByPlayEventSchema),
    matchId: z.number(),
  })
  .passthrough();

export type PublicMatchPlayByPlayEvent = z.infer<
  typeof publicMatchPlayByPlayEventSchema
>;
export type PublicMatchPlayByPlay = z.infer<typeof publicMatchPlayByPlaySchema>;

export class BBPublicPlayByPlayFetchError extends Error {
  constructor(
    message: string,
    readonly endpoint?: string,
    readonly status?: number,
    readonly bodyPreview?: string,
  ) {
    super(message);
    this.name = "BBPublicPlayByPlayFetchError";
  }
}

export class BBPublicPlayByPlayParseError extends Error {
  constructor(
    message: string,
    readonly endpoint?: string,
    readonly bodyPreview?: string,
    cause?: unknown,
  ) {
    super(message, cause ? { cause } : undefined);
    this.name = "BBPublicPlayByPlayParseError";
  }
}

export async function fetchPublicMatchPlayByPlay(
  matchId: number | string,
  fetchImpl: typeof fetch = fetch,
): Promise<PublicMatchPlayByPlay> {
  const normalizedMatchId = String(matchId).trim();
  if (!normalizedMatchId) {
    throw new Error("A match id is required to fetch public play-by-play.");
  }

  const endpoint = `api/Matches/${encodeURIComponent(normalizedMatchId)}/play-by-play?localeName=en`;
  const url = new URL(endpoint, PUBLIC_PLAY_BY_PLAY_BASE_URL);
  const response = await fetchImpl(url, {
    cache: "no-store",
    headers: {
      accept: "application/json",
    },
    method: "GET",
  });
  const body = await response.text();

  if (!response.ok) {
    throw new BBPublicPlayByPlayFetchError(
      `Public play-by-play request failed for ${endpoint}: ${response.status} ${response.statusText}`,
      endpoint,
      response.status,
      buildBodyPreview(body),
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    throw new BBPublicPlayByPlayParseError(
      `Public play-by-play response for ${endpoint} was not valid JSON.`,
      endpoint,
      buildBodyPreview(body),
      error,
    );
  }

  try {
    return publicMatchPlayByPlaySchema.parse(parsed);
  } catch (error) {
    throw new BBPublicPlayByPlayParseError(
      `Public play-by-play response for ${endpoint} did not match the expected shape.`,
      endpoint,
      buildBodyPreview(body),
      error,
    );
  }
}

function buildBodyPreview(body: string): string | undefined {
  const trimmed = body.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length <= BODY_PREVIEW_LIMIT) {
    return trimmed;
  }
  return `${trimmed.slice(0, BODY_PREVIEW_LIMIT)}...`;
}
