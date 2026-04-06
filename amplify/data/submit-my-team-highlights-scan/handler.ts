import { env } from "$amplify/env/submit-my-team-highlights-scan";

import type { Schema } from "../resource";
import { submitMyTeamHighlightsScan } from "../_backend/team-highlights";

type Handler = Schema["submitMyTeamHighlightsScan"]["functionHandler"];
type RuntimeEnv = Record<string, string | undefined>;

export const handler: Handler = async (event) => {
  const stateMachineArn = (env as RuntimeEnv)["TEAM_HIGHLIGHTS_SCAN_STATE_MACHINE_ARN"];
  if (!stateMachineArn) {
    throw new Error(
      "TEAM_HIGHLIGHTS_SCAN_STATE_MACHINE_ARN environment variable was not found.",
    );
  }

  return submitMyTeamHighlightsScan({
    env,
    identity: event.identity,
    stateMachineArn,
  });
};
