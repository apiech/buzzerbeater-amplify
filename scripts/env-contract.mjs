export const readmeEnvSectionStart = "<!-- ENV-CONTRACT:START -->";
export const readmeEnvSectionEnd = "<!-- ENV-CONTRACT:END -->";

export const envContract = {
  plain: {
    required: [
      {
        name: "APP_BASE_URL",
        purpose:
          "Canonical public origin used for Cognito callback/logout URLs, Stripe return URLs, and the derived Next.js auth origin.",
        appliesTo:
          "Required for local sandbox deploys and Amplify Hosting backend/frontend builds.",
        recommendedValue: "http://localhost:3000",
        templateValue: "http://localhost:3000",
      },
      {
        name: "STRIPE_PREMIUM_PRICE_ID",
        purpose:
          "Stripe recurring `price_...` id for the premium subscription checkout flow.",
        appliesTo:
          "Required for local sandbox deploys and Amplify Hosting backend builds.",
        recommendedValue: "price_sandbox_placeholder",
        templateValue: "price_sandbox_placeholder",
      },
      {
        name: "GAME_DAY_RECAP_MODEL_ID",
        purpose: "Default Bedrock model id for recap generation.",
        appliesTo:
          "Required for local sandbox deploys and Amplify Hosting backend builds.",
        recommendedValue: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        templateValue: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      },
    ],
    mode: [
      {
        name: "MATCH_DATA_PLANE_SOURCE",
        purpose:
          "Controls whether bb-amplify provisions app-local match-store resources or imports the separate MatchDataPlane stack.",
        defaultValue: "local",
        options: ["local", "external"],
      },
      {
        name: "MATCH_DATA_PLANE_STACK_NAME",
        purpose:
          "CloudFormation stack name read by `npm run sync:match-data-plane` when external mode is enabled.",
        defaultValue: "MatchDataPlane",
        templateValue: "MatchDataPlane",
        requiredWhen: "`MATCH_DATA_PLANE_SOURCE=external`",
      },
    ],
    optional: [
      {
        name: "GAME_DAY_RECAP_MODEL_ID_PREMIUM",
        purpose:
          "Premium recap override model. Premium recap jobs fall back to `GAME_DAY_RECAP_MODEL_ID` when this is unset.",
        recommendedValue: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        templateValue: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      },
      {
        name: "BILLING_DEFAULT_PLAN",
        purpose:
          "Branch-wide default plan override used before per-user billing state is resolved.",
        defaultValue:
          "Unset by default; non-prod branches fall back to premium, prod-like branches leave it unset",
        templateValue: "premium",
      },
      {
        name: "ENABLE_COST_VISIBILITY",
        purpose: "Enables account-global AWS Budgets and billing alarms.",
        defaultValue: "false",
        templateValue: "false",
      },
      {
        name: "COST_ALERT_EMAILS",
        purpose:
          "Comma-separated email recipients for cost guardrail notifications.",
        defaultValue: "unset",
        templateValue: "you@example.com",
      },
      {
        name: "COST_ALERT_SMS_NUMBERS",
        purpose:
          "Comma-separated SMS recipients for cost guardrail notifications.",
        defaultValue: "unset",
        templateValue: "+15555555555",
      },
      {
        name: "WORKSPACE_REFRESH_STALE_AFTER_HOURS",
        purpose: "Staleness threshold used by workspace refresh scheduling.",
        defaultValue: "24",
        templateValue: "24",
      },
      {
        name: "WORKSPACE_REFRESH_MAX_USERS_PER_RUN",
        purpose:
          "Maximum number of users enqueued per scheduled workspace refresh run.",
        defaultValue: "50",
        templateValue: "50",
      },
      {
        name: "WORKSPACE_REFRESH_DEDUPE_BY_TEAM",
        purpose: "Optional refresh dedupe mode for shared-team refresh queues.",
        defaultValue: "false",
        templateValue: "false",
      },
      {
        name: "SYNC_RUN_RETENTION_DAYS",
        purpose: "Retention window for operational sync-run records.",
        defaultValue: "14",
        templateValue: "14",
      },
      {
        name: "PREDICTION_JOB_RETENTION_DAYS",
        purpose: "Retention window for prediction-job records.",
        defaultValue: "30",
        templateValue: "30",
      },
    ],
  },
  generated: [
    {
      name: "MATCH_STORE_BUCKET_NAME",
      purpose:
        "Generated from the external MatchDataPlane stack output `MatchStoreBucketName`.",
    },
    {
      name: "MATCH_CATALOG_TABLE_NAME",
      purpose:
        "Generated from the external MatchDataPlane stack output `MatchCatalogTableName`.",
    },
    {
      name: "TEAM_MATCH_PROJECTION_TABLE_NAME",
      purpose:
        "Generated from the external MatchDataPlane stack output `TeamMatchProjectionTableName`.",
    },
    {
      name: "ACTIVE_TRACKED_TEAMS_TABLE_NAME",
      purpose:
        "Generated from the external MatchDataPlane stack output `ActiveTrackedTeamsTableName`.",
    },
    {
      name: "PLAYER_SKILL_SNAPSHOT_TABLE_NAME",
      purpose:
        "Generated from the external MatchDataPlane stack output `PlayerSkillSnapshotTableName`.",
    },
    {
      name: "TEAM_MOMENTS_TABLE_NAME",
      purpose:
        "Generated from the external MatchDataPlane stack output `TeamMomentsTableName`.",
    },
    {
      name: "TEAM_HIGHLIGHTS_STATUS_TABLE_NAME",
      purpose:
        "Generated from the external MatchDataPlane stack output `TeamHighlightsStatusTableName`.",
    },
    {
      name: "TEAM_HIGHLIGHTS_SCAN_QUEUE_URL",
      purpose:
        "Generated from the external MatchDataPlane stack output `TeamHighlightsScanQueueUrl`.",
    },
  ],
  secrets: [
    {
      name: "BB_CONNECTION_ENCRYPTION_SECRET",
      purpose:
        "Encrypts and decrypts stored BuzzerBeater access keys across bb-amplify and the external match-data-plane.",
      followUp:
        "Current raw shared secret stays manual in this pass. Follow-up: move to a centrally provisioned secret reference before attempting rotation.",
    },
    {
      name: "STRIPE_SECRET_KEY",
      purpose: "Authenticates server-side Stripe API requests.",
    },
    {
      name: "STRIPE_WEBHOOK_SECRET",
      purpose:
        "Verifies Stripe webhook signatures before billing state is updated.",
    },
    {
      name: "BILLING_ADMIN_TOKEN",
      purpose:
        "Protects the manual billing override Function URL used for complimentary plan grants and removals.",
      followUp:
        "Current static bearer token stays manual in this pass. Follow-up: replace it with first-party admin auth.",
    },
  ],
  internal: [
    {
      name: "AMPLIFY_APP_ORIGIN",
      purpose:
        "Derived by the repo-local Next.js launcher from `APP_BASE_URL`. Do not set this manually.",
    },
    {
      name: "AWS_BRANCH",
      purpose:
        "Provided by Amplify Hosting and used for branch-aware defaults such as billing plan behavior and predictor stage selection.",
    },
    {
      name: "AWS_APP_ID",
      purpose: "Provided by Amplify Hosting for `npx ampx pipeline-deploy`.",
    },
    {
      name: "AWS_REGION",
      purpose:
        "Region discovered from AWS credentials or provided by the environment for CloudFormation lookups and runtime wiring.",
    },
    {
      name: "AWS_DEFAULT_REGION",
      purpose: "Fallback region for local tooling when `AWS_REGION` is unset.",
    },
    {
      name: "AMPLIFY_DATA_DEFAULT_NAME",
      purpose:
        "Amplify-generated runtime data client identifier. Do not set this manually.",
    },
  ],
  localScripts: [
    {
      name: "BILLING_ADMIN_OVERRIDE_URL",
      purpose: "Local helper script target URL for `npm run billing:override`.",
    },
    {
      name: "BB_LOGIN",
      purpose: "Optional username fallback for `npm run debug:game-day-recap`.",
    },
    {
      name: "BB_ACCESS_KEY",
      purpose:
        "Optional access-key fallback for `npm run debug:game-day-recap`.",
    },
    {
      name: "ANALYZE",
      purpose: "Enables the optional Next.js bundle analysis build.",
    },
  ],
};

function renderTemplateAssignments(entries) {
  return entries
    .map((entry) => {
      const value =
        entry.templateValue ??
        entry.recommendedValue ??
        entry.defaultValue ??
        "";
      return `${entry.name}=${value}`;
    })
    .join("\n");
}

function renderCommentedTemplateAssignments(entries) {
  return entries
    .map((entry) => {
      const value =
        entry.templateValue ??
        entry.recommendedValue ??
        entry.defaultValue ??
        "";
      return `# ${entry.name}=${value}`;
    })
    .join("\n");
}

function renderReadmeEntries(entries, formatter) {
  return entries.map(formatter).join("\n");
}

function renderReadmeEntry(entry, lines) {
  return [`- \`${entry.name}\``, ...lines.map((line) => `  - ${line}`)].join(
    "\n",
  );
}

function formatReadmeValue(value) {
  if (!value) {
    return "`unset`";
  }

  return /\s/.test(value) ? value : `\`${value}\``;
}

export function renderEnvTemplate() {
  return [
    "# Generated from scripts/env-contract.mjs via `npm run render:env-docs`.",
    "# Do not edit this file manually.",
    "#",
    "# Copy this file to .env for local development.",
    "# These same build-time values must also exist in Amplify Hosting environment",
    "# variables for branch deploys because amplify.yml runs both backend deploys",
    "# and frontend builds.",
    "#",
    "# This file is for plain environment variables only.",
    "# Do not put secrets here.",
    "",
    "# Required for backend synth/deploy and Next.js builds.",
    renderTemplateAssignments(envContract.plain.required),
    "",
    "# Match data plane mode.",
    `MATCH_DATA_PLANE_SOURCE=${envContract.plain.mode[0].defaultValue}`,
    `# MATCH_DATA_PLANE_STACK_NAME=${envContract.plain.mode[1].defaultValue}`,
    "# When MATCH_DATA_PLANE_SOURCE=external, run:",
    "#   npm run sync:match-data-plane",
    "# This generates .env.match-data-plane with the imported resource names.",
    "",
    "# Optional deploy-time tuning. Defaults or recommended values shown below.",
    renderCommentedTemplateAssignments(envContract.plain.optional),
    "",
    "# Generated only when MATCH_DATA_PLANE_SOURCE=external.",
    "# Do not maintain these values by hand in .env.",
    "# .env.match-data-plane contains:",
    ...envContract.generated.map((entry) => `# - ${entry.name}`),
    "",
    "# Amplify secrets are required separately and should not be stored in .env.",
    "# Local sandbox:",
    ...envContract.secrets.map(
      (entry) => `#   npm run ampx -- sandbox secret set ${entry.name}`,
    ),
    "#",
    "# Amplify Hosting secrets:",
    ...envContract.secrets.map((entry) => `# - ${entry.name}`),
    "",
  ].join("\n");
}

export function renderReadmeEnvSection() {
  return [
    readmeEnvSectionStart,
    "### Required Plain Env",
    "",
    renderReadmeEntries(envContract.plain.required, (entry) =>
      renderReadmeEntry(entry, [
        entry.purpose,
        entry.appliesTo,
        `Recommended local value: ${formatReadmeValue(entry.recommendedValue)}.`,
      ]),
    ),
    "",
    "### Match Data Plane Mode",
    "",
    renderReadmeEntries(envContract.plain.mode, (entry) => {
      const lines = [entry.purpose];
      if (entry.defaultValue) {
        lines.push(`Default: ${formatReadmeValue(entry.defaultValue)}.`);
      }
      if (entry.options) {
        lines.push(
          `Allowed values: ${entry.options.map((value) => `\`${value}\``).join(", ")}.`,
        );
      }
      if (entry.requiredWhen) {
        lines.push(`Required when: ${entry.requiredWhen}.`);
      }
      return renderReadmeEntry(entry, lines);
    }),
    "",
    "- Generated external-data-plane env file",
    "  - `npm run sync:match-data-plane` reads CloudFormation outputs from the external MatchDataPlane stack and writes `.env.match-data-plane`.",
    "  - The repo-local `npm run ampx -- ...` and Next.js launcher load `.env.match-data-plane` after `.env` when `MATCH_DATA_PLANE_SOURCE=external`.",
    "  - Generated variables:",
    ...envContract.generated.map(
      (entry) => `    - \`${entry.name}\`: ${entry.purpose}`,
    ),
    "",
    "### Optional Plain Env",
    "",
    renderReadmeEntries(envContract.plain.optional, (entry) =>
      renderReadmeEntry(entry, [
        entry.purpose,
        `Default or recommended value: ${formatReadmeValue(
          entry.defaultValue ?? entry.recommendedValue,
        )}.`,
      ]),
    ),
    "",
    "### Required Secrets",
    "",
    renderReadmeEntries(envContract.secrets, (entry) => {
      const lines = [entry.purpose];
      if (entry.followUp) {
        lines.push(entry.followUp);
      }
      return renderReadmeEntry(entry, lines);
    }),
    "",
    "### Internal Or Platform-Provided Env",
    "",
    renderReadmeEntries(envContract.internal, (entry) =>
      renderReadmeEntry(entry, [entry.purpose]),
    ),
    "",
    "### Local Script-Only Env",
    "",
    renderReadmeEntries(envContract.localScripts, (entry) =>
      renderReadmeEntry(entry, [entry.purpose]),
    ),
    "",
    readmeEnvSectionEnd,
  ].join("\n");
}
