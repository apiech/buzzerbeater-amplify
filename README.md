# BB Amplify

Amplify Gen 2 web app for private BuzzerBeater scouting, player analysis, lineup planning, and matchup predictions.

## Current Product Surface

- Public store at `/store` plus self-serve email sign-up/sign-in at `/login`
- Root route `/` redirects into the authenticated workspace shell
- Route-based workspace sections at `/workspace/home`, `/workspace/scout`, `/workspace/lineups`, `/workspace/league`, `/workspace/players`, `/workspace/predictions`, `/workspace/recaps`, and `/workspace/ops`
- Encrypted BuzzerBeater account connection and cached workspace sync
- Opponent scouting, league standings, player trends, salary projections, lineup planning, and dedicated saved boxscore review
- Async SageMaker-backed matchup predictions
- Stripe-backed premium gating for predictions, league writeups, and store-managed paid offers

## Private Alpha Constraints

- All scouting, roster, and prediction data requires an authenticated BB Amplify session.
- Each account owns an isolated private workspace; member sharing and guest access are disabled.
- Raw canonical player snapshot payloads are internal-only storage. User-facing reads must go through owner-scoped or public-safe accessors and must not expose hidden skill payloads.

## Local Development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `/Users/karey/projects/bb/.env.deploy.local` from the workspace
   example file and set:

   ```bash
   BB_CONNECTION_ENCRYPTION_SECRET=<raw-secret>
   AWS_REGION=us-east-1
   ```

3. Add local non-secret sandbox env vars to `.env`.

   ```bash
   APP_BASE_URL=http://localhost:3000
   BILLING_ENABLE_LIFETIME_PURCHASE=false
   BILLING_ENABLE_PREMIUM_SUBSCRIPTION=true
   STRIPE_PREMIUM_PRICE_ID=price_sandbox_placeholder
   # Optional until you enable the lifetime offer:
   # STRIPE_LIFETIME_PRICE_ID=price_lifetime_placeholder
   GAME_DAY_RECAP_MODEL_ID=us.anthropic.claude-haiku-4-5-20251001-v1:0
   ```

   Use [`env-template`](/Users/karey/projects/bb/bb-amplify/env-template) as the source of truth for required, optional, and conditional build-time variables.
   The repo-local `npm run ampx -- ...` wrapper and `npm run sandbox` workflow both pick up `.env` automatically for local sandbox deploys, so synth-time values like `APP_BASE_URL` do not need extra shell setup.
   The repo-local Next.js launcher derives `AMPLIFY_APP_ORIGIN` from `APP_BASE_URL`, so `npm run dev`, `npm run build`, and `npm run start` do not need a second origin variable.

4. Run the local doctor and release the sandbox predictor once:

   ```bash
   npm run sandbox:doctor
   npm run sandbox:predictor -- --release-id <release-id> --artifact-prefix <absolute-artifact-stem>
   ```

5. Start the backend sandbox and Next.js app:

   ```bash
   npm run sandbox
   ```

   `npm run sandbox` is the primary local workflow. It runs
   `npm run verify:deploy:sandbox` before any mutating deploy steps, loads
   `/Users/karey/projects/bb/.env.deploy.local`, syncs the Amplify sandbox
   encryption secret when needed, deploys ML Data Infra, ensures predictor
   readiness, and then starts the existing Amplify sandbox wrapper. By default,
   the wrapper starts sandbox with Lambda log streaming enabled. After a
   successful local sandbox deploy, it also prints the deployed Stripe webhook
   URL as `Stripe webhook URL: https://...` so you can paste it into Stripe
   without opening CloudFormation outputs.

   For advanced/manual cases where shared infra and secrets are already
   prepared, use:

   ```bash
   npm run sandbox:raw
   ```

   ```bash
   npm run dev
   ```

6. Run the verification gate:

   ```bash
   npm run verify:deploy
   ```

   `npm run verify:deploy` remains the strict full verification gate for manual
   and CI-style checks. Use `npm run verify:deploy:sandbox` when you need the
   sandbox-bootstrap-safe version of that gate locally.

## Auth Branding

This app keeps the existing server-side `/api/auth/*` flow for SSR-safe
sessions and upgrades Cognito to the Essentials tier so the branded auth domain
can use managed login instead of the classic hosted UI. In hosted
environments, auth moves onto a branded Cognito custom domain such as
`auth.example.com`, while the app-owned `/login` page remains a contextual
reassurance screen instead of the required first hop.
Managed-login branding is applied per Cognito user pool and app client, so each
hosted environment needs its own explicit `npm run auth:brand` apply step.
For non-prod branches, prefer a branch-specific auth hostname such as
`auth.dev.example.com` so it does not collide with the eventual production auth
domain.

To reapply the code-owned managed-login branding after a backend deploy or
asset change, run:

```bash
npm run auth:brand
```

Use `npm run auth:brand -- --dry-run` to print the resolved user pool, app
client, payload size, and preview URL without calling AWS. The branding source
files live in [`scripts/cognito-managed-login/`](/Users/karey/projects/bb/bb-amplify/scripts/cognito-managed-login),
the apply script lives at
[`scripts/apply-cognito-managed-login-branding.ts`](/Users/karey/projects/bb/bb-amplify/scripts/apply-cognito-managed-login-branding.ts),
and the operator notes live in
[`docs/runbooks/cognito-managed-login.md`](/Users/karey/projects/bb/bb-amplify/docs/runbooks/cognito-managed-login.md).

Switching a Cognito domain from classic hosted UI to managed login can require
users to sign in again, so roll this out on hosted `dev` first and promote to
production after validation.

To verify hosted readiness for the branded auth domain, Amplify custom domains,
and shared infra bindings together, run:

```bash
npm run check:hosted:shared-infra -- --app-id <amplify-app-id>
```

## Backend Requirements

This app depends on Amplify Gen 2 resources defined under [`amplify/`](/Users/karey/projects/bb/bb-amplify/amplify).

<!-- ENV-CONTRACT:START -->

### Required Plain Env

- `APP_BASE_URL`
  - Canonical public origin used for Cognito callback/logout URLs, Stripe return URLs, and the derived Next.js auth origin.
  - Required for local sandbox deploys and Amplify Hosting backend/frontend builds.
  - Recommended local value: `http://localhost:3000`.
- `STRIPE_PREMIUM_PRICE_ID`
  - Stripe recurring `price_...` identifier used by the premium checkout flow.
  - Required for local sandbox deploys and Amplify Hosting backend builds.
  - Recommended local value: `price_sandbox_placeholder`.
- `GAME_DAY_RECAP_MODEL_ID`
  - Default Bedrock model id for recap generation.
  - Required for local sandbox deploys and Amplify Hosting backend builds.
  - Recommended local value: `us.anthropic.claude-haiku-4-5-20251001-v1:0`.

### Optional Plain Env

- `GAME_DAY_RECAP_MODEL_ID_PREMIUM`
  - Premium recap override model. Premium recap jobs fall back to `GAME_DAY_RECAP_MODEL_ID` when this is unset.
  - Default or recommended value: `us.anthropic.claude-haiku-4-5-20251001-v1:0`.
- `COGNITO_AUTH_CUSTOM_DOMAIN`
  - Optional branded Cognito auth hostname override. When unset but a hosted zone name is configured, runtime and synth default to `auth.<zone>`.
  - Default or recommended value: `unset`.
- `COGNITO_AUTH_CUSTOM_DOMAIN_ZONE_NAME`
  - Route 53 hosted zone name for the branded Cognito auth domain. Required together with `COGNITO_AUTH_CUSTOM_DOMAIN_ZONE_ID` when enabling the custom auth domain.
  - Default or recommended value: `unset`.
- `COGNITO_AUTH_CUSTOM_DOMAIN_ZONE_ID`
  - Route 53 hosted zone id for the branded Cognito auth domain. Required together with `COGNITO_AUTH_CUSTOM_DOMAIN_ZONE_NAME` when enabling the custom auth domain.
  - Default or recommended value: `unset`.
- `COMMERCIAL_MODE_ENABLED`
  - Site-wide commerce toggle. When false, the store and billing UI disappear, checkout offers stay off, and premium-gated features run without paywalls.
  - Default or recommended value: `true`.
- `BILLING_DEFAULT_PLAN`
  - Optional override for the environment-wide default plan. When unset, non-prod environments default to premium and prod leaves the default unset.
  - Default or recommended value: Unset by default; non-prod environments fall back to premium while prod stays unset.
- `BILLING_ENABLE_PREMIUM_SUBSCRIPTION`
  - Feature flag for recurring premium checkout and portal flows.
  - Default or recommended value: `true`.
- `BILLING_ENABLE_LIFETIME_PURCHASE`
  - Feature flag for the one-time lifetime purchase checkout flow.
  - Default or recommended value: `false`.
- `STRIPE_LIFETIME_PRICE_ID`
  - Stripe one-time `price_...` identifier used only when lifetime purchases are enabled.
  - Default or recommended value: unset unless BILLING_ENABLE_LIFETIME_PURCHASE=true.
- `ENABLE_COST_VISIBILITY`
  - Synth-time flag for AWS Budgets and billing alarms. Enable this in exactly one owning environment at a time.
  - Default or recommended value: `false`.
- `COST_ALERT_EMAILS`
  - Comma-separated email recipients for cost guardrail notifications.
  - Default or recommended value: `unset`.
- `COST_ALERT_SMS_NUMBERS`
  - Comma-separated SMS recipients for cost guardrail notifications.
  - Default or recommended value: `unset`.
- `FEEDBACK_ALERT_EMAILS`
  - Comma-separated email recipients for logged-in feedback and feature-request notifications.
  - Default or recommended value: `unset`.
- `SYNC_RUN_RETENTION_DAYS`
  - Retention window for operational sync-run records.
  - Default or recommended value: `14`.
- `NEXT_PUBLIC_POSTHOG_TOKEN`
  - Preferred public PostHog project token for pageviews, funnels, and feature analytics. Falls back to `NEXT_PUBLIC_ANALYTICS_ID` during migration.
  - Default or recommended value: `unset`.
- `NEXT_PUBLIC_POSTHOG_HOST`
  - Public PostHog API host. Use the matching PostHog cloud region or your self-hosted proxy hostname.
  - Default or recommended value: `https://us.i.posthog.com`.

### Shared ML Infra Bindings

- Shared infra discovery
  - `bb-amplify` no longer provisions app-local match-store resources and no longer depends on a generated local env bridge file.
  - `bb-shared-infra` publishes a deterministic SSM contract keyed by sandbox or environment identity.
  - `npm run sandbox` is the primary local workflow. It loads `/Users/karey/projects/bb/.env.deploy.local`, publishes the canonical BuzzerBeater encryption secret into shared-infra SSM when needed, bootstraps ML Data Infra, and exports `BB_SHARED_ENVIRONMENT_NAME` before Amplify synth.
  - Predictor endpoints are a separate explicit deploy. Sandbox and dev should fail fast if the predictor endpoint is missing instead of guessing a default artifact.
  - Hosted builds derive the shared infra environment name from `AWS_BRANCH`, with `main -> prod` and other hosted branches using their normalized branch name.
  - Hosted backend deploys require the Amplify app service role to have `ssm:GetParameter`, `ssm:GetParameters`, and `ssm:GetParametersByPath` on `arn:aws:ssm:us-east-1:427377913956:parameter/buzzerbeater/ml-data-infra/*`.
  - Hosted SSR runtime requires each Amplify branch compute role to have `ssm:GetParameter` on `/buzzerbeater/site-control/<env>/current`. The hosted backend stack now provisions that role and attaches it to the current branch during deploy.
- Imported runtime bindings
  - `MATCH_STORE_BUCKET_NAME`: Imported at synth time from the shared ML Data Infra SSM contract and injected into match-store readers.
  - `MATCH_CATALOG_TABLE_NAME`: Imported at synth time from the shared ML Data Infra SSM contract and injected into match-store readers.
  - `TEAM_MATCH_PROJECTION_TABLE_NAME`: Imported at synth time from the shared ML Data Infra SSM contract and injected into match/workspace readers.
  - `ACTIVE_TRACKED_TEAMS_TABLE_NAME`: Imported at synth time from the shared ML Data Infra SSM contract and injected into workspace sync lambdas.
  - `PLAYER_SKILL_SNAPSHOT_TABLE_NAME`: Imported at synth time from the shared ML Data Infra SSM contract and injected into workspace and lineup lambdas.
  - `TEAM_MOMENTS_TABLE_NAME`: Imported at synth time from the shared ML Data Infra SSM contract and injected into highlights readers.
  - `TEAM_HIGHLIGHTS_STATUS_TABLE_NAME`: Imported at synth time from the shared ML Data Infra SSM contract and injected into highlights readers and submitters.
  - `TEAM_HIGHLIGHTS_SCAN_STATE_MACHINE_ARN`: Imported at synth time from the shared ML Data Infra SSM contract and injected into the highlights submitter.

### Required Secrets

- `STRIPE_SECRET_KEY`
  - Authenticates server-side Stripe API requests.
- `STRIPE_WEBHOOK_SECRET`
  - Verifies Stripe webhook signatures before billing state is updated.
- `BILLING_ADMIN_TOKEN`
  - Protects the manual billing override Function URL used for complimentary plan grants and removals.
  - Current static bearer token stays manual in this pass. Follow-up: replace it with first-party admin auth.
- `MAINTENANCE_ADMIN_TOKEN`
  - Protects the maintenance control Function URL used to activate, update, and clear maintenance mode.
  - Current static bearer token stays manual in this pass. Follow-up: replace it with first-party admin auth.

### Internal Or Platform-Provided Env

- `AMPLIFY_APP_ORIGIN`
  - Required by the installed Next.js Amplify adapter for server-side auth. It is always derived from `APP_BASE_URL` by the repo-local Next.js launcher and the hosted build env writer so the app only has one real origin input.
- `BB_SHARED_ENVIRONMENT_NAME`
  - Optional synth-time override for shared infra discovery. `npm run sandbox` sets this automatically, while hosted builds derive the environment from `AWS_BRANCH`.
- `MAINTENANCE_ENVIRONMENT_NAME`
  - Derived environment name used by hosted SSR and Lambda runtimes to read and write the site maintenance control document in SSM.
- `AWS_BRANCH`
  - Provided by Amplify Hosting and used to derive the shared infra environment name plus branch-aware defaults such as billing plan behavior.
- `AWS_APP_ID`
  - Provided by Amplify Hosting for `npx ampx pipeline-deploy`.
- `AWS_REGION`
  - Region discovered from AWS credentials or provided by the environment for SSM lookups and runtime wiring.
- `AWS_DEFAULT_REGION`
  - Fallback region for local tooling when `AWS_REGION` is unset.
- `AMPLIFY_DATA_DEFAULT_NAME`
  - Amplify-generated identifier consumed by the runtime data client. Never user-set.

### Local Script-Only Env

- `BB_CONNECTION_ENCRYPTION_SECRET`
  - Deployment-only raw secret used by shared-infra publish/rotate flows to write the canonical SSM SecureString and fingerprint for an environment.
- `AMPLIFY_OUTPUTS_FILE`
  - Optional outputs path override for `npm run auth:brand` when Cognito identifiers should come from a non-default Amplify outputs file.
- `COGNITO_USER_POOL_CLIENT_ID`
  - Optional Cognito app client id override for `npm run auth:brand` when you do not want to read it from Amplify outputs.
- `COGNITO_USER_POOL_ID`
  - Optional Cognito user pool id override for `npm run auth:brand` when you do not want to read it from Amplify outputs.
- `BILLING_ADMIN_OVERRIDE_URL`
  - Local helper script target URL for `npm run billing:override`.
- `MAINTENANCE_ADMIN_URL`
  - Local helper script target URL for `npm run maintenance:set`.
- `BB_LOGIN`
  - Optional username fallback for `npm run debug:game-day-recap`.
- `BB_ACCESS_KEY`
  - Optional access-key fallback for `npm run debug:game-day-recap`.
- `ANALYZE`
  - Enables the optional Next.js bundle analysis build.

<!-- ENV-CONTRACT:END -->

Cost visibility guardrails:

- The AWS Budgets and billing alarms in [`amplify/_backend/cost-visibility.ts`](/Users/karey/projects/bb/bb-amplify/amplify/_backend/cost-visibility.ts) are account-global resources.
- They stay disabled unless `ENABLE_COST_VISIBILITY=true` is set for the one environment that should own them.
- Use that flag in exactly one environment, ideally production, to avoid name collisions with local sandboxes and non-prod branches.

The billing integration reads `APP_BASE_URL` and `STRIPE_PREMIUM_PRICE_ID` during backend synthesis in [`amplify/_backend/billing-integration.ts`](/Users/karey/projects/bb/bb-amplify/amplify/_backend/billing-integration.ts), and the recap job wiring reads `GAME_DAY_RECAP_MODEL_ID` during backend synthesis in [`amplify/_backend/game-day-recap-jobs.ts`](/Users/karey/projects/bb/bb-amplify/amplify/_backend/game-day-recap-jobs.ts), so those values need to exist in the shell or CI job that runs the Amplify deploy.
Amplify Hosting branch builds also need `APP_BASE_URL` because the frontend build runs [`scripts/next-with-env.mjs`](/Users/karey/projects/bb/bb-amplify/scripts/next-with-env.mjs), which derives `AMPLIFY_APP_ORIGIN` from it.

Premium access defaults:

- Non-prod branches and sandbox-like environments default `BILLING_DEFAULT_PLAN` to `premium` unless you explicitly set `BILLING_DEFAULT_PLAN` yourself.
- Prod branches leave `BILLING_DEFAULT_PLAN` unset by default.
- Manual overrides still win over the environment default, so you can force a test account back to `free` when you want to verify gated UX.

Prediction infrastructure requirements:

- A shared-ML-infra-published SageMaker endpoint for the current environment
  - `bb-amplify` imports the predictor endpoint name from the shared ML infra SSM contract during backend synth.
  - Sandboxes get sandbox-scoped endpoints such as `buzzerbeater-machine-learning-predictor-sandbox-karey`.
  - Hosted `dev` and `prod` get their own endpoints such as `buzzerbeater-machine-learning-predictor-dev` and `buzzerbeater-machine-learning-predictor-prod`.
  - Provision or update it through [`bb-shared-infra`](/Users/karey/projects/bb/bb-shared-infra) or [`scripts/matchup-predictor-release`](/Users/karey/projects/bb/scripts/matchup-predictor-release).
  - Runbook: [`docs/runbooks/matchup-predictor-release.md`](/Users/karey/projects/bb/docs/runbooks/matchup-predictor-release.md)
- The prediction submit Lambda needs SQS send access.
- The prediction worker Lambda needs SQS consume access and `sagemaker:InvokeEndpoint`.

These resources are already wired in [`amplify/backend.ts`](/Users/karey/projects/bb/bb-amplify/amplify/backend.ts).

## PostHog Analytics Setup

The app now initializes PostHog from public env vars and captures pageviews,
auth, billing, connection, navigation, highlights, prediction, recap, and
theme events through the shared analytics wrapper in
[`lib/analytics`](/Users/karey/projects/bb/bb-amplify/lib/analytics).

Recommended environment split:

- Local sandbox and `sandbox-*` deploys -> PostHog `sandbox` project
- Hosted `dev` branch -> PostHog `dev` project
- Hosted `main` branch -> PostHog `prod` project

Step-by-step:

1. Create a PostHog account and pick the cloud region that matches where you
   want your data stored.
2. If you want separate `sandbox`, `dev`, and `prod` projects inside one
   PostHog org, upgrade the org to usage-based billing by adding a credit card.
   The free tier is still applied monthly; the card is mainly what unlocks
   enough projects for the three-environment split.
3. Create three PostHog projects named `sandbox`, `dev`, and `prod`.
4. Copy the public project token for each project plus the matching PostHog host
   such as `https://us.i.posthog.com` or `https://eu.i.posthog.com`.
5. For local sandbox work, copy
   [`env-template`](/Users/karey/projects/bb/bb-amplify/env-template) to `.env`
   and set:

   ```bash
   NEXT_PUBLIC_POSTHOG_TOKEN=<sandbox-project-token>
   NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
   ```

6. In Amplify Hosting, open the `dev` branch environment variables and set:

   ```bash
   NEXT_PUBLIC_POSTHOG_TOKEN=<dev-project-token>
   NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
   ```

7. In Amplify Hosting, open the `main` branch environment variables and set:

   ```bash
   NEXT_PUBLIC_POSTHOG_TOKEN=<prod-project-token>
   NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
   ```

8. Redeploy each environment. The frontend build picks up the public env vars,
   and the client-side analytics provider initializes PostHog automatically.
9. Verify with PostHog live events:
   - open `/login` and confirm a `$pageview`
   - sign in and confirm `auth_flow_completed`
   - open `/workspace/predictions` and confirm `workspace_section_viewed`
   - run a prediction and confirm `prediction_requested`
   - change themes and confirm `theme_changed`
10. Current implementation does not require a PostHog secret key, personal API
    key, or backend Lambda env var. Only the public project token and host are
    needed because analytics are captured from the Next.js client. If you later
    add server-side capture or PostHog API automation, introduce separate
    secret env vars at that time.

## Stripe Billing Setup

1. Create a dedicated Stripe account for this app and start in test mode.
   - Stripe can onboard a US hobby project as an `individual` or `sole proprietorship`; an LLC is not required if that matches your situation.
2. In Stripe Dashboard, create one recurring `Premium` product with one monthly price.
   - Set price metadata `app_plan_id=premium`.
3. If you want the one-time store offer, create one `Lifetime Access` product with a one-time price.
   - Use Stripe's customer-chosen pricing configuration for the amount if you want a pay-what-you-want lifetime purchase.
   - Set price metadata `app_grant_plan_id=premium`.
   - Set price metadata `app_purchase_kind=lifetime`.
4. Configure the Stripe customer portal.
   - Enable payment method updates.
   - Enable cancel-at-period-end.
5. Configure customer-facing Stripe account details before launch.
   - Display name
   - Website URL
   - Support email or support page
   - Statement descriptor
6. Store the Stripe values this app expects.
   - `STRIPE_SECRET_KEY`: Stripe secret API key
   - `STRIPE_WEBHOOK_SECRET`: signing secret for the webhook endpoint
   - `STRIPE_PREMIUM_PRICE_ID`: the recurring `price_...` id for the premium subscription
   - `STRIPE_LIFETIME_PRICE_ID`: the one-time `price_...` id for the lifetime offer when that offer is enabled
7. Deploy the backend and copy the billing endpoints from the stack outputs created by [`amplify/_backend/billing-integration.ts`](/Users/karey/projects/bb/bb-amplify/amplify/_backend/billing-integration.ts).
   - `BillingWebhookUrl`
   - `BillingAdminOverrideUrl`
8. In Stripe Workbench, create a webhook destination that points to `BillingWebhookUrl`.
   - Subscribe to `checkout.session.completed`
   - Subscribe to `customer.subscription.updated`
   - Subscribe to `customer.subscription.deleted`
   - Subscribe to `invoice.paid`
   - Subscribe to `invoice.payment_failed`

Premium feature access is resolved centrally from [`lib/billing/plans.ts`](/Users/karey/projects/bb/bb-amplify/lib/billing/plans.ts), so adding another paid tier later is a matter of adding a new `PlanId`, mapping features in `PLAN_FEATURES`, and assigning Stripe price metadata for the new plan.
The public commerce surface lives at [`app/store/page.tsx`](/Users/karey/projects/bb/bb-amplify/app/store/page.tsx) and [`app/store/storefront.tsx`](/Users/karey/projects/bb/bb-amplify/app/store/storefront.tsx), while `/workspace/ops` remains the authenticated billing/status panel.

## Complimentary Access

Use the admin override endpoint when you want to grant or remove plan access without going through Stripe. The endpoint is protected by `BILLING_ADMIN_TOKEN`, and the local helper script sends the expected request shape.

```bash
export BILLING_ADMIN_OVERRIDE_URL="https://<billing-admin-override-url>"
export BILLING_ADMIN_TOKEN="<admin-token>"

npm run billing:override -- --user-id <auth-user-id> --plan premium --reason "alpha access"
npm run billing:override -- --user-id <auth-user-id> --plan premium --expires-at 2026-04-30T23:59:59Z --reason "beta access"
npm run billing:override -- --user-id <auth-user-id> --clear
```

Use `npm run billing:override -- --help` for the full CLI options.

## Deploy Notes

- Bring up shared ML infra before expecting `/workspace/predictions` to work. For local sandboxes, `npm run sandbox` bootstraps ML Data Infra automatically and then fails fast if the predictor endpoint is missing; for hosted `dev` and `prod`, deploy shared infra separately first.
- Use `npm run check:hosted:shared-infra -- --app-id d2ckw6mf5kdema` before hosted rebuilds to verify the Amplify service role, branch compute roles, shared-infra SSM contract, and SageMaker quota posture.
- Hosted deploy order is shared ML data infra, then predictor endpoint, then the Amplify branch rebuild.
- Hosted backend deploys now create and attach the branch compute role from the backend stack, so `computeRoleArn` no longer depends on a manual console step.
- Deploy or update the predictor with `./scripts/matchup-predictor-release dev --release-id <release-id> --artifact-prefix <absolute-artifact-stem>` before testing hosted `dev` predictions.
- Promote with `./scripts/matchup-predictor-release prod --release-id <release-id>` only after the same release passes in `dev`.
- The intended SageMaker serverless split is `sandbox=1`, `dev=3`, `prod=5`; an oversized sandbox endpoint can block hosted releases even when `dev` and `prod` are otherwise ready.
- The opponent forecast endpoint binding is currently optional.
  When `/buzzerbeater/ml-data-infra/<env>/opponent-forecast-endpoint-name` is absent, hosted builds still proceed but opponent forecast jobs stay unwired until that endpoint is deployed and published.
- The workspace sync path stores encrypted BB credentials server-side and refreshes cached data only on initial connect plus explicit manual refresh.
- The ops section surfaces recent `SyncRun` and `PredictionJob` records so failures are visible inside the product.
- The BB XML client now retries transient upstream failures with bounded exponential backoff.
- `/workspace/predictions` and `/workspace/recaps` are premium-gated in the UI and enforced server-side from the shared billing feature registry.

## Launch Verification Checklist

- Sign up or sign in with email auth at `/login`.
- Open `/store` while signed out and confirm the public offer cards render without exposing any private workspace data.
- Connect a BuzzerBeater account and confirm the initial sync completes.
- Open each authenticated workspace route and verify cached data loads without GraphQL auth errors.
- Submit both manual and connected predictions, then confirm the Ops section shows job progress plus `modelVersion`.
- Open `/store` while signed in and confirm the current access panel, monthly CTA, and optional lifetime CTA behave correctly for the current environment flags.
- Upgrade in Stripe test mode, return to `/workspace/ops`, and confirm the premium surfaces unlock.
- If lifetime access is enabled, complete a one-time lifetime purchase in Stripe test mode, return to `/store`, and confirm the account reflects permanent premium access.
- Cancel in the Stripe customer portal and confirm the billing panel reflects the renewal state correctly.
- Verify unauthenticated sessions cannot read any workspace or data API surface.

## Core Files

- [`app/page.tsx`](/Users/karey/projects/bb/bb-amplify/app/page.tsx): root redirect into the authenticated workspace
- [`app/store/page.tsx`](/Users/karey/projects/bb/bb-amplify/app/store/page.tsx): public store route
- [`app/store/storefront.tsx`](/Users/karey/projects/bb/bb-amplify/app/store/storefront.tsx): public store UI and offer CTAs
- [`app/dashboard-app.tsx`](/Users/karey/projects/bb/bb-amplify/app/dashboard-app.tsx): landing page plus authenticated workspace shell
- [`app/workspace/[section]/page.tsx`](/Users/karey/projects/bb/bb-amplify/app/workspace/[section]/page.tsx): route entry for product sections
- [`amplify/data/resource.ts`](/Users/karey/projects/bb/bb-amplify/amplify/data/resource.ts): GraphQL schema and custom operations
- [`amplify/data/_backend/workspace.ts`](/Users/karey/projects/bb/bb-amplify/amplify/data/_backend/workspace.ts): sync, lineup, and player backend logic
- [`lib/bbapi/client.ts`](/Users/karey/projects/bb/bb-amplify/lib/bbapi/client.ts): TypeScript BB XML API client with retry logic
