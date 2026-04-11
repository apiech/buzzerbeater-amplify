"use client";

import { ErrorBoundary } from "react-error-boundary";

import { Button } from "@/app/ui/primitives/button";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";

const statusCopyClassName = "text-sm leading-7 text-ink-muted";

export function PanelErrorBoundary({
  children,
  resetKeys,
  title,
}: {
  children: React.ReactNode;
  resetKeys?: unknown[];
  title: string;
}) {
  return (
    <ErrorBoundary
      fallbackRender={({ error, resetErrorBoundary }) => (
        <Panel variant="danger">
          <SectionHeading title={title} titleAs="h4" />
          <p className={statusCopyClassName}>
            {error instanceof Error
              ? error.message
              : "This panel failed to render."}
          </p>
          <Button onClick={resetErrorBoundary} size="sm" variant="secondary">
            Try again
          </Button>
        </Panel>
      )}
      resetKeys={resetKeys}
    >
      {children}
    </ErrorBoundary>
  );
}
