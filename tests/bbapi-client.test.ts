import assert from "node:assert/strict";
import test from "node:test";

import { BBXmlApiClient, BBXmlApiError } from "../lib/bbapi/client";

test("BBXmlApiClient retries transient upstream failures", async () => {
  let attempts = 0;
  const client = new BBXmlApiClient({
    username: "coach",
    securityCode: "secret",
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response("upstream unavailable", {
          status: 503,
          statusText: "Service Unavailable",
        });
      }

      return new Response("<loggedIn />", {
        status: 200,
        headers: {
          "set-cookie": "bb_session=ok; Path=/; HttpOnly",
        },
      });
    },
  });

  await client.login();

  assert.equal(attempts, 2);
});

test("BBXmlApiClient does not retry invalid credentials", async () => {
  let attempts = 0;
  const client = new BBXmlApiClient({
    username: "coach",
    securityCode: "bad-secret",
    fetchImpl: async () => {
      attempts += 1;
      return new Response('<error message="BuzzerBeater login failed." />', {
        status: 200,
      });
    },
  });

  await assert.rejects(() => client.login(), BBXmlApiError);
  assert.equal(attempts, 1);
});
