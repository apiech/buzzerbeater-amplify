import { env } from "$amplify/env/get-scout-schedule";

import type { Schema } from "../resource";
import { getScoutScheduleForTeam } from "../_backend/workspace";

type Handler = Schema["getScoutSchedule"]["functionHandler"];

export const handler: Handler = async (event) => {
  const competitionKeys = event.arguments.competitionKeys?.filter(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );

  return getScoutScheduleForTeam({
    competitionKeys: competitionKeys?.length ? competitionKeys : undefined,
    env,
    force: event.arguments.force ?? false,
    identity: event.identity,
    season: event.arguments.season ?? undefined,
    teamId: event.arguments.teamId ?? null,
  });
};
