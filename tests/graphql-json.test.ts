import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeGraphqlJsonPayload,
  encodeGraphqlJsonInput,
} from "../app/graphql-json";

test("encodeGraphqlJsonInput serializes mutation payloads for AWSJSON arguments", () => {
  assert.equal(
    encodeGraphqlJsonInput({
      starters: [{ playerId: "1" }],
    }),
    '{"starters":[{"playerId":"1"}]}',
  );
});

test("decodeGraphqlJsonPayload parses JSON-string query payloads", () => {
  assert.deepStrictEqual(
    decodeGraphqlJsonPayload<{ team: { teamName: string } }>(
      '{"team":{"teamName":"Visionaries"}}',
    ),
    {
      team: {
        teamName: "Visionaries",
      },
    },
  );
});
