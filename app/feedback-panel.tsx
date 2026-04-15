"use client";

import { useMutation } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";

import { submitProductFeedbackMutation } from "@/app/dashboard/workspace-query-client";
import type {
  FeedbackSubmissionKind,
  SubmitProductFeedbackInput,
} from "@/app/types";
import { Alert } from "@/app/ui/primitives/alert";
import { Button } from "@/app/ui/primitives/button";
import { Field, Input, Select, Textarea } from "@/app/ui/primitives/field";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";
import { captureAnalyticsEvent } from "@/lib/analytics/client";

const MAX_MESSAGE_LENGTH = 2000;
const MAX_SUBJECT_LENGTH = 120;
const identityMetaClassName =
  "rounded-card border border-black/8 bg-white/65 px-4 py-3 text-sm leading-6 text-ink-muted";
const kindOptions: Array<{
  description: string;
  label: string;
  value: FeedbackSubmissionKind;
}> = [
  {
    description:
      "Share friction, bugs, rough edges, or general product thoughts.",
    label: "Feedback",
    value: "FEEDBACK",
  },
  {
    description: "Ask for a new workflow, report, view, or improvement.",
    label: "Feature request",
    value: "FEATURE_REQUEST",
  },
];

type FeedbackPanelProps = {
  currentTeamName?: string | null;
  viewerLabel?: string | null;
};

type FeedbackFormState = SubmitProductFeedbackInput;
type FeedbackFormErrors = Partial<Record<"message" | "subject", string>>;
type FeedbackStatus = {
  message: string;
  tone: "danger" | "note";
} | null;

const defaultFormState: FeedbackFormState = {
  kind: "FEEDBACK",
  message: "",
  subject: "",
};

export function FeedbackPanel({
  currentTeamName,
  viewerLabel,
}: FeedbackPanelProps) {
  const kindId = useId();
  const subjectId = useId();
  const messageId = useId();
  const [form, setForm] = useState<FeedbackFormState>(defaultFormState);
  const [errors, setErrors] = useState<FeedbackFormErrors>({});
  const [status, setStatus] = useState<FeedbackStatus>(null);
  const submitMutation = useMutation({
    mutationFn: submitProductFeedbackMutation,
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const validation = validateForm(form);
    setErrors(validation.errors);
    if (!validation.value) {
      return;
    }

    setStatus(null);

    try {
      const result = await submitMutation.mutateAsync(validation.value);
      captureAnalyticsEvent("product_feedback_submitted", {
        kind: validation.value.kind,
        notified: result.notified,
        source: "account_panel",
      });
      setForm(defaultFormState);
      setErrors({});
      setStatus({
        message: result.notified
          ? "Thanks. Your note was saved and our team was notified."
          : "Your note was saved, but the notification email did not go out. There is no need to resubmit it.",
        tone: "note",
      });
    } catch (error) {
      captureAnalyticsEvent("product_feedback_submission_failed", {
        kind: validation.value.kind,
        source: "account_panel",
      });
      setStatus({
        message:
          error instanceof Error
            ? error.message
            : "Unable to send your feedback right now.",
        tone: "danger",
      });
    }
  }

  return (
    <Panel
      className="scroll-mt-6"
      data-analytics-sensitive="true"
      id="feedback"
    >
      <SectionHeading
        description="Tell us what feels off or what would make the workspace more useful. We attach your signed-in identity and current club context automatically."
        eyebrow="Account"
        title="Feedback and feature requests"
      />

      <div className="grid gap-3 md:grid-cols-2">
        <div className={identityMetaClassName}>
          <strong className="text-ink block">Signed-in identity</strong>
          <span>{viewerLabel ?? "Attached from your account session."}</span>
        </div>
        <div className={identityMetaClassName}>
          <strong className="text-ink block">Current club context</strong>
          <span>
            {currentTeamName
              ? `${currentTeamName} will be attached to the submission.`
              : "If a current club is available, we will attach it for context."}
          </span>
        </div>
      </div>

      {status ? <Alert tone={status.tone}>{status.message}</Alert> : null}

      <form
        className="grid gap-4"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="grid gap-4 md:grid-cols-[15rem_minmax(0,1fr)]">
          <Field
            hint={
              kindOptions.find((option) => option.value === form.kind)
                ?.description
            }
            htmlFor={kindId}
            label="Type"
          >
            <Select
              data-analytics-mask="true"
              id={kindId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  kind: event.target.value as FeedbackSubmissionKind,
                }))
              }
              value={form.kind}
            >
              {kindOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            error={errors.subject}
            hint={`${form.subject.trim().length}/${MAX_SUBJECT_LENGTH} characters`}
            htmlFor={subjectId}
            label="Subject"
          >
            <Input
              data-analytics-mask="true"
              id={subjectId}
              maxLength={MAX_SUBJECT_LENGTH}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  subject: event.target.value,
                }))
              }
              placeholder="What should we know at a glance?"
              value={form.subject}
            />
          </Field>
        </div>

        <Field
          error={errors.message}
          hint={`${form.message.trim().length}/${MAX_MESSAGE_LENGTH} characters`}
          htmlFor={messageId}
          label="Details"
        >
          <Textarea
            data-analytics-mask="true"
            id={messageId}
            maxLength={MAX_MESSAGE_LENGTH}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                message: event.target.value,
              }))
            }
            placeholder="What happened, what you expected, or what feature would help?"
            value={form.message}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <Button loading={submitMutation.isPending} type="submit">
            Send request
          </Button>
          <span className="text-ink-muted text-sm leading-6">
            One submission at a time. We trim the message before saving it.
          </span>
        </div>
      </form>
    </Panel>
  );
}

function validateForm(input: FeedbackFormState): {
  errors: FeedbackFormErrors;
  value: SubmitProductFeedbackInput | null;
} {
  const subject = input.subject.trim();
  const message = input.message.trim();
  const errors: FeedbackFormErrors = {};

  if (!subject) {
    errors.subject = "Add a short subject.";
  } else if (subject.length > MAX_SUBJECT_LENGTH) {
    errors.subject = `Subject must be ${MAX_SUBJECT_LENGTH} characters or fewer.`;
  }

  if (!message) {
    errors.message = "Add a few details so we know what to look at.";
  } else if (message.length > MAX_MESSAGE_LENGTH) {
    errors.message = `Details must be ${MAX_MESSAGE_LENGTH} characters or fewer.`;
  }

  if (Object.keys(errors).length) {
    return {
      errors,
      value: null,
    };
  }

  return {
    errors: {},
    value: {
      kind: input.kind,
      message,
      subject,
    },
  };
}
