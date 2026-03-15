# BB Amplify

Amplify Gen 2 web app for private BuzzerBeater scouting, player analysis, lineup planning, and matchup predictions.

## Current Product Surface

- Public marketing + self-serve email sign-up/sign-in at `/`
- Route-based workspace sections at `/workspace/home`, `/workspace/scout`, `/workspace/league`, `/workspace/players`, `/workspace/predictions`, and `/workspace/ops`
- Encrypted BuzzerBeater account connection and cached workspace sync
- Opponent scouting, league standings, player trends, salary projections, lineup planning, and saved lineup scenarios
- Async SageMaker-backed matchup predictions

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

Prediction infrastructure requirements:

- A SageMaker endpoint named `bb-matchup-predictor-dev` or `bb-matchup-predictor-prod`
  - The backend selects the suffix from `AWS_BRANCH` in [`amplify/backend.ts`](/Users/karey/projects/bb/bb-amplify/amplify/backend.ts).
- The prediction submit Lambda needs SQS send access.
- The prediction worker Lambda needs SQS consume access and `sagemaker:InvokeEndpoint`.

These resources are already wired in [`amplify/backend.ts`](/Users/karey/projects/bb/bb-amplify/amplify/backend.ts).

## Deploy Notes

- The workspace sync path stores encrypted BB credentials server-side and refreshes cached data only on initial connect plus explicit manual refresh.
- The ops section surfaces recent `SyncRun` and `PredictionJob` records so failures are visible inside the product.
- The BB XML client now retries transient upstream failures with bounded exponential backoff.

## Launch Verification Checklist

- Sign up or sign in with email auth at `/`.
- Connect a BuzzerBeater account and confirm the initial sync completes.
- Open each authenticated workspace route and verify cached data loads without GraphQL auth errors.
- Submit both manual and connected predictions, then confirm the Ops section shows job progress plus `modelVersion`.
- Verify unauthenticated sessions cannot read any workspace or data API surface.

## Core Files

- [`app/page.tsx`](/Users/karey/projects/bb/bb-amplify/app/page.tsx): route entry for the landing page
- [`app/dashboard-app.tsx`](/Users/karey/projects/bb/bb-amplify/app/dashboard-app.tsx): landing page plus authenticated workspace shell
- [`app/workspace/[section]/page.tsx`](/Users/karey/projects/bb/bb-amplify/app/workspace/[section]/page.tsx): route entry for product sections
- [`amplify/data/resource.ts`](/Users/karey/projects/bb/bb-amplify/amplify/data/resource.ts): GraphQL schema and custom operations
- [`amplify/data/_backend/workspace.ts`](/Users/karey/projects/bb/bb-amplify/amplify/data/_backend/workspace.ts): sync, lineup, and player backend logic
- [`lib/bbapi/client.ts`](/Users/karey/projects/bb/bb-amplify/lib/bbapi/client.ts): TypeScript BB XML API client with retry logic
