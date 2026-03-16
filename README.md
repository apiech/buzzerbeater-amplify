# BB Amplify

Amplify Gen 2 web app for private BuzzerBeater scouting, player analysis, lineup planning, and matchup predictions.

## Current Product Surface

- Public marketing + self-serve email sign-up/sign-in at `/`
- Route-based workspace sections at `/workspace/home`, `/workspace/scout`, `/workspace/lineups`, `/workspace/league`, `/workspace/players`, `/workspace/predictions`, `/workspace/recaps`, and `/workspace/ops`
- Encrypted BuzzerBeater account connection and cached workspace sync
- Opponent scouting, league standings, player trends, salary projections, lineup planning, and saved lineup scenarios
- Async SageMaker-backed matchup predictions
- Stripe-backed premium gating for predictions and league writeups

## Private Alpha Constraints

- All scouting, roster, and prediction data requires an authenticated BB Amplify session.
- Each account owns an isolated private workspace; member sharing and guest access are disabled.

## Local Development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the Next.js app:

   ```bash
   npm run dev
   ```

3. Run the verification gate:

   ```bash
   npm test
   npm run build
   ```

## Backend Requirements

This app depends on Amplify Gen 2 resources defined under [`amplify/`](/Users/karey/projects/bb/bb-amplify/amplify).

Required secret:

- `BB_CONNECTION_ENCRYPTION_SECRET`
  - Used by the account-connection Lambdas to encrypt and decrypt stored BB access keys.

Stripe billing configuration:

- Secrets managed in Amplify:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `BILLING_ADMIN_TOKEN`
- Deploy-time environment variables:
  - `APP_BASE_URL`
  - `STRIPE_PREMIUM_PRICE_ID`

The billing integration reads `APP_BASE_URL` and `STRIPE_PREMIUM_PRICE_ID` during backend synthesis in [`amplify/_backend/billing-integration.ts`](/Users/karey/projects/bb/bb-amplify/amplify/_backend/billing-integration.ts), so they need to exist in the shell or CI job that runs the Amplify deploy.

Prediction infrastructure requirements:

- A SageMaker endpoint named `bb-matchup-predictor-dev` or `bb-matchup-predictor-prod`
  - The backend selects the suffix from `AWS_BRANCH` in [`amplify/backend.ts`](/Users/karey/projects/bb/bb-amplify/amplify/backend.ts).
  - Provision it with the dedicated CDK app in [`infra/matchup-predictor/`](/Users/karey/projects/bb/bb-amplify/infra/matchup-predictor).
  - Dev deploy command: `npm run cdk:matchup-predictor:deploy:dev`
  - Prod deploy command: `npm run cdk:matchup-predictor:deploy:prod`
- The prediction submit Lambda needs SQS send access.
- The prediction worker Lambda needs SQS consume access and `sagemaker:InvokeEndpoint`.

These resources are already wired in [`amplify/backend.ts`](/Users/karey/projects/bb/bb-amplify/amplify/backend.ts).

## Stripe Billing Setup

1. Create a dedicated Stripe account for this app and start in test mode.
   - Stripe can onboard a US hobby project as an `individual` or `sole proprietorship`; an LLC is not required if that matches your situation.
2. In Stripe Dashboard, create one recurring `Premium` product with one monthly price.
   - Set price metadata `app_plan_id=premium`.
3. Configure the Stripe customer portal.
   - Enable payment method updates.
   - Enable cancel-at-period-end.
4. Configure customer-facing Stripe account details before launch.
   - Display name
   - Website URL
   - Support email or support page
   - Statement descriptor
5. Store the Stripe values this app expects.
   - `STRIPE_SECRET_KEY`: Stripe secret API key
   - `STRIPE_WEBHOOK_SECRET`: signing secret for the webhook endpoint
   - `STRIPE_PREMIUM_PRICE_ID`: the recurring `price_...` id for the premium subscription
6. Deploy the backend and copy the billing endpoints from the stack outputs created by [`amplify/_backend/billing-integration.ts`](/Users/karey/projects/bb/bb-amplify/amplify/_backend/billing-integration.ts).
   - `BillingWebhookUrl`
   - `BillingAdminOverrideUrl`
7. In Stripe Workbench, create a webhook destination that points to `BillingWebhookUrl`.
   - Subscribe to `checkout.session.completed`
   - Subscribe to `customer.subscription.updated`
   - Subscribe to `customer.subscription.deleted`
   - Subscribe to `invoice.paid`
   - Subscribe to `invoice.payment_failed`

Premium feature access is resolved centrally from [`lib/billing/plans.ts`](/Users/karey/projects/bb/bb-amplify/lib/billing/plans.ts), so adding another paid tier later is a matter of adding a new `PlanId`, mapping features in `PLAN_FEATURES`, and assigning Stripe price metadata for the new plan.

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

- Deploy the matchup predictor stack before testing `/workspace/predictions`; otherwise prediction jobs fail with `Endpoint bb-matchup-predictor-<stage> not found`.
- The workspace sync path stores encrypted BB credentials server-side and refreshes cached data only on initial connect plus explicit manual refresh.
- The ops section surfaces recent `SyncRun` and `PredictionJob` records so failures are visible inside the product.
- The BB XML client now retries transient upstream failures with bounded exponential backoff.
- `/workspace/predictions` and `/workspace/recaps` are premium-gated in the UI and enforced server-side from the shared billing feature registry.

## Launch Verification Checklist

- Sign up or sign in with email auth at `/`.
- Connect a BuzzerBeater account and confirm the initial sync completes.
- Open each authenticated workspace route and verify cached data loads without GraphQL auth errors.
- Submit both manual and connected predictions, then confirm the Ops section shows job progress plus `modelVersion`.
- Upgrade in Stripe test mode, return to `/workspace/ops`, and confirm the premium surfaces unlock.
- Cancel in the Stripe customer portal and confirm the billing panel reflects the renewal state correctly.
- Verify unauthenticated sessions cannot read any workspace or data API surface.

## Core Files

- [`app/page.tsx`](/Users/karey/projects/bb/bb-amplify/app/page.tsx): route entry for the landing page
- [`app/dashboard-app.tsx`](/Users/karey/projects/bb/bb-amplify/app/dashboard-app.tsx): landing page plus authenticated workspace shell
- [`app/workspace/[section]/page.tsx`](/Users/karey/projects/bb/bb-amplify/app/workspace/[section]/page.tsx): route entry for product sections
- [`amplify/data/resource.ts`](/Users/karey/projects/bb/bb-amplify/amplify/data/resource.ts): GraphQL schema and custom operations
- [`amplify/data/_backend/workspace.ts`](/Users/karey/projects/bb/bb-amplify/amplify/data/_backend/workspace.ts): sync, lineup, and player backend logic
- [`lib/bbapi/client.ts`](/Users/karey/projects/bb/bb-amplify/lib/bbapi/client.ts): TypeScript BB XML API client with retry logic
