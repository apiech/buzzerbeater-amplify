import assert from "node:assert/strict";
import test from "node:test";

import {
  isOpaqueAuthIdentifier,
  resolveViewerLabel,
} from "../app/viewer-identity";

test("resolveViewerLabel prefers the account email", () => {
  assert.equal(
    resolveViewerLabel({
      email: "coach+attrs@example.com",
      username: "94181488-f031-7045-0f00-d8e29fc17e3b",
    }),
    "coach+attrs@example.com",
  );
});

test("resolveViewerLabel falls back to the preferred username", () => {
  assert.equal(
    resolveViewerLabel({
      preferredUsername: "coach-on-call",
      username: "94181488-f031-7045-0f00-d8e29fc17e3b",
    }),
    "coach-on-call",
  );
});

test("resolveViewerLabel falls back to the profile name", () => {
  assert.equal(
    resolveViewerLabel({
      name: "Coach Example",
      username: "94181488-f031-7045-0f00-d8e29fc17e3b",
    }),
    "Coach Example",
  );
});

test("resolveViewerLabel keeps non-opaque usernames", () => {
  assert.equal(
    resolveViewerLabel({
      username: "coach-on-call",
    }),
    "coach-on-call",
  );
});

test("resolveViewerLabel suppresses opaque auth identifiers", () => {
  const opaqueIdentifier = "94181488-f031-7045-0f00-d8e29fc17e3b";

  assert.equal(isOpaqueAuthIdentifier(opaqueIdentifier), true);
  assert.equal(
    resolveViewerLabel({
      username: opaqueIdentifier,
    }),
    null,
  );
});
