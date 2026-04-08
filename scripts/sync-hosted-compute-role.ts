import { execFileSync } from "node:child_process";
import process from "node:process";

const DEFAULT_REGION = "us-east-1";
const HOSTED_COMPUTE_ROLE_NESTED_STACK_PREFIX = "hostedcomputerole";
const HOSTED_COMPUTE_ROLE_OUTPUT_KEY = "HostedSsrComputeRoleArn";

type AwsCliRuntime = {
  execAwsJson: (args: string[]) => unknown;
  write: (message: string) => void;
};

type SyncHostedComputeRoleOptions = {
  appId: string;
  branchName: string;
  region?: string;
};

type SyncHostedComputeRoleResult = {
  branchName: string;
  previousRoleArn: string | null;
  roleArn: string;
  status: "attached" | "unchanged" | "updated";
};

export const __testing = {
  parseArgs,
  resolveHostedComputeRoleArn,
  resolveHostedComputeRoleNestedStackArn,
  syncHostedComputeRole,
};

export function parseArgs(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): SyncHostedComputeRoleOptions {
  let appId = normalizeOptionalString(env.AWS_APP_ID);
  let branchName = normalizeOptionalString(env.AWS_BRANCH);
  let region = normalizeOptionalString(env.AWS_REGION) ?? DEFAULT_REGION;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--app-id") {
      appId = normalizeOptionalString(argv[index + 1]);
      index += 1;
      continue;
    }
    if (argument?.startsWith("--app-id=")) {
      appId = normalizeOptionalString(argument.slice("--app-id=".length));
      continue;
    }
    if (argument === "--branch") {
      branchName = normalizeOptionalString(argv[index + 1]);
      index += 1;
      continue;
    }
    if (argument?.startsWith("--branch=")) {
      branchName = normalizeOptionalString(argument.slice("--branch=".length));
      continue;
    }
    if (argument === "--region") {
      region = normalizeOptionalString(argv[index + 1]) ?? DEFAULT_REGION;
      index += 1;
      continue;
    }
    if (argument?.startsWith("--region=")) {
      region =
        normalizeOptionalString(argument.slice("--region=".length)) ??
        DEFAULT_REGION;
    }
  }

  if (!appId) {
    throw new Error("Pass --app-id <amplify-app-id> or set AWS_APP_ID.");
  }
  if (!branchName) {
    throw new Error("Pass --branch <branch-name> or set AWS_BRANCH.");
  }

  return {
    appId,
    branchName,
    region,
  };
}

export function syncHostedComputeRole(
  options: SyncHostedComputeRoleOptions,
  runtime: AwsCliRuntime = createDefaultRuntime(),
): SyncHostedComputeRoleResult {
  const region = normalizeOptionalString(options.region) ?? DEFAULT_REGION;
  const branchPayload = runtime.execAwsJson([
    "amplify",
    "get-branch",
    "--app-id",
    options.appId,
    "--branch-name",
    options.branchName,
    "--region",
    region,
    "--output",
    "json",
  ]) as {
    branch?: {
      backend?: {
        stackArn?: string;
      };
      computeRoleArn?: string;
    };
  };
  const branch = branchPayload.branch;
  if (!branch) {
    throw new Error(
      `Amplify branch '${options.branchName}' was not found for app '${options.appId}'.`,
    );
  }

  const backendStackArn = normalizeOptionalString(branch.backend?.stackArn);
  if (!backendStackArn) {
    throw new Error(
      `Amplify branch '${options.branchName}' does not expose a backend stack ARN.`,
    );
  }

  const expectedRoleArn = resolveHostedComputeRoleArn(
    backendStackArn,
    region,
    runtime,
  );
  const previousRoleArn = normalizeOptionalString(branch.computeRoleArn);
  if (previousRoleArn === expectedRoleArn) {
    return {
      branchName: options.branchName,
      previousRoleArn,
      roleArn: expectedRoleArn,
      status: "unchanged",
    };
  }

  runtime.execAwsJson([
    "amplify",
    "update-branch",
    "--app-id",
    options.appId,
    "--branch-name",
    options.branchName,
    "--region",
    region,
    "--compute-role-arn",
    expectedRoleArn,
    "--output",
    "json",
  ]);

  return {
    branchName: options.branchName,
    previousRoleArn,
    roleArn: expectedRoleArn,
    status: previousRoleArn ? "updated" : "attached",
  };
}

export function main(argv = process.argv.slice(2)): void {
  const options = parseArgs(argv);
  const result = syncHostedComputeRole(options);

  if (result.status === "unchanged") {
    process.stdout.write(
      `Hosted compute role already synced for branch '${result.branchName}': ${result.roleArn}\n`,
    );
    return;
  }

  process.stdout.write(
    [
      `Hosted compute role ${result.status} for branch '${result.branchName}'.`,
      `Role: ${result.roleArn}`,
      result.previousRoleArn
        ? `Previous: ${result.previousRoleArn}`
        : "Previous: missing",
    ].join(" "),
  );
  process.stdout.write("\n");
}

function resolveHostedComputeRoleArn(
  backendStackArn: string,
  region: string,
  runtime: Pick<AwsCliRuntime, "execAwsJson">,
): string {
  const nestedStackArn = resolveHostedComputeRoleNestedStackArn(
    backendStackArn,
    region,
    runtime,
  );
  const nestedStackPayload = runtime.execAwsJson([
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    nestedStackArn,
    "--region",
    region,
    "--output",
    "json",
  ]) as {
    Stacks?: Array<{
      Outputs?: Array<{
        OutputKey?: string;
        OutputValue?: string;
      }>;
    }>;
  };
  const nestedStack = nestedStackPayload.Stacks?.[0];
  const roleArn = normalizeOptionalString(
    nestedStack?.Outputs?.find(
      (output) => output.OutputKey === HOSTED_COMPUTE_ROLE_OUTPUT_KEY,
    )?.OutputValue,
  );
  if (!roleArn) {
    throw new Error(
      `Nested stack '${nestedStackArn}' is missing output '${HOSTED_COMPUTE_ROLE_OUTPUT_KEY}'.`,
    );
  }

  return roleArn;
}

function resolveHostedComputeRoleNestedStackArn(
  backendStackArn: string,
  region: string,
  runtime: Pick<AwsCliRuntime, "execAwsJson">,
): string {
  const resourcesPayload = runtime.execAwsJson([
    "cloudformation",
    "list-stack-resources",
    "--stack-name",
    backendStackArn,
    "--region",
    region,
    "--output",
    "json",
  ]) as {
    StackResourceSummaries?: Array<{
      LogicalResourceId?: string;
      PhysicalResourceId?: string;
      ResourceType?: string;
    }>;
  };

  const nestedStacks = (resourcesPayload.StackResourceSummaries ?? []).filter(
    (resource) =>
      resource.ResourceType === "AWS::CloudFormation::Stack" &&
      normalizeOptionalString(resource.LogicalResourceId)
        ?.toLowerCase()
        .startsWith(HOSTED_COMPUTE_ROLE_NESTED_STACK_PREFIX),
  );
  if (nestedStacks.length !== 1) {
    throw new Error(
      `Expected exactly one hosted compute nested stack under '${backendStackArn}', found ${nestedStacks.length}.`,
    );
  }

  const nestedStackArn = normalizeOptionalString(nestedStacks[0]?.PhysicalResourceId);
  if (!nestedStackArn) {
    throw new Error(
      `Hosted compute nested stack under '${backendStackArn}' is missing its physical stack ARN.`,
    );
  }

  return nestedStackArn;
}

function createDefaultRuntime(): AwsCliRuntime {
  return {
    execAwsJson: (args) =>
      JSON.parse(
        execFileSync("aws", args, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }),
      ),
    write: (message) => {
      process.stdout.write(`${message}\n`);
    },
  };
}

function normalizeOptionalString(value: string | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized ? normalized : null;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  main();
}
