import os from "node:os";
import process from "node:process";

type MaintenanceReasonCode =
  | "MANUAL"
  | "BUDGET_GUARDRAIL"
  | "LLM_OUTAGE"
  | "BB_API_OUTAGE"
  | "DEPENDENCY_OUTAGE";

type ParsedArgs = {
  action: "activate" | "clear" | "update-message" | null;
  activatedBy: string | null;
  detail: string | null;
  expectedRecoveryAt: string | null;
  headline: string | null;
  help: boolean;
  reasonCode: MaintenanceReasonCode | null;
  token: string | null;
  url: string | null;
};

type MaintenanceAdminResponse = {
  changed?: boolean;
  error?: string;
  state?: unknown;
};

const HELP_TEXT = `Usage:
  npm run maintenance:set -- --activate --reason-code <reason> --headline <text> --detail <text> [--expected-recovery-at <iso8601>] [--activated-by <text>]
  npm run maintenance:set -- --update-message [--reason-code <reason>] [--headline <text>] [--detail <text>] [--expected-recovery-at <iso8601>] [--activated-by <text>]
  npm run maintenance:set -- --clear

Options:
  --activate                Activate maintenance mode.
  --update-message          Update the active maintenance document. Missing fields reuse the current active values.
  --clear                   Clear maintenance mode.
  --reason-code <value>     One of MANUAL, BUDGET_GUARDRAIL, LLM_OUTAGE, BB_API_OUTAGE, DEPENDENCY_OUTAGE.
  --headline <value>        Short status headline shown on /status.
  --detail <value>          Detailed operator message shown on /status.
  --expected-recovery-at    Optional ISO-8601 timestamp.
  --activated-by <value>    Optional operator label. Defaults to the local user.
  --url <value>             Override endpoint URL. Defaults to MAINTENANCE_ADMIN_URL.
  --token <value>           Bearer token. Defaults to MAINTENANCE_ADMIN_TOKEN.
  --help                    Show this message.

Examples:
  npm run maintenance:set -- --activate --reason-code BUDGET_GUARDRAIL --headline "Budget exhausted" --detail "Monthly LLM budget was exhausted. New requests are disabled until the budget resets."
  npm run maintenance:set -- --activate --reason-code LLM_OUTAGE --headline "LLM provider outage" --detail "Bedrock requests are failing upstream."
  npm run maintenance:set -- --update-message --detail "Budget was replenished. Final verification is in progress."
  npm run maintenance:set -- --clear
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(HELP_TEXT);
    return;
  }

  const url =
    args.url ?? normalizeOptionalString(process.env.MAINTENANCE_ADMIN_URL);
  const token =
    args.token ?? normalizeOptionalString(process.env.MAINTENANCE_ADMIN_TOKEN);

  if (!url) {
    throw new Error(
      "Maintenance admin URL is required. Pass --url or set MAINTENANCE_ADMIN_URL.",
    );
  }

  if (!token) {
    throw new Error(
      "Maintenance admin token is required. Pass --token or set MAINTENANCE_ADMIN_TOKEN.",
    );
  }

  if (args.action === null) {
    throw new Error("Choose one of --activate, --update-message, or --clear.");
  }

  if (args.action === "clear") {
    if (
      args.reasonCode !== null ||
      args.headline !== null ||
      args.detail !== null ||
      args.expectedRecoveryAt !== null
    ) {
      throw new Error(
        "--reason-code, --headline, --detail, and --expected-recovery-at cannot be used with --clear.",
      );
    }
  } else if (args.action === "activate") {
    if (args.reasonCode === null) {
      throw new Error("--reason-code is required with --activate.");
    }
    if (args.headline === null) {
      throw new Error("--headline is required with --activate.");
    }
    if (args.detail === null) {
      throw new Error("--detail is required with --activate.");
    }
  }

  if (args.expectedRecoveryAt !== null) {
    assertIsoDateTime(args.expectedRecoveryAt);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: args.action,
      activatedBy:
        args.activatedBy ??
        normalizeOptionalString(readLocalUserName()) ??
        "cli",
      detail: args.detail,
      expectedRecoveryAt: args.expectedRecoveryAt,
      headline: args.headline,
      reasonCode: args.reasonCode,
    }),
  });

  const payload = (await response
    .json()
    .catch(() => ({}))) as MaintenanceAdminResponse;
  if (!response.ok) {
    throw new Error(
      payload.error ||
        `Maintenance request failed with status ${response.status}.`,
    );
  }

  console.log(JSON.stringify(payload, null, 2));
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    action: null,
    activatedBy: null,
    detail: null,
    expectedRecoveryAt: null,
    headline: null,
    help: false,
    reasonCode: null,
    token: null,
    url: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) {
      continue;
    }

    switch (argument) {
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--activate":
        parsed.action = "activate";
        break;
      case "--update-message":
        parsed.action = "update-message";
        break;
      case "--clear":
        parsed.action = "clear";
        break;
      case "--activated-by":
        parsed.activatedBy = readOptionValue(argv, ++index, "--activated-by");
        break;
      case "--detail":
        parsed.detail = readOptionValue(argv, ++index, "--detail");
        break;
      case "--expected-recovery-at":
        parsed.expectedRecoveryAt = readOptionValue(
          argv,
          ++index,
          "--expected-recovery-at",
        );
        break;
      case "--headline":
        parsed.headline = readOptionValue(argv, ++index, "--headline");
        break;
      case "--reason-code":
        parsed.reasonCode = readReasonCode(
          readOptionValue(argv, ++index, "--reason-code"),
        );
        break;
      case "--token":
        parsed.token = readOptionValue(argv, ++index, "--token");
        break;
      case "--url":
        parsed.url = readOptionValue(argv, ++index, "--url");
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

function readReasonCode(value: string): MaintenanceReasonCode {
  switch (value) {
    case "MANUAL":
    case "BUDGET_GUARDRAIL":
    case "LLM_OUTAGE":
    case "BB_API_OUTAGE":
    case "DEPENDENCY_OUTAGE":
      return value;
    default:
      throw new Error(`Unsupported reason code: ${value}`);
  }
}

function normalizeOptionalString(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function readLocalUserName(): string | null {
  try {
    return os.userInfo().username;
  } catch {
    return null;
  }
}

function assertIsoDateTime(value: string): void {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid --expected-recovery-at value: ${value}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
