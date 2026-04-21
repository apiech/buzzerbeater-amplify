import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { resolveCognitoAuthCustomDomainOverride } from "../amplify/_shared/auth-domain.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, "..");

const defaultOutputsFilePath = join(projectRoot, "amplify_outputs.json");
const defaultDefinitionPath = join(
  projectRoot,
  "scripts",
  "cognito-managed-login",
  "clubhouse-branding.json",
);
const maxAssetBytes = 1_000_000;
const maxManagedLoginRequestBytes = 2 * 1024 * 1024;

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

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

type ManagedLoginAssetCategory =
  | "AUTH_APP_GRAPHIC"
  | "EMAIL_GRAPHIC"
  | "FAVICON_ICO"
  | "FAVICON_SVG"
  | "FORM_BACKGROUND"
  | "FORM_LOGO"
  | "IDP_BUTTON_ICON"
  | "PAGE_BACKGROUND"
  | "PAGE_FOOTER_BACKGROUND"
  | "PAGE_FOOTER_LOGO"
  | "PAGE_HEADER_BACKGROUND"
  | "PAGE_HEADER_LOGO"
  | "PASSKEY_GRAPHIC"
  | "PASSWORD_GRAPHIC"
  | "SMS_GRAPHIC";

type ManagedLoginAssetColorMode = "DARK" | "DYNAMIC" | "LIGHT";
type ManagedLoginAssetExtension = "ICO" | "JPEG" | "PNG" | "SVG" | "WEBP";

type ManagedLoginBrandingAssetDefinition = {
  category: ManagedLoginAssetCategory;
  colorMode: ManagedLoginAssetColorMode;
  extension: ManagedLoginAssetExtension;
  path: string;
  resourceId: string | null;
};

type LoadedManagedLoginBrandingAsset = ManagedLoginBrandingAssetDefinition & {
  absolutePath: string;
  bytes: Buffer;
  size: number;
};

type ManagedLoginBrandingDefinition = {
  assets: LoadedManagedLoginBrandingAsset[];
  settings: JsonValue;
};

type ParsedArgs = {
  clientId: string;
  definitionPath: string;
  dryRun: boolean;
  outputsFilePath: string;
  previewUrl: string | null;
  region: string;
  userPoolId: string;
};

type ApplyBrandingResult = {
  action: "create-and-update" | "update";
  assetCount: number;
  clientId: string;
  managedLoginBrandingId: string;
  previewUrl: string | null;
  region: string;
  requestBytes: number;
  status: "applied" | "dry-run";
  userPoolId: string;
};

type AuthOutputsLoader = (filePath: string) => AuthOutputs;

type ManagedLoginBrandingAsset = {
  Bytes?: string;
  Category?: string;
  ColorMode?: string;
  Extension?: string;
  ResourceId?: string;
};

type ManagedLoginBrandingRecord = {
  Assets?: ManagedLoginBrandingAsset[];
  ManagedLoginBrandingId?: string;
  Settings?: JsonValue;
};

type ManagedLoginBrandingResponse = {
  ManagedLoginBranding?: ManagedLoginBrandingRecord;
};

type ManagedLoginUpdateInput = {
  assets: ManagedLoginBrandingAsset[];
  requestBytes: number;
  settings: JsonValue;
};

const managedLoginAssetCategories = new Set<ManagedLoginAssetCategory>([
  "AUTH_APP_GRAPHIC",
  "EMAIL_GRAPHIC",
  "FAVICON_ICO",
  "FAVICON_SVG",
  "FORM_BACKGROUND",
  "FORM_LOGO",
  "IDP_BUTTON_ICON",
  "PAGE_BACKGROUND",
  "PAGE_FOOTER_BACKGROUND",
  "PAGE_FOOTER_LOGO",
  "PAGE_HEADER_BACKGROUND",
  "PAGE_HEADER_LOGO",
  "PASSKEY_GRAPHIC",
  "PASSWORD_GRAPHIC",
  "SMS_GRAPHIC",
]);
const managedLoginAssetColorModes = new Set<ManagedLoginAssetColorMode>([
  "DARK",
  "DYNAMIC",
  "LIGHT",
]);
const managedLoginAssetExtensions = new Set<ManagedLoginAssetExtension>([
  "ICO",
  "JPEG",
  "PNG",
  "SVG",
  "WEBP",
]);

export const __testing = {
  buildCreateDefaultManagedLoginBrandingArgs,
  buildManagedLoginPreviewUrl,
  buildUpdateManagedLoginBrandingArgs,
  buildManagedLoginUpdateInput,
  defaultDefinitionPath,
  defaultOutputsFilePath,
  loadAuthOutputs,
  loadManagedLoginBrandingDefinition,
  maxAssetBytes,
  maxManagedLoginRequestBytes,
  mergeManagedLoginAssets,
  parseArgs,
};

export function parseArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
  loadOutputs: AuthOutputsLoader = loadAuthOutputs,
): ParsedArgs {
  let clientId = normalizeOptionalString(env.COGNITO_USER_POOL_CLIENT_ID);
  let definitionPath = defaultDefinitionPath;
  let dryRun = false;
  let outputsFilePath =
    normalizeOptionalString(env.AMPLIFY_OUTPUTS_FILE) ?? defaultOutputsFilePath;
  let region =
    normalizeOptionalString(env.AWS_REGION) ??
    normalizeOptionalString(env.AWS_DEFAULT_REGION);
  let requestedPreviewDomain =
    resolveCognitoAuthCustomDomainOverride(env) ?? null;
  let requestedRedirectUri: string | null = null;
  let userPoolId = normalizeOptionalString(env.COGNITO_USER_POOL_ID);

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
      case "--definition-path":
        definitionPath = resolve(
          projectRoot,
          readOptionValue(argv, ++index, "--definition-path"),
        );
        break;
      case "--dry-run":
        dryRun = true;
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
  if (
    !clientId ||
    !region ||
    !requestedPreviewDomain ||
    !requestedRedirectUri ||
    !userPoolId
  ) {
    outputs = loadOutputs(outputsFilePath);
    clientId ??= outputs.clientId;
    region ??= outputs.region;
    requestedPreviewDomain ??= outputs.domain;
    requestedRedirectUri ??= outputs.redirectUri;
    userPoolId ??= outputs.userPoolId;
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
    definitionPath,
    dryRun,
    outputsFilePath,
    previewUrl: buildManagedLoginPreviewUrl({
      clientId,
      domain: requestedPreviewDomain,
      redirectUri: requestedRedirectUri,
    }),
    region,
    userPoolId,
  };
}

export function loadAuthOutputs(
  filePath = defaultOutputsFilePath,
): AuthOutputs {
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

export function loadManagedLoginBrandingDefinition(
  filePath = defaultDefinitionPath,
): ManagedLoginBrandingDefinition {
  if (!existsSync(filePath)) {
    throw new Error(
      `Managed login branding definition was not found at '${filePath}'.`,
    );
  }

  const parsedSource = JSON.parse(readFileSync(filePath, "utf8")) as {
    assets?: Array<{
      category?: unknown;
      colorMode?: unknown;
      extension?: unknown;
      path?: unknown;
      resourceId?: unknown;
    }>;
    settings?: unknown;
  };
  const settings = ensureJsonValue(
    parsedSource.settings ?? {},
    "Managed login settings",
  );
  const assetEntries = Array.isArray(parsedSource.assets)
    ? parsedSource.assets
    : [];

  if (assetEntries.length === 0) {
    throw new Error(
      "Managed login branding definition must include at least one asset.",
    );
  }

  const definitionDirectory = dirname(filePath);
  const assets = assetEntries.map((entry, index) =>
    loadManagedLoginBrandingAsset(definitionDirectory, entry, index),
  );

  return {
    assets,
    settings,
  };
}

function loadManagedLoginBrandingAsset(
  definitionDirectory: string,
  asset: {
    category?: unknown;
    colorMode?: unknown;
    extension?: unknown;
    path?: unknown;
    resourceId?: unknown;
  },
  index: number,
): LoadedManagedLoginBrandingAsset {
  const category = ensureEnumValue(
    asset.category,
    managedLoginAssetCategories,
    `Managed login asset ${index + 1} category`,
  );
  const colorMode = ensureEnumValue(
    asset.colorMode,
    managedLoginAssetColorModes,
    `Managed login asset ${index + 1} colorMode`,
  );
  const extension = ensureEnumValue(
    asset.extension,
    managedLoginAssetExtensions,
    `Managed login asset ${index + 1} extension`,
  );
  const assetPath = ensureNonEmptyString(
    asset.path,
    `Managed login asset ${index + 1} path`,
  );
  const resourceId = normalizeOptionalString(
    typeof asset.resourceId === "string" ? asset.resourceId : null,
  );
  const absolutePath = resolve(definitionDirectory, assetPath);

  if (!existsSync(absolutePath)) {
    throw new Error(
      `Managed login asset '${category}' was not found at '${absolutePath}'.`,
    );
  }

  const size = statSync(absolutePath).size;
  if (size > maxAssetBytes) {
    throw new Error(
      `Managed login asset '${category}' exceeds the Cognito limit of ${maxAssetBytes} bytes.`,
    );
  }

  return {
    absolutePath,
    bytes: readFileSync(absolutePath),
    category,
    colorMode,
    extension,
    path: assetPath,
    resourceId,
    size,
  };
}

export function buildCreateDefaultManagedLoginBrandingArgs(
  options: Pick<ParsedArgs, "clientId" | "region" | "userPoolId">,
): string[] {
  return [
    "cognito-idp",
    "create-managed-login-branding",
    "--user-pool-id",
    options.userPoolId,
    "--client-id",
    options.clientId,
    "--use-cognito-provided-values",
    "--region",
    options.region,
    "--output",
    "json",
  ];
}

export function buildUpdateManagedLoginBrandingArgs(
  options: Pick<ParsedArgs, "region" | "userPoolId">,
  managedLoginBrandingId: string,
  input: ManagedLoginUpdateInput,
): string[] {
  return [
    "cognito-idp",
    "update-managed-login-branding",
    "--user-pool-id",
    options.userPoolId,
    "--managed-login-branding-id",
    managedLoginBrandingId,
    "--settings",
    JSON.stringify(input.settings),
    "--assets",
    JSON.stringify(input.assets),
    "--region",
    options.region,
    "--output",
    "json",
  ];
}

export function buildManagedLoginPreviewUrl(input: {
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

export function mergeManagedLoginAssets(
  _existingAssets: readonly ManagedLoginBrandingAsset[],
  desiredAssets: readonly LoadedManagedLoginBrandingAsset[],
): ManagedLoginBrandingAsset[] {
  return desiredAssets.map((asset) => ({
    Bytes: asset.bytes.toString("base64"),
    Category: asset.category,
    ColorMode: asset.colorMode,
    Extension: asset.extension,
  }));
}

export function buildManagedLoginUpdateInput(
  currentBranding: ManagedLoginBrandingRecord,
  definition: ManagedLoginBrandingDefinition,
): ManagedLoginUpdateInput {
  const settings = deepMergeJsonValue(
    ensureJsonValue(currentBranding.Settings ?? {}, "Managed login settings"),
    definition.settings,
  );
  const assets = mergeManagedLoginAssets(
    currentBranding.Assets ?? [],
    definition.assets,
  );
  const requestBytes = Buffer.byteLength(
    JSON.stringify({
      Assets: assets,
      Settings: settings,
    }),
    "utf8",
  );

  if (requestBytes > maxManagedLoginRequestBytes) {
    throw new Error(
      `Managed login branding payload exceeds the Cognito request limit of ${maxManagedLoginRequestBytes} bytes.`,
    );
  }

  return {
    assets,
    requestBytes,
    settings,
  };
}

export function applyManagedLoginBranding(
  options: ParsedArgs,
  runtime: AwsCliRuntime = createDefaultRuntime(),
): ApplyBrandingResult {
  const definition = loadManagedLoginBrandingDefinition(options.definitionPath);
  let branding = describeManagedLoginBrandingByClient(options, runtime);
  const action: ApplyBrandingResult["action"] =
    branding === null ? "create-and-update" : "update";

  if (branding === null && !options.dryRun) {
    createDefaultManagedLoginBranding(options, runtime);
    branding = describeManagedLoginBrandingByClient(options, runtime);
  }

  const brandingRecord: ManagedLoginBrandingRecord = branding ?? {
    Assets: [],
    Settings: {},
  };
  const managedLoginBrandingId = normalizeOptionalString(
    brandingRecord.ManagedLoginBrandingId,
  );
  const updateInput = buildManagedLoginUpdateInput(brandingRecord, definition);

  if (!options.dryRun) {
    if (!managedLoginBrandingId) {
      throw new Error(
        "Managed login branding exists but did not return a ManagedLoginBrandingId after bootstrap.",
      );
    }

    runtime.execAwsJson(
      buildUpdateManagedLoginBrandingArgs(
        options,
        managedLoginBrandingId,
        updateInput,
      ),
    );
  }

  return {
    action,
    assetCount: definition.assets.length,
    clientId: options.clientId,
    managedLoginBrandingId:
      managedLoginBrandingId ??
      "(created on apply; run without --dry-run to persist and inspect the style id)",
    previewUrl: options.previewUrl,
    region: options.region,
    requestBytes: updateInput.requestBytes,
    status: options.dryRun ? "dry-run" : "applied",
    userPoolId: options.userPoolId,
  };
}

function describeManagedLoginBrandingByClient(
  options: Pick<ParsedArgs, "clientId" | "region" | "userPoolId">,
  runtime: AwsCliRuntime,
): ManagedLoginBrandingRecord | null {
  try {
    const response = runtime.execAwsJson([
      "cognito-idp",
      "describe-managed-login-branding-by-client",
      "--user-pool-id",
      options.userPoolId,
      "--client-id",
      options.clientId,
      "--return-merged-resources",
      "--region",
      options.region,
      "--output",
      "json",
    ]) as ManagedLoginBrandingResponse;

    return response.ManagedLoginBranding ?? null;
  } catch (error) {
    if (isMissingManagedLoginBrandingError(error)) {
      return null;
    }
    throw error;
  }
}

function createDefaultManagedLoginBranding(
  options: Pick<ParsedArgs, "clientId" | "region" | "userPoolId">,
  runtime: AwsCliRuntime,
): void {
  try {
    runtime.execAwsJson(buildCreateDefaultManagedLoginBrandingArgs(options));
  } catch (error) {
    if (isManagedLoginBrandingExistsError(error)) {
      return;
    }
    throw error;
  }
}

export function main(argv = process.argv.slice(2)): void {
  const options = parseArgs(argv);
  const result = applyManagedLoginBranding(options);
  const summaryLines = [
    `Managed login branding ${result.status} for app client '${result.clientId}'.`,
    `Action: ${result.action}`,
    `User pool: ${result.userPoolId}`,
    `Region: ${result.region}`,
    `Style ID: ${result.managedLoginBrandingId}`,
    `Asset count: ${result.assetCount}`,
    `Payload bytes: ${result.requestBytes}`,
    result.previewUrl
      ? `Preview URL: ${result.previewUrl}`
      : "Preview URL: unavailable (missing Cognito domain or redirect URI in outputs)",
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

function ensureEnumValue<T extends string>(
  value: unknown,
  allowedValues: Set<T>,
  label: string,
): T {
  const normalizedValue =
    typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!normalizedValue || !allowedValues.has(normalizedValue as T)) {
    throw new Error(
      `${label} must be one of: ${Array.from(allowedValues).join(", ")}.`,
    );
  }

  return normalizedValue as T;
}

function ensureJsonValue(value: unknown, label: string): JsonValue {
  if (value === null) {
    return null;
  }
  if (
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => ensureJsonValue(item, label));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, childValue]) => [
        key,
        ensureJsonValue(childValue, label),
      ]),
    );
  }

  throw new Error(`${label} must be valid JSON data.`);
}

function ensureNonEmptyString(value: unknown, label: string): string {
  const normalizedValue = normalizeOptionalString(
    typeof value === "string" ? value : null,
  );
  if (!normalizedValue) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return normalizedValue;
}

function deepMergeJsonValue(base: JsonValue, patch: JsonValue): JsonValue {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return patch;
  }

  const mergedEntries = new Map<string, JsonValue>();

  for (const [key, value] of Object.entries(base)) {
    mergedEntries.set(key, value);
  }

  for (const [key, value] of Object.entries(patch)) {
    const existingValue = mergedEntries.get(key);
    mergedEntries.set(
      key,
      existingValue === undefined
        ? value
        : deepMergeJsonValue(existingValue, value),
    );
  }

  return Object.fromEntries(mergedEntries.entries());
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cliError = error as Error & {
      stderr?: string | Buffer;
      stdout?: string | Buffer;
    };
    const stderr =
      typeof cliError.stderr === "string"
        ? cliError.stderr
        : Buffer.isBuffer(cliError.stderr)
          ? cliError.stderr.toString("utf8")
          : "";
    const stdout =
      typeof cliError.stdout === "string"
        ? cliError.stdout
        : Buffer.isBuffer(cliError.stdout)
          ? cliError.stdout.toString("utf8")
          : "";

    return [stderr, stdout, cliError.message].filter(Boolean).join("\n");
  }

  return String(error);
}

function isManagedLoginBrandingExistsError(error: unknown): boolean {
  return /ManagedLoginBrandingExistsException/i.test(
    extractErrorMessage(error),
  );
}

function isMissingManagedLoginBrandingError(error: unknown): boolean {
  return /ResourceNotFoundException/i.test(extractErrorMessage(error));
}

function isPlainObject(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionalString(
  value: string | undefined | null,
): string | null {
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

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
