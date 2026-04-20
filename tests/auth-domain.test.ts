import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCognitoAuthDomainOverride,
  deriveDefaultCognitoAuthCustomDomain,
  extractCognitoAuthDomainFromConfig,
  isAmazonCognitoManagedDomain,
  resolveCognitoAuthCustomDomainConfig,
  resolveCognitoAuthCustomDomainOverride,
} from "../amplify/_shared/auth-domain";

test("custom auth domain override prefers an explicit host and otherwise derives auth.<zone>", () => {
  assert.equal(
    resolveCognitoAuthCustomDomainOverride({
      COGNITO_AUTH_CUSTOM_DOMAIN: "AUTH.Example.com",
      COGNITO_AUTH_CUSTOM_DOMAIN_ZONE_NAME: "example.com",
    }),
    "auth.example.com",
  );

  assert.equal(
    resolveCognitoAuthCustomDomainOverride({
      COGNITO_AUTH_CUSTOM_DOMAIN_ZONE_NAME: "Example.com.",
    }),
    "auth.example.com",
  );
  assert.equal(deriveDefaultCognitoAuthCustomDomain("example.com"), "auth.example.com");
});

test("custom auth domain config requires both hosted zone fields and validates domain ancestry", () => {
  assert.deepEqual(
    resolveCognitoAuthCustomDomainConfig({
      COGNITO_AUTH_CUSTOM_DOMAIN_ZONE_ID: "Z123",
      COGNITO_AUTH_CUSTOM_DOMAIN_ZONE_NAME: "example.com",
    }),
    {
      domain: "auth.example.com",
      zoneId: "Z123",
      zoneName: "example.com",
    },
  );

  assert.throws(
    () =>
      resolveCognitoAuthCustomDomainConfig({
        COGNITO_AUTH_CUSTOM_DOMAIN: "login.other.com",
        COGNITO_AUTH_CUSTOM_DOMAIN_ZONE_ID: "Z123",
        COGNITO_AUTH_CUSTOM_DOMAIN_ZONE_NAME: "example.com",
      }),
    /must be within the hosted zone 'example\.com'/,
  );
  assert.throws(
    () =>
      resolveCognitoAuthCustomDomainConfig({
        COGNITO_AUTH_CUSTOM_DOMAIN: "auth.example.com",
        COGNITO_AUTH_CUSTOM_DOMAIN_ZONE_NAME: "example.com",
      }),
    /ZONE_NAME and COGNITO_AUTH_CUSTOM_DOMAIN_ZONE_ID must both be set/i,
  );
});

test("auth domain helpers extract and override both Amplify outputs and parsed config shapes", () => {
  const rawOutputs = {
    auth: {
      oauth: {
        domain: "prefix.auth.us-east-1.amazoncognito.com",
      },
    },
  };
  const parsedConfig = {
    Auth: {
      Cognito: {
        loginWith: {
          oauth: {
            domain: "prefix.auth.us-east-1.amazoncognito.com",
          },
        },
      },
    },
  };

  assert.equal(
    extractCognitoAuthDomainFromConfig(rawOutputs),
    "prefix.auth.us-east-1.amazoncognito.com",
  );
  assert.equal(
    extractCognitoAuthDomainFromConfig(parsedConfig),
    "prefix.auth.us-east-1.amazoncognito.com",
  );

  assert.deepEqual(applyCognitoAuthDomainOverride(rawOutputs, "auth.example.com"), {
    auth: {
      oauth: {
        domain: "auth.example.com",
      },
    },
  });
  assert.deepEqual(
    applyCognitoAuthDomainOverride(parsedConfig, "auth.example.com"),
    {
      Auth: {
        Cognito: {
          loginWith: {
            oauth: {
              domain: "auth.example.com",
            },
          },
        },
      },
    },
  );
});

test("amazoncognito prefixes are treated as fallback-only auth hosts", () => {
  assert.equal(
    isAmazonCognitoManagedDomain("prefix.auth.us-east-1.amazoncognito.com"),
    true,
  );
  assert.equal(isAmazonCognitoManagedDomain("auth.example.com"), false);
});
