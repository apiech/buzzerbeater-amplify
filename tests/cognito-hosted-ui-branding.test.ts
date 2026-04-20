import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing as brandingTesting,
} from "../scripts/apply-cognito-hosted-ui-branding";

test("branding defaults resolve Cognito identifiers from amplify outputs", () => {
  const result = brandingTesting.parseArgs(
    [],
    {},
    () => ({
      clientId: "client-123",
      domain: "example.auth.us-east-1.amazoncognito.com",
      redirectUri: "https://app.example.com/api/auth/sign-in-callback",
      region: "us-east-1",
      userPoolId: "us-east-1_example",
    }),
  );

  assert.equal(result.clientId, "client-123");
  assert.equal(result.userPoolId, "us-east-1_example");
  assert.equal(result.region, "us-east-1");
  assert.match(
    result.previewUrl ?? "",
    /https:\/\/example\.auth\.us-east-1\.amazoncognito\.com\/login\?/,
  );
});

test("branding preview prefers the configured custom auth domain when present", () => {
  const result = brandingTesting.parseArgs(
    [],
    {
      COGNITO_AUTH_CUSTOM_DOMAIN: "auth.example.com",
    },
    () => ({
      clientId: "client-123",
      domain: "example.auth.us-east-1.amazoncognito.com",
      redirectUri: "https://app.example.com/api/auth/sign-in-callback",
      region: "us-east-1",
      userPoolId: "us-east-1_example",
    }),
  );

  assert.match(result.previewUrl ?? "", /https:\/\/auth\.example\.com\/login\?/);
});

test("classic hosted UI command uses file-backed logo input and inline CSS", () => {
  const args = brandingTesting.buildSetUiCustomizationArgs(
    {
      clientId: "client-123",
      imagePath: "/tmp/clubhouse-logo.png",
      region: "us-east-1",
      userPoolId: "us-east-1_example",
    },
    {
      cssSource: ".label-customizable{color:#1f2a33;}",
    },
  );

  assert.deepEqual(args.slice(0, 8), [
    "cognito-idp",
    "set-ui-customization",
    "--user-pool-id",
    "us-east-1_example",
    "--client-id",
    "client-123",
    "--image-file",
    "fileb:///tmp/clubhouse-logo.png",
  ]);
  assert.match(args.join(" "), /--css/);
  assert.match(args.join(" "), /--region us-east-1/);
});

test("classic hosted UI assets stay within Cognito Lite limits", () => {
  const assets = brandingTesting.loadBrandingAssets({
    cssPath: brandingTesting.defaultCssPath,
    imagePath: brandingTesting.defaultImagePath,
  });

  assert.ok(assets.cssBytes <= brandingTesting.maxCssBytes);
  assert.ok(assets.imageBytes <= brandingTesting.maxImageBytes);
});
