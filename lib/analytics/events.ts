import type { ThemeId } from "@/app/theme";
import type { WorkspaceSection } from "@/app/workspace-sections";
import type { AnalyticsPageCategory } from "@/lib/analytics/config";

export type AnalyticsAuthFlow = "sign_in" | "sign_up";
export type AnalyticsBillingOfferType = "lifetime" | "subscription";
export type AnalyticsFeedbackSubmissionKind = "FEEDBACK" | "FEATURE_REQUEST";
export type AnalyticsHighlightsPerspective = "against" | "both" | "for";
export type AnalyticsNavigationSurface = "desktop_sidebar" | "mobile_drawer";
export type AnalyticsThemeSource = "theme_select";

export type AnalyticsEventMap = {
  $pageview: {
    environment_name: string;
    is_authenticated: boolean;
    page_category: AnalyticsPageCategory;
    page_name: string;
    search_present: boolean;
    workspace_section: string | null;
  };
  auth_flow_completed: {
    environment_name: string;
    flow: AnalyticsAuthFlow;
  };
  auth_flow_started: {
    flow: AnalyticsAuthFlow;
    source:
      | "login_page"
      | "store"
      | "store_lifetime_offer"
      | "store_subscription_offer";
  };
  auth_signed_out: {
    source: "workspace_nav";
  };
  bb_connection_disconnect_requested: {
    source: "workspace_panel";
  };
  bb_connection_result: {
    status: string;
    success: boolean;
  };
  bb_connection_submitted: {
    mode: "initial_connect" | "update";
  };
  bb_connection_update_requested: {
    source: "workspace_panel";
  };
  billing_access_changed: {
    access_source: string;
    plan_id: string;
    source: "account_panel" | "store";
  };
  billing_checkout_failed: {
    offer_type: AnalyticsBillingOfferType;
    source: "account_panel" | "store";
  };
  billing_checkout_returned: {
    result: string;
    source: "store";
  };
  billing_checkout_started: {
    offer_type: AnalyticsBillingOfferType;
    source: "account_panel" | "store";
  };
  billing_portal_opened: {
    source: "account_panel" | "store";
  };
  feedback_shortcut_clicked: {
    source: "workspace_account_actions";
  };
  highlights_clear_failed: {
    source: "highlights_panel";
  };
  highlights_data_cleared: {
    source: "highlights_panel";
  };
  highlights_filter_changed: {
    only_outcome_change: boolean;
    perspective: AnalyticsHighlightsPerspective;
    source: "highlights_panel";
  };
  highlights_load_more_requested: {
    only_outcome_change: boolean;
    perspective: AnalyticsHighlightsPerspective;
    source: "highlights_panel";
  };
  highlights_scan_completed: {
    failed_matches: number;
    matches_discovered: number;
    matches_with_moments: number;
    moments_written: number;
    source: "highlights_panel";
    status: string;
  };
  highlights_scan_request_failed: {
    source: "highlights_panel";
  };
  highlights_scan_requested: {
    action_label: string;
    has_recorded_history: boolean;
    source: "highlights_panel";
  };
  operations_refresh_requested: {
    source: "operations_panel";
  };
  product_feedback_submission_failed: {
    kind: AnalyticsFeedbackSubmissionKind;
    source: "account_panel";
  };
  product_feedback_submitted: {
    kind: AnalyticsFeedbackSubmissionKind;
    notified: boolean;
    source: "account_panel";
  };
  prediction_completed: {
    has_forecast_context: boolean;
    has_issue: boolean;
    has_result: boolean;
    status: string | null | undefined;
  };
  prediction_request_failed: {
    has_forecast_prefill: boolean;
    has_scout_summary: boolean;
  };
  prediction_requested: {
    effort_delta: number;
    has_away_source_match: boolean;
    has_forecast_prefill: boolean;
    has_home_source_match: boolean;
    has_scout_summary: boolean;
    neutral_site: boolean;
  };
  game_prediction_defense_filter_changed: {
    axis: "team_a" | "team_b";
    defense: string;
    selected_count: number;
    state: "enabled" | "disabled";
    total_count: number;
  };
  game_prediction_matrix_completed: {
    has_estimated_team_a_pair: boolean;
    has_estimated_team_b_pair: boolean;
    team_a_pair_count: number;
    team_b_pair_count: number;
    venue: string;
    view_count: number;
  };
  game_prediction_matrix_request_failed: {
    has_team_a_source_match: boolean;
    has_team_b_source_match: boolean;
    venue: string;
  };
  game_prediction_matrix_requested: {
    has_team_a_source_match: boolean;
    has_team_b_source_match: boolean;
    venue: string;
  };
  game_prediction_offense_filter_changed: {
    axis: "team_a" | "team_b";
    offense: string;
    selected_count: number;
    state: "expanded" | "collapsed";
    total_count: number;
  };
  game_prediction_overview_cell_selected: {
    is_recommended: boolean;
    margin: number | null;
    source: "mobile_overview_picker" | "overview_heatmap";
    team_a_offense: string;
    team_b_offense: string;
  };
  game_prediction_pair_selected: {
    is_recommended: boolean;
    margin: number | null;
    source: "advanced_matrix" | "defense_drilldown";
    team_a_defense: string;
    team_a_offense: string;
    team_b_defense: string;
    team_b_offense: string;
  };
  game_prediction_surface_toggled: {
    source: "game_prediction_panel";
    state: "closed" | "opened";
    surface:
      | "advanced_filters"
      | "advanced_matrix"
      | "defense_drilldown"
      | "explore_extremes";
  };
  game_prediction_view_changed: {
    next_view_id: string;
    next_view_label: string;
  };
  prediction_source_load_failed: {
    reason:
      | "missing_match"
      | "missing_team_metadata"
      | "request_failed"
      | "team_mismatch";
    side: "away" | "home";
  };
  prediction_source_loaded: {
    side: "away" | "home";
    team_location: "AWAY" | "HOME";
  };
  premium_access_unlocked: {
    access_source: string;
    plan_id: string;
    source: "account_panel" | "store";
  };
  recap_forum_post_copied: {
    mode: string;
    status: string | null;
  };
  recap_request_failed: {
    mode: string;
  };
  recap_requested: {
    has_custom_league_id: boolean;
    has_match_id: boolean;
    has_season_override: boolean;
    mode: string;
  };
  store_browse_requested: {
    source: "login_page";
  };
  theme_change_failed: {
    next_theme: ThemeId;
    previous_theme: ThemeId;
    source: AnalyticsThemeSource;
  };
  theme_changed: {
    next_theme: ThemeId;
    previous_theme: ThemeId;
    source: AnalyticsThemeSource;
  };
  workspace_nav_clicked: {
    destination_section: WorkspaceSection;
    from_section: WorkspaceSection;
    navigation_surface: AnalyticsNavigationSurface;
  };
  workspace_nav_menu_toggled: {
    navigation_surface: "mobile_drawer";
    state: "closed" | "opened";
  };
  workspace_refresh_requested: {
    active_section: WorkspaceSection;
  };
  workspace_section_viewed: {
    environment_name: string;
    page_name: string;
    workspace_section: string;
  };
};

export type AnalyticsEventName = keyof AnalyticsEventMap;
export type AnalyticsEventProperties<TName extends AnalyticsEventName> =
  AnalyticsEventMap[TName];

export type AnalyticsPersonProperties = {
  active_workspace_section?: WorkspaceSection | null;
  analytics_environment?: string;
  app_theme?: ThemeId | null;
  bb_connection_status?: string | null;
  billing_access_source?: string | null;
  billing_plan_id?: string | null;
  commercial_mode_enabled?: boolean;
  has_bb_connection?: boolean;
  has_billing_customer?: boolean;
  has_lifetime_access?: boolean;
  has_premium_access?: boolean;
  has_workspace?: boolean;
};

export type AnalyticsRegisteredProperties = AnalyticsPersonProperties & {
  analytics_token_source?: string | null;
  analytics_vendor?: "posthog";
  is_authenticated?: boolean;
};
