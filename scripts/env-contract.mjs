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
          "Stripe recurring `price_...` identifier used by the premium checkout flow.",
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
    optional: [
      {
        name: "GAME_DAY_RECAP_MODEL_ID_PREMIUM",
        purpose:
          "Premium recap override model. Premium recap jobs fall back to `GAME_DAY_RECAP_MODEL_ID` when this is unset.",
        recommendedValue: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        templateValue: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      },
      {
        name: "COMMERCIAL_MODE_ENABLED",
        purpose:
          "Site-wide commerce toggle. When false, the store and billing UI disappear, checkout offers stay off, and premium-gated features run without paywalls.",
        defaultValue: "true",
        templateValue: "true",
      },
      {
        name: "BILLING_DEFAULT_PLAN",
        purpose:
          "Optional override for the environment-wide default plan. When unset, non-prod environments default to premium and prod leaves the default unset.",
        defaultValue:
          "Unset by default; non-prod environments fall back to premium while prod stays unset",
        templateValue: "premium",
      },
      {
        name: "BILLING_ENABLE_PREMIUM_SUBSCRIPTION",
        purpose:
          "Feature flag for recurring premium checkout and portal flows.",
        defaultValue: "true",
        templateValue: "true",
      },
      {
        name: "BILLING_ENABLE_LIFETIME_PURCHASE",
        purpose:
          "Feature flag for the one-time lifetime purchase checkout flow.",
        defaultValue: "false",
        templateValue: "false",
      },
      {
        name: "STRIPE_LIFETIME_PRICE_ID",
        purpose:
          "Stripe one-time `price_...` identifier used only when lifetime purchases are enabled.",
        defaultValue: "unset unless BILLING_ENABLE_LIFETIME_PURCHASE=true",
        templateValue: "price_lifetime_placeholder",
      },
      {
        name: "ENABLE_COST_VISIBILITY",
        purpose:
          "Synth-time flag for AWS Budgets and billing alarms. Enable this in exactly one owning environment at a time.",
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
        name: "FEEDBACK_ALERT_EMAILS",
        purpose:
          "Comma-separated email recipients for logged-in feedback and feature-request notifications.",
        defaultValue: "unset",
        templateValue: "you@example.com",
      },
      {
        name: "SYNC_RUN_RETENTION_DAYS",
        purpose: "Retention window for operational sync-run records.",
        defaultValue: "14",
        templateValue: "14",
      },
      {
        name: "NEXT_PUBLIC_POSTHOG_TOKEN",
        purpose:
          "Preferred public PostHog project token for pageviews, funnels, and feature analytics. Falls back to `NEXT_PUBLIC_ANALYTICS_ID` during migration.",
        defaultValue: "unset",
        templateValue: "phc_sandbox_placeholder",
      },
      {
        name: "NEXT_PUBLIC_POSTHOG_HOST",
        purpose:
          "Public PostHog API host. Use the matching PostHog cloud region or your self-hosted proxy hostname.",
        defaultValue: "https://us.i.posthog.com",
        templateValue: "https://us.i.posthog.com",
      },
    ],
  },
  generated: [
    {
      name: "MATCH_STORE_BUCKET_NAME",
      purpose:
        "Imported at synth time from the shared ML Data Infra SSM contract and injected into match-store readers.",
    },
    {
      name: "MATCH_CATALOG_TABLE_NAME",
      purpose:
        "Imported at synth time from the shared ML Data Infra SSM contract and injected into match-store readers.",
    },
    {
      name: "TEAM_MATCH_PROJECTION_TABLE_NAME",
      purpose:
        "Imported at synth time from the shared ML Data Infra SSM contract and injected into match/workspace readers.",
    },
    {
      name: "ACTIVE_TRACKED_TEAMS_TABLE_NAME",
      purpose:
        "Imported at synth time from the shared ML Data Infra SSM contract and injected into workspace sync lambdas.",
    },
    {
      name: "PLAYER_SKILL_SNAPSHOT_TABLE_NAME",
      purpose:
        "Imported at synth time from the shared ML Data Infra SSM contract and injected into workspace and lineup lambdas.",
    },
    {
      name: "TEAM_MOMENTS_TABLE_NAME",
      purpose:
        "Imported at synth time from the shared ML Data Infra SSM contract and injected into highlights readers.",
    },
    {
      name: "TEAM_HIGHLIGHTS_STATUS_TABLE_NAME",
      purpose:
        "Imported at synth time from the shared ML Data Infra SSM contract and injected into highlights readers and submitters.",
    },
    {
      name: "TEAM_HIGHLIGHTS_SCAN_STATE_MACHINE_ARN",
      purpose:
        "Imported at synth time from the shared ML Data Infra SSM contract and injected into the highlights submitter.",
    },
  ],
  secrets: [
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
    {
      name: "MAINTENANCE_ADMIN_TOKEN",
      purpose:
        "Protects the maintenance control Function URL used to activate, update, and clear maintenance mode.",
      followUp:
        "Current static bearer token stays manual in this pass. Follow-up: replace it with first-party admin auth.",
    },
  ],
  internal: [
    {
      name: "AMPLIFY_APP_ORIGIN",
      purpose:
        "Required by the installed Next.js Amplify adapter for server-side auth. It is always derived from `APP_BASE_URL` by the repo-local Next.js launcher and the hosted build env writer so the app only has one real origin input.",
    },
    {
      name: "BB_SHARED_ENVIRONMENT_NAME",
      purpose:
        "Optional synth-time override for shared infra discovery. `npm run sandbox` sets this automatically, while hosted builds derive the environment from `AWS_BRANCH`.",
    },
    {
      name: "MAINTENANCE_ENVIRONMENT_NAME",
      purpose:
        "Derived environment name used by hosted SSR and Lambda runtimes to read and write the site maintenance control document in SSM.",
    },
    {
      name: "AWS_BRANCH",
      purpose:
        "Provided by Amplify Hosting and used to derive the shared infra environment name plus branch-aware defaults such as billing plan behavior.",
    },
    {
      name: "AWS_APP_ID",
      purpose: "Provided by Amplify Hosting for `npx ampx pipeline-deploy`.",
    },
    {
      name: "AWS_REGION",
      purpose:
        "Region discovered from AWS credentials or provided by the environment for SSM lookups and runtime wiring.",
    },
    {
      name: "AWS_DEFAULT_REGION",
      purpose: "Fallback region for local tooling when `AWS_REGION` is unset.",
    },
    {
      name: "AMPLIFY_DATA_DEFAULT_NAME",
      purpose:
        "Amplify-generated identifier consumed by the runtime data client. Never user-set.",
    },
  ],
  runtimeInjected: [
    {
      name: "GAME_DAY_RECAP_STATE_MACHINE_ARN",
      purpose:
        "Backend-injected Step Functions state machine ARN wired during synth for recap submit lambdas.",
    },
    {
      name: "LEAGUE_HISTORY_BACKFILL_STATE_MACHINE_ARN",
      purpose:
        "Backend-injected Step Functions state machine ARN wired during synth for league-history backfill submit lambdas.",
    },
    {
      name: "OPPONENT_FORECAST_JOB_STATE_MACHINE_ARN",
      purpose:
        "Backend-injected Step Functions state machine ARN wired during synth for opponent forecast submit lambdas.",
    },
    {
      name: "PREDICTION_JOB_STATE_MACHINE_ARN",
      purpose:
        "Backend-injected Step Functions state machine ARN wired during synth for prediction submit lambdas.",
    },
    {
      name: "TEAM_HIGHLIGHTS_SCAN_STATE_MACHINE_ARN",
      purpose:
        "Backend-injected shared Step Functions state machine ARN wired during synth for highlights submit lambdas.",
    },
    {
      name: "NEXT_GAME_RECOMMENDATION_JOB_STATE_MACHINE_ARN",
      purpose:
        "Backend-injected Step Functions state machine ARN wired during synth for next-game recommendation submit lambdas.",
    },
    {
      name: "RIVALS_BACKFILL_STATE_MACHINE_ARN",
      purpose:
        "Backend-injected Step Functions state machine ARN wired during synth for rivals backfill submit lambdas.",
    },
    {
      name: "FEEDBACK_ALERTS_TOPIC_ARN",
      purpose:
        "Backend-injected SNS topic ARN wired during synth for product feedback alert publishing.",
    },
    {
      name: "BB_CONNECTION_ENCRYPTION_SECRET_PARAMETER_NAME",
      purpose:
        "Backend-injected SSM parameter path for the canonical per-environment BuzzerBeater credential encryption secret.",
    },
    {
      name: "PREDICTION_ENDPOINT_NAME",
      purpose:
        "Backend-injected SageMaker endpoint name imported from the shared ML Data Infra SSM contract.",
    },
    {
      name: "OPPONENT_FORECAST_ENDPOINT_NAME",
      purpose:
        "Backend-injected SageMaker endpoint name imported from the shared ML Data Infra SSM contract for opponent forecasts.",
    },
  ],
  localScripts: [
    {
      name: "BB_CONNECTION_ENCRYPTION_SECRET",
      purpose:
        "Deployment-only raw secret used by shared-infra publish/rotate flows to write the canonical SSM SecureString and fingerprint for an environment.",
    },
    {
      name: "BILLING_ADMIN_OVERRIDE_URL",
      purpose: "Local helper script target URL for `npm run billing:override`.",
    },
    {
      name: "MAINTENANCE_ADMIN_URL",
      purpose: "Local helper script target URL for `npm run maintenance:set`.",
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
    "# Optional deploy-time tuning. Defaults or recommended values shown below.",
    renderCommentedTemplateAssignments(envContract.plain.optional),
    "",
    "# Shared ML Data Infra bindings come from deterministic SSM parameter names",
    "# published by bb-shared-infra. Do not set imported resource names in .env.",
    "#",
    "# Local sandbox runs:",
    "# - `npm run sandbox` is the primary local workflow. It loads",
    "#   /Users/karey/projects/bb/.env.deploy.local, publishes the canonical",
    "#   BuzzerBeater encryption secret into shared-infra SSM when needed,",
    "#   sets BB_SHARED_ENVIRONMENT_NAME, and bootstraps ML Data Infra.",
    "# - Predictor endpoints are not bootstrapped implicitly. Release one explicitly",
    "#   before the first sandbox or dev deploy that needs predictions.",
    "# - Plain `npx ampx sandbox` expects shared infra and predictor resources for",
    "#   that sandbox identifier to already exist in AWS.",
    "#",
    "# Hosted builds derive the shared infra environment from AWS_BRANCH.",
    "# Optional local/manual override:",
    "# BB_SHARED_ENVIRONMENT_NAME=sandbox-karey",
    "",
    "# Amplify secrets are required separately and should not be stored in .env.",
    "# Preferred local operator flow:",
    "# - Keep deployment-only local values in /Users/karey/projects/bb/.env.deploy.local",
    "# - Shared-infra deploy scripts publish the canonical BuzzerBeater",
    "#   encryption secret into SSM and update its fingerprint.",
    "# - App/runtime functions read that secret from SSM via",
    "#   BB_CONNECTION_ENCRYPTION_SECRET_PARAMETER_NAME instead of raw env.",
    "# - Other secrets still use `npm run ampx -- sandbox secret set <NAME>`.",
    "#",
    "# Shared ML Data Infra deploys:",
    "#   Source BB_CONNECTION_ENCRYPTION_SECRET from .env.deploy.local",
    "#   npm run shared-infra:deploy:ml-data-infra -- --environment dev",
    "# Predictor deploys:",
    "#   npm run dev:predictor -- --release-id <release-id> --artifact-prefix <absolute-artifact-stem>",
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
    "### Shared ML Infra Bindings",
    "",
    "- Shared infra discovery",
    "  - `bb-amplify` no longer provisions app-local match-store resources and no longer depends on a generated local env bridge file.",
    "  - `bb-shared-infra` publishes a deterministic SSM contract keyed by sandbox or environment identity.",
    "  - `npm run sandbox` is the primary local workflow. It loads `/Users/karey/projects/bb/.env.deploy.local`, publishes the canonical BuzzerBeater encryption secret into shared-infra SSM when needed, bootstraps ML Data Infra, and exports `BB_SHARED_ENVIRONMENT_NAME` before Amplify synth.",
    "  - Predictor endpoints are a separate explicit deploy. Sandbox and dev should fail fast if the predictor endpoint is missing instead of guessing a default artifact.",
    "  - Hosted builds derive the shared infra environment name from `AWS_BRANCH`, with `main -> prod` and other hosted branches using their normalized branch name.",
    "  - Hosted backend deploys require the Amplify app service role to have `ssm:GetParameter`, `ssm:GetParameters`, and `ssm:GetParametersByPath` on `arn:aws:ssm:us-east-1:427377913956:parameter/buzzerbeater/ml-data-infra/*`.",
    "  - Hosted SSR runtime requires each Amplify branch compute role to have `ssm:GetParameter` on `/buzzerbeater/site-control/<env>/current`. The hosted backend stack now provisions that role and attaches it to the current branch during deploy.",
    "- Imported runtime bindings",
    ...envContract.generated.map(
      (entry) => `  - \`${entry.name}\`: ${entry.purpose}`,
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
