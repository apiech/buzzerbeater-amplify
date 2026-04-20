# Cognito Classic Hosted UI Branding And Custom Auth Domain

This app keeps Cognito on the Lite tier and preserves the existing server-side
`/api/auth/*` route flow. The branded `/login` page is only the contextual
handoff surface; actual credential entry still happens on the Cognito classic
hosted UI. In hosted environments, the trust improvement comes from moving that
hosted UI onto a branded custom domain such as `auth.example.com`.
Classic hosted UI branding is stored on the Cognito user pool/app client, not
globally across environments, so each hosted environment needs its own explicit
branding apply step. For non-prod, prefer an environment-specific hostname such
as `auth.dev.example.com` so it does not claim the production auth domain.

## Files

- CSS: [`scripts/cognito-hosted-ui/classic-clubhouse.css`](/Users/karey/projects/bb/bb-amplify/scripts/cognito-hosted-ui/classic-clubhouse.css)
- Logo source: [`scripts/cognito-hosted-ui/clubhouse-logo.svg`](/Users/karey/projects/bb/bb-amplify/scripts/cognito-hosted-ui/clubhouse-logo.svg)
- Logo upload asset: [`scripts/cognito-hosted-ui/clubhouse-logo.png`](/Users/karey/projects/bb/bb-amplify/scripts/cognito-hosted-ui/clubhouse-logo.png)
- Apply script: [`scripts/apply-cognito-hosted-ui-branding.ts`](/Users/karey/projects/bb/bb-amplify/scripts/apply-cognito-hosted-ui-branding.ts)
- Hosted readiness check: [`scripts/check-hosted-shared-infra.ts`](/Users/karey/projects/bb/bb-amplify/scripts/check-hosted-shared-infra.ts)

## Required Hosted Env

Set these in the hosted environment before deploy:

- `COGNITO_AUTH_CUSTOM_DOMAIN`
  - Optional explicit auth hostname. When omitted, the synth/runtime defaults to `auth.<zone-name>`.
- `COGNITO_AUTH_CUSTOM_DOMAIN_ZONE_NAME`
  - Route 53 public hosted zone name, for example `example.com`.
- `COGNITO_AUTH_CUSTOM_DOMAIN_ZONE_ID`
  - Route 53 hosted zone id for that public zone.

These values allow the backend synth to:

- request an ACM certificate for the branded auth hostname
- validate that certificate through Route 53
- attach the custom domain to the existing Cognito user pool in classic hosted UI mode
- create Route 53 alias records that target the Cognito-managed CloudFront distribution

The certificate must live in `us-east-1`. This repo assumes the Cognito user
pool and hosted environment are already in `us-east-1`.

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
unless you override them with explicit flags. When the custom auth domain env is
present, the preview URL uses that branded domain instead of the fallback
`amazoncognito.com` prefix domain.

Useful overrides:

```bash
npm run auth:brand -- \
  --user-pool-id us-east-1_example \
  --client-id 123example \
  --region us-east-1
```

## What The Script Does

- validates the classic hosted UI CSS and logo size limits before calling AWS
- uploads the logo and CSS together with `aws cognito-idp set-ui-customization`
- prints a preview URL when the Cognito domain and callback URL are available in
  `amplify_outputs.json`

## Deployment Flow

1. Configure the hosted env with the Cognito custom-domain values above.
2. Deploy the backend so the certificate, Cognito custom domain, and Route 53
   alias records are created.
3. Wait for DNS and Cognito distribution propagation. Certificate distribution
   can take longer than the hosted UI CSS update path.
4. Run `npm run auth:brand -- --dry-run` and confirm the preview URL points at
   the branded auth host.
5. Run `npm run auth:brand`.
6. Run `npm run check:hosted:shared-infra -- --app-id <amplify-app-id>` and
   confirm the reported auth domain is the branded host with no issues.

## Verification

- Open `/api/auth/sign-in` from the public app and confirm the browser lands on
  `https://auth.<your-domain>/...`, not `amazoncognito.com`.
- Confirm the certificate is valid and the logo/CSS match the app theme.
- Complete sign-in, sign-out, and a hard refresh on a protected route.

## Rollback

- Remove the Cognito custom-domain env vars and redeploy to fall back to the
  existing prefix-domain behavior.
- Re-run `npm run auth:brand` after fallback if you need to refresh the classic
  hosted UI style on the prefix domain.
- If DNS propagation is still in flight, allow Route 53 and Cognito time to
  settle before validating the fallback path.

## Classic Hosted UI Limits

These limits come from Cognito classic hosted UI branding:

- the user pool must already have a domain
- CSS and logo must be uploaded together
- CSS must stay under roughly 3 KB
- the logo must be PNG, JPG, or JPEG and stay under 100 KB
- only the classic hosted UI CSS template class names are supported
- text on the hosted pages is not freely customizable

Preview changes can take up to about one minute to refresh after upload.
Custom-domain certificate distribution can take longer.
