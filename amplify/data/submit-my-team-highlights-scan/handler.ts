import { env } from "$amplify/env/submit-my-team-highlights-scan";

import type { Schema } from "../resource";
import { submitMyTeamHighlightsScan } from "../_backend/team-highlights";

type Handler = Schema["submitMyTeamHighlightsScan"]["functionHandler"];

export const handler: Handler = async (event) => {
  const queueUrl = env.TEAM_HIGHLIGHTS_SCAN_QUEUE_URL;
  if (!queueUrl) {
    throw new Error(
      "TEAM_HIGHLIGHTS_SCAN_QUEUE_URL environment variable was not found.",
    );
  }

  return submitMyTeamHighlightsScan({
    env,
    identity: event.identity,
    queueUrl,
  });
};
