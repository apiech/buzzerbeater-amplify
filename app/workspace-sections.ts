export const workspaceSections = [
  {
    id: "home",
    label: "Home",
    description: "Club overview, readiness, and recent form.",
  },
  {
    id: "scout",
    label: "Scout",
    description: "Opponent tendencies, matchups, and boxscore drilldowns.",
  },
  {
    id: "league",
    label: "League",
    description: "Standings and conference context.",
  },
  {
    id: "players",
    label: "Players",
    description: "Trend analysis, salary, and flag fit.",
  },
  {
    id: "predictions",
    label: "Predictions",
    description: "Connected and manual matchup predictions.",
  },
  {
    id: "ops",
    label: "Ops",
    description: "Sync runs and prediction queue health.",
  },
] as const;

export type WorkspaceSection = (typeof workspaceSections)[number]["id"];

export function normalizeWorkspaceSection(
  value: string | null | undefined,
): WorkspaceSection {
  return (
    workspaceSections.find((section) => section.id === value)?.id ?? "home"
  );
}
