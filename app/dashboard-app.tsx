"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import {
  confirmResetPassword,
  confirmSignUp,
  getCurrentUser,
  resetPassword,
  resendSignUpCode,
  signIn,
  signOut,
  signUp,
} from "aws-amplify/auth";

import { client } from "@/app/amplify-client";
import {
  createAuthUiState,
  resolveConfirmResetPasswordSuccess,
  resolveConfirmSignUpStep,
  resolveResetPasswordStep,
  resolveSignInStep,
  resolveSignUpStep,
  type AuthNotice,
  type AuthUiState,
} from "@/app/auth-flow";
import { BillingPanel, PremiumFeatureGatePanel } from "@/app/billing-panel";
import { fetchBillingSummary } from "@/app/billing-client";
import { decodeGraphqlJsonPayload } from "@/app/graphql-json";
import { HighlightsPanel } from "@/app/highlights-panel";
import { LineupHelper } from "@/app/lineup-helper";
import { OperationsPanel } from "@/app/operations-panel";
import { PredictionPanel } from "@/app/prediction-panel";
import { RecapPanel } from "@/app/recap-panel";
import { LineupPlanner } from "@/app/team-tools";
import type {
  BillingSummary,
  BbConnectionRecord,
  ConnectBbAccountInput,
  ConnectBbAccountResult,
  DashboardWorkspace,
  HomeWorkspacePayload,
  JsonLookupResponse,
  LeagueIntelPayload,
  MatchBoxscorePayload,
  PlayerLabPayload,
  PlayerSummary,
  PlayerTrendPayload,
  SalaryProjection,
  ScoutWorkspacePayload,
  TeamHubPayload,
  WorkspaceResponse,
} from "@/app/types";
import { Alert } from "@/app/ui/primitives/alert";
import { Button } from "@/app/ui/primitives/button";
import { Field, Input, Select } from "@/app/ui/primitives/field";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";
import { StatCard } from "@/app/ui/primitives/stat-card";
import {
  StatusBadge,
  statusToneFromValue,
} from "@/app/ui/primitives/status-badge";
import {
  TableCell,
  TableHeadCell,
  TableShell,
} from "@/app/ui/primitives/table-shell";
import { PlayerTrendChart } from "@/app/ui/workspace/player-trend-chart";
import { ThemeSelect } from "@/app/ui/theme/theme-select";
import { WorkspaceRouteNav } from "@/app/ui/workspace/workspace-route-nav";
import { hasFeature } from "@/lib/billing/plans";
import { type WorkspaceSection } from "@/app/workspace-sections";

type AuthenticatedUser = Awaited<ReturnType<typeof getCurrentUser>>;

type ConnectionFormState = ConnectBbAccountInput;
type SignInFormState = {
  email: string;
  password: string;
};
type SignUpFormState = {
  confirmPassword: string;
  email: string;
  password: string;
};
type ConfirmSignUpFormState = {
  confirmationCode: string;
};
type RequestResetFormState = {
  email: string;
};
type ConfirmResetFormState = {
  confirmationCode: string;
  confirmPassword: string;
  newPassword: string;
};

const twoColumnGridClassName = "grid gap-4 xl:grid-cols-2";
const summaryGridClassName = "grid gap-4 sm:grid-cols-2 xl:grid-cols-4";
const statusCopyClassName = "text-sm leading-7 text-ink-muted";
const listClassName = "grid list-none gap-3 p-0";
const listItemClassName =
  "grid gap-1 border-b border-black/8 pb-3 last:border-b-0 last:pb-0";
const listRowClassName =
  "flex flex-wrap items-start justify-between gap-3 border-b border-black/8 pb-3 last:border-b-0 last:pb-0";
const listCopyClassName = "grid gap-1";
const mutedMetaClassName = "text-xs font-semibold text-ink-muted";
const ratingGridClassName =
  "grid min-w-[30rem] grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,0.9fr))] gap-x-3 gap-y-2";

export default function DashboardHomePage() {
  return <DashboardApp activeSection="home" viewerEmail={null} />;
}

export function LegacyLocalAuthShell({
  activeSection,
}: {
  activeSection: WorkspaceSection;
}) {
  const [authState, setAuthState] = useState<AuthUiState>(() =>
    createAuthUiState(),
  );
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [signInForm, setSignInForm] = useState<SignInFormState>({
    email: "",
    password: "",
  });
  const [signUpForm, setSignUpForm] = useState<SignUpFormState>({
    confirmPassword: "",
    email: "",
    password: "",
  });
  const [confirmSignUpForm, setConfirmSignUpForm] =
    useState<ConfirmSignUpFormState>({
      confirmationCode: "",
    });
  const [requestResetForm, setRequestResetForm] =
    useState<RequestResetFormState>({
      email: "",
    });
  const [confirmResetForm, setConfirmResetForm] =
    useState<ConfirmResetFormState>({
      confirmationCode: "",
      confirmPassword: "",
      newPassword: "",
    });

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const currentUser = await getCurrentUser();
        if (cancelled) {
          return;
        }

        const email =
          currentUser.signInDetails?.loginId ?? currentUser.username;
        setUser(currentUser);
        setSignInForm({ email, password: "" });
        setRequestResetForm({ email });
        setAuthState(createAuthUiState({ email, screen: "signedIn" }));
      } catch {
        if (cancelled) {
          return;
        }

        setUser(null);
        setAuthState(createAuthUiState({ screen: "signIn" }));
      }
    }

    void initialize();

    return () => {
      cancelled = true;
    };
  }, []);

  function beginAuthRequest() {
    setAuthState((current) => ({
      ...current,
      isBusy: true,
      notice: null,
    }));
  }

  function completeAuthRequest(nextState: Omit<AuthUiState, "isBusy">) {
    setAuthState(createAuthUiState(nextState));
  }

  function failAuthRequest(
    notice: AuthNotice,
    overrides: Partial<Omit<AuthUiState, "isBusy">> = {},
  ) {
    setAuthState((current) => ({
      ...current,
      ...overrides,
      isBusy: false,
      notice,
    }));
  }

  function openSignIn(
    email = authState.email,
    notice: AuthNotice | null = null,
  ) {
    setSignInForm({ email, password: "" });
    completeAuthRequest({
      email,
      notice,
      pendingUsername: null,
      screen: "signIn",
    });
  }

  function openSignUp() {
    const email = signInForm.email.trim() || authState.email;
    setSignUpForm({
      confirmPassword: "",
      email,
      password: "",
    });
    completeAuthRequest({
      email,
      notice: null,
      pendingUsername: null,
      screen: "signUp",
    });
  }

  function openRequestReset(
    email = signInForm.email.trim() || authState.email,
  ) {
    setRequestResetForm({ email });
    completeAuthRequest({
      email,
      notice: null,
      pendingUsername: email || null,
      screen: "requestReset",
    });
  }

  async function handleSignInSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const email = signInForm.email.trim();
    const password = signInForm.password;
    beginAuthRequest();

    try {
      const result = await signIn({
        password,
        username: email,
      });
      const nextState = resolveSignInStep(result.nextStep.signInStep, email);

      setSignInForm({ email, password: "" });
      if (nextState.screen === "confirmSignUp") {
        setConfirmSignUpForm({ confirmationCode: "" });
      }
      if (nextState.screen === "requestReset") {
        setRequestResetForm({ email });
        setConfirmResetForm({
          confirmationCode: "",
          confirmPassword: "",
          newPassword: "",
        });
      }

      if (nextState.screen === "signedIn") {
        const currentUser = await getCurrentUser();
        const signedInEmail =
          currentUser.signInDetails?.loginId ?? currentUser.username;
        setUser(currentUser);
        setRequestResetForm({ email: signedInEmail });
        completeAuthRequest({
          email: signedInEmail,
          notice: null,
          pendingUsername: null,
          screen: "signedIn",
        });
        return;
      }

      setUser(null);
      completeAuthRequest(nextState);
    } catch (error) {
      setUser(null);
      failAuthRequest(
        {
          message: formatAuthError(error),
          tone: "danger",
        },
        {
          email,
          pendingUsername: null,
          screen: "signIn",
        },
      );
    }
  }

  async function handleSignUpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const email = signUpForm.email.trim();
    if (signUpForm.password !== signUpForm.confirmPassword) {
      failAuthRequest(
        {
          message: "Passwords must match before creating the account.",
          tone: "danger",
        },
        {
          email,
          screen: "signUp",
        },
      );
      return;
    }

    beginAuthRequest();

    try {
      const result = await signUp({
        options: {
          userAttributes: {
            email,
          },
        },
        password: signUpForm.password,
        username: email,
      });
      const nextState = resolveSignUpStep(result.nextStep.signUpStep, email);

      setSignUpForm({
        confirmPassword: "",
        email,
        password: "",
      });
      if (nextState.screen === "confirmSignUp") {
        setConfirmSignUpForm({ confirmationCode: "" });
      }
      if (nextState.screen === "signIn") {
        setSignInForm({ email, password: "" });
      }

      completeAuthRequest(nextState);
    } catch (error) {
      failAuthRequest(
        {
          message: formatAuthError(error),
          tone: "danger",
        },
        {
          email,
          pendingUsername: null,
          screen: "signUp",
        },
      );
    }
  }

  async function handleConfirmSignUpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const username = authState.pendingUsername ?? authState.email;
    if (!username) {
      failAuthRequest(
        {
          message: "The confirmation flow is missing the account email.",
          tone: "danger",
        },
        {
          screen: "signIn",
        },
      );
      return;
    }

    beginAuthRequest();

    try {
      const result = await confirmSignUp({
        confirmationCode: confirmSignUpForm.confirmationCode.trim(),
        username,
      });
      const nextState = resolveConfirmSignUpStep(
        result.nextStep.signUpStep,
        username,
      );

      setConfirmSignUpForm({ confirmationCode: "" });
      setSignInForm({ email: username, password: "" });
      completeAuthRequest(nextState);
    } catch (error) {
      failAuthRequest(
        {
          message: formatAuthError(error),
          tone: "danger",
        },
        {
          email: username,
          pendingUsername: username,
          screen: "confirmSignUp",
        },
      );
    }
  }

  async function handleResendSignUpCode() {
    const username = authState.pendingUsername ?? authState.email;
    if (!username) {
      return;
    }

    beginAuthRequest();

    try {
      const result = await resendSignUpCode({ username });
      const destination = result.destination?.trim();
      failAuthRequest(
        {
          message: destination
            ? `A new confirmation code was sent to ${destination}.`
            : "A new confirmation code was sent.",
          tone: "note",
        },
        {
          email: username,
          pendingUsername: username,
          screen: "confirmSignUp",
        },
      );
    } catch (error) {
      failAuthRequest(
        {
          message: formatAuthError(error),
          tone: "danger",
        },
        {
          email: username,
          pendingUsername: username,
          screen: "confirmSignUp",
        },
      );
    }
  }

  async function handleRequestResetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const email = requestResetForm.email.trim();
    beginAuthRequest();

    try {
      const result = await resetPassword({ username: email });
      const nextState = resolveResetPasswordStep(
        result.nextStep.resetPasswordStep,
        email,
      );
      const destination =
        result.nextStep.codeDeliveryDetails.destination?.trim();

      setConfirmResetForm({
        confirmationCode: "",
        confirmPassword: "",
        newPassword: "",
      });
      completeAuthRequest({
        ...nextState,
        notice:
          nextState.screen === "confirmReset"
            ? {
                message: destination
                  ? `A password reset code was sent to ${destination}.`
                  : "A password reset code was sent.",
                tone: "note",
              }
            : nextState.notice,
      });
    } catch (error) {
      failAuthRequest(
        {
          message: formatAuthError(error),
          tone: "danger",
        },
        {
          email,
          pendingUsername: email,
          screen: "requestReset",
        },
      );
    }
  }

  async function handleResendResetCode() {
    const username = authState.pendingUsername ?? authState.email;
    if (!username) {
      return;
    }

    beginAuthRequest();

    try {
      const result = await resetPassword({ username });
      const destination =
        result.nextStep.codeDeliveryDetails.destination?.trim();
      failAuthRequest(
        {
          message: destination
            ? `A fresh password reset code was sent to ${destination}.`
            : "A fresh password reset code was sent.",
          tone: "note",
        },
        {
          email: username,
          pendingUsername: username,
          screen: "confirmReset",
        },
      );
    } catch (error) {
      failAuthRequest(
        {
          message: formatAuthError(error),
          tone: "danger",
        },
        {
          email: username,
          pendingUsername: username,
          screen: "confirmReset",
        },
      );
    }
  }

  async function handleConfirmResetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const username = authState.pendingUsername ?? authState.email;
    if (!username) {
      failAuthRequest(
        {
          message: "The password reset flow is missing the account email.",
          tone: "danger",
        },
        {
          screen: "signIn",
        },
      );
      return;
    }

    if (confirmResetForm.newPassword !== confirmResetForm.confirmPassword) {
      failAuthRequest(
        {
          message: "Passwords must match before updating the account password.",
          tone: "danger",
        },
        {
          email: username,
          pendingUsername: username,
          screen: "confirmReset",
        },
      );
      return;
    }

    beginAuthRequest();

    try {
      await confirmResetPassword({
        confirmationCode: confirmResetForm.confirmationCode.trim(),
        newPassword: confirmResetForm.newPassword,
        username,
      });
      setConfirmResetForm({
        confirmationCode: "",
        confirmPassword: "",
        newPassword: "",
      });
      setSignInForm({ email: username, password: "" });
      completeAuthRequest(resolveConfirmResetPasswordSuccess(username));
    } catch (error) {
      failAuthRequest(
        {
          message: formatAuthError(error),
          tone: "danger",
        },
        {
          email: username,
          pendingUsername: username,
          screen: "confirmReset",
        },
      );
    }
  }

  async function _handleSignOut() {
    await signOut();
    setUser(null);
    openSignIn(authState.email, {
      message: "Signed out.",
      tone: "note",
    });
  }

  function renderAuthForm() {
    switch (authState.screen) {
      case "loading":
        return (
          <Panel as="article" padding="sm" variant="solid">
            <SectionHeading eyebrow="Sign in" title="Checking your session." />
            <p className={statusCopyClassName}>
              Loading your account session before the app opens.
            </p>
          </Panel>
        );
      case "signIn":
        return (
          <Panel as="article" padding="sm" variant="solid">
            <SectionHeading
              description="Use your companion-app email and password to open your club view."
              eyebrow="Sign In"
              title="Sign in to your account."
            />
            <form
              className="grid gap-4"
              onSubmit={(event) => void handleSignInSubmit(event)}
            >
              <Field label="Email">
                <Input
                  autoComplete="email"
                  onChange={(event) =>
                    setSignInForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  placeholder="coach@example.com"
                  required
                  type="email"
                  value={signInForm.email}
                />
              </Field>
              <Field label="Password">
                <Input
                  autoComplete="current-password"
                  onChange={(event) =>
                    setSignInForm((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                  placeholder="Enter your password"
                  required
                  type="password"
                  value={signInForm.password}
                />
              </Field>
              <div className="flex flex-wrap gap-3">
                <Button loading={authState.isBusy} type="submit">
                  Sign in
                </Button>
                <Button
                  disabled={authState.isBusy}
                  onClick={() => openSignUp()}
                  type="button"
                  variant="secondary"
                >
                  Create account
                </Button>
                <Button
                  disabled={authState.isBusy}
                  onClick={() => openRequestReset()}
                  type="button"
                  variant="ghost"
                >
                  Forgot password
                </Button>
              </div>
            </form>
          </Panel>
        );
      case "signUp":
        return (
          <Panel as="article" padding="sm" variant="solid">
            <SectionHeading
              description="Create the email/password account that stores your private club tools and settings."
              eyebrow="Sign Up"
              title="Create your account."
            />
            <form
              className="grid gap-4"
              onSubmit={(event) => void handleSignUpSubmit(event)}
            >
              <Field label="Email">
                <Input
                  autoComplete="email"
                  onChange={(event) =>
                    setSignUpForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  placeholder="coach@example.com"
                  required
                  type="email"
                  value={signUpForm.email}
                />
              </Field>
              <Field label="Password">
                <Input
                  autoComplete="new-password"
                  onChange={(event) =>
                    setSignUpForm((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                  placeholder="Create a password"
                  required
                  type="password"
                  value={signUpForm.password}
                />
              </Field>
              <Field label="Confirm password">
                <Input
                  autoComplete="new-password"
                  onChange={(event) =>
                    setSignUpForm((current) => ({
                      ...current,
                      confirmPassword: event.target.value,
                    }))
                  }
                  placeholder="Confirm your password"
                  required
                  type="password"
                  value={signUpForm.confirmPassword}
                />
              </Field>
              <div className="flex flex-wrap gap-3">
                <Button loading={authState.isBusy} type="submit">
                  Create account
                </Button>
                <Button
                  disabled={authState.isBusy}
                  onClick={() => openSignIn(signUpForm.email.trim())}
                  type="button"
                  variant="secondary"
                >
                  Back to sign in
                </Button>
              </div>
            </form>
          </Panel>
        );
      case "confirmSignUp":
        return (
          <Panel as="article" padding="sm" variant="solid">
            <SectionHeading
              description={`Enter the code sent to ${
                authState.pendingUsername ?? authState.email
              } to activate your account.`}
              eyebrow="Confirm Email"
              title="Confirm your account."
            />
            <form
              className="grid gap-4"
              onSubmit={(event) => void handleConfirmSignUpSubmit(event)}
            >
              <Field label="Confirmation code">
                <Input
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  onChange={(event) =>
                    setConfirmSignUpForm({
                      confirmationCode: event.target.value,
                    })
                  }
                  placeholder="123456"
                  required
                  value={confirmSignUpForm.confirmationCode}
                />
              </Field>
              <div className="flex flex-wrap gap-3">
                <Button loading={authState.isBusy} type="submit">
                  Confirm account
                </Button>
                <Button
                  disabled={authState.isBusy}
                  onClick={() => void handleResendSignUpCode()}
                  type="button"
                  variant="secondary"
                >
                  Resend code
                </Button>
                <Button
                  disabled={authState.isBusy}
                  onClick={() =>
                    openSignIn(authState.pendingUsername ?? authState.email)
                  }
                  type="button"
                  variant="ghost"
                >
                  Back to sign in
                </Button>
              </div>
            </form>
          </Panel>
        );
      case "requestReset":
        return (
          <Panel as="article" padding="sm" variant="solid">
            <SectionHeading
              description="Request a reset code, then enter it with your new password."
              eyebrow="Reset Password"
              title="Send a password reset code."
            />
            <form
              className="grid gap-4"
              onSubmit={(event) => void handleRequestResetSubmit(event)}
            >
              <Field label="Email">
                <Input
                  autoComplete="email"
                  onChange={(event) =>
                    setRequestResetForm({
                      email: event.target.value,
                    })
                  }
                  placeholder="coach@example.com"
                  required
                  type="email"
                  value={requestResetForm.email}
                />
              </Field>
              <div className="flex flex-wrap gap-3">
                <Button loading={authState.isBusy} type="submit">
                  Send reset code
                </Button>
                <Button
                  disabled={authState.isBusy}
                  onClick={() => openSignIn(requestResetForm.email.trim())}
                  type="button"
                  variant="secondary"
                >
                  Back to sign in
                </Button>
              </div>
            </form>
          </Panel>
        );
      case "confirmReset":
        return (
          <Panel as="article" padding="sm" variant="solid">
            <SectionHeading
              description={`Complete the password reset for ${
                authState.pendingUsername ?? authState.email
              }.`}
              eyebrow="Reset Password"
              title="Set a new password."
            />
            <form
              className="grid gap-4"
              onSubmit={(event) => void handleConfirmResetSubmit(event)}
            >
              <Field label="Confirmation code">
                <Input
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  onChange={(event) =>
                    setConfirmResetForm((current) => ({
                      ...current,
                      confirmationCode: event.target.value,
                    }))
                  }
                  placeholder="123456"
                  required
                  value={confirmResetForm.confirmationCode}
                />
              </Field>
              <Field label="New password">
                <Input
                  autoComplete="new-password"
                  onChange={(event) =>
                    setConfirmResetForm((current) => ({
                      ...current,
                      newPassword: event.target.value,
                    }))
                  }
                  placeholder="Create a new password"
                  required
                  type="password"
                  value={confirmResetForm.newPassword}
                />
              </Field>
              <Field label="Confirm new password">
                <Input
                  autoComplete="new-password"
                  onChange={(event) =>
                    setConfirmResetForm((current) => ({
                      ...current,
                      confirmPassword: event.target.value,
                    }))
                  }
                  placeholder="Confirm the new password"
                  required
                  type="password"
                  value={confirmResetForm.confirmPassword}
                />
              </Field>
              <div className="flex flex-wrap gap-3">
                <Button loading={authState.isBusy} type="submit">
                  Update password
                </Button>
                <Button
                  disabled={authState.isBusy}
                  onClick={() => void handleResendResetCode()}
                  type="button"
                  variant="secondary"
                >
                  Resend code
                </Button>
                <Button
                  disabled={authState.isBusy}
                  onClick={() =>
                    openSignIn(authState.pendingUsername ?? authState.email)
                  }
                  type="button"
                  variant="ghost"
                >
                  Back to sign in
                </Button>
              </div>
            </form>
          </Panel>
        );
      case "signedIn":
        return user ? (
          <AuthenticatedWorkspace
            activeSection={activeSection}
            viewerEmail={user.signInDetails?.loginId ?? user.username}
          />
        ) : (
          <Panel as="article" padding="sm" variant="solid">
            <SectionHeading eyebrow="Sign in" title="Finishing your session." />
            <p className={statusCopyClassName}>
              Your session is active, but your club data is still loading.
            </p>
          </Panel>
        );
      default:
        return null;
    }
  }

  return (
    <div className="grid gap-4">
      {authState.screen !== "signedIn" ? (
        <>
          <div className="grid gap-3">
            <p className="text-accent text-[0.76rem] font-bold tracking-[0.18em] uppercase">
              BuzzerBeater Assistant Coach
            </p>
            <h2 className="text-ink text-2xl font-semibold tracking-[-0.04em]">
              Sign in, then connect your BuzzerBeater account.
            </h2>
            <p className={statusCopyClassName}>
              Your app login stays separate from your BuzzerBeater access key.
              Once connected, this companion keeps your club view, opponent
              reads, and league context ready for quick game prep.
            </p>
          </div>
          {authState.notice ? (
            <Alert tone={authState.notice.tone}>
              {authState.notice.message}
            </Alert>
          ) : null}
        </>
      ) : null}
      {renderAuthForm()}
    </div>
  );
}

export function DashboardApp({
  activeSection,
  viewerEmail,
}: {
  activeSection: WorkspaceSection;
  viewerEmail: string | null;
}) {
  return (
    <main className="grid min-h-screen gap-6 p-4 sm:p-6">
      <AuthenticatedWorkspace
        activeSection={activeSection}
        viewerEmail={viewerEmail}
      />
    </main>
  );
}

function AuthenticatedWorkspace({
  activeSection,
  viewerEmail,
}: {
  activeSection: WorkspaceSection;
  viewerEmail: string | null;
}) {
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(
    null,
  );
  const [connection, setConnection] = useState<BbConnectionRecord | null>(null);
  const [workspace, setWorkspace] = useState<DashboardWorkspace | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [isLoadingBilling, setIsLoadingBilling] = useState(true);
  const [isLoadingConnection, setIsLoadingConnection] = useState(true);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [showCredentialForm, setShowCredentialForm] = useState(false);

  async function loadConnection(): Promise<BbConnectionRecord | null> {
    setIsLoadingConnection(true);
    setConnectionError(null);

    const { data, errors } = await client.models.BbConnection.list({
      limit: 1,
    });

    if (errors?.length) {
      setConnection(null);
      setConnectionError(formatAmplifyErrors(errors));
      setIsLoadingConnection(false);
      return null;
    }

    const record = data[0] ?? null;
    setConnection(record);
    setIsLoadingConnection(false);
    return record;
  }

  async function loadBilling(): Promise<BillingSummary | null> {
    setIsLoadingBilling(true);
    setBillingError(null);

    try {
      const summary = await fetchBillingSummary();
      setBillingSummary(summary);
      setIsLoadingBilling(false);
      return summary;
    } catch (error) {
      setBillingSummary(null);
      setBillingError(formatClientError(error));
      setIsLoadingBilling(false);
      return null;
    }
  }

  async function loadWorkspace(force = false): Promise<void> {
    setIsLoadingWorkspace(true);
    setWorkspaceError(null);

    const homeResponse = force
      ? await client.mutations.refreshWorkspace()
      : await client.queries.getHomeWorkspace();

    if (homeResponse.errors?.length || !homeResponse.data) {
      setWorkspace(null);
      setWorkspaceError(formatAmplifyErrors(homeResponse.errors));
      setIsLoadingWorkspace(false);
      return;
    }

    const [
      teamHubResponse,
      scoutResponse,
      leagueIntelResponse,
      playerLabResponse,
    ] = await Promise.all([
      client.queries.getTeamHub(),
      client.queries.getScoutWorkspace({}),
      client.queries.getLeagueIntel(),
      client.queries.getPlayerLab(),
    ]);

    const allErrors = [
      ...(teamHubResponse.errors ?? []),
      ...(scoutResponse.errors ?? []),
      ...(leagueIntelResponse.errors ?? []),
      ...(playerLabResponse.errors ?? []),
    ];

    if (
      allErrors.length ||
      !teamHubResponse.data ||
      !scoutResponse.data ||
      !leagueIntelResponse.data ||
      !playerLabResponse.data
    ) {
      setWorkspace(null);
      setWorkspaceError(formatAmplifyErrors(allErrors));
      setIsLoadingWorkspace(false);
      return;
    }

    setWorkspace({
      home: readPayload<HomeWorkspacePayload>(homeResponse.data),
      teamHub: readPayload<TeamHubPayload>(teamHubResponse.data),
      scout: readPayload<ScoutWorkspacePayload>(scoutResponse.data),
      leagueIntel: readPayload<LeagueIntelPayload>(leagueIntelResponse.data),
      playerLab: readPayload<PlayerLabPayload>(playerLabResponse.data),
      syncedAt: homeResponse.data.syncedAt ?? null,
    });
    setIsLoadingWorkspace(false);
  }

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      const [record] = await Promise.all([loadConnection(), loadBilling()]);
      if (cancelled) {
        return;
      }

      if (record?.status === "CONNECTED") {
        await loadWorkspace(false);
      } else {
        setWorkspace(null);
      }
    }

    void initialize();

    return () => {
      cancelled = true;
    };
  }, []);

  const connected = connection?.status === "CONNECTED";
  const loginEmail = viewerEmail ?? "Signed in";

  async function handleRefresh(): Promise<void> {
    await loadWorkspace(true);
    await loadConnection();
    await loadBilling();
  }

  async function handleDisconnect(): Promise<void> {
    setIsDisconnecting(true);

    const result = await client.mutations.disconnectBbAccount();
    if (result.errors?.length) {
      setWorkspaceError(formatAmplifyErrors(result.errors));
      setIsDisconnecting(false);
      return;
    }

    setWorkspace(null);
    setShowCredentialForm(false);
    await loadConnection();
    setIsDisconnecting(false);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
      <WorkspaceRouteNav
        accountActions={
          <>
            <div className="grid gap-1">
              <p className="text-ink-muted m-0 text-[0.72rem] font-bold tracking-[0.16em] uppercase">
                Signed in
              </p>
              <strong className="text-ink text-sm">{loginEmail}</strong>
            </div>
            <Link
              className="border-border-soft bg-surface-strong text-ink hover:border-accent/25 hover:text-accent inline-flex min-h-11 items-center justify-center rounded-full border px-4 text-sm font-semibold shadow-sm transition hover:-translate-y-px"
              href="/api/auth/sign-out"
            >
              Sign out
            </Link>
          </>
        }
        activeSection={activeSection}
        currentTeamName={
          workspace?.home.team.teamName ?? connection?.teamName ?? null
        }
        currentTeamRecord={
          workspace
            ? `Record ${formatRecord(workspace.home.team.record)}`
            : (connection?.leagueName ?? "Connect a club to see team context.")
        }
        nextOpponentName={workspace?.home.nextMatch?.opponentTeamName ?? null}
        secondaryActions={<ThemeSelect />}
      />

      <main className="grid gap-4">
        {isLoadingConnection ? (
          <Panel>
            <SectionHeading title="Checking your club link" titleAs="h4" />
            <p className={statusCopyClassName}>
              Looking up your saved BuzzerBeater connection.
            </p>
          </Panel>
        ) : connectionError ? (
          <Panel variant="danger">
            <SectionHeading title="Club link unavailable" titleAs="h4" />
            <p className={statusCopyClassName}>{connectionError}</p>
          </Panel>
        ) : !connected || showCredentialForm ? (
          <ConnectionOnboarding
            connection={connection}
            onCancel={
              connected ? () => setShowCredentialForm(false) : undefined
            }
            onConnected={async (status) => {
              await loadConnection();
              if (status === "CONNECTED") {
                setShowCredentialForm(false);
                await loadWorkspace(false);
              } else {
                setWorkspace(null);
              }
            }}
          />
        ) : (
          <>
            <Panel>
              <SectionHeading
                actions={
                  <>
                    <StatusBadge tone={statusToneFromValue(connection.status)}>
                      {humanizeStatus(connection.status)}
                    </StatusBadge>
                    <Button
                      loading={isLoadingWorkspace}
                      onClick={() => void handleRefresh()}
                    >
                      Refresh club data
                    </Button>
                    <Button
                      onClick={() => setShowCredentialForm(true)}
                      variant="secondary"
                    >
                      Update credentials
                    </Button>
                    <Button
                      loading={isDisconnecting}
                      onClick={() => void handleDisconnect()}
                      variant="secondary"
                    >
                      Disconnect club
                    </Button>
                  </>
                }
                eyebrow="Club connection"
                title={connection.teamName ?? "Connected club"}
              />

              <div className={summaryGridClassName}>
                <StatCard
                  detail={connection.accessKeyLast4 ?? "Securely stored"}
                  label="Login name"
                  value={connection.bbLoginName || "Not set"}
                />
                <StatCard
                  detail={connection.countryName ?? "Country unavailable"}
                  label="League"
                  value={connection.leagueName ?? "Unassigned"}
                />
                <StatCard
                  detail={`Connected ${formatTimestamp(connection.connectedAt)}`}
                  label="Last check"
                  value={formatTimestamp(connection.lastValidatedAt)}
                />
                <StatCard
                  detail={
                    connection.lastSyncError ??
                    "Your latest sync completed cleanly."
                  }
                  label="Latest refresh"
                  value={formatTimestamp(
                    workspace?.syncedAt ?? connection.lastSyncAt,
                  )}
                />
              </div>

              {workspaceError ? <Alert>{workspaceError}</Alert> : null}
            </Panel>

            {isLoadingWorkspace && !workspace ? (
              <Panel>
                <SectionHeading title="Building your club view" titleAs="h4" />
                <p className={statusCopyClassName}>
                  Pulling your team, next opponent, league table, and player
                  snapshots.
                </p>
              </Panel>
            ) : workspace ? (
              <WorkspaceDashboard
                activeSection={activeSection}
                billingError={billingError}
                billingSummary={billingSummary}
                isLoadingBilling={isLoadingBilling}
                workspace={workspace}
              />
            ) : (
              <Panel>
                <SectionHeading
                  title="Your club is ready to load"
                  titleAs="h4"
                />
                <p className={statusCopyClassName}>
                  Refresh your club link or reconnect your BuzzerBeater account
                  to start filling in the companion view.
                </p>
              </Panel>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function ConnectionOnboarding({
  connection,
  onConnected,
  onCancel,
}: {
  connection: BbConnectionRecord | null;
  onConnected: (status: ConnectBbAccountResult["status"]) => Promise<void>;
  onCancel?: () => void;
}) {
  const [formState, setFormState] = useState<ConnectionFormState>({
    bbLoginName: connection?.bbLoginName ?? "",
    accessKey: "",
  });
  const [submitError, setSubmitError] = useState<string | null>(
    connection?.lastSyncError ?? null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setFormState({
      bbLoginName: connection?.bbLoginName ?? "",
      accessKey: "",
    });
    setSubmitError(connection?.lastSyncError ?? null);
  }, [connection?.bbLoginName, connection?.lastSyncError]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);

    const result = await client.mutations.connectBbAccount({
      bbLoginName: formState.bbLoginName.trim(),
      accessKey: formState.accessKey.trim(),
    });

    if (result.errors?.length || !result.data) {
      setSubmitError(formatAmplifyErrors(result.errors));
      setIsSubmitting(false);
      return;
    }

    if (result.data.status !== "CONNECTED") {
      setSubmitError(
        result.data.lastSyncError ?? "Unable to validate those credentials.",
      );
      setIsSubmitting(false);
      await onConnected(result.data.status);
      return;
    }

    await onConnected(result.data.status);
    setIsSubmitting(false);
  }

  return (
    <Panel>
      <SectionHeading
        description={
          <>
            Enter your BuzzerBeater login name and access key. The app checks
            them right away, stores the key securely, and starts your first club
            refresh.
          </>
        }
        eyebrow="Connect BuzzerBeater"
        title={
          connection?.status === "CONNECTED"
            ? "Replace or revalidate your credentials."
            : "Unlock your club companion."
        }
      />

      <form
        className="grid gap-4"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <Field label="BuzzerBeater login name">
          <Input
            onChange={(event) =>
              setFormState((current) => ({
                ...current,
                bbLoginName: event.target.value,
              }))
            }
            placeholder="apiech"
            required
            value={formState.bbLoginName}
          />
        </Field>
        <Field label="Access key">
          <Input
            onChange={(event) =>
              setFormState((current) => ({
                ...current,
                accessKey: event.target.value,
              }))
            }
            placeholder="Enter your BuzzerBeater access key"
            required
            type="password"
            value={formState.accessKey}
          />
        </Field>

        {submitError ? <Alert>{submitError}</Alert> : null}

        <div className="flex flex-wrap gap-3">
          <Button loading={isSubmitting} type="submit">
            Connect and refresh
          </Button>
          {onCancel ? (
            <Button onClick={onCancel} variant="secondary">
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
    </Panel>
  );
}

function WorkspaceDashboard({
  activeSection,
  billingError,
  billingSummary,
  isLoadingBilling,
  workspace,
}: {
  activeSection: WorkspaceSection;
  billingError: string | null;
  billingSummary: BillingSummary | null;
  isLoadingBilling: boolean;
  workspace: DashboardWorkspace;
}) {
  const home = workspace.home;
  const [scout, setScout] = useState(workspace.scout);
  const [selectedScoutTeamId, setSelectedScoutTeamId] = useState(
    workspace.scout.requestedTeamId ?? workspace.scout.teamId ?? "",
  );
  const [scoutError, setScoutError] = useState<string | null>(null);
  const [isLoadingScout, setIsLoadingScout] = useState(false);
  const [boxscoreDetails, setBoxscoreDetails] =
    useState<MatchBoxscorePayload | null>(null);
  const [boxscoreError, setBoxscoreError] = useState<string | null>(null);
  const [loadingMatchId, setLoadingMatchId] = useState<string | null>(null);
  const [playerTrend, setPlayerTrend] = useState<PlayerTrendPayload | null>(
    null,
  );
  const [playerTrendError, setPlayerTrendError] = useState<string | null>(null);
  const [loadingTrendPlayerId, setLoadingTrendPlayerId] = useState<
    string | null
  >(null);
  const [salaryProjection, setSalaryProjection] =
    useState<SalaryProjection | null>(null);
  const [salaryProjectionError, setSalaryProjectionError] = useState<
    string | null
  >(null);
  const [loadingSalaryPlayerId, setLoadingSalaryPlayerId] = useState<
    string | null
  >(null);

  useEffect(() => {
    setScout(workspace.scout);
    setSelectedScoutTeamId(
      workspace.scout.requestedTeamId ?? workspace.scout.teamId ?? "",
    );
    setScoutError(null);
  }, [workspace.scout]);

  const displayWorkspace = {
    ...workspace,
    scout,
  };
  const billingPlanId =
    billingSummary?.planId === "premium" ? "premium" : "free";
  const canUsePredictions = billingSummary
    ? hasFeature(billingPlanId, "predictions")
    : false;
  const canUseLeagueWriteups = billingSummary
    ? hasFeature(billingPlanId, "leagueWriteups")
    : false;
  const canUseTeamHighlights = billingSummary
    ? hasFeature(billingPlanId, "teamHighlights")
    : false;

  async function handleScoutLoad() {
    if (!selectedScoutTeamId) {
      return;
    }

    setIsLoadingScout(true);
    setScoutError(null);

    const response = await client.queries.getScoutWorkspace({
      teamId: selectedScoutTeamId,
    });

    if (response.errors?.length || !response.data) {
      setScoutError(formatAmplifyErrors(response.errors));
      setIsLoadingScout(false);
      return;
    }

    setScout(readPayload<ScoutWorkspacePayload>(response.data));
    setIsLoadingScout(false);
  }

  async function handleLoadBoxscore(matchId: string) {
    setLoadingMatchId(matchId);
    setBoxscoreError(null);

    const response = await client.queries.getMatchBoxscoreDetails({ matchId });
    if (response.errors?.length || !response.data) {
      setBoxscoreDetails(null);
      setBoxscoreError(formatAmplifyErrors(response.errors));
      setLoadingMatchId(null);
      return;
    }

    setBoxscoreDetails(readPayload<MatchBoxscorePayload>(response.data));
    setLoadingMatchId(null);
  }

  async function handleLoadPlayerTrend(player: PlayerSummary) {
    if (!player.playerId) {
      return;
    }

    setLoadingTrendPlayerId(player.playerId);
    setPlayerTrendError(null);

    const response = await client.queries.getPlayerTrend({
      playerId: player.playerId,
    });

    if (response.errors?.length || !response.data) {
      setPlayerTrend(null);
      setPlayerTrendError(formatAmplifyErrors(response.errors));
      setLoadingTrendPlayerId(null);
      return;
    }

    setPlayerTrend(readPayload<PlayerTrendPayload>(response.data));
    setLoadingTrendPlayerId(null);
  }

  async function handleLoadSalaryProjection(player: PlayerSummary) {
    if (!player.playerId) {
      return;
    }

    setLoadingSalaryPlayerId(player.playerId);
    setSalaryProjectionError(null);

    const response = await client.queries.getSalaryProjection({
      playerId: player.playerId,
    });

    if (response.errors?.length || !response.data) {
      setSalaryProjection(null);
      setSalaryProjectionError(formatAmplifyErrors(response.errors));
      setLoadingSalaryPlayerId(null);
      return;
    }

    setSalaryProjection(response.data);
    setLoadingSalaryPlayerId(null);
  }

  return (
    <>
      {activeSection === "home" ? (
        <Panel>
          <SectionHeading
            eyebrow="My Team"
            title={home.team.teamName ?? "Club overview"}
          />

          <div className={summaryGridClassName}>
            <StatCard
              detail={home.team.shortName ?? "Current club"}
              label="Record"
              value={formatRecord(home.team.record)}
            />
            <StatCard
              detail={
                home.nextMatch
                  ? `${formatMatchVenue(home.nextMatch.isHome)} • ${formatTimestamp(home.nextMatch.startTime)}`
                  : "No future game is listed yet."
              }
              label="Next matchup"
              value={home.nextMatch?.opponentTeamName ?? "No upcoming game"}
            />
            <StatCard
              detail={
                home.nextOpponent?.record
                  ? `Record ${formatRecord(home.nextOpponent.record)}`
                  : "No opponent snapshot available."
              }
              label="Next opponent"
              value={home.nextOpponent?.teamName ?? "No opponent"}
            />
            <StatCard
              detail={
                home.team.injuries.length
                  ? `${home.team.injuries[0]?.fullName ?? "Player"} needs attention`
                  : "Full roster available."
              }
              label="Current injuries"
              value={String(home.team.injuries.length)}
            />
          </div>

          <div className={twoColumnGridClassName}>
            <Panel as="article" padding="sm" variant="solid">
              <SectionHeading title="Core rotation" titleAs="h4" />
              <ul className={listClassName}>
                {home.team.topPlayers.length ? (
                  home.team.topPlayers.map((player) => (
                    <li
                      className={listItemClassName}
                      key={player.playerId ?? player.fullName}
                    >
                      <strong className="text-ink text-sm">
                        {player.fullName}
                      </strong>
                      <span className={statusCopyClassName}>
                        {formatPlayerMeta(player)}
                      </span>
                    </li>
                  ))
                ) : (
                  <li className="text-ink-muted text-sm">
                    No rotation snapshot is available yet.
                  </li>
                )}
              </ul>
            </Panel>

            <Panel as="article" padding="sm" variant="solid">
              <SectionHeading title="Recent results" titleAs="h4" />
              <ul className={listClassName}>
                {home.recentMatches.length ? (
                  home.recentMatches.map((match) => (
                    <li
                      className={listRowClassName}
                      key={
                        match.matchId ??
                        `${match.startTime}-${match.opponentTeamName}`
                      }
                    >
                      <div className={listCopyClassName}>
                        <strong className="text-ink text-sm">
                          {match.opponentTeamName ?? "Unknown opponent"}
                        </strong>
                        <span className={statusCopyClassName}>
                          {formatMatchResult(match)}
                        </span>
                      </div>
                      {match.matchId && match.hasBoxscore ? (
                        <Button
                          loading={loadingMatchId === match.matchId}
                          onClick={() =>
                            void handleLoadBoxscore(match.matchId ?? "")
                          }
                          size="sm"
                          variant="secondary"
                        >
                          Boxscore
                        </Button>
                      ) : (
                        <span className={mutedMetaClassName}>
                          Box score not ready
                        </span>
                      )}
                    </li>
                  ))
                ) : (
                  <li className="text-ink-muted text-sm">
                    No completed games are ready yet.
                  </li>
                )}
              </ul>
            </Panel>
          </div>
        </Panel>
      ) : null}

      {activeSection === "home" ? (
        <>
          <Panel>
            <SectionHeading
              eyebrow="Roster"
              title="Availability and lineup context"
            />
            <TableShell>
              <thead>
                <tr>
                  <TableHeadCell>Player</TableHeadCell>
                  <TableHeadCell>Role</TableHeadCell>
                  <TableHeadCell>Age</TableHeadCell>
                  <TableHeadCell>Salary</TableHeadCell>
                  <TableHeadCell>Shape</TableHeadCell>
                  <TableHeadCell>DMI</TableHeadCell>
                  <TableHeadCell>Injury</TableHeadCell>
                  <TableHeadCell>Starts</TableHeadCell>
                </tr>
              </thead>
              <tbody>
                {workspace.teamHub.roster.length ? (
                  workspace.teamHub.roster.map((player) => (
                    <tr key={player.playerId ?? player.fullName}>
                      <TableCell>{player.fullName}</TableCell>
                      <TableCell>{player.bestPosition ?? "N/A"}</TableCell>
                      <TableCell>{player.age ?? "N/A"}</TableCell>
                      <TableCell>{formatCurrency(player.salary)}</TableCell>
                      <TableCell>{player.gameShape ?? "N/A"}</TableCell>
                      <TableCell>{player.dmi ?? "N/A"}</TableCell>
                      <TableCell>{formatInjury(player.injuryWeeks)}</TableCell>
                      <TableCell>{player.projectedStarterCount ?? 0}</TableCell>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <TableCell className="text-ink-muted" colSpan={8}>
                      No roster data is ready yet.
                    </TableCell>
                  </tr>
                )}
              </tbody>
            </TableShell>
          </Panel>
          <Panel>
            <SectionHeading
              eyebrow="Lineup Planning"
              title="Starter planning and saved setups"
            />
            <LineupPlanner />
          </Panel>
        </>
      ) : null}

      {activeSection === "lineups" ? (
        <Panel>
          <SectionHeading
            eyebrow="CoachParrot"
            title="Lineup construction and rating outputs"
          />
          <LineupHelper />
        </Panel>
      ) : null}

      {activeSection === "scout" ? (
        <Panel>
          <SectionHeading
            actions={
              <>
                <Field className="w-full md:min-w-80" label="View team">
                  <Select
                    onChange={(event) =>
                      setSelectedScoutTeamId(event.target.value)
                    }
                    value={selectedScoutTeamId}
                  >
                    <option value="">Select a league team</option>
                    {scout.availableOpponents.map((opponent) => (
                      <option
                        key={opponent.teamId ?? opponent.teamName ?? "unknown"}
                        value={opponent.teamId ?? ""}
                      >
                        {opponent.teamName ?? "Unknown team"}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button
                  disabled={!selectedScoutTeamId}
                  loading={isLoadingScout}
                  onClick={() => void handleScoutLoad()}
                  variant="secondary"
                >
                  Open team view
                </Button>
              </>
            }
            eyebrow="Opponents"
            title={scout.summary?.teamName ?? "Opponent and team view"}
          />
          {scoutError ? <Alert>{scoutError}</Alert> : null}
          {scout.summary ? (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard
                  detail={scout.summary.teamName ?? "Selected team"}
                  label="Record"
                  value={formatRecord(scout.summary.record)}
                />
                <StatCard
                  detail={
                    scout.recentMatchups.length
                      ? "Recent head-to-head history available"
                      : "No recent head-to-head games"
                  }
                  label="Recent games"
                  value={String(scout.summary.recentGames.length)}
                />
                <StatCard
                  detail="Planning tools stay locked to your current club."
                  label="Selected team ID"
                  value={
                    scout.summary.matchupPerspective.opponentTeamId ??
                    "Unavailable"
                  }
                />
              </div>

              <div className={twoColumnGridClassName}>
                <Panel as="article" padding="sm" variant="solid">
                  <SectionHeading title="Team tendencies" titleAs="h4" />
                  <div className="flex flex-wrap gap-2">
                    {renderTrendChips("Off", scout.summary.tendencies.offense)}
                    {renderTrendChips("Def", scout.summary.tendencies.defense)}
                  </div>
                  <div className="h-1" />
                  <SectionHeading title="Key players" titleAs="h4" />
                  <ul className={listClassName}>
                    {scout.summary.topPlayers.map((player) => (
                      <li
                        className={listItemClassName}
                        key={player.playerId ?? player.fullName}
                      >
                        <strong className="text-ink text-sm">
                          {player.fullName}
                        </strong>
                        <span className={statusCopyClassName}>
                          {formatPlayerMeta(player)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Panel>

                <Panel as="article" padding="sm" variant="solid">
                  <SectionHeading
                    title="Recent games and effort clues"
                    titleAs="h4"
                  />
                  <ul className={listClassName}>
                    {scout.summary.recentGames.length ? (
                      scout.summary.recentGames.map((match) => (
                        <li
                          className={listRowClassName}
                          key={
                            match.matchId ??
                            `${match.startTime}-${match.opponentTeamName}`
                          }
                        >
                          <div className={listCopyClassName}>
                            <strong className="text-ink text-sm">
                              {match.opponentTeamName ?? "Unknown opponent"}
                            </strong>
                            <span className={statusCopyClassName}>
                              {formatMatchResult(match)}
                            </span>
                            <span className={mutedMetaClassName}>
                              {formatEffortDelta(match.effortDelta)}
                            </span>
                          </div>
                          {match.matchId && match.hasBoxscore ? (
                            <Button
                              loading={loadingMatchId === match.matchId}
                              onClick={() =>
                                void handleLoadBoxscore(match.matchId ?? "")
                              }
                              size="sm"
                              variant="secondary"
                            >
                              Boxscore
                            </Button>
                          ) : (
                            <span className={mutedMetaClassName}>
                              Box score not ready
                            </span>
                          )}
                        </li>
                      ))
                    ) : (
                      <li className="text-ink-muted text-sm">
                        No recent games are available yet.
                      </li>
                    )}
                  </ul>
                </Panel>
              </div>

              <Panel as="article" padding="sm" variant="solid">
                <SectionHeading
                  description="Public team view only. Hidden skills stay hidden, but salary, shape, DMI, and injuries still help frame the matchup."
                  title="Public roster"
                  titleAs="h4"
                />
                <TableShell>
                  <thead>
                    <tr>
                      <TableHeadCell>Player</TableHeadCell>
                      <TableHeadCell>Role</TableHeadCell>
                      <TableHeadCell>Age</TableHeadCell>
                      <TableHeadCell>Salary</TableHeadCell>
                      <TableHeadCell>Shape</TableHeadCell>
                      <TableHeadCell>DMI</TableHeadCell>
                      <TableHeadCell>Injury</TableHeadCell>
                    </tr>
                  </thead>
                  <tbody>
                    {scout.summary.roster.length ? (
                      scout.summary.roster.map((player) => (
                        <tr key={player.playerId ?? player.fullName}>
                          <TableCell>{player.fullName}</TableCell>
                          <TableCell>{player.bestPosition ?? "N/A"}</TableCell>
                          <TableCell>{player.age ?? "N/A"}</TableCell>
                          <TableCell>{formatCurrency(player.salary)}</TableCell>
                          <TableCell>{player.gameShape ?? "N/A"}</TableCell>
                          <TableCell>{player.dmi ?? "N/A"}</TableCell>
                          <TableCell>
                            {formatInjury(player.injuryWeeks)}
                          </TableCell>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <TableCell className="text-ink-muted" colSpan={7}>
                          Public roster data is not ready yet.
                        </TableCell>
                      </tr>
                    )}
                  </tbody>
                </TableShell>
              </Panel>

              <Panel as="article" padding="sm" variant="solid">
                <SectionHeading
                  title="Recent matchups with your club"
                  titleAs="h4"
                />
                <ul className={listClassName}>
                  {scout.recentMatchups.length ? (
                    scout.recentMatchups.map((match) => (
                      <li
                        className={listRowClassName}
                        key={`matchup-${match.matchId ?? match.startTime}`}
                      >
                        <div className={listCopyClassName}>
                          <strong className="text-ink text-sm">
                            {match.opponentTeamName ?? "Unknown opponent"}
                          </strong>
                          <span className={statusCopyClassName}>
                            {formatMatchResult(match)}
                          </span>
                        </div>
                        {match.matchId && match.hasBoxscore ? (
                          <Button
                            loading={loadingMatchId === match.matchId}
                            onClick={() =>
                              void handleLoadBoxscore(match.matchId ?? "")
                            }
                            size="sm"
                            variant="secondary"
                          >
                            Boxscore
                          </Button>
                        ) : (
                          <span className={mutedMetaClassName}>
                            Box score not ready
                          </span>
                        )}
                      </li>
                    ))
                  ) : (
                    <li className="text-ink-muted text-sm">
                      No recent head-to-head history is ready yet.
                    </li>
                  )}
                </ul>
              </Panel>
            </>
          ) : (
            <p className={statusCopyClassName}>
              {scout.message ?? "No opponent view is available yet."}
            </p>
          )}
        </Panel>
      ) : null}

      {activeSection === "scout" && (boxscoreDetails || boxscoreError) ? (
        <Panel>
          <SectionHeading
            eyebrow="Box Score"
            title={
              boxscoreDetails?.opponentTeamName ?? "Saved box score detail"
            }
          />
          {boxscoreError ? <Alert>{boxscoreError}</Alert> : null}
          {boxscoreDetails ? (
            <div className={twoColumnGridClassName}>
              <Panel as="article" padding="sm" variant="solid">
                <SectionHeading title="Strategy snapshot" titleAs="h4" />
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <dt className="text-ink-muted text-[0.78rem] font-bold tracking-[0.08em] uppercase">
                      Your offense
                    </dt>
                    <dd className="text-ink m-0 font-semibold">
                      {boxscoreDetails.offStrategy ?? "N/A"}
                    </dd>
                  </div>
                  <div className="grid gap-1">
                    <dt className="text-ink-muted text-[0.78rem] font-bold tracking-[0.08em] uppercase">
                      Your defense
                    </dt>
                    <dd className="text-ink m-0 font-semibold">
                      {boxscoreDetails.defStrategy ?? "N/A"}
                    </dd>
                  </div>
                  <div className="grid gap-1">
                    <dt className="text-ink-muted text-[0.78rem] font-bold tracking-[0.08em] uppercase">
                      Opponent offense
                    </dt>
                    <dd className="text-ink m-0 font-semibold">
                      {boxscoreDetails.opponentOffStrategy ?? "N/A"}
                    </dd>
                  </div>
                  <div className="grid gap-1">
                    <dt className="text-ink-muted text-[0.78rem] font-bold tracking-[0.08em] uppercase">
                      Opponent defense
                    </dt>
                    <dd className="text-ink m-0 font-semibold">
                      {boxscoreDetails.opponentDefStrategy ?? "N/A"}
                    </dd>
                  </div>
                </dl>
              </Panel>

              <Panel as="article" padding="sm" variant="solid">
                <SectionHeading title="Ratings snapshot" titleAs="h4" />
                <div className="overflow-x-auto">
                  <div className={ratingGridClassName}>
                    <div className="text-ink-muted text-[0.78rem] font-bold tracking-[0.08em] uppercase">
                      Metric
                    </div>
                    <div className="text-ink-muted text-[0.78rem] font-bold tracking-[0.08em] uppercase">
                      You
                    </div>
                    <div className="text-ink-muted text-[0.78rem] font-bold tracking-[0.08em] uppercase">
                      Opponent
                    </div>
                    {renderBoxscoreMetricRows(
                      boxscoreDetails.teamRatings,
                      boxscoreDetails.opponentRatings,
                    )}
                  </div>
                </div>
              </Panel>

              <Panel as="article" padding="sm" variant="solid">
                <SectionHeading title="Efficiency snapshot" titleAs="h4" />
                <div className="overflow-x-auto">
                  <div className={ratingGridClassName}>
                    <div className="text-ink-muted text-[0.78rem] font-bold tracking-[0.08em] uppercase">
                      Metric
                    </div>
                    <div className="text-ink-muted text-[0.78rem] font-bold tracking-[0.08em] uppercase">
                      You
                    </div>
                    <div className="text-ink-muted text-[0.78rem] font-bold tracking-[0.08em] uppercase">
                      Opponent
                    </div>
                    {renderBoxscoreMetricRows(
                      boxscoreDetails.teamEfficiency,
                      boxscoreDetails.opponentEfficiency,
                    )}
                  </div>
                </div>
              </Panel>

              <Panel as="article" padding="sm" variant="solid">
                <SectionHeading title="Saved game context" titleAs="h4" />
                <p className={statusCopyClassName}>
                  Match {boxscoreDetails.matchId}. This saved snapshot keeps the
                  strategy and effort context available for later comparison.
                </p>
                <div className="flex flex-wrap gap-2">
                  {renderBoxscoreContext(boxscoreDetails.boxscore)}
                </div>
              </Panel>
            </div>
          ) : null}
        </Panel>
      ) : null}

      {activeSection === "predictions" ? (
        canUsePredictions ? (
          <PredictionPanel workspace={displayWorkspace} />
        ) : (
          <PremiumFeatureGatePanel
            billingSummary={billingSummary}
            error={billingError}
            featureName="Prediction engine"
            isLoading={isLoadingBilling}
            message="Run matchup forecasts and compare connected or manual inputs with the premium prediction engine."
          />
        )
      ) : null}

      {activeSection === "highlights" ? (
        canUseTeamHighlights ? (
          <HighlightsPanel workspace={displayWorkspace} />
        ) : (
          <PremiumFeatureGatePanel
            billingSummary={billingSummary}
            error={billingError}
            featureName="Team highlights"
            isLoading={isLoadingBilling}
            message="Scan your club's full history and browse all-time buzzerbeater-derived moments with a premium subscription."
          />
        )
      ) : null}

      {activeSection === "recaps" ? (
        canUseLeagueWriteups ? (
          <RecapPanel workspace={displayWorkspace} />
        ) : (
          <PremiumFeatureGatePanel
            billingSummary={billingSummary}
            error={billingError}
            featureName="League writeups"
            isLoading={isLoadingBilling}
            message="Generate game day recaps and league writeups with a premium subscription."
          />
        )
      ) : null}

      {activeSection === "league" ? (
        <Panel>
          <SectionHeading
            eyebrow="League"
            title={workspace.leagueIntel.league?.name ?? "League standings"}
          />
          <div className={twoColumnGridClassName}>
            {workspace.leagueIntel.standings.length ? (
              workspace.leagueIntel.standings.map((conference) => (
                <Panel
                  as="article"
                  key={conference.index}
                  padding="sm"
                  variant="solid"
                >
                  <SectionHeading
                    title={`Conference ${conference.index + 1}`}
                    titleAs="h4"
                  />
                  <TableShell compact>
                    <thead>
                      <tr>
                        <TableHeadCell className="pl-0">Team</TableHeadCell>
                        <TableHeadCell>W-L</TableHeadCell>
                        <TableHeadCell>Margin</TableHeadCell>
                      </tr>
                    </thead>
                    <tbody>
                      {conference.teams.map((team) => (
                        <tr key={team.teamId ?? team.teamName}>
                          <TableCell className="pl-0">
                            {team.teamName ?? "Unknown team"}
                          </TableCell>
                          <TableCell>
                            {team.wins ?? 0}-{team.losses ?? 0}
                          </TableCell>
                          <TableCell>
                            {formatSigned(team.pointMargin)}
                          </TableCell>
                        </tr>
                      ))}
                    </tbody>
                  </TableShell>
                </Panel>
              ))
            ) : (
              <Panel as="article" padding="sm" variant="solid">
                <p className={statusCopyClassName}>
                  No standings snapshot is ready yet.
                </p>
              </Panel>
            )}
          </div>
        </Panel>
      ) : null}

      {activeSection === "players" ? (
        <Panel>
          <SectionHeading
            eyebrow="Players"
            title="Trend lines, salary movement, and roster calls"
          />
          {playerTrendError ? <Alert>{playerTrendError}</Alert> : null}
          {salaryProjectionError ? (
            <Alert>{salaryProjectionError}</Alert>
          ) : null}
          <TableShell>
            <thead>
              <tr>
                <TableHeadCell>Player</TableHeadCell>
                <TableHeadCell>Role</TableHeadCell>
                <TableHeadCell>Salary</TableHeadCell>
                <TableHeadCell>Shape</TableHeadCell>
                <TableHeadCell>DMI</TableHeadCell>
                <TableHeadCell>Starts</TableHeadCell>
                <TableHeadCell>Analysis</TableHeadCell>
              </tr>
            </thead>
            <tbody>
              {workspace.playerLab.players.length ? (
                workspace.playerLab.players.map((player) => (
                  <tr key={player.playerId ?? player.fullName}>
                    <TableCell>{player.fullName}</TableCell>
                    <TableCell>{player.bestPosition ?? "N/A"}</TableCell>
                    <TableCell>{formatCurrency(player.salary)}</TableCell>
                    <TableCell>{player.gameShape ?? "N/A"}</TableCell>
                    <TableCell>{player.dmi ?? "N/A"}</TableCell>
                    <TableCell>{player.projectedStarterCount ?? 0}</TableCell>
                    <TableCell className="flex flex-wrap gap-2">
                      <Button
                        disabled={!player.playerId}
                        loading={loadingTrendPlayerId === player.playerId}
                        onClick={() => void handleLoadPlayerTrend(player)}
                        size="sm"
                        variant="secondary"
                      >
                        Trend
                      </Button>
                      <Button
                        disabled={!player.playerId}
                        loading={loadingSalaryPlayerId === player.playerId}
                        onClick={() => void handleLoadSalaryProjection(player)}
                        size="sm"
                        variant="secondary"
                      >
                        Salary
                      </Button>
                    </TableCell>
                  </tr>
                ))
              ) : (
                <tr>
                  <TableCell className="text-ink-muted" colSpan={7}>
                    Player data is not available yet.
                  </TableCell>
                </tr>
              )}
            </tbody>
          </TableShell>

          <div className={twoColumnGridClassName}>
            <Panel as="article" padding="sm" variant="solid">
              <SectionHeading
                description="Weekly snapshots from your saved club history."
                title={`${String(playerTrend?.player.fullName ?? "Player")} trend`}
                titleAs="h4"
              />
              {playerTrend ? (
                playerTrend.history.length > 1 ? (
                  <PlayerTrendChart
                    formatCurrency={formatCurrency}
                    formatInjury={formatInjury}
                    formatTimestamp={formatTimestamp}
                    history={playerTrend.history}
                  />
                ) : (
                  <p className={statusCopyClassName}>
                    Need at least two weekly snapshots to draw a trend chart.
                  </p>
                )
              ) : (
                <p className={statusCopyClassName}>
                  Load a player trend to inspect weekly salary, DMI, and
                  availability changes.
                </p>
              )}
            </Panel>

            <Panel as="article" padding="sm" variant="solid">
              <SectionHeading title="Salary projection" titleAs="h4" />
              {salaryProjection ? (
                <div className={summaryGridClassName}>
                  <StatCard
                    detail={salaryProjection.bestPosition ?? "No listed role"}
                    label="Player"
                    value={salaryProjection.fullName}
                  />
                  <StatCard
                    detail={`Trend ${salaryProjection.trend}`}
                    label="Current salary"
                    value={formatCurrency(salaryProjection.currentSalary)}
                  />
                  <StatCard
                    detail={`Δ ${formatSigned((salaryProjection.weeklyDelta ?? 0) / 1)}`}
                    label="Projected next week"
                    value={formatCurrency(salaryProjection.projectedSalary)}
                  />
                  <StatCard
                    detail={
                      salaryProjection.flagReason ??
                      "No flag guidance available."
                    }
                    label="Flag fit"
                    value={
                      salaryProjection.isFlagTarget ? "Aligned" : "Not aligned"
                    }
                  />
                </div>
              ) : (
                <p className={statusCopyClassName}>
                  Load a salary projection to estimate next-week movement and
                  flag fit.
                </p>
              )}
            </Panel>
          </div>
        </Panel>
      ) : null}

      {activeSection === "ops" ? (
        <>
          <BillingPanel
            error={billingError}
            isLoading={isLoadingBilling}
            summary={billingSummary}
          />
          <Panel>
            <SectionHeading
              description="Choose the look you want for your companion app. The selection is saved to your account."
              eyebrow="Appearance"
              title="Theme and account preferences"
            />
            <div className="max-w-sm">
              <ThemeSelect />
            </div>
          </Panel>
          <OperationsPanel />
        </>
      ) : null}
    </>
  );
}

function readPayload<T>(response: WorkspaceResponse | JsonLookupResponse): T {
  return decodeGraphqlJsonPayload<T>(response.payload);
}

export const __testing = {
  readPayload,
};

function formatEffortDelta(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "Effort clue unavailable";
  }

  if (value === 0) {
    return "Effort looked even";
  }

  return value > 0 ? `Effort edge: +${value}` : `Effort edge: ${value}`;
}

function renderTrendChips(prefix: string, values: Record<string, number>) {
  const entries = Object.entries(values);
  if (!entries.length) {
    return (
      <span className="text-ink-muted inline-flex rounded-full bg-black/5 px-3 py-1.5 text-sm font-semibold">
        {prefix}: no data
      </span>
    );
  }

  return entries.map(([label, count]) => (
    <span
      className="bg-note-bg text-note inline-flex rounded-full px-3 py-1.5 text-sm font-semibold"
      key={`${prefix}-${label}`}
    >
      {prefix}: {label} ({count})
    </span>
  ));
}

function renderBoxscoreMetricRows(
  left: Record<string, unknown> | null,
  right: Record<string, unknown> | null,
) {
  const keys = Array.from(
    new Set([
      ...(left ? Object.keys(left) : []),
      ...(right ? Object.keys(right) : []),
    ]),
  )
    .filter((key) => !key.startsWith("__"))
    .sort((leftKey, rightKey) => leftKey.localeCompare(rightKey));

  if (!keys.length) {
    return (
      <div className="contents" key="empty-metrics">
        <span className="text-ink font-semibold">No cached metrics</span>
        <span className="text-ink-muted">-</span>
        <span className="text-ink-muted">-</span>
      </div>
    );
  }

  return keys.slice(0, 8).map((key) => (
    <div className="contents" key={key}>
      <span className="text-ink font-semibold">{humanizeKey(key)}</span>
      <span className="text-ink text-sm">{formatMetricValue(left?.[key])}</span>
      <span className="text-ink text-sm">
        {formatMetricValue(right?.[key])}
      </span>
    </div>
  ));
}

function renderBoxscoreContext(boxscore: Record<string, unknown> | null) {
  if (!boxscore) {
    return (
      <span className="text-ink-muted inline-flex rounded-full bg-black/5 px-3 py-1.5 text-sm font-semibold">
        No raw boxscore context
      </span>
    );
  }

  const homeTeam = toRecord(boxscore.homeTeam);
  const awayTeam = toRecord(boxscore.awayTeam);
  const tags = [
    homeTeam?.teamName ? `Home: ${String(homeTeam.teamName)}` : null,
    awayTeam?.teamName ? `Away: ${String(awayTeam.teamName)}` : null,
    boxscore.effortDelta !== undefined
      ? `Effort Δ: ${String(boxscore.effortDelta)}`
      : null,
    boxscore.neutral !== undefined
      ? `Neutral: ${String(boxscore.neutral)}`
      : null,
  ].filter((value): value is string => Boolean(value));

  if (!tags.length) {
    return (
      <span className="text-ink-muted inline-flex rounded-full bg-black/5 px-3 py-1.5 text-sm font-semibold">
        No raw boxscore context
      </span>
    );
  }

  return tags.map((tag) => (
    <span
      className="bg-note-bg text-note inline-flex rounded-full px-3 py-1.5 text-sm font-semibold"
      key={tag}
    >
      {tag}
    </span>
  ));
}

function formatAmplifyErrors(
  errors: Array<{ message?: string }> | null | undefined,
): string {
  if (!errors?.length) {
    return "The operation failed without a detailed error message.";
  }

  return errors
    .map((error) => error.message?.trim())
    .filter((message): message is string => Boolean(message))
    .join(" ");
}

function formatClientError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatAuthError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message.trim();
  }

  return "Authentication failed without a detailed error message.";
}

function humanizeStatus(status: BbConnectionRecord["status"]) {
  return status
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "Unavailable";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatRecord(
  record: { wins: number | null; losses: number | null } | null,
): string {
  if (!record) {
    return "No record";
  }

  return `${record.wins ?? 0}-${record.losses ?? 0}`;
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "N/A";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatInjury(value: number | null | undefined): string {
  if (!value) {
    return "Healthy";
  }

  return `${value}w`;
}

function formatMatchVenue(isHome: boolean | null | undefined): string {
  if (isHome === null || isHome === undefined) {
    return "Venue TBD";
  }

  return isHome ? "Home" : "Away";
}

function formatSigned(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "N/A";
  }

  return value > 0 ? `+${value}` : String(value);
}

function formatMatchResult(match: {
  outcome: string | null;
  teamScore: number | null;
  opponentScore: number | null;
  startTime?: string | null;
}): string {
  const scoreline =
    match.teamScore !== null && match.opponentScore !== null
      ? `${match.teamScore}-${match.opponentScore}`
      : null;

  if (scoreline) {
    return `${match.outcome ?? "PENDING"} • ${scoreline}`;
  }

  return match.startTime
    ? formatTimestamp(match.startTime)
    : (match.outcome ?? "PENDING");
}

function formatMetricValue(value: unknown): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  if (typeof value === "string" && value.trim()) {
    return value;
  }

  return "N/A";
}

function humanizeKey(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatPlayerMeta(player: PlayerSummary): string {
  const parts = [
    player.bestPosition,
    player.salary !== null ? formatCurrency(player.salary) : null,
    player.stats && typeof player.stats.ppg === "number"
      ? `${player.stats.ppg} PPG`
      : null,
  ];

  return parts.filter(Boolean).join(" • ") || "No profile details yet.";
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
