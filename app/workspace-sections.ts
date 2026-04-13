export const workspaceSections = [
  {
    id: "home",
    label: "My Team",
    description: "Club overview, roster health, and owner skill snapshots.",
    group: "Club",
  },
  {
    id: "scout",
    label: "Scout opponent",
    description: "Opponent-only scouting sheets with editable forecast output.",
    group: "Club",
  },
  {
    id: "opponent-schedule",
    label: "Opponent schedule",
    description: "Full schedule, filters, and boxscore browsing for any opponent.",
    group: "Club",
  },
  {
    id: "highlights",
    label: "Highlights",
    description:
      "All-time team moments, buzzerbeaters, and late-game swings from your club perspective.",
    group: "Club",
  },
  {
    id: "lineups",
    label: "Lineups",
    description:
      "Lineup helper with minute grids, tactics, and rating outputs.",
    group: "Club",
  },
  {
    id: "league",
    label: "League",
    description: "Standings, conference races, and context around your club.",
    group: "Competition",
  },
  {
    id: "league-history",
    label: "League History",
    description:
      "All-time league standings across stored final seasons and the live current table.",
    group: "Competition",
  },
  {
    id: "rivals",
    label: "Rivals",
    description:
      "All-time head-to-head records, splits, and game logs against every opponent.",
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
    label: "Game prediction",
    description: "Standalone matchup simulator with the full tactic-pair matrix.",
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
