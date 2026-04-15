"use client";

import { useMemo } from "react";
import { useQueryStates } from "nuqs";

import {
  buildMissingFieldMessage,
  calculateStaffBidResult,
  MAX_STAFF_HORIZON_WEEKS,
  MINIMUM_STAFF_BID,
  parseStaffBidFormState,
  PAYBACK_LOOKAHEAD_WEEKS,
  readStaffBidFormState,
  staffBudgetModeOptions,
  staffMarketUrlStateParsers,
  staffRoleOptions,
  type StaffBidDecision,
  type StaffBidFormErrors,
  type StaffBidFormField,
  type StaffBidResult,
} from "@/app/staff-market";
import { Alert } from "@/app/ui/primitives/alert";
import { Field, Input, Select } from "@/app/ui/primitives/field";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";
import { StatCard } from "@/app/ui/primitives/stat-card";
import {
  TableCell,
  TableHeadCell,
  TableShell,
} from "@/app/ui/primitives/table-shell";
import { WorkInProgressNotice } from "@/app/ui/primitives/work-in-progress-notice";

const numericTableCellClassName = "text-right tabular-nums";

export function StaffMarketPanel() {
  const [urlState, setUrlState] = useQueryStates(staffMarketUrlStateParsers);
  const formState = useMemo(() => readStaffBidFormState(urlState), [urlState]);
  const parsed = useMemo(() => parseStaffBidFormState(formState), [formState]);
  const result = useMemo(
    () => (parsed.scenario ? calculateStaffBidResult(parsed.scenario) : null),
    [parsed.scenario],
  );
  const missingFieldMessage = buildMissingFieldMessage(parsed.missingFields);

  function setField(
    field: keyof typeof urlState,
    value: string | null,
  ): Promise<URLSearchParams> {
    return setUrlState({
      [field]: value,
    });
  }

  return (
    <Panel>
      <SectionHeading
        description="Pure staff-side auction math only. This tool intentionally ignores player salaries, player payroll, and transfer-list APIs."
        eyebrow="Staff Market"
        title="Bid optimizer for staff auctions"
      />
      <WorkInProgressNotice subject="This staff market page" />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="grid gap-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel as="article" padding="sm" variant="solid">
              <SectionHeading
                description="The outgoing staffer whose severance and future salary you would avoid by upgrading."
                title="Current staffer"
                titleAs="h4"
              />
              <div className="grid gap-4">
                <Field
                  hint="Role is descriptive only in v1."
                  label="Role"
                >
                  <Select
                    onChange={(event) =>
                      void setField("staffCurRole", event.currentTarget.value)
                    }
                    value={formState.currentRole}
                  >
                    {staffRoleOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field
                  error={readDisplayError(parsed.errors, "currentLevel")}
                  hint="Level 1-7"
                  label="Level"
                >
                  <Input
                    inputMode="numeric"
                    max={7}
                    min={1}
                    onChange={(event) =>
                      void setField(
                        "staffCurLevel",
                        normalizeFormInputValue(event.currentTarget.value),
                      )
                    }
                    step={1}
                    type="number"
                    value={formState.currentLevel}
                  />
                </Field>

                <Field
                  error={readDisplayError(
                    parsed.errors,
                    "currentWeeklySalary",
                  )}
                  hint="Displayed weekly salary"
                  label="Weekly salary"
                >
                  <Input
                    inputMode="numeric"
                    min={1}
                    onChange={(event) =>
                      void setField(
                        "staffCurSalary",
                        normalizeFormInputValue(event.currentTarget.value),
                      )
                    }
                    placeholder="5000"
                    step={1}
                    type="number"
                    value={formState.currentWeeklySalary}
                  />
                </Field>
              </div>
            </Panel>

            <Panel as="article" padding="sm" variant="solid">
              <SectionHeading
                description="The auction target you are considering. Level affects salary growth, but role is still descriptive only."
                title="Candidate staffer"
                titleAs="h4"
              />
              <div className="grid gap-4">
                <Field
                  hint="Use the same slot you plan to replace."
                  label="Role"
                >
                  <Select
                    onChange={(event) =>
                      void setField("staffCandRole", event.currentTarget.value)
                    }
                    value={formState.candidateRole}
                  >
                    {staffRoleOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field
                  error={readDisplayError(parsed.errors, "candidateLevel")}
                  hint="Level 1-7"
                  label="Level"
                >
                  <Input
                    inputMode="numeric"
                    max={7}
                    min={1}
                    onChange={(event) =>
                      void setField(
                        "staffCandLevel",
                        normalizeFormInputValue(event.currentTarget.value),
                      )
                    }
                    step={1}
                    type="number"
                    value={formState.candidateLevel}
                  />
                </Field>

                <Field
                  error={readDisplayError(
                    parsed.errors,
                    "candidateWeeklySalary",
                  )}
                  hint="Displayed weekly salary"
                  label="Weekly salary"
                >
                  <Input
                    inputMode="numeric"
                    min={1}
                    onChange={(event) =>
                      void setField(
                        "staffCandSalary",
                        normalizeFormInputValue(event.currentTarget.value),
                      )
                    }
                    placeholder="7000"
                    step={1}
                    type="number"
                    value={formState.candidateWeeklySalary}
                  />
                </Field>
              </div>
            </Panel>
          </div>

          <Panel as="article" padding="sm" variant="solid">
            <SectionHeading
              description="Budget cap determines the highest rational bid. The tool still projects salaries and severance separately."
              title="Bid scenario"
              titleAs="h4"
            />
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field
                error={readDisplayError(parsed.errors, "horizonWeeks")}
                hint={`1-${MAX_STAFF_HORIZON_WEEKS} weeks`}
                label="Planning horizon"
              >
                <Input
                  inputMode="numeric"
                  max={MAX_STAFF_HORIZON_WEEKS}
                  min={1}
                  onChange={(event) =>
                    void setField(
                      "staffWeeks",
                      normalizeFormInputValue(event.currentTarget.value),
                    )
                  }
                  step={1}
                  type="number"
                  value={formState.horizonWeeks}
                />
              </Field>

              <Field
                hint="Choose how strict your spending ceiling should be."
                label="Budget mode"
              >
                <Select
                  onChange={(event) =>
                    void setField("staffBudgetMode", event.currentTarget.value)
                  }
                  value={formState.budgetMode}
                >
                  {staffBudgetModeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                error={readDisplayError(parsed.errors, "budgetCap")}
                hint="Required for max bid guidance"
                label="Budget cap"
              >
                <Input
                  inputMode="numeric"
                  min={1}
                  onChange={(event) =>
                    void setField(
                      "staffBudgetCap",
                      normalizeFormInputValue(event.currentTarget.value),
                    )
                  }
                  placeholder="100000"
                  step={1}
                  type="number"
                  value={formState.budgetCap}
                />
              </Field>

              <Field
                error={readDisplayError(parsed.errors, "proposedBid")}
                hint={`Minimum valid bid: ${formatCurrency(MINIMUM_STAFF_BID)}`}
                label="Proposed bid"
              >
                <Input
                  inputMode="numeric"
                  min={0}
                  onChange={(event) =>
                    void setField(
                      "staffBid",
                      normalizeFormInputValue(event.currentTarget.value),
                    )
                  }
                  step={1}
                  type="number"
                  value={formState.proposedBid}
                />
              </Field>
            </div>
          </Panel>

          {missingFieldMessage ? <Alert>{missingFieldMessage}</Alert> : null}
          <Alert>
            Severance is modeled as one current weekly salary paid exactly once
            when you replace the outgoing staffer.
          </Alert>
        </div>

        <div className="grid gap-4">
          {result ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <StatCard
                  detail={
                    result.maxRationalBid < MINIMUM_STAFF_BID
                      ? `Below the ${formatCurrency(MINIMUM_STAFF_BID)} auction minimum.`
                      : `Budget mode: ${formatBudgetModeLabel(formState.budgetMode)}`
                  }
                  label="Max rational bid"
                  value={formatCurrency(Math.max(result.maxRationalBid, 0))}
                />
                <StatCard
                  detail={formatDecisionDetail(result)}
                  label="Decision"
                  value={formatDecisionLabel(result.decision)}
                />
                <StatCard
                  detail="Bid plus severance due immediately."
                  label="Today cash outlay"
                  value={formatCurrency(result.todayCashOutlay)}
                />
                <StatCard
                  detail={`Keep cost ${formatCurrency(result.keepCost)} over ${formState.horizonWeeks} weeks.`}
                  label="Total replacement cost"
                  value={formatCurrency(result.replaceCost)}
                />
                <StatCard
                  detail={
                    result.netUpgradeCost <= 0
                      ? "Replacement is cheaper than keeping the current staffer over this horizon."
                      : "Extra spend required versus keeping the current staffer."
                  }
                  label="Net upgrade cost"
                  value={formatSignedCurrencyValue(result.netUpgradeCost)}
                />
                <StatCard
                  detail={`Searches up to ${PAYBACK_LOOKAHEAD_WEEKS} projected weeks.`}
                  label="Payback week"
                  value={
                    result.paybackWeek === null
                      ? "Never"
                      : `Week ${result.paybackWeek}`
                  }
                />
                <StatCard
                  detail="Only shown when the candidate gains levels."
                  label="Cost per level gained"
                  value={
                    result.costPerLevel === null
                      ? "N/A"
                      : formatCurrency(result.costPerLevel)
                  }
                />
                <StatCard
                  detail={`Current ${formatGrowthFactor(result.growthFactors.current)} • Candidate ${formatGrowthFactor(result.growthFactors.candidate)}`}
                  label="Weekly growth factors"
                  value={`${formState.currentLevel} -> ${formState.candidateLevel}`}
                />
              </div>
            </>
          ) : (
            <Panel as="article" padding="sm" variant="solid">
              <SectionHeading title="Results" titleAs="h4" />
              <p className="text-sm leading-7 text-ink-muted">
                Enter both weekly salaries and a budget cap to calculate your
                max rational bid, replacement cost, and payback timing.
              </p>
            </Panel>
          )}
        </div>
      </div>

      {result ? (
        <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Panel as="article" padding="sm" variant="solid">
            <SectionHeading
              description="The chart uses the selected planning horizon only."
              title="Weekly salary projection"
              titleAs="h4"
            />
            <StaffSalaryProjectionChart result={result} />
          </Panel>

          <Panel as="article" padding="sm" variant="solid">
            <SectionHeading
              description="Week 1 is the current displayed salary, then the formula compounds from there."
              title="Week-by-week breakdown"
              titleAs="h4"
            />
            <TableShell compact tableClassName="min-w-[32rem]">
              <thead>
                <tr>
                  <TableHeadCell>Week</TableHeadCell>
                  <TableHeadCell className={numericTableCellClassName}>
                    Current salary
                  </TableHeadCell>
                  <TableHeadCell className={numericTableCellClassName}>
                    Candidate salary
                  </TableHeadCell>
                  <TableHeadCell className={numericTableCellClassName}>
                    Keep cumulative
                  </TableHeadCell>
                  <TableHeadCell className={numericTableCellClassName}>
                    Replace cumulative
                  </TableHeadCell>
                </tr>
              </thead>
              <tbody>
                {result.currentSeries.map((point, index) => {
                  const candidatePoint = result.candidateSeries[index];
                  const replaceCumulative =
                    result.todayCashOutlay +
                    (candidatePoint?.cumulativeCost ?? 0);

                  return (
                    <tr key={`staff-week-${point.week}`}>
                      <TableCell>{point.week}</TableCell>
                      <TableCell className={numericTableCellClassName}>
                        {formatCurrency(point.salary)}
                      </TableCell>
                      <TableCell className={numericTableCellClassName}>
                        {formatCurrency(candidatePoint?.salary)}
                      </TableCell>
                      <TableCell className={numericTableCellClassName}>
                        {formatCurrency(point.cumulativeCost)}
                      </TableCell>
                      <TableCell className={numericTableCellClassName}>
                        {formatCurrency(replaceCumulative)}
                      </TableCell>
                    </tr>
                  );
                })}
              </tbody>
            </TableShell>
          </Panel>
        </div>
      ) : null}
    </Panel>
  );
}

function StaffSalaryProjectionChart({ result }: { result: StaffBidResult }) {
  const width = 720;
  const height = 240;
  const padding = 24;
  const currentSeries = buildChartSeries(result.currentSeries, width, height, padding);
  const candidateSeries = buildChartSeries(
    result.candidateSeries,
    width,
    height,
    padding,
  );

  return (
    <div className="grid gap-4">
      <svg
        aria-label="Staff salary projection chart"
        className="h-auto w-full"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <rect
          className="fill-white/90 stroke-black/8"
          height={height}
          rx="20"
          width={width}
          x="0"
          y="0"
        />
        <line
          className="stroke-black/15"
          strokeWidth="2"
          x1={padding}
          x2={width - padding}
          y1={height - padding}
          y2={height - padding}
        />
        {currentSeries ? (
          <polyline
            fill="none"
            points={currentSeries}
            stroke="var(--color-accent)"
            strokeWidth="4"
          />
        ) : null}
        {candidateSeries ? (
          <polyline
            fill="none"
            points={candidateSeries}
            stroke="var(--color-note)"
            strokeDasharray="10 6"
            strokeWidth="4"
          />
        ) : null}
      </svg>

      <div className="flex flex-wrap gap-2">
        <span className="inline-flex rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-accent shadow-sm">
          Current staffer
        </span>
        <span className="inline-flex rounded-full bg-note-bg px-3 py-1.5 text-sm font-semibold text-note">
          Candidate staffer
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard
          detail="Outgoing staffer kept in place."
          label={`Week ${result.currentSeries.at(-1)?.week ?? 0} salary`}
          value={formatCurrency(result.currentSeries.at(-1)?.salary)}
        />
        <StatCard
          detail="Auction target after compounding."
          label={`Week ${result.candidateSeries.at(-1)?.week ?? 0} salary`}
          value={formatCurrency(result.candidateSeries.at(-1)?.salary)}
        />
      </div>
    </div>
  );
}

function buildChartSeries(
  series: StaffBidResult["currentSeries"],
  width: number,
  height: number,
  padding: number,
): string | null {
  const values = series.map((point) => point.salary);
  if (values.length < 2) {
    return null;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const yRange = max - min || 1;
  const xStep = (width - padding * 2) / Math.max(series.length - 1, 1);

  return series
    .map((point, index) => {
      const x = padding + index * xStep;
      const y =
        height - padding - ((point.salary - min) / yRange) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");
}

function formatBudgetModeLabel(value: string): string {
  return value === "UPGRADE_PREMIUM"
    ? "Upgrade premium cap"
    : "All-in cost cap";
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "N/A";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function formatSignedCurrencyValue(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "N/A";
  }

  if (value === 0) {
    return formatCurrency(0);
  }

  return value > 0
    ? `+${formatCurrency(value)}`
    : `-${formatCurrency(Math.abs(value))}`;
}

function formatGrowthFactor(value: number): string {
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function formatDecisionLabel(value: StaffBidDecision): string {
  switch (value) {
    case "BID":
      return "Bid";
    case "PASS":
      return "Pass";
    case "INVALID":
      return "Invalid";
  }
}

function formatDecisionDetail(result: StaffBidResult): string {
  if (result.decision === "INVALID") {
    return `The entered bid is below the ${formatCurrency(MINIMUM_STAFF_BID)} minimum.`;
  }

  if (result.decision === "BID") {
    return `The proposed bid stays within your ceiling of ${formatCurrency(
      Math.max(result.maxRationalBid, 0),
    )}.`;
  }

  if (result.maxRationalBid < MINIMUM_STAFF_BID) {
    return "No valid auction bid fits the selected budget cap.";
  }

  return `The proposed bid is ${formatCurrency(
    Math.max(result.proposedBid - result.maxRationalBid, 0),
  )} too rich for this ceiling.`;
}

function normalizeFormInputValue(value: string): string | null {
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

function readDisplayError(
  errors: StaffBidFormErrors,
  field: StaffBidFormField,
): string | null {
  return errors[field] ?? null;
}

export const __testing = {
  buildChartSeries,
  formatBudgetModeLabel,
  formatDecisionLabel,
  normalizeFormInputValue,
};
