import assert from "node:assert/strict";
import test from "node:test";

import { __testing as dashboardTesting } from "../app/dashboard-app";

test("readPayload parses JSON string payloads from workspace handlers", () => {
  const payload = dashboardTesting.readPayload<{ team: { teamName: string } }>({
    payload: JSON.stringify({
      team: {
        teamName: "Visionaries",
      },
    }),
  } as any);

  assert.deepStrictEqual(payload, {
    team: {
      teamName: "Visionaries",
    },
  });
});

test("readPayload preserves object payloads returned by generated clients", () => {
  const payload = dashboardTesting.readPayload<{ summary: { wins: number } }>({
    payload: {
      summary: {
        wins: 10,
      },
    },
  } as any);

  assert.deepStrictEqual(payload, {
    summary: {
      wins: 10,
    },
  });
});
