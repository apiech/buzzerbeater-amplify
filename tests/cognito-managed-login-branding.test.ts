import assert from "node:assert/strict";
import test from "node:test";

import { __testing as brandingTesting } from "../scripts/apply-cognito-managed-login-branding";

test("managed-login branding defaults resolve Cognito identifiers from amplify outputs", () => {
  const result = brandingTesting.parseArgs([], {}, () => ({
    clientId: "client-123",
    domain: "example.auth.us-east-1.amazoncognito.com",
    redirectUri: "https://app.example.com/api/auth/sign-in-callback",
    region: "us-east-1",
    userPoolId: "us-east-1_example",
  }));

  assert.equal(result.clientId, "client-123");
  assert.equal(result.userPoolId, "us-east-1_example");
  assert.equal(result.region, "us-east-1");
  assert.match(
    result.previewUrl ?? "",
    /https:\/\/example\.auth\.us-east-1\.amazoncognito\.com\/login\?/,
  );
});

test("managed-login preview prefers the configured custom auth domain when present", () => {
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

  assert.match(
    result.previewUrl ?? "",
    /https:\/\/auth\.example\.com\/login\?/,
  );
});

test("managed-login create command bootstraps Cognito-provided defaults first", () => {
  const args = brandingTesting.buildCreateDefaultManagedLoginBrandingArgs({
    clientId: "client-123",
    region: "us-east-1",
    userPoolId: "us-east-1_example",
  });

  assert.deepEqual(args, [
    "cognito-idp",
    "create-managed-login-branding",
    "--user-pool-id",
    "us-east-1_example",
    "--client-id",
    "client-123",
    "--use-cognito-provided-values",
    "--region",
    "us-east-1",
    "--output",
    "json",
  ]);
});

test("managed-login update payload omits resource ids and includes repo-managed assets", () => {
  const definition = brandingTesting.loadManagedLoginBrandingDefinition(
    brandingTesting.defaultDefinitionPath,
  );
  const updateInput = brandingTesting.buildManagedLoginUpdateInput(
    {
      Assets: [
        {
          Category: "FORM_LOGO",
          ColorMode: "LIGHT",
          Extension: "SVG",
          ResourceId: "existing-form-logo",
        },
      ],
      ManagedLoginBrandingId: "branding-123",
      Settings: {
        categories: {
          global: {
            colorSchemeMode: "LIGHT",
          },
        },
      },
    },
    definition,
  );

  const formLogoAsset = updateInput.assets.find(
    (asset) => asset.Category === "FORM_LOGO" && asset.ColorMode === "LIGHT",
  );
  const headerLogoAsset = updateInput.assets.find(
    (asset) =>
      asset.Category === "PAGE_HEADER_LOGO" && asset.ColorMode === "LIGHT",
  );

  assert.equal(formLogoAsset?.ResourceId, undefined);
  assert.equal(headerLogoAsset?.ResourceId, undefined);
  assert.equal(updateInput.assets.length, definition.assets.length);
  assert.match(JSON.stringify(updateInput.settings), /"pageHeader"/);
  assert.ok(updateInput.requestBytes > 0);
});

test("managed-login update command sends JSON settings and asset documents", () => {
  const args = brandingTesting.buildUpdateManagedLoginBrandingArgs(
    {
      region: "us-east-1",
      userPoolId: "us-east-1_example",
    },
    "branding-123",
    {
      assets: [
        {
          Bytes: "R0lGODlhAQABAIAAAAUEBA==",
          Category: "FORM_LOGO",
          ColorMode: "LIGHT",
          Extension: "SVG",
        },
      ],
      requestBytes: 256,
      settings: {
        categories: {
          global: {
            colorSchemeMode: "LIGHT",
          },
        },
      },
    },
  );

  assert.deepEqual(args.slice(0, 8), [
    "cognito-idp",
    "update-managed-login-branding",
    "--user-pool-id",
    "us-east-1_example",
    "--managed-login-branding-id",
    "branding-123",
    "--settings",
    JSON.stringify({
      categories: {
        global: {
          colorSchemeMode: "LIGHT",
        },
      },
    }),
  ]);
  assert.match(args.join(" "), /--assets/);
  assert.match(args.join(" "), /--region us-east-1/);
});

test("managed-login assets stay within Cognito limits and include the branded background", () => {
  const definition = brandingTesting.loadManagedLoginBrandingDefinition(
    brandingTesting.defaultDefinitionPath,
  );
  const pageBackgroundAsset = definition.assets.find(
    (asset) =>
      asset.category === "PAGE_BACKGROUND" && asset.colorMode === "LIGHT",
  );

  assert.ok(
    definition.assets.every(
      (asset) => asset.size <= brandingTesting.maxAssetBytes,
    ),
  );
  assert.ok(definition.assets.length >= 4);
  assert.equal(pageBackgroundAsset?.extension, "SVG");
});
