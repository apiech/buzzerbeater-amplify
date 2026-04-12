import { normalizeWorkspaceSection } from "@/app/workspace-sections";

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

export type AnalyticsTokenSource =
  | "legacy_analytics_id"
  | "posthog_token"
  | null;

export type AnalyticsPublicConfig = {
  enabled: boolean;
  host: string;
  token: string | null;
  tokenSource: AnalyticsTokenSource;
};

export type AnalyticsPageCategory =
  | "auth"
  | "commerce"
  | "status"
  | "workspace"
  | "app";

export type AnalyticsRouteContext = {
  pageCategory: AnalyticsPageCategory;
  pageName: string;
  workspaceSection: string | null;
};

export function resolveAnalyticsPublicConfig(
  env: Record<string, string | undefined> = {},
): AnalyticsPublicConfig {
  const posthogToken = normalizeOptionalString(env.NEXT_PUBLIC_POSTHOG_TOKEN);
  const legacyToken = normalizeOptionalString(env.NEXT_PUBLIC_ANALYTICS_ID);
  const token = posthogToken ?? legacyToken;

  return {
    enabled: Boolean(token),
    host:
      normalizeOptionalString(env.NEXT_PUBLIC_POSTHOG_HOST) ??
      DEFAULT_POSTHOG_HOST,
    token,
    tokenSource: posthogToken
      ? "posthog_token"
      : legacyToken
        ? "legacy_analytics_id"
        : null,
  };
}

export function resolveAnalyticsRouteContext(
  pathname: string,
): AnalyticsRouteContext {
  const normalizedPath = normalizeAnalyticsPath(pathname);

  if (normalizedPath === "/login") {
    return {
      pageCategory: "auth",
      pageName: "login",
      workspaceSection: null,
    };
  }

  if (normalizedPath === "/store") {
    return {
      pageCategory: "commerce",
      pageName: "store",
      workspaceSection: null,
    };
  }

  if (normalizedPath === "/status") {
    return {
      pageCategory: "status",
      pageName: "status",
      workspaceSection: null,
    };
  }

  if (normalizedPath.startsWith("/workspace/boxscores/")) {
    return {
      pageCategory: "workspace",
      pageName: "workspace-boxscore",
      workspaceSection: "scout",
    };
  }

  if (normalizedPath === "/workspace") {
    return {
      pageCategory: "workspace",
      pageName: "workspace-home",
      workspaceSection: "home",
    };
  }

  if (normalizedPath.startsWith("/workspace/")) {
    const sectionSegment = normalizedPath.split("/")[2] ?? "home";
    const workspaceSection = normalizeWorkspaceSection(sectionSegment);
    return {
      pageCategory: "workspace",
      pageName: `workspace-${workspaceSection}`,
      workspaceSection,
    };
  }

  return {
    pageCategory: "app",
    pageName: toAnalyticsPageName(normalizedPath),
    workspaceSection: null,
  };
}

export function shouldEnablePublicSessionRecording(input: {
  isAuthenticated: boolean;
  pathname: string;
}): boolean {
  if (input.isAuthenticated) {
    return false;
  }

  const normalizedPath = normalizeAnalyticsPath(input.pathname);
  return normalizedPath === "/login" || normalizedPath === "/store";
}

function normalizeAnalyticsPath(pathname: string): string {
  const normalized = pathname.trim();
  if (!normalized || normalized === "/") {
    return "/";
  }

  return normalized.replace(/\/+$/g, "") || "/";
}

function toAnalyticsPageName(pathname: string): string {
  if (pathname === "/") {
    return "root";
  }

  return pathname
    .slice(1)
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function normalizeOptionalString(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
