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
    "The player answers must sound shamelessly self-glorifying, like every sentence is a parade float built for one ego. Use grand claims of command, receipts, invoices, coronations, and victory-lap rhythm without inventing new basketball facts.",
  cagey:
    "The player answers must sound guarded, sly, and deliberately under-revealing, like the player knows the secret floor plan and is smiling at the reporter for asking. Use hints, half-answers, and mischievous refusal while still answering the question.",
  curt:
    "The player answers must stay brutally brief, clipped, and cold, with no wasted words. The comedy comes from the hard stop: short sentence, sharp edge, done.",
  deadpan:
    "The player answers must sound so dry and understated that the absurdity lands by being treated as normal office paperwork. Use flat phrasing, tiny understatements, and sudden matter-of-fact punchlines.",
  earnest:
    "The player answers must sound deeply sincere, team-first, and almost too morally serious, like a locker-room speech accidentally wandered into a courtroom. Make ordinary possessions sound like civic duty.",
  excited:
    "The player answers must sound electrically hyped, emotionally loud, and fully in the moment. Use exclamation-like rhythm, fast pivots, big feeling, and the sense that the player is still vibrating from the game.",
  friendly:
    "The player answers must sound warm, charming, loose, and funny, like a superstar happily turning the game into a story while grinning through every line.",
  nonsensical:
    "The player answers must drift into bizarre, funny, surreal imagery while still staying tethered to the supplied facts. The player can talk about impossible objects, weather with opinions, haunted scoreboards, paperwork made of thunder, or other obviously comic images.",
  rambling:
    "The player answers must sound gloriously long-winded, winding through side roads, nested analogies, sudden detours, and one final clean basketball point. Make the journey entertaining, not generic.",
  reflective:
    "The player answers must sound introspective, philosophical, and analytical about how the game unfolded. Use big concepts, ancient-sounding certainty, and calm overthinking, but keep the basketball claim grounded.",
  stoic:
    "The player answers must sound icy, composed, and unfazed, like the player expected the whole night to resolve into a proof. Use short logic, pressure, order, and finality.",
  swaggering:
    "The player answers must sound flamboyant, stylish, and coolly arrogant, like the game had a soundtrack only the player could hear. Use rhythm, shine, tempo, and verbal flair without invented facts.",
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
    "Keep the voice vivid, funny, and highly distinctive, but broadcast-safe and non-insulting. The player can be theatrical, poetic, strange, and instantly quotable without directly trashing the opponent.",
  full_heat:
    "Use the same wild theatrical imagination as PG-13, then add sharper disrespect, harder competitive mockery, audacious self-belief, original trash talk, and bigger verbal flexing. Keep every basketball claim grounded in the supplied facts. Do not use slurs, hate speech, or copyrighted quotations.",
  pg13:
    "Make this as entertaining as full heat: wild, funny, theatrical, surreal, highly quotable, and unmistakably personality-driven. The difference is that PG-13 should be less mean and less cutting, not less creative. Original boasts, philosopher references, absurd analogies, and playful trash talk are encouraged. Keep every basketball claim grounded in the supplied facts. Do not use slurs, hate speech, or copyrighted quotations.",
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
    "Every answer should pass a silhouette test: even with the personality label removed, the cadence, sentence length, rhythm, metaphor, attitude, and word choice should make the archetype obvious.",
    "Push the archetype far past generic athlete-speak. Safe blandness is a failure mode.",
    "Only the player answers should carry this personality styling; keep the title and reporter questions neutral.",
    "When the intensity allows it, the player can sound unstoppable, superior, mocking, philosophical, flowery, or absurd, so long as the facts stay grounded.",
    `Example answer flavor: "${INTERVIEW_PERSONALITY_EXAMPLES[personalityType]}"`,
    "Treat the example as a style reference only and do not copy it verbatim unless the supplied facts naturally support it.",
  ].join(" ");
}
