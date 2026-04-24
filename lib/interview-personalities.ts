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
export type InterviewPersonalitySource =
  | "auto"
  | "request_override"
  | "user_override";
export type InterviewPersonalityMode = "off" | "random";
export const INTERVIEW_INTENSITY_LEVELS = [
  "clean",
  "pg13",
  "full_heat",
] as const;
export type InterviewIntensity = (typeof INTERVIEW_INTENSITY_LEVELS)[number];

export const INTERVIEW_PERSONALITY_SOURCE_LABELS: Record<
  InterviewPersonalitySource,
  string
> = {
  auto: "Auto",
  request_override: "Debug override",
  user_override: "Custom",
};

export const INTERVIEW_INTENSITY_LABELS: Record<InterviewIntensity, string> = {
  clean: "Clean",
  full_heat: "Full heat",
  pg13: "PG-13",
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
    "The player answers must sound shamelessly self-glorifying, like the player is delivering a victory lap in real time without inventing new facts.",
  cagey:
    "The player answers must sound guarded, slippery, and sly, as if the player knows more than he wants to hand over while still answering the question.",
  curt:
    "The player answers must stay brutally brief, clipped, and cold, with no wasted words.",
  deadpan:
    "The player answers must sound so dry and understated that the confidence lands as a joke without becoming a comedy sketch.",
  earnest:
    "The player answers must sound deeply sincere, team-first, and morally serious, like the player is giving testimony after a basketball sermon.",
  excited:
    "The player answers must sound electrically hyped, emotionally loud, and fully in the moment.",
  friendly:
    "The player answers must sound warm, charming, and loose, like a superstar happily telling the story over a long walk back to the locker room.",
  nonsensical:
    "The player answers must drift into bizarre, funny, surreal imagery while still staying tethered to the supplied facts.",
  rambling:
    "The player answers must sound gloriously long-winded, winding through side roads and analogies before finally landing on the basketball point.",
  reflective:
    "The player answers must sound introspective, philosophical, and analytical about how the game unfolded.",
  stoic:
    "The player answers must sound icy, composed, and unfazed, like the player expected this outcome all along.",
  swaggering:
    "The player answers must sound flamboyant, stylish, and coolly arrogant, with verbal flair but no invented facts.",
};

const INTERVIEW_PERSONALITY_EXAMPLES: Record<
  InterviewPersonalityType,
  string
> = {
  braggart:
    "I knew I was the best player in the building before the anthem ended, and the box score just signed the affidavit.",
  cagey:
    "We saw a door swing open, walked through it twice, and I will let them spend all week guessing which door I mean.",
  curt: "Yeah. I broke them. Next question.",
  deadpan:
    "They kept giving me space. I assumed it was a cry for help, so I answered it.",
  earnest:
    "I wanted to honor the work the group put in, possession by possession, and that is what the night felt like to me.",
  excited:
    "Man, that place was shaking, my pulse was in my throat, and once we smelled blood the whole game turned into fireworks.",
  friendly:
    "It felt like one of those nights where every good read smiled back at you, and I was lucky enough to ride that wave with the group.",
  nonsensical:
    "The game felt like trying to iron lightning with a spoon, and somehow we still got the wrinkles out.",
  rambling:
    "It was one of those nights where one sturdy possession grew a second shadow, then a third, and by the time the crowd noticed, the game had quietly moved into our pocket.",
  reflective:
    "Heraclitus would tell you no defense survives the same read twice, and once we trusted the flow instead of fighting it, the game opened.",
  stoic: "We applied pressure. They bent. The math finished the sentence.",
  swaggering:
    "Once I found the rhythm, the game started dressing in my colors and walking to my tempo.",
};

const INTERVIEW_INTENSITY_PROMPTS: Record<InterviewIntensity, string> = {
  clean:
    "Keep the voice vivid, funny, and highly distinctive, but broadcast-safe and non-insulting. The player can sound cocky, poetic, or theatrical without directly trashing the opponent.",
  full_heat:
    "Turn the volume all the way up. Let the player sound merciless, theatrical, and disrespectful in a sharp competitive way, with mocking lines, audacious self-belief, philosopher references, bar-like rhythm, and original trash talk. Keep every claim grounded in the supplied facts. Do not use slurs, hate speech, or copyrighted quotations.",
  pg13:
    "Push the answers hard. Let the player sound boldly self-confident, funny, quotable, and playful with the trash talk. Original bar-like boasts, philosopher references, and vivid analogies are encouraged. Keep every claim grounded in the supplied facts. Do not use slurs, hate speech, or copyrighted quotations.",
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
  return (
    value === "auto" ||
    value === "request_override" ||
    value === "user_override"
  );
}

export function isInterviewIntensity(value: unknown): value is InterviewIntensity {
  return (
    typeof value === "string" &&
    (INTERVIEW_INTENSITY_LEVELS as readonly string[]).includes(value)
  );
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

export function resolveInterviewIntensityLabel(
  intensity: InterviewIntensity,
): string {
  return INTERVIEW_INTENSITY_LABELS[intensity];
}

export function resolveInterviewPersonalityPrompt(
  args: {
    intensity?: InterviewIntensity | null;
    personalityType: InterviewPersonalityType;
  },
): string {
  const intensity = args.intensity && isInterviewIntensity(args.intensity)
    ? args.intensity
    : "pg13";
  const personalityType = args.personalityType;
  return [
    INTERVIEW_INTENSITY_PROMPTS[intensity],
    INTERVIEW_PERSONALITY_PROMPTS[personalityType],
    "Make the selected personality obvious enough that a reader can identify it instantly without any debug labels.",
    "Use cadence, sentence length, rhythm, metaphor, attitude, and word choice to push the archetype far past generic athlete-speak.",
    "Only the player answers should carry this personality styling; keep the title and reporter questions neutral.",
    "When the intensity allows it, the player can sound unstoppable, superior, mocking, philosophical, flowery, or absurd, so long as the facts stay grounded.",
    `Example answer flavor: "${INTERVIEW_PERSONALITY_EXAMPLES[personalityType]}"`,
    "Treat the example as a style reference only and do not copy it verbatim unless the supplied facts naturally support it.",
  ].join(" ");
}
