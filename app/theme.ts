export const themeOptions = [
  {
    id: "clubhouse",
    label: "Clubhouse",
    description: "Warm paper, brass accents, and a classic front-office feel.",
  },
  {
    id: "arena",
    label: "Arena",
    description:
      "Clean court blues with brighter surfaces and sharper contrast.",
  },
  {
    id: "nightfall",
    label: "Nightfall",
    description: "Dark score-table styling for late-night prep sessions.",
  },
] as const;

export type ThemeId = (typeof themeOptions)[number]["id"];

export const DEFAULT_THEME_ID: ThemeId = "clubhouse";

const themeIds = new Set<ThemeId>(themeOptions.map((option) => option.id));

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return typeof value === "string" && themeIds.has(value as ThemeId);
}
