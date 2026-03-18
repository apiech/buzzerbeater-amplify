import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCALHOST_APP_ORIGIN,
  deriveAmplifyAppOrigin,
  normalizePublicAppOrigin,
  resolvePublicAppOrigin,
} from "../lib/env/public-app-origin.js";

test("normalizePublicAppOrigin trims and strips trailing slashes", () => {
  assert.equal(
    normalizePublicAppOrigin(" https://example.com/// "),
    "https://example.com",
  );
  assert.equal(normalizePublicAppOrigin(""), null);
});

test("resolvePublicAppOrigin reads APP_BASE_URL from env", () => {
  assert.equal(
    resolvePublicAppOrigin({
      APP_BASE_URL: "https://app.example.com///",
    }),
    "https://app.example.com",
  );
});

test("resolvePublicAppOrigin supports the local fallback", () => {
  assert.equal(
    resolvePublicAppOrigin({}, { fallback: LOCALHOST_APP_ORIGIN }),
    LOCALHOST_APP_ORIGIN,
  );
});

test("resolvePublicAppOrigin throws when APP_BASE_URL is required but missing", () => {
  assert.throws(
    () =>
      resolvePublicAppOrigin(
        {},
        {
          errorMessage: "APP_BASE_URL should be configured.",
        },
      ),
    /APP_BASE_URL should be configured\./,
  );
});

test("deriveAmplifyAppOrigin uses the canonical public origin", () => {
  assert.equal(
    deriveAmplifyAppOrigin({
      APP_BASE_URL: "https://bb.example.com/",
    }),
    "https://bb.example.com",
  );
});
