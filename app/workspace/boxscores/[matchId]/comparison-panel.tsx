"use client";

import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";
import {
  TableCell,
  TableHeadCell,
  TableShell,
} from "@/app/ui/primitives/table-shell";

export type ComparisonPanelRow = {
  key: string;
  label: string;
  leftValue: string;
  rightValue: string;
};

export function ComparisonPanel({
  emptyMessage = "No saved metrics are available for this match.",
  leftLabel,
  numericCellClassName,
  rightLabel,
  rows,
  title,
}: {
  emptyMessage?: string;
  leftLabel: string;
  numericCellClassName?: string;
  rightLabel: string;
  rows: readonly ComparisonPanelRow[];
  title: string;
}) {
  return (
    <Panel as="article" padding="sm" variant="solid">
      <SectionHeading title={title} titleAs="h4" />
      <TableShell compact tableClassName="min-w-[24rem]">
        <thead>
          <tr>
            <TableHeadCell>Metric</TableHeadCell>
            <TableHeadCell className={numericCellClassName}>
              {leftLabel}
            </TableHeadCell>
            <TableHeadCell className={numericCellClassName}>
              {rightLabel}
            </TableHeadCell>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row) => (
              <tr key={row.key}>
                <TableCell>{row.label}</TableCell>
                <TableCell className={numericCellClassName}>
                  {row.leftValue}
                </TableCell>
                <TableCell className={numericCellClassName}>
                  {row.rightValue}
                </TableCell>
              </tr>
            ))
          ) : (
            <tr>
              <TableCell className="text-ink-muted" colSpan={3}>
                {emptyMessage}
              </TableCell>
            </tr>
          )}
        </tbody>
      </TableShell>
    </Panel>
  );
}
