import assert from "node:assert/strict";
import test from "node:test";

import { client } from "../app/amplify-client";

test("client hard-navigates to /status when an app route returns maintenance mode", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const redirects: string[] = [];

  globalThis.fetch = async () =>
    ({
      json: async () => ({
        data: null,
        errors: [{ message: "Budget exhausted" }],
        maintenance: {
          active: true,
          state: {
            detail: "Budget exhausted.",
            headline: "Budget exhausted",
            reasonCode: "BUDGET_GUARDRAIL",
          },
        },
      }),
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    }) as Response;
  globalThis.window = {
    location: {
      assign: (value: string) => {
        redirects.push(value);
      },
      pathname: "/workspace/home",
    },
  } as Window & typeof globalThis;

  try {
    const result = await client.queries.getHomeWorkspace();

    assert.deepEqual(redirects, ["/status"]);
    assert.equal(result.maintenance?.active, true);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});
