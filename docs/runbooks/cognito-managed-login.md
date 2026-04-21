# Cognito Managed Login Branding And Custom Auth Domain

This app preserves the existing server-side `/api/auth/*` route flow and the
current HttpOnly-cookie SSR session model. The auth UX upgrade comes from
moving Cognito onto the Essentials tier, switching the branded auth domain to
managed login, and applying repo-owned managed-login styling per environment.
Managed-login branding is stored on the Cognito user pool app client, not
globally across environments, so each hosted environment needs its own explicit
branding apply step. For non-prod, prefer an environment-specific hostname such
as `auth.dev.example.com` so it does not claim the production auth domain.

## Files

- Branding definition: [`scripts/cognito-managed-login/clubhouse-branding.json`](/Users/karey/projects/bb/bb-amplify/scripts/cognito-managed-login/clubhouse-branding.json)
- Logo asset: [`scripts/cognito-managed-login/clubhouse-logo.svg`](/Users/karey/projects/bb/bb-amplify/scripts/cognito-managed-login/clubhouse-logo.svg)
- Background asset: [`scripts/cognito-managed-login/clubhouse-page-background.svg`](/Users/karey/projects/bb/bb-amplify/scripts/cognito-managed-login/clubhouse-page-background.svg)
- Apply script: [`scripts/apply-cognito-managed-login-branding.ts`](/Users/karey/projects/bb/bb-amplify/scripts/apply-cognito-managed-login-branding.ts)
- Hosted readiness check: [`scripts/check-hosted-shared-infra.ts`](/Users/karey/projects/bb/bb-amplify/scripts/check-hosted-shared-infra.ts)

## Essentials Requirement

- Managed login requires a Cognito feature plan that includes it.
- This repo pins the user pool tier to `ESSENTIALS` in [`amplify/_backend/auth-controls.ts`](/Users/karey/projects/bb/bb-amplify/amplify/_backend/auth-controls.ts).
- The branded custom domain is pinned to managed login version `2` in [`amplify/_backend/auth-custom-domain.ts`](/Users/karey/projects/bb/bb-amplify/amplify/_backend/auth-custom-domain.ts).

## Required Hosted Env

Set these in the hosted environment before deploy:

- `COGNITO_AUTH_CUSTOM_DOMAIN`
  - Optional explicit auth hostname. When omitted, synth/runtime defaults to `auth.<zone-name>`.
- `COGNITO_AUTH_CUSTOM_DOMAIN_ZONE_NAME`
  - Route 53 public hosted zone name, for example `example.com`.
- `COGNITO_AUTH_CUSTOM_DOMAIN_ZONE_ID`
  - Route 53 hosted zone id for that public zone.

These values allow the backend synth to:

- request an ACM certificate in `us-east-1`
- validate that certificate through Route 53
- attach the custom domain to the existing Cognito user pool in managed-login mode
- create Route 53 alias records that target the Cognito-managed CloudFront distribution

## Apply

Dry-run first:

```bash
npm run auth:brand -- --dry-run
```

Apply the branding:

```bash
npm run auth:brand
```

The script reads `auth.user_pool_id`, `auth.user_pool_client_id`, and
`auth.aws_region` from [`amplify_outputs.json`](/Users/karey/projects/bb/bb-amplify/amplify_outputs.json)
unless you override them with explicit flags. When the custom auth domain env
is present, the preview URL uses that branded domain instead of the fallback
`amazoncognito.com` prefix domain.

Useful overrides:

```bash
npm run auth:brand -- \
  --user-pool-id us-east-1_example \
  --client-id 123example \
  --region us-east-1 \
  --ui-domain auth.example.com \
  --redirect-uri https://app.example.com/api/auth/sign-in-callback
```

## What The Script Does

- resolves the user pool, app client, region, redirect URI, and active auth host
- loads the repo-owned managed-login settings and assets
- checks whether the app client already has a managed-login style
- bootstraps a Cognito-provided default style when the app client does not have one yet
- updates the existing style idempotently with repo-owned settings and assets
- prints a real managed-login preview URL with `client_id` and `redirect_uri`

## Staging-First Deployment Flow

1. Configure the hosted `dev` branch env with the Cognito custom-domain values above.
2. Deploy the backend so the Essentials tier, Cognito managed-login domain, certificate, and Route 53 alias records are created.
3. Wait for DNS and Cognito distribution propagation.
4. Run `npm run auth:brand -- --dry-run` and confirm the preview URL points at the branded auth host.
5. Run `npm run auth:brand`.
6. Run `npm run check:hosted:shared-infra -- --app-id <amplify-app-id>` and confirm the reported auth domain is the branded host with no issues.
7. Validate sign-up, sign-in, forgot password, sign-out, callback, and a hard refresh on a protected route.
8. Promote the same pattern to production only after staged validation looks right.

## Verification

- Open `/api/auth/sign-in` from the public app and confirm the browser lands on `https://auth.<your-domain>/...`, not `amazoncognito.com`.
- Confirm the certificate is valid and the managed login page uses the repo-owned logo, background, and palette.
- Confirm `npm run check:hosted:shared-infra -- --app-id <amplify-app-id>` reports the custom auth domain and no managed-login preview issues.
- Complete sign-in, sign-out, forgot password, and a hard refresh on a protected route.

## Rollback

- Redeploy the backend with the Cognito domain set back to classic branding if you need to fall back to hosted UI.
- If you remove the custom auth-domain env vars, redeploy so runtime and DNS fall back to the prefix-domain behavior.
- Reapplying the old classic-hosted-UI assets is a separate manual fallback step; this runbook only covers the managed-login path.

## Re-Auth Expectation

Switching a Cognito domain from classic hosted UI to managed login can require
users to sign in again. Treat the version switch as a staged auth change, not
as a purely cosmetic asset update.
