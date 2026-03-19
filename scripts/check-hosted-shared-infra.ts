import { execFileSync } from "node:child_process";
import process from "node:process";

import {
  branchToEnvironmentName,
  buildSharedInfraParameterPaths,
  type SharedInfraBindings,
} from "../amplify/_shared/shared-infra-contract.js";

const ACTIVE_SERVERLESS_ENDPOINT_STATUSES = new Set([
  "Creating",
  "Deleting",
  "InService",
  "RollingBack",
  "SystemUpdating",
  "Updating",
]);
const DEFAULT_REGION = "us-east-1";
const EXPECTED_ACCOUNT = "427377913956";
const INTENDED_ENDPOINT_ALLOCATIONS = [
  {
    endpointName: "buzzerbeater-machine-learning-predictor-sandbox-karey",
    maxConcurrency: 2,
  },
  {
    endpointName: "buzzerbeater-machine-learning-predictor-dev",
    maxConcurrency: 3,
  },
  {
    endpointName: "buzzerbeater-machine-learning-predictor-prod",
    maxConcurrency: 5,
  },
] as const;
const REQUIRED_POLICY_ACTIONS = [
  "ssm:GetParameter",
  "ssm:GetParameters",
  "ssm:GetParametersByPath",
] as const;
const REQUIRED_POLICY_NAME = "BuzzerBeaterSharedMlInfraRead";
const REQUIRED_POLICY_SID = "ReadSharedMlInfraParameters";
const SAGEMAKER_SERVERLESS_TOTAL_CONCURRENCY_QUOTA_CODE = "L-96300102";
const OPTIONAL_SHARED_INFRA_BINDING_KEYS = new Set<keyof SharedInfraBindings>([
  "opponentForecastEndpointName",
]);

type AwsCliRuntime = {
  execAwsJson: (args: string[]) => unknown;
  write: (message: string) => void;
};

type HostedBranchSummary = {
  branchName: string;
  environmentName: string;
};

type ParameterCheck = {
  environmentName: string;
  missingPaths: string[];
  missingOptionalPaths: string[];
};

type ActiveEndpointAllocation = {
  endpointName: string;
  maxConcurrency: number;
  status: string;
};

type RoleAccessCheck =
  | {
      issues: string[];
      status: "missing";
    }
  | {
      issues: string[];
      status: "ok";
    }
  | {
      status: "unverified";
      warning: string;
    };

export type HostedSharedInfraReport = {
  appId: string;
  appName: string;
  branchSummaries: HostedBranchSummary[];
  issues: string[];
  parameterChecks: ParameterCheck[];
  quota: number;
  roleAccess: RoleAccessCheck;
  serviceRoleArn: string | null;
  warnings: string[];
};

export type HostedSharedInfraOptions = {
  appId: string;
  region?: string;
};

export const __testing = {
  buildRequiredPolicyDocument,
  buildRequiredPolicyResourceArn,
  collectHostedSharedInfraReadiness,
  describeHostedBranches,
  roleNameFromArn,
};

export function parseArgs(argv: string[]): HostedSharedInfraOptions {
  let appId: string | null = null;
  let region = DEFAULT_REGION;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--app-id") {
      appId = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument?.startsWith("--app-id=")) {
      appId = argument.slice("--app-id=".length);
      continue;
    }
    if (argument === "--region") {
      region = argv[index + 1] ?? DEFAULT_REGION;
      index += 1;
      continue;
    }
    if (argument?.startsWith("--region=")) {
      region = argument.slice("--region=".length);
      continue;
    }
  }

  if (!appId?.trim()) {
    throw new Error("Pass --app-id <amplify-app-id>.");
  }

  return {
    appId: appId.trim(),
    region: region.trim() || DEFAULT_REGION,
  };
}

export function collectHostedSharedInfraReadiness(
  options: HostedSharedInfraOptions,
  runtime: AwsCliRuntime = createDefaultRuntime(),
): HostedSharedInfraReport {
  const region = options.region?.trim() || DEFAULT_REGION;
  const appPayload = runtime.execAwsJson([
    "amplify",
    "get-app",
    "--app-id",
    options.appId,
    "--region",
    region,
    "--output",
    "json",
  ]) as {
    app?: {
      iamServiceRoleArn?: string;
      name?: string;
    };
  };
  const app = appPayload.app;
  if (!app) {
    throw new Error(`Amplify app '${options.appId}' was not found.`);
  }

  const serviceRoleArn = normalizeOptionalString(app.iamServiceRoleArn);
  const branchSummaries = describeHostedBranches(options.appId, region, runtime);
  const environmentNames = Array.from(
    new Set(branchSummaries.map((branch) => branch.environmentName)),
  );
  const parameterChecks = environmentNames.map((environmentName) =>
    checkSharedInfraParameters(environmentName, region, runtime),
  );
  const issues = parameterChecks
    .filter((check) => check.missingPaths.length > 0)
    .map(
      (check) =>
        `Shared ML infra SSM parameters are missing for '${check.environmentName}': ${check.missingPaths.join(", ")}`,
    );
  const warnings: string[] = [];
  warnings.push(
    ...parameterChecks.flatMap((check) =>
      check.missingOptionalPaths.map(
        (missingPath) =>
          `Optional shared ML infra parameter is missing for '${check.environmentName}': ${missingPath}. Opponent forecast jobs remain disabled until the endpoint is deployed.`,
      ),
    ),
  );
  const roleAccess =
    serviceRoleArn === null
      ? {
          issues: [
            "Amplify app does not have iamServiceRoleArn configured for hosted backend deploys.",
          ],
          status: "missing" as const,
        }
      : verifyServiceRoleSsmAccess(serviceRoleArn, environmentNames, region, runtime);

  if (roleAccess.status === "missing") {
    issues.push(...roleAccess.issues);
  } else if (roleAccess.status === "unverified") {
    warnings.push(roleAccess.warning);
  }

  const { allocations, quota, quotaIssues } = checkPredictorQuota(region, runtime);
  issues.push(...quotaIssues);
  warnings.push(
    ...allocations.map(
      (allocation) =>
        `Active endpoint ${allocation.endpointName} [${allocation.status}] reserves ${allocation.maxConcurrency} serverless concurrency.`,
    ),
  );

  return {
    appId: options.appId,
    appName: normalizeOptionalString(app.name) ?? options.appId,
    branchSummaries,
    issues,
    parameterChecks,
    quota,
    roleAccess,
    serviceRoleArn,
    warnings,
  };
}

export function describeHostedBranches(
  appId: string,
  region: string,
  runtime: Pick<AwsCliRuntime, "execAwsJson"> = createDefaultRuntime(),
): HostedBranchSummary[] {
  const payload = runtime.execAwsJson([
    "amplify",
    "list-branches",
    "--app-id",
    appId,
    "--region",
    region,
    "--output",
    "json",
  ]) as {
    branches?: Array<{ branchName?: string }>;
  };

  return (payload.branches ?? [])
    .flatMap((branch) => {
      const branchName = normalizeOptionalString(branch.branchName);
      if (!branchName) {
        return [];
      }

      return [
        {
          branchName,
          environmentName: branchToEnvironmentName(branchName),
        },
      ];
    })
    .sort((left, right) => left.branchName.localeCompare(right.branchName));
}

export function main(argv = process.argv.slice(2)): void {
  const options = parseArgs(argv);
  const report = collectHostedSharedInfraReadiness(options);
  const region = options.region?.trim() || DEFAULT_REGION;

  printSummary(report, region);

  if (report.issues.length > 0) {
    process.exit(1);
  }
}

function checkSharedInfraParameters(
  environmentName: string,
  region: string,
  runtime: Pick<AwsCliRuntime, "execAwsJson">,
): ParameterCheck {
  const parameterPaths = buildSharedInfraParameterPaths(environmentName);
  const parameterEntries = Object.entries(parameterPaths) as Array<
    [keyof typeof parameterPaths, string]
  >;
  const payload = runtime.execAwsJson([
    "ssm",
    "get-parameters",
    "--region",
    region,
    "--with-decryption",
    "--output",
    "json",
    "--names",
    ...parameterEntries.map(([, parameterPath]) => parameterPath),
  ]) as {
    InvalidParameters?: string[];
  };
  const invalidParameters = new Set((payload.InvalidParameters ?? []).filter(Boolean));

  return {
    environmentName,
    missingPaths: parameterEntries
      .filter(
        ([bindingKey, parameterPath]) =>
          !OPTIONAL_SHARED_INFRA_BINDING_KEYS.has(bindingKey) &&
          invalidParameters.has(parameterPath),
      )
      .map(([, parameterPath]) => parameterPath),
    missingOptionalPaths: parameterEntries
      .filter(
        ([bindingKey, parameterPath]) =>
          OPTIONAL_SHARED_INFRA_BINDING_KEYS.has(bindingKey) &&
          invalidParameters.has(parameterPath),
      )
      .map(([, parameterPath]) => parameterPath),
  };
}

function verifyServiceRoleSsmAccess(
  serviceRoleArn: string,
  environmentNames: string[],
  region: string,
  runtime: Pick<AwsCliRuntime, "execAwsJson">,
): RoleAccessCheck {
  const representativeResources = environmentNames.map((environmentName) =>
    buildRepresentativeParameterArn(environmentName, region),
  );

  try {
    const payload = runtime.execAwsJson([
      "iam",
      "simulate-principal-policy",
      "--policy-source-arn",
      serviceRoleArn,
      "--action-names",
      ...REQUIRED_POLICY_ACTIONS,
      "--resource-arns",
      ...representativeResources,
      "--output",
      "json",
    ]) as {
      EvaluationResults?: Array<{ EvalActionName?: string; EvalDecision?: string }>;
    };

    const deniedActions = (payload.EvaluationResults ?? []).filter((result) => {
      const decision = normalizeOptionalString(result.EvalDecision)?.toLowerCase();
      return decision !== "allowed";
    });
    if (deniedActions.length === 0) {
      return {
        issues: [],
        status: "ok",
      };
    }

    const deniedActionNames = Array.from(
      new Set(
        deniedActions
          .map((result) => normalizeOptionalString(result.EvalActionName))
          .filter((actionName): actionName is string => actionName !== null),
      ),
    );
    return {
      issues: [
        [
          `Amplify service role ${serviceRoleArn} is missing shared-infra SSM access for actions: ${deniedActionNames.join(", ")}.`,
          `Attach inline policy '${REQUIRED_POLICY_NAME}' with: ${JSON.stringify(buildRequiredPolicyDocument(region))}`,
        ].join(" "),
      ],
      status: "missing",
    };
  } catch (error) {
    const message = extractAwsCliErrorMessage(error);
    if (message.toLowerCase().includes("accessdenied")) {
      return {
        status: "unverified",
        warning: [
          `Unable to simulate IAM policy for ${serviceRoleArn}.`,
          `Current credentials cannot inspect role access directly.`,
          `If hosted builds still fail with AccessDeniedException, attach inline policy '${REQUIRED_POLICY_NAME}' with: ${JSON.stringify(buildRequiredPolicyDocument(region))}`,
        ].join(" "),
      };
    }

    throw new Error(
      `Unable to inspect Amplify service role IAM access. AWS CLI error: ${message}`,
    );
  }
}

function checkPredictorQuota(
  region: string,
  runtime: Pick<AwsCliRuntime, "execAwsJson">,
): {
  allocations: ActiveEndpointAllocation[];
  quota: number;
  quotaIssues: string[];
} {
  const quotaPayload = runtime.execAwsJson([
    "service-quotas",
    "get-service-quota",
    "--region",
    region,
    "--service-code",
    "sagemaker",
    "--quota-code",
    SAGEMAKER_SERVERLESS_TOTAL_CONCURRENCY_QUOTA_CODE,
    "--output",
    "json",
  ]) as {
    Quota?: {
      Value?: number;
    };
  };
  const quotaValue = quotaPayload.Quota?.Value;
  if (
    typeof quotaValue !== "number" ||
    !Number.isFinite(quotaValue) ||
    quotaValue < 1
  ) {
    throw new Error("SageMaker Service Quotas response did not include a valid quota.");
  }

  const endpointsPayload = runtime.execAwsJson([
    "sagemaker",
    "list-endpoints",
    "--region",
    region,
    "--output",
    "json",
  ]) as {
    Endpoints?: Array<{ EndpointName?: string; EndpointStatus?: string }>;
  };

  const allocations = (endpointsPayload.Endpoints ?? [])
    .flatMap((endpoint) => {
      const endpointName = normalizeOptionalString(endpoint.EndpointName);
      const status = normalizeOptionalString(endpoint.EndpointStatus);
      if (
        endpointName === null ||
        status === null ||
        !ACTIVE_SERVERLESS_ENDPOINT_STATUSES.has(status)
      ) {
        return [];
      }

      const descriptionPayload = runtime.execAwsJson([
        "sagemaker",
        "describe-endpoint",
        "--region",
        region,
        "--endpoint-name",
        endpointName,
        "--output",
        "json",
      ]) as {
        ProductionVariants?: Array<{
          CurrentServerlessConfig?: {
            MaxConcurrency?: number;
          };
        }>;
      };
      const maxConcurrency = extractEndpointServerlessMaxConcurrency(descriptionPayload);
      if (maxConcurrency === null) {
        return [];
      }

      return [
        {
          endpointName,
          maxConcurrency,
          status,
        },
      ];
    })
    .sort((left, right) => left.endpointName.localeCompare(right.endpointName));

  const intendedByEndpoint = new Map<string, number>(
    INTENDED_ENDPOINT_ALLOCATIONS.map((allocation) => [
      allocation.endpointName,
      allocation.maxConcurrency,
    ]),
  );
  const quotaIssues: string[] = [];
  const unexpectedActiveTotal = allocations
    .filter((allocation) => !intendedByEndpoint.has(allocation.endpointName))
    .reduce((sum, allocation) => sum + allocation.maxConcurrency, 0);
  const intendedTotal = INTENDED_ENDPOINT_ALLOCATIONS.reduce(
    (sum, allocation) => sum + allocation.maxConcurrency,
    0,
  );

  for (const allocation of allocations) {
    const intended = intendedByEndpoint.get(allocation.endpointName);
    if (intended !== undefined && allocation.maxConcurrency > intended) {
      quotaIssues.push(
        `Endpoint ${allocation.endpointName} currently reserves ${allocation.maxConcurrency} concurrency, exceeding the intended ${intended}. Reduce it before relying on the hosted dev/prod split.`,
      );
    }
  }

  if (unexpectedActiveTotal + intendedTotal > quotaValue) {
    quotaIssues.push(
      [
        `Current active serverless endpoints cannot fit the intended sandbox/dev/prod split within quota ${SAGEMAKER_SERVERLESS_TOTAL_CONCURRENCY_QUOTA_CODE}.`,
        `Quota: ${quotaValue}.`,
        `Unexpected active allocations: ${unexpectedActiveTotal}.`,
        `Required intended split: ${intendedTotal}.`,
      ].join(" "),
    );
  }

  return {
    allocations,
    quota: quotaValue,
    quotaIssues,
  };
}

function buildRepresentativeParameterArn(
  environmentName: string,
  region: string,
): string {
  return (
    `arn:aws:ssm:${region}:${EXPECTED_ACCOUNT}:parameter` +
    buildSharedInfraParameterPaths(environmentName).activeTrackedTeamsTableName
  );
}

function buildRequiredPolicyDocument(region: string): Record<string, unknown> {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: REQUIRED_POLICY_SID,
        Effect: "Allow",
        Action: [...REQUIRED_POLICY_ACTIONS],
        Resource: buildRequiredPolicyResourceArn(region),
      },
    ],
  };
}

function buildRequiredPolicyResourceArn(region: string): string {
  return `arn:aws:ssm:${region}:${EXPECTED_ACCOUNT}:parameter/buzzerbeater/ml-data-infra/*`;
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

function extractAwsCliErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const stderr =
      "stderr" in error && typeof error.stderr === "string"
        ? error.stderr
        : "stderr" in error && Buffer.isBuffer(error.stderr)
          ? error.stderr.toString("utf8")
          : null;
    const message = stderr?.trim() || error.message.trim();
    return message || "Unknown AWS CLI failure.";
  }

  return typeof error === "string" && error.trim()
    ? error.trim()
    : "Unknown AWS CLI failure.";
}

function extractEndpointServerlessMaxConcurrency(payload: {
  ProductionVariants?: Array<{
    CurrentServerlessConfig?: {
      MaxConcurrency?: number;
    };
  }>;
}): number | null {
  let foundConfig = false;
  let total = 0;

  for (const variant of payload.ProductionVariants ?? []) {
    const maxConcurrency = variant.CurrentServerlessConfig?.MaxConcurrency;
    if (typeof maxConcurrency !== "number" || !Number.isFinite(maxConcurrency)) {
      continue;
    }

    foundConfig = true;
    total += maxConcurrency;
  }

  return foundConfig ? total : null;
}

function normalizeOptionalString(value: string | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized ? normalized : null;
}

function printSummary(report: HostedSharedInfraReport, region: string): void {
  const runtime = createDefaultRuntime();
  runtime.write(`Amplify app: ${report.appName} (${report.appId})`);
  runtime.write(`Region: ${region}`);
  runtime.write(`Service role: ${report.serviceRoleArn ?? "missing"}`);
  runtime.write("Hosted branches:");
  for (const branch of report.branchSummaries) {
    runtime.write(`- ${branch.branchName} -> ${branch.environmentName}`);
  }
  runtime.write("Shared-infra parameter checks:");
  for (const check of report.parameterChecks) {
    runtime.write(
      `- ${check.environmentName}: ${
        check.missingPaths.length === 0
          ? check.missingOptionalPaths.length === 0
            ? "ok"
            : `ok (optional missing ${check.missingOptionalPaths.length})`
          : `missing ${check.missingPaths.length}`
      }`,
    );
  }
  runtime.write(`SageMaker serverless quota ${SAGEMAKER_SERVERLESS_TOTAL_CONCURRENCY_QUOTA_CODE}: ${report.quota}`);
  if (report.roleAccess.status === "unverified") {
    runtime.write(`Role access: ${report.roleAccess.warning}`);
  } else {
    runtime.write(`Role access: ${report.roleAccess.status}`);
  }

  for (const warning of report.warnings) {
    runtime.write(`Warning: ${warning}`);
  }
  for (const issue of report.issues) {
    runtime.write(`Issue: ${issue}`);
  }

  if (report.issues.length === 0) {
    runtime.write("Hosted shared-infra readiness check passed.");
  }
}

function roleNameFromArn(roleArn: string): string {
  const segments = roleArn.split("/");
  return segments[segments.length - 1] ?? roleArn;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  main();
}
