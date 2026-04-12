import { env } from "$amplify/env/get-rivals-workspace";

import type { Schema } from "../resource";
import {
  compactNullableStringArray,
  getRivalsWorkspace,
} from "../_backend/rivals";

type Handler = Schema["getRivalsWorkspace"]["functionHandler"];

export const handler: Handler = async (event) => {
  return getRivalsWorkspace({
    competitionKeys: compactNullableStringArray(
      event.arguments.competitionKeys,
    ),
    endSeason: event.arguments.endSeason ?? undefined,
    env,
    identity: event.identity,
    outcomes: compactNullableStringArray(event.arguments.outcomes),
    selectedOpponentId: event.arguments.selectedOpponentId ?? undefined,
    startSeason: event.arguments.startSeason ?? undefined,
    tvScopes: compactNullableStringArray(event.arguments.tvScopes),
    venues: compactNullableStringArray(event.arguments.venues),
  });
};
