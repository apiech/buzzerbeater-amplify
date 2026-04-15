import {
  formatBuzzerBeaterLabel,
} from "../buzzerbeater/rating-scale";
import type { RawPlayerSkills } from "../coach-parrot";
import { readStoredOwnedRosterPlayer } from "../owned-data/contracts";
import {
  OWNED_ROSTER_SKILL_KEYS,
  type BBApiOwnedRoster,
  type BBApiOwnedRosterPlayer,
  type BBApiOwnedRosterPlayerSkills,
  type BBApiRoster,
  type BBApiRosterPlayer,
} from "./types";

export function isOwnedRosterPlayerSkills(
  skills: BBApiRosterPlayer["skills"],
): skills is BBApiOwnedRosterPlayerSkills {
  const record = skills as Record<string, unknown>;
  return OWNED_ROSTER_SKILL_KEYS.every((key) => typeof record[key] === "number");
}

export function isOwnedRosterPlayer(
  player: BBApiRosterPlayer,
): player is BBApiOwnedRosterPlayer {
  return isOwnedRosterPlayerSkills(player.skills);
}

export function assertOwnedRoster(
  roster: BBApiRoster,
  label: string,
): BBApiOwnedRoster {
  const invalidPlayer = roster.players.find((player) => !isOwnedRosterPlayer(player));
  if (invalidPlayer) {
    throw new Error(
      `${label} did not include the full owned roster skill contract for player ${invalidPlayer.id}.`,
    );
  }

  return roster as BBApiOwnedRoster;
}

export function ownedRosterPlayerToRawPlayerSkills(
  player: BBApiOwnedRosterPlayer,
): RawPlayerSkills {
  return {
    playerId: player.id,
    name: player.fullName,
    js: player.skills.jumpShot,
    jr: player.skills.range,
    od: player.skills.outsideDef,
    ha: player.skills.handling,
    dr: player.skills.driving,
    pa: player.skills.passing,
    is: player.skills.insideShot,
    id: player.skills.insideDef,
    rb: player.skills.rebound,
    sb: player.skills.block,
    st: player.skills.stamina,
    ft: player.skills.freeThrow,
    ex: player.skills.experience,
    gs: player.skills.gameShape,
    age: player.age,
    salary: player.salary,
    metadata: {},
  };
}

export function formatRosterGameShapeLabel(value: number): string {
  return (
    formatBuzzerBeaterLabel({
      scale: "game_shape",
      value,
    }) ?? String(value)
  );
}

export function parseStoredOwnedRosterPlayer(
  value: unknown,
): BBApiOwnedRosterPlayer | null {
  return readStoredOwnedRosterPlayer(value);
}
