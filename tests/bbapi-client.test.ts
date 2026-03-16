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

test("BBXmlApiClient exposes raw seasons XML", async () => {
  const requests: string[] = [];
  const client = new BBXmlApiClient({
    username: "coach",
    securityCode: "secret",
    fetchImpl: async (input) => {
      const url = input instanceof URL ? input : new URL(String(input));
      requests.push(url.pathname);

      if (url.pathname.endsWith("/login.aspx")) {
        return new Response("<loggedIn />", {
          status: 200,
          headers: {
            "set-cookie": "bb_session=ok; Path=/; HttpOnly",
          },
        });
      }

      return new Response("<bbapi><seasons /></bbapi>", {
        status: 200,
      });
    },
  });

  const xml = await client.getSeasonsXml();

  assert.equal(xml, "<bbapi><seasons /></bbapi>");
  assert.deepStrictEqual(requests, ["/login.aspx", "/seasons.aspx"]);
});
