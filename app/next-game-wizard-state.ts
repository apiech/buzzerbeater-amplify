import type {
  NextGameRecommendationResult,
  RecommendedGamePlan,
} from "@/app/types";

export type NextGameWizardGoalPreset =
  | "BEST_CHANCE"
  | "SAFEST_FLOOR"
  | "SAVE_ENTHUSIASM";

export const NEXT_GAME_WIZARD_GOAL_OPTIONS: Array<{
  description: string;
  label: string;
  value: NextGameWizardGoalPreset;
}> = [
  {
    description: "Lean into the strongest overall win probability.",
    label: "Best chance",
    value: "BEST_CHANCE",
  },
  {
    description: "Prioritize the safest floor if the game gets weird.",
    label: "Safest floor",
    value: "SAFEST_FLOOR",
  },
  {
    description: "Try to win while conserving enthusiasm where possible.",
    label: "Save enthusiasm",
    value: "SAVE_ENTHUSIASM",
  },
];

export function formatNextGameWizardGoalLabel(
  value: NextGameWizardGoalPreset,
): string {
  return (
    NEXT_GAME_WIZARD_GOAL_OPTIONS.find((option) => option.value === value)
      ?.label ?? "Best chance"
  );
}

export function selectNextGameWizardPrimaryPlan(args: {
  goal: NextGameWizardGoalPreset;
  result: NextGameRecommendationResult | null | undefined;
}): RecommendedGamePlan | null {
  if (!args.result) {
    return null;
  }

  switch (args.goal) {
    case "SAFEST_FLOOR":
      return args.result.safestPlan;
    case "SAVE_ENTHUSIASM":
      return args.result.efficientPlan;
    case "BEST_CHANCE":
    default:
      return args.result.bestExpectedPlan;
  }
}

export function listNextGameWizardAlternativePlans(args: {
  goal: NextGameWizardGoalPreset;
  result: NextGameRecommendationResult | null | undefined;
}): Array<{
  goal: NextGameWizardGoalPreset;
  label: string;
  plan: RecommendedGamePlan;
}> {
  const orderedGoals: NextGameWizardGoalPreset[] = [
    "BEST_CHANCE",
    "SAFEST_FLOOR",
    "SAVE_ENTHUSIASM",
  ];

  return orderedGoals
    .filter((goal) => goal !== args.goal)
    .flatMap((goal) => {
      const plan = selectNextGameWizardPrimaryPlan({
        goal,
        result: args.result,
      });
      return plan
        ? [
            {
              goal,
              label: formatNextGameWizardGoalLabel(goal),
              plan,
            },
          ]
        : [];
    });
}

export function resolveNextGameWizardScenarioMargin(args: {
  plan: RecommendedGamePlan | null | undefined;
  scenarioId: string | null | undefined;
}): number | null {
  if (!args.plan || !args.scenarioId) {
    return null;
  }

  const match = args.plan.scenarioResults.find(
    (result) => result.scenarioId === args.scenarioId && result.available,
  );
  return typeof match?.predictedPointDiff === "number"
    ? match.predictedPointDiff
    : null;
}

export function formatProjectedOutcome(
  value: number | null | undefined,
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Projection unavailable";
  }

  if (value > 0) {
    return `Projected to win by ${value.toFixed(1)}`;
  }
  if (value < 0) {
    return `Projected to lose by ${Math.abs(value).toFixed(1)}`;
  }
  return "Projected even";
}
