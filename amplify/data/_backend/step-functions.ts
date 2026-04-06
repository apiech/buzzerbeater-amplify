import { createHash } from "node:crypto";

import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";

type JsonRecord = Record<string, unknown>;

type StartStateMachineExecutionArgs = {
  input: JsonRecord;
  name: string;
  region?: string;
  stateMachineArn: string;
};

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
  const normalizedPrefix = normalizeNameSegment(prefix, 24);
  const normalizedKey = normalizeNameSegment(key, 48);
  const candidate = `${normalizedPrefix}-${normalizedKey}`.replace(/^-+|-+$/g, "");
  if (candidate.length <= 80) {
    return candidate;
  }

  const digest = createHash("sha1").update(candidate).digest("hex").slice(0, 12);
  return `${normalizedPrefix}-${digest}`;
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

function normalizeNameSegment(value: string, maxLength: number): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return (normalized || "execution").slice(0, maxLength);
}
