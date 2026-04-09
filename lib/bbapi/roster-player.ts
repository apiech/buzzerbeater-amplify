import {
  formatBuzzerBeaterLabel,
} from "../buzzerbeater/rating-scale";
import type { RawPlayerSkills } from "../coach-parrot";
import {
  OWNED_ROSTER_SKILL_KEYS,
  type BBApiOwnedRoster,
  type BBApiOwnedRosterPlayer,
  type BBApiOwnedRosterPlayerSkills,
  type BBApiRequiredNamedReference,
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
  const player = toRecord(value);
  const nationality = parseRequiredNamedReference(player?.nationality);
  const skills = parseStoredOwnedRosterPlayerSkills(player?.skills);
  if (!player || !nationality || !skills) {
    return null;
  }

  const id = asNonEmptyString(player.id);
  const firstName = asNonEmptyString(player.firstName);
  const lastName = asNonEmptyString(player.lastName);
  const fullName = asNonEmptyString(player.fullName);
  const salary = asFiniteNumber(player.salary);
  const bestPosition = asNonEmptyString(player.bestPosition);
  const age = asFiniteNumber(player.age);
  const height = asFiniteNumber(player.height);
  const dmi = asFiniteNumber(player.dmi);
  const injuryWeeks = asFiniteNumber(player.injuryWeeks);

  if (
    id === null ||
    firstName === null ||
    lastName === null ||
    fullName === null ||
    salary === null ||
    bestPosition === null ||
    age === null ||
    height === null ||
    dmi === null ||
    injuryWeeks === null
  ) {
    return null;
  }

  return {
    id,
    firstName,
    lastName,
    fullName,
    salary,
    bestPosition,
    age,
    height,
    dmi,
    injuryWeeks,
    nationality,
    skills,
  };
}

function parseStoredOwnedRosterPlayerSkills(
  value: unknown,
): BBApiOwnedRosterPlayerSkills | null {
  const skills = toRecord(value);
  if (!skills) {
    return null;
  }

  const parsed = {} as BBApiOwnedRosterPlayerSkills;
  for (const key of OWNED_ROSTER_SKILL_KEYS) {
    const numeric = asFiniteNumber(skills[key]);
    if (numeric === null) {
      return null;
    }
    parsed[key] = numeric;
  }
  return parsed;
}

function parseRequiredNamedReference(
  value: unknown,
): BBApiRequiredNamedReference | null {
  const record = toRecord(value);
  const id = asNonEmptyString(record?.id);
  const name = asNonEmptyString(record?.name);
  if (!record || id === null || name === null) {
    return null;
  }

  const attributes = toRecord(record.attributes);
  return {
    id,
    name,
    attributes: attributes
      ? Object.fromEntries(
          Object.entries(attributes).map(([key, entry]) => [
            key,
            typeof entry === "string" ? entry : entry == null ? null : String(entry),
          ]),
        )
      : undefined,
  };
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
