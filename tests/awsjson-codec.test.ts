import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeAwsJsonFields,
  decodeAwsJsonValue,
  encodeAwsJsonFields,
  encodeAwsJsonValue,
} from "../amplify/data/_backend/awsjson";

test("encodeAwsJsonValue serializes objects, arrays, and primitives", () => {
  assert.equal(encodeAwsJsonValue({ teamId: "123" }), '{"teamId":"123"}');
  assert.equal(encodeAwsJsonValue(["home", "away"]), '["home","away"]');
  assert.equal(encodeAwsJsonValue(12), "12");
  assert.equal(encodeAwsJsonValue(true), "true");
  assert.equal(encodeAwsJsonValue("apiech"), '"apiech"');
});

test("encodeAwsJsonValue preserves nullish values", () => {
  assert.equal(encodeAwsJsonValue(null), null);
  assert.equal(encodeAwsJsonValue(undefined), undefined);
});

test("decodeAwsJsonValue parses valid JSON and leaves malformed strings untouched", () => {
  assert.deepStrictEqual(
    decodeAwsJsonValue('{"home":{"teamId":"123"}}'),
    { home: { teamId: "123" } },
  );
  assert.equal(decodeAwsJsonValue("12"), 12);
  assert.equal(decodeAwsJsonValue("true"), true);
  assert.equal(decodeAwsJsonValue('"apiech"'), "apiech");
  assert.equal(decodeAwsJsonValue("{broken"), "{broken");
});

test("field codecs only serialize intentional holdouts and still decode legacy typed fields", () => {
  const encoded = encodeAwsJsonFields("BbConnection", {
    userId: "u1",
    bbLoginName: "apiech",
    profileJson: { teamId: "123" },
    workspaceCacheJson: { home: { teamId: "123" } },
  });

  assert.deepStrictEqual(encoded, {
    userId: "u1",
    bbLoginName: "apiech",
    profileJson: { teamId: "123" },
    workspaceCacheJson: { home: { teamId: "123" } },
  });

  assert.deepStrictEqual(
    decodeAwsJsonFields("BbConnection", {
      userId: "u1",
      bbLoginName: "apiech",
      profileJson: '{"teamId":"123"}',
      workspaceCacheJson: '{"home":{"teamId":"123"}}',
    }),
    {
      userId: "u1",
      bbLoginName: "apiech",
      profileJson: { teamId: "123" },
      workspaceCacheJson: { home: { teamId: "123" } },
    },
  );
});
