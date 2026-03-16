export const themeOptions = [
  {
    id: "clubhouse",
    label: "Clubhouse",
    description: "Warm paper, brass accents, and a classic front-office feel.",
  },
  {
    id: "arena",
    label: "Arena",
    description: "Clean court blues with brighter surfaces and sharper contrast.",
  },
  {
    id: "nightfall",
    label: "Nightfall",
    description: "Dark score-table styling for late-night prep sessions.",
  },
] as const;

export type ThemeId = (typeof themeOptions)[number]["id"];

export const DEFAULT_THEME_ID: ThemeId = "clubhouse";
export const THEME_STORAGE_KEY = "bb-amplify-theme";

export function getThemeInitScript() {
  return `
    (function() {
      var storageKey = ${JSON.stringify(THEME_STORAGE_KEY)};
      var fallbackTheme = ${JSON.stringify(DEFAULT_THEME_ID)};
      try {
        var storedTheme = window.localStorage.getItem(storageKey);
        var theme = storedTheme || fallbackTheme;
        document.documentElement.setAttribute("data-theme", theme);
      } catch (error) {
        document.documentElement.setAttribute("data-theme", fallbackTheme);
      }
    })();
  `;
}
