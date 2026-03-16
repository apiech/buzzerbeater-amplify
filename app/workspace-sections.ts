export const workspaceSections = [
  {
    id: "home",
    label: "My Team",
    description: "Club overview, roster health, and lineup planning.",
    group: "Club",
  },
  {
    id: "scout",
    label: "Opponents",
    description: "Public team view, tendencies, recent games, and box scores.",
    group: "Club",
  },
  {
    id: "lineups",
    label: "Lineups",
    description: "CoachParrot lineup helper with minute grids, tactics, and rating outputs.",
    group: "Club",
  },
  {
    id: "league",
    label: "League",
    description: "Standings, conference races, and context around your club.",
    group: "Competition",
  },
  {
    id: "players",
    label: "Players",
    description: "Player trends, salaries, and squad decisions.",
    group: "Competition",
  },
  {
    id: "predictions",
    label: "Predictions",
    description: "Matchup previews from saved box scores or manual ratings.",
    group: "Competition",
  },
  {
    id: "recaps",
    label: "Recaps",
    description: "Turn full league slates into reporter-style game stories.",
    group: "Competition",
  },
  {
    id: "ops",
    label: "Account",
    description: "Connection settings, appearance, and recent activity.",
    group: "Settings",
  },
] as const;

export type WorkspaceSection = (typeof workspaceSections)[number]["id"];
export type WorkspaceSectionGroup = (typeof workspaceSections)[number]["group"];

export function normalizeWorkspaceSection(
  value: string | null | undefined,
): WorkspaceSection {
  return (
    workspaceSections.find((section) => section.id === value)?.id ?? "home"
  );
}
