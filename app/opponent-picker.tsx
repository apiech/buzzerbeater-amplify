"use client";

import type { OpponentSummary } from "@/app/types";
import { Alert } from "@/app/ui/primitives/alert";
import { Button } from "@/app/ui/primitives/button";
import { Field, Input, Select } from "@/app/ui/primitives/field";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";

type OpponentPickerProps = {
  activeTeamName: string | null;
  availableOpponents: OpponentSummary[];
  isLoading?: boolean;
  manualTeamId: string;
  onApply: () => void;
  onManualTeamIdChange: (value: string) => void;
  onScheduledTeamIdChange: (value: string) => void;
  scheduledTeamId: string;
  error?: string | null;
};

export function OpponentPicker({
  activeTeamName,
  availableOpponents,
  error,
  isLoading = false,
  manualTeamId,
  onApply,
  onManualTeamIdChange,
  onScheduledTeamIdChange,
  scheduledTeamId,
}: OpponentPickerProps) {
  return (
    <Panel as="article" padding="sm" variant="solid">
      <SectionHeading
        actions={
          <Button
            loading={isLoading}
            onClick={onApply}
            size="sm"
            variant="secondary"
          >
            Load opponent
          </Button>
        }
        description={
          activeTeamName
            ? `Currently viewing ${activeTeamName}.`
            : "Pick the next opponent from your schedule or load any club by team ID."
        }
        title="Opponent picker"
        titleAs="h4"
      />

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
        <Field
          hint="Schedule opponents populate here automatically. A manual team ID overrides this when applied."
          label="Scheduled opponents"
        >
          <Select
            onChange={(event) => onScheduledTeamIdChange(event.currentTarget.value)}
            value={scheduledTeamId}
          >
            <option value="">Select an opponent</option>
            {availableOpponents.map((opponent) => (
              <option
                key={opponent.teamId ?? opponent.teamName ?? "unknown"}
                value={opponent.teamId ?? ""}
              >
                {opponent.teamName ?? "Unknown team"}
                {typeof opponent.wins === "number" && typeof opponent.losses === "number"
                  ? ` • ${opponent.wins}-${opponent.losses}`
                  : ""}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          hint="Enter any BuzzerBeater team ID and then load it."
          label="Manual team ID"
        >
          <Input
            inputMode="numeric"
            onChange={(event) => onManualTeamIdChange(event.currentTarget.value)}
            placeholder="Example: 12345"
            value={manualTeamId}
          />
        </Field>
      </div>

      {error ? <Alert>{error}</Alert> : null}
    </Panel>
  );
}
