export const INTERVIEW_PERSONALITY_TYPES = [
  "curt",
  "friendly",
  "rambling",
  "nonsensical",
  "excited",
  "braggart",
  "earnest",
  "stoic",
  "deadpan",
  "reflective",
  "cagey",
  "swaggering",
] as const;

export type InterviewPersonalityType =
  (typeof INTERVIEW_PERSONALITY_TYPES)[number];
export type InterviewPersonalitySource = "auto" | "user_override";
export type InterviewPersonalityMode = "off" | "random";

export const INTERVIEW_PERSONALITY_SOURCE_LABELS: Record<
  InterviewPersonalitySource,
  string
> = {
  auto: "Auto",
  user_override: "Custom",
};

export const INTERVIEW_PERSONALITY_LABELS: Record<
  InterviewPersonalityType,
  string
> = {
  braggart: "Braggart",
  cagey: "Cagey",
  curt: "Curt",
  deadpan: "Deadpan",
  earnest: "Earnest",
  excited: "Excited",
  friendly: "Friendly",
  nonsensical: "Nonsensical",
  rambling: "Rambling",
  reflective: "Reflective",
  stoic: "Stoic",
  swaggering: "Swaggering",
};

const INTERVIEW_PERSONALITY_PROMPTS: Record<
  InterviewPersonalityType,
  string
> = {
  braggart:
    "Let the speaker sound openly self-confident and boastful without inventing new facts.",
  cagey:
    "Let the speaker sound careful, guarded, and slightly evasive while still answering the question.",
  curt:
    "Keep the speaker brief and clipped, with short direct answers.",
  deadpan:
    "Let the speaker sound dry and understated, almost amused, without turning it into a joke bit.",
  earnest:
    "Let the speaker sound sincere, thoughtful, and team-first.",
  excited:
    "Let the speaker sound energized, upbeat, and emotionally charged.",
  friendly:
    "Let the speaker sound warm, approachable, and conversational.",
  nonsensical:
    "Let the speaker wander into quirky, odd phrasing that still stays tethered to the supplied facts.",
  rambling:
    "Let the speaker sound long-winded and meandering while still landing on a clear basketball point.",
  reflective:
    "Let the speaker sound introspective and analytical about how the game unfolded.",
  stoic:
    "Let the speaker sound calm, restrained, and unfazed.",
  swaggering:
    "Let the speaker sound flashy and confident, with a little flair, but without inventing anything.",
};

export function isInterviewPersonalityType(
  value: unknown,
): value is InterviewPersonalityType {
  return (
    typeof value === "string" &&
    (INTERVIEW_PERSONALITY_TYPES as readonly string[]).includes(value)
  );
}

export function isInterviewPersonalitySource(
  value: unknown,
): value is InterviewPersonalitySource {
  return value === "auto" || value === "user_override";
}

export function normalizeInterviewPersonalityMode(
  value: string | null | undefined,
): InterviewPersonalityMode {
  return value === "off" ? "off" : "random";
}

export function buildInterviewPersonalitySeed(args: {
  playerId?: string | null;
  playerName: string;
  teamName?: string | null;
}): string {
  const explicitId = args.playerId?.trim();
  if (explicitId) {
    return explicitId;
  }

  return `${args.teamName?.trim() ?? "unknown-team"}::${args.playerName.trim()}`;
}

export function resolveDeterministicInterviewPersonality(
  seed: string,
): InterviewPersonalityType {
  const normalizedSeed = seed.trim().toLowerCase();
  let hash = 0;
  for (let index = 0; index < normalizedSeed.length; index += 1) {
    hash = (hash * 31 + normalizedSeed.charCodeAt(index)) >>> 0;
  }

  return INTERVIEW_PERSONALITY_TYPES[
    hash % INTERVIEW_PERSONALITY_TYPES.length
  ]!;
}

export function resolveInterviewPersonalityLabel(
  personalityType: InterviewPersonalityType,
): string {
  return INTERVIEW_PERSONALITY_LABELS[personalityType];
}

export function resolveInterviewPersonalityPrompt(
  personalityType: InterviewPersonalityType,
): string {
  return INTERVIEW_PERSONALITY_PROMPTS[personalityType];
}
