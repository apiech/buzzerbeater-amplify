import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { resolveCognitoAuthCustomDomainOverride } from "../amplify/_shared/auth-domain.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, "..");

const defaultOutputsFilePath = join(projectRoot, "amplify_outputs.json");
const defaultCssPath = join(
  projectRoot,
  "scripts",
  "cognito-hosted-ui",
  "classic-clubhouse.css",
);
const defaultImagePath = join(
  projectRoot,
  "scripts",
  "cognito-hosted-ui",
  "clubhouse-logo.png",
);
const maxCssBytes = 3 * 1024;
const maxImageBytes = 100 * 1024;

type AwsCliRuntime = {
  execAwsJson: (args: string[]) => unknown;
};

type AuthOutputs = {
  clientId: string;
  domain: string | null;
  redirectUri: string | null;
  region: string;
  userPoolId: string;
};

type ParsedArgs = {
  clientId: string;
  cssPath: string;
  dryRun: boolean;
  imagePath: string;
  outputsFilePath: string;
  previewUrl: string | null;
  region: string;
  userPoolId: string;
};

type LoadedBrandingAssets = {
  cssBytes: number;
  cssSource: string;
  imageBytes: number;
};

type ApplyBrandingResult = {
  clientId: string;
  cssBytes: number;
  imageBytes: number;
  previewUrl: string | null;
  region: string;
  status: "applied" | "dry-run";
  userPoolId: string;
};

type AuthOutputsLoader = (filePath: string) => AuthOutputs;

export const __testing = {
  buildHostedUiPreviewUrl,
  buildSetUiCustomizationArgs,
  defaultCssPath,
  defaultImagePath,
  defaultOutputsFilePath,
  loadAuthOutputs,
  loadBrandingAssets,
  maxCssBytes,
  maxImageBytes,
  parseArgs,
};

export function parseArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
  loadOutputs: AuthOutputsLoader = loadAuthOutputs,
): ParsedArgs {
  let clientId = normalizeOptionalString(env.COGNITO_USER_POOL_CLIENT_ID);
  let cssPath = defaultCssPath;
  let dryRun = false;
  let imagePath = defaultImagePath;
  let outputsFilePath =
    normalizeOptionalString(env.AMPLIFY_OUTPUTS_FILE) ?? defaultOutputsFilePath;
  let region =
    normalizeOptionalString(env.AWS_REGION) ??
    normalizeOptionalString(env.AWS_DEFAULT_REGION);
  let userPoolId = normalizeOptionalString(env.COGNITO_USER_POOL_ID);
  let requestedPreviewDomain =
    resolveCognitoAuthCustomDomainOverride(env) ?? null;
  let requestedRedirectUri: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) {
      continue;
    }

    switch (argument) {
      case "--client-id":
        clientId = normalizeOptionalString(
          readOptionValue(argv, ++index, "--client-id"),
        );
        break;
      case "--css-path":
        cssPath = resolve(projectRoot, readOptionValue(argv, ++index, "--css-path"));
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--image-path":
        imagePath = resolve(
          projectRoot,
          readOptionValue(argv, ++index, "--image-path"),
        );
        break;
      case "--outputs-file":
        outputsFilePath = resolve(
          projectRoot,
          readOptionValue(argv, ++index, "--outputs-file"),
        );
        break;
      case "--redirect-uri":
        requestedRedirectUri = normalizeOptionalString(
          readOptionValue(argv, ++index, "--redirect-uri"),
        );
        break;
      case "--region":
        region = normalizeOptionalString(
          readOptionValue(argv, ++index, "--region"),
        );
        break;
      case "--ui-domain":
        requestedPreviewDomain = normalizeOptionalString(
          readOptionValue(argv, ++index, "--ui-domain"),
        );
        break;
      case "--user-pool-id":
        userPoolId = normalizeOptionalString(
          readOptionValue(argv, ++index, "--user-pool-id"),
        );
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  let outputs: AuthOutputs | null = null;
  if (!userPoolId || !clientId || !region || !requestedPreviewDomain || !requestedRedirectUri) {
    outputs = loadOutputs(outputsFilePath);
    userPoolId ??= outputs.userPoolId;
    clientId ??= outputs.clientId;
    region ??= outputs.region;
    requestedPreviewDomain ??= outputs.domain;
    requestedRedirectUri ??= outputs.redirectUri;
  }

  if (!userPoolId) {
    throw new Error(
      "Pass --user-pool-id <user-pool-id> or provide amplify_outputs.json with auth.user_pool_id.",
    );
  }
  if (!clientId) {
    throw new Error(
      "Pass --client-id <app-client-id> or provide amplify_outputs.json with auth.user_pool_client_id.",
    );
  }
  if (!region) {
    throw new Error(
      "Pass --region <aws-region>, set AWS_REGION, or provide amplify_outputs.json with auth.aws_region.",
    );
  }

  return {
    clientId,
    cssPath,
    dryRun,
    imagePath,
    outputsFilePath,
    previewUrl: buildHostedUiPreviewUrl({
      clientId,
      domain: requestedPreviewDomain,
      redirectUri: requestedRedirectUri,
    }),
    region,
    userPoolId,
  };
}

export function loadAuthOutputs(filePath = defaultOutputsFilePath): AuthOutputs {
  if (!existsSync(filePath)) {
    throw new Error(
      `Amplify outputs file was not found at '${filePath}'. Pass explicit Cognito identifiers or restore amplify_outputs.json.`,
    );
  }

  const rawSource = JSON.parse(readFileSync(filePath, "utf8")) as {
    auth?: {
      aws_region?: unknown;
      oauth?: {
        domain?: unknown;
        redirect_sign_in_uri?: unknown;
      };
      user_pool_client_id?: unknown;
      user_pool_id?: unknown;
    };
  };

  const auth = rawSource.auth;
  const redirectSignInUri = auth?.oauth?.redirect_sign_in_uri;
  const redirectUris = Array.isArray(redirectSignInUri)
    ? redirectSignInUri
    : [];
  const redirectUri =
    typeof redirectUris[0] === "string" ? redirectUris[0] : null;
  const region =
    typeof auth?.aws_region === "string" ? auth.aws_region.trim() : "";
  const clientId =
    typeof auth?.user_pool_client_id === "string"
      ? auth.user_pool_client_id.trim()
      : "";
  const userPoolId =
    typeof auth?.user_pool_id === "string" ? auth.user_pool_id.trim() : "";

  if (!region || !clientId || !userPoolId) {
    throw new Error(
      `Amplify outputs at '${filePath}' are missing required Cognito auth identifiers.`,
    );
  }

  return {
    clientId,
    domain:
      typeof auth?.oauth?.domain === "string" ? auth.oauth.domain.trim() : null,
    redirectUri,
    region,
    userPoolId,
  };
}

export function loadBrandingAssets(input: {
  cssPath: string;
  imagePath: string;
}): LoadedBrandingAssets {
  if (!existsSync(input.cssPath)) {
    throw new Error(`Hosted UI CSS file was not found at '${input.cssPath}'.`);
  }
  if (!existsSync(input.imagePath)) {
    throw new Error(`Hosted UI image file was not found at '${input.imagePath}'.`);
  }

  const cssSource = readFileSync(input.cssPath, "utf8").trim();
  const cssBytes = Buffer.byteLength(cssSource, "utf8");
  const imageBytes = statSync(input.imagePath).size;

  if (!cssSource) {
    throw new Error("Hosted UI CSS is empty.");
  }
  if (cssBytes > maxCssBytes) {
    throw new Error(
      `Hosted UI CSS exceeds the classic Cognito limit of ${maxCssBytes} bytes.`,
    );
  }
  if (imageBytes > maxImageBytes) {
    throw new Error(
      `Hosted UI logo exceeds the classic Cognito limit of ${maxImageBytes} bytes.`,
    );
  }

  return {
    cssBytes,
    cssSource,
    imageBytes,
  };
}

export function buildSetUiCustomizationArgs(
  options: Pick<ParsedArgs, "clientId" | "imagePath" | "region" | "userPoolId">,
  assets: Pick<LoadedBrandingAssets, "cssSource">,
): string[] {
  return [
    "cognito-idp",
    "set-ui-customization",
    "--user-pool-id",
    options.userPoolId,
    "--client-id",
    options.clientId,
    "--image-file",
    `fileb://${options.imagePath}`,
    "--css",
    assets.cssSource,
    "--region",
    options.region,
    "--output",
    "json",
  ];
}

export function buildHostedUiPreviewUrl(input: {
  clientId: string;
  domain: string | null;
  redirectUri: string | null;
}): string | null {
  if (!input.domain || !input.redirectUri) {
    return null;
  }

  const previewUrl = new URL(`https://${input.domain}/login`);
  previewUrl.searchParams.set("response_type", "code");
  previewUrl.searchParams.set("client_id", input.clientId);
  previewUrl.searchParams.set("redirect_uri", input.redirectUri);
  return previewUrl.toString();
}

export function applyHostedUiBranding(
  options: ParsedArgs,
  runtime: AwsCliRuntime = createDefaultRuntime(),
): ApplyBrandingResult {
  const assets = loadBrandingAssets({
    cssPath: options.cssPath,
    imagePath: options.imagePath,
  });

  if (!options.dryRun) {
    runtime.execAwsJson(buildSetUiCustomizationArgs(options, assets));
  }

  return {
    clientId: options.clientId,
    cssBytes: assets.cssBytes,
    imageBytes: assets.imageBytes,
    previewUrl: options.previewUrl,
    region: options.region,
    status: options.dryRun ? "dry-run" : "applied",
    userPoolId: options.userPoolId,
  };
}

export function main(argv = process.argv.slice(2)): void {
  const options = parseArgs(argv);
  const result = applyHostedUiBranding(options);
  const summaryLines = [
    `Hosted UI branding ${result.status} for app client '${result.clientId}'.`,
    `User pool: ${result.userPoolId}`,
    `Region: ${result.region}`,
    `CSS bytes: ${result.cssBytes}`,
    `Image bytes: ${result.imageBytes}`,
    result.previewUrl
      ? `Preview URL: ${result.previewUrl}`
      : `Preview URL: unavailable (missing Cognito domain or redirect URI in outputs)`,
  ];
  process.stdout.write(`${summaryLines.join("\n")}\n`);
}

function createDefaultRuntime(): AwsCliRuntime {
  return {
    execAwsJson(args) {
      return JSON.parse(
        execFileSync("aws", args, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }),
      ) as unknown;
    },
  };
}

function normalizeOptionalString(value: string | undefined | null): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
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

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
