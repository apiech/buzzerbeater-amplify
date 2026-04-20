"use client";

import Link from "next/link";

import { useAuthenticatedWorkspace } from "@/app/dashboard/use-authenticated-workspace";
import { SimplePredictionWorkspace } from "@/app/workspace/simple/simple-prediction-workspace";
import { commercialModeEnabled } from "@/config/commercial-mode";
import { Alert } from "@/app/ui/primitives/alert";
import { canUseSimplePredictionFeature } from "@/app/workspace/simple/simple-prediction-helpers";

export function SimplePredictionPageClient() {
  const {
    billingError,
    billingSummary,
    connected,
    connectionError,
    isLoadingBilling,
    isLoadingConnection,
    isLoadingWorkspace,
    workspace,
    workspaceError,
  } = useAuthenticatedWorkspace({
    activeSection: "predictions",
    commercialModeEnabled,
  });

  const loading =
    isLoadingConnection ||
    (connected && !workspace && isLoadingWorkspace) ||
    (commercialModeEnabled && !billingSummary && isLoadingBilling);

  if (loading) {
    return (
      <div className="rounded-lg border border-black/10 bg-white px-4 py-5 text-sm text-ink-muted">
        Loading prediction workspace.
      </div>
    );
  }

  if (connectionError || workspaceError) {
    return <Alert>{connectionError ?? workspaceError}</Alert>;
  }

  if (!connected) {
    return (
      <div className="rounded-lg border border-black/10 bg-white px-4 py-5 text-sm text-ink">
        Connect your club in{" "}
        <Link className="font-semibold underline" href="/workspace/ops">
          Account
        </Link>{" "}
        to use the simple prediction view.
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="rounded-lg border border-black/10 bg-white px-4 py-5 text-sm text-ink-muted">
        No workspace data is available yet.
      </div>
    );
  }

  if (
    !canUseSimplePredictionFeature({
      billingError,
      billingSummary,
    })
  ) {
    return (
      <div className="grid gap-3 rounded-lg border border-black/10 bg-white p-4">
        <div className="text-sm font-semibold text-ink">
          Prediction requires premium access.
        </div>
        <div className="text-sm text-ink-muted">
          Upgrade in the store to unlock the prediction engine.
        </div>
        <div>
          <Link
            className="inline-flex rounded-md border border-black/10 px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-black/5"
            href="/store"
          >
            Open store
          </Link>
        </div>
      </div>
    );
  }

  return (
    <SimplePredictionWorkspace
      currentTeamId={workspace.home.team.teamId ?? null}
      currentTeamName={workspace.home.team.teamName ?? null}
      recentMatches={workspace.home.recentMatches}
    />
  );
}
