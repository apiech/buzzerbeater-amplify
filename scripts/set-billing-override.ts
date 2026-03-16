import process from "node:process";

type PlanId = "free" | "premium";

type ParsedArgs = {
  expiresAt: string | null;
  help: boolean;
  planId: PlanId | null;
  reason: string | null;
  shouldClear: boolean;
  token: string | null;
  url: string | null;
  userId: string | null;
};

type BillingOverrideResponse = {
  billingSummary?: unknown;
  error?: string;
  userId?: string;
};

const HELP_TEXT = `Usage:
  npm run billing:override -- --user-id <user-id> --plan premium [--expires-at <iso8601>] [--reason <text>]
  npm run billing:override -- --user-id <user-id> --clear

Options:
  --user-id <value>     Required. Auth user id to update.
  --plan <free|premium> Plan to grant as an override.
  --clear               Remove any existing override.
  --expires-at <value>  Optional ISO-8601 timestamp for the override expiry.
  --reason <value>      Optional note stored with the override.
  --url <value>         Override endpoint URL. Defaults to BILLING_ADMIN_OVERRIDE_URL.
  --token <value>       Bearer token. Defaults to BILLING_ADMIN_TOKEN.
  --help                Show this message.

Examples:
  npm run billing:override -- --user-id abc123 --plan premium --reason "alpha access"
  npm run billing:override -- --user-id abc123 --plan premium --expires-at 2026-04-30T23:59:59Z --reason "beta access"
  npm run billing:override -- --user-id abc123 --clear
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(HELP_TEXT);
    return;
  }

  const url = args.url ?? normalizeOptionalString(process.env.BILLING_ADMIN_OVERRIDE_URL);
  const token = args.token ?? normalizeOptionalString(process.env.BILLING_ADMIN_TOKEN);
  const userId = normalizeOptionalString(args.userId);

  if (!url) {
    throw new Error(
      "Billing override URL is required. Pass --url or set BILLING_ADMIN_OVERRIDE_URL.",
    );
  }

  if (!token) {
    throw new Error(
      "Billing admin token is required. Pass --token or set BILLING_ADMIN_TOKEN.",
    );
  }

  if (!userId) {
    throw new Error("--user-id is required.");
  }

  if (args.shouldClear && args.planId !== null) {
    throw new Error("Use either --plan or --clear, not both.");
  }

  if (!args.shouldClear && args.planId === null) {
    throw new Error("Pass --plan <free|premium> or --clear.");
  }

  if (args.shouldClear && (args.expiresAt !== null || args.reason !== null)) {
    throw new Error("--expires-at and --reason cannot be used with --clear.");
  }

  if (args.expiresAt !== null) {
    assertIsoDateTime(args.expiresAt);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      overrideExpiresAt: args.shouldClear ? null : args.expiresAt,
      overrideReason: args.shouldClear ? null : args.reason,
      planId: args.shouldClear ? null : args.planId,
      userId,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as BillingOverrideResponse;

  if (!response.ok) {
    throw new Error(
      payload.error ||
        `Billing override request failed with status ${response.status}.`,
    );
  }

  console.log(JSON.stringify(payload, null, 2));
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    expiresAt: null,
    help: false,
    planId: null,
    reason: null,
    shouldClear: false,
    token: null,
    url: null,
    userId: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--clear":
        parsed.shouldClear = true;
        break;
      case "--expires-at":
        parsed.expiresAt = readOptionValue(argv, ++index, "--expires-at");
        break;
      case "--plan":
        parsed.planId = readPlanId(readOptionValue(argv, ++index, "--plan"));
        break;
      case "--reason":
        parsed.reason = readOptionValue(argv, ++index, "--reason");
        break;
      case "--token":
        parsed.token = readOptionValue(argv, ++index, "--token");
        break;
      case "--url":
        parsed.url = readOptionValue(argv, ++index, "--url");
        break;
      case "--user-id":
        parsed.userId = readOptionValue(argv, ++index, "--user-id");
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return parsed;
}

function readOptionValue(
  argv: readonly string[],
  index: number,
  optionName: string,
): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${optionName} requires a value.`);
  }

  return value;
}

function readPlanId(value: string): PlanId {
  if (value === "free" || value === "premium") {
    return value;
  }

  throw new Error(`Unsupported plan: ${value}`);
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function assertIsoDateTime(value: string): void {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid --expires-at value: ${value}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
