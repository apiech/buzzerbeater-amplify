import { createHash } from "node:crypto";

import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";

type JsonRecord = Record<string, unknown>;

type StartStateMachineExecutionArgs = {
  input: JsonRecord;
  name: string;
  region?: string;
  stateMachineArn: string;
};

const MAX_EXECUTION_NAME_LENGTH = 80;
const MAX_PREFIX_LENGTH = 24;
const DIGEST_LENGTH = 12;
const clientCache = new Map<string, SFNClient>();

export async function startStateMachineExecution(
  args: StartStateMachineExecutionArgs,
): Promise<string> {
  const client = getClient(args.region);
  const response = await client.send(
    new StartExecutionCommand({
      input: JSON.stringify(args.input),
      name: args.name,
      stateMachineArn: args.stateMachineArn,
    }),
  );

  if (!response.executionArn) {
    throw new Error(
      `Step Functions did not return an execution ARN for ${args.stateMachineArn}.`,
    );
  }

  return response.executionArn;
}

export function buildExecutionName(prefix: string, key: string): string {
  const normalizedPrefix = normalizeNameSegment(prefix, MAX_PREFIX_LENGTH);
  const normalizedKey = normalizeNameSegment(key);
  const candidate = joinExecutionNameSegments(normalizedPrefix, normalizedKey);
  if (candidate.length <= MAX_EXECUTION_NAME_LENGTH) {
    return candidate;
  }

  const digest = createHash("sha1").update(candidate).digest("hex").slice(0, DIGEST_LENGTH);
  const maxReadableKeyLength = Math.max(
    1,
    MAX_EXECUTION_NAME_LENGTH - normalizedPrefix.length - digest.length - 2,
  );
  return joinExecutionNameSegments(
    normalizedPrefix,
    truncateNormalizedNameSegment(normalizedKey, maxReadableKeyLength),
    digest,
  );
}

function getClient(region?: string): SFNClient {
  const cacheKey = region ?? "default";
  const cachedClient = clientCache.get(cacheKey);
  if (cachedClient) {
    return cachedClient;
  }

  const client = new SFNClient(region ? { region } : {});
  clientCache.set(cacheKey, client);
  return client;
}

function normalizeNameSegment(value: string, maxLength?: number): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const compact = normalized || "execution";
  return typeof maxLength === "number" ? compact.slice(0, maxLength) : compact;
}

function truncateNormalizedNameSegment(value: string, maxLength: number): string {
  const truncated = value.slice(0, maxLength).replace(/-+$/g, "");
  return truncated || "execution";
}

function joinExecutionNameSegments(...segments: string[]): string {
  return segments.filter(Boolean).join("-").replace(/^-+|-+$/g, "");
}
