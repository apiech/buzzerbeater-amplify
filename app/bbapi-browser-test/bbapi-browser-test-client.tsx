"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/app/ui/primitives/button";
import { Field, Input } from "@/app/ui/primitives/field";
import { Panel } from "@/app/ui/primitives/panel";
import { cn } from "@/app/ui/primitives/cn";

const DEFAULT_BASE_URL = "http://bbapi.buzzerbeater.com";

type ProbeStepId = "login" | "countries" | "logout";
type ProbeStepStatus = "pending" | "running" | "success" | "error" | "skipped";
type ProbeStatus = "idle" | "running" | "success" | "error";

type ProbeStep = {
  id: ProbeStepId;
  label: string;
  status: ProbeStepStatus;
  detail: string;
  durationMs: number | null;
  bodyBytes: number | null;
  httpStatus: number | null;
  responseType: string | null;
  requestUrl: string | null;
};

type ProbeResponse = {
  body: string;
  bodyBytes: number;
  durationMs: number;
  httpStatus: number;
  ok: boolean;
  responseType: string;
  requestUrl: string;
  statusText: string;
};

type CountriesResult = {
  countryCount: number | null;
  preview: string;
};

const stepLabels: Record<ProbeStepId, string> = {
  login: "login.aspx",
  countries: "countries.aspx",
  logout: "logout.aspx",
};

const statusClasses: Record<ProbeStepStatus, string> = {
  pending: "border-black/10 bg-white/70 text-ink-muted",
  running: "border-accent/25 bg-accent/10 text-accent-strong",
  success: "border-success/25 bg-success/10 text-success",
  error: "border-danger-border bg-danger-bg text-danger",
  skipped: "border-black/10 bg-black/5 text-ink-muted",
};

function createInitialSteps(): ProbeStep[] {
  return (Object.keys(stepLabels) as ProbeStepId[]).map((id) => ({
    id,
    label: stepLabels[id],
    status: "pending",
    detail: "Waiting",
    durationMs: null,
    bodyBytes: null,
    httpStatus: null,
    responseType: null,
    requestUrl: null,
  }));
}

export function BBApiBrowserTestClient() {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [username, setUsername] = useState("");
  const [securityCode, setSecurityCode] = useState("");
  const [status, setStatus] = useState<ProbeStatus>("idle");
  const [summary, setSummary] = useState("Ready to run the browser probe.");
  const [steps, setSteps] = useState<ProbeStep[]>(() => createInitialSteps());
  const [countriesResult, setCountriesResult] =
    useState<CountriesResult | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedBaseUrl = baseUrl.trim();
    const trimmedUsername = username.trim();
    const trimmedSecurityCode = securityCode.trim();

    if (!trimmedUsername || !trimmedSecurityCode) {
      setStatus("error");
      setSummary("Enter a BB login name and access key before running.");
      return;
    }

    setStatus("running");
    setSummary("Running direct browser requests.");
    setCountriesResult(null);
    setSteps(createInitialSteps());

    let completedLogin = false;
    let completedCountries = false;
    let sequenceError: string | null = null;
    let activeStep: ProbeStepId | null = null;

    try {
      activeStep = "login";
      markStep("login", {
        status: "running",
        detail: "Sending credentials from the browser",
      });
      const loginResponse = await fetchBBApi(trimmedBaseUrl, "login.aspx", {
        login: trimmedUsername,
        code: trimmedSecurityCode,
      });
      recordStepResponse("login", loginResponse, "Login response received");
      assertUsableResponse("login.aspx", loginResponse);

      if (!/<loggedIn\b/i.test(loginResponse.body)) {
        throw new Error("login.aspx completed but did not return loggedIn.");
      }

      completedLogin = true;
      markStep("login", {
        status: "success",
        detail: "loggedIn marker detected",
      });

      activeStep = "countries";
      markStep("countries", {
        status: "running",
        detail: "Fetching countries.aspx with browser-managed credentials",
      });
      const countriesResponse = await fetchBBApi(
        trimmedBaseUrl,
        "countries.aspx",
      );
      recordStepResponse(
        "countries",
        countriesResponse,
        "Countries XML received",
      );
      assertUsableResponse("countries.aspx", countriesResponse);

      const countryCount = countCountries(countriesResponse.body);
      setCountriesResult({
        countryCount,
        preview: buildXmlPreview(countriesResponse.body),
      });
      completedCountries = true;
      markStep("countries", {
        status: "success",
        detail:
          countryCount === null
            ? "Countries XML received"
            : `${countryCount} countries parsed`,
      });
    } catch (error) {
      const message = formatErrorMessage(error);
      sequenceError = message;
      if (activeStep) {
        markStep(activeStep, {
          status: "error",
          detail: message,
        });
      }
    } finally {
      const logoutError = completedLogin
        ? await runLogout(trimmedBaseUrl)
        : "Skipped because login did not complete.";

      if (!completedLogin) {
        markStep("logout", {
          status: "skipped",
          detail: logoutError ?? "Skipped because login did not complete.",
        });
      }

      if (sequenceError || (completedLogin && logoutError)) {
        setStatus("error");
        setSummary(
          sequenceError
            ? completedLogin && logoutError
              ? `${sequenceError} Logout also failed: ${logoutError}`
              : sequenceError
            : `Logout failed: ${logoutError}`,
        );
      } else {
        setStatus(completedCountries ? "success" : "error");
        setSummary(
          completedCountries
            ? "Browser completed login, countries.aspx, and logout."
            : "The browser probe did not complete.",
        );
      }
    }
  }

  function markStep(id: ProbeStepId, patch: Partial<ProbeStep>) {
    setSteps((currentSteps) =>
      currentSteps.map((step) =>
        step.id === id
          ? {
              ...step,
              ...patch,
            }
          : step,
      ),
    );
  }

  function recordStepResponse(
    id: ProbeStepId,
    response: ProbeResponse,
    detail: string,
  ) {
    markStep(id, {
      status: response.ok ? "success" : "error",
      detail,
      durationMs: response.durationMs,
      bodyBytes: response.bodyBytes,
      httpStatus: response.httpStatus,
      responseType: response.responseType,
      requestUrl: response.requestUrl,
    });
  }

  async function runLogout(trimmedBaseUrl: string): Promise<string | null> {
    markStep("logout", {
      status: "running",
      detail: "Calling logout.aspx",
    });

    try {
      const logoutResponse = await fetchBBApi(trimmedBaseUrl, "logout.aspx");
      recordStepResponse("logout", logoutResponse, "Logout response received");
      assertUsableResponse("logout.aspx", logoutResponse);
      markStep("logout", {
        status: "success",
        detail: "Logout completed",
      });
      return null;
    } catch (error) {
      const message = formatErrorMessage(error);
      markStep("logout", {
        status: "error",
        detail: message,
      });
      return message;
    }
  }

  return (
    <main className="min-h-screen bg-[rgba(244,241,235,0.72)] p-4 sm:p-6">
      <div className="mx-auto grid w-full max-w-6xl gap-5">
        <header className="grid gap-2">
          <p className="text-accent m-0 text-xs font-bold uppercase">
            Diagnostic
          </p>
          <h1 className="text-ink m-0 text-3xl font-semibold">
            BB API browser test
          </h1>
          <p className="text-ink-muted m-0 max-w-3xl text-sm leading-7">
            Runs the BB XML API sequence directly in the browser: login,
            countries, logout. No app API route or server-side BB client is
            used.
          </p>
        </header>

        <Panel as="section" padding="lg" variant="solid">
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Field label="Base URL">
                <Input
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                />
              </Field>
              <Field label="BB login name">
                <Input
                  autoCapitalize="none"
                  autoComplete="username"
                  spellCheck={false}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </Field>
              <Field label="Access key">
                <Input
                  autoComplete="off"
                  type="password"
                  value={securityCode}
                  onChange={(event) => setSecurityCode(event.target.value)}
                />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button loading={status === "running"} type="submit">
                Run browser probe
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setStatus("idle");
                  setSummary("Ready to run the browser probe.");
                  setSteps(createInitialSteps());
                  setCountriesResult(null);
                }}
              >
                Clear result
              </Button>
              <StatusPill status={status} />
            </div>
          </form>
        </Panel>

        <Panel as="section">
          <div className="grid gap-1">
            <h2 className="text-ink m-0 text-xl font-semibold">Result</h2>
            <p
              className={cn(
                "m-0 text-sm leading-7",
                status === "error" ? "text-danger" : "text-ink-muted",
              )}
            >
              {summary}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] border-separate border-spacing-0 text-left">
              <thead>
                <tr className="text-ink-muted text-xs font-bold uppercase">
                  <th className="border-b border-black/10 px-3 py-2">Step</th>
                  <th className="border-b border-black/10 px-3 py-2">Status</th>
                  <th className="border-b border-black/10 px-3 py-2">HTTP</th>
                  <th className="border-b border-black/10 px-3 py-2">Time</th>
                  <th className="border-b border-black/10 px-3 py-2">Bytes</th>
                  <th className="border-b border-black/10 px-3 py-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((step) => (
                  <tr key={step.id}>
                    <td className="border-b border-black/8 px-3 py-3 align-top">
                      <div className="grid gap-1">
                        <span className="text-ink font-semibold">
                          {step.label}
                        </span>
                        {step.requestUrl ? (
                          <span className="text-ink-muted text-xs break-all">
                            {step.requestUrl}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="border-b border-black/8 px-3 py-3 align-top">
                      <span
                        className={cn(
                          "inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold capitalize",
                          statusClasses[step.status],
                        )}
                      >
                        {step.status}
                      </span>
                    </td>
                    <td className="text-ink border-b border-black/8 px-3 py-3 align-top text-sm">
                      {step.httpStatus ?? "-"}
                    </td>
                    <td className="text-ink border-b border-black/8 px-3 py-3 align-top text-sm">
                      {step.durationMs === null
                        ? "-"
                        : `${Math.round(step.durationMs)} ms`}
                    </td>
                    <td className="text-ink border-b border-black/8 px-3 py-3 align-top text-sm">
                      {step.bodyBytes ?? "-"}
                    </td>
                    <td className="border-b border-black/8 px-3 py-3 align-top">
                      <div className="grid gap-1 text-sm">
                        <span
                          className={
                            step.status === "error" ? "text-danger" : "text-ink"
                          }
                        >
                          {step.detail}
                        </span>
                        {step.responseType ? (
                          <span className="text-ink-muted text-xs">
                            response type: {step.responseType}
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        {countriesResult ? (
          <Panel as="section">
            <div className="grid gap-1">
              <h2 className="text-ink m-0 text-xl font-semibold">
                countries.aspx preview
              </h2>
              <p className="text-ink-muted m-0 text-sm leading-7">
                {countriesResult.countryCount === null
                  ? "XML received; country elements were not counted."
                  : `${countriesResult.countryCount} country elements counted.`}
              </p>
            </div>
            <pre className="text-ink max-h-[26rem] overflow-auto rounded-lg border border-black/10 bg-white p-4 text-xs leading-6">
              {countriesResult.preview}
            </pre>
          </Panel>
        ) : null}
      </div>
    </main>
  );
}

function StatusPill({ status }: { status: ProbeStatus }) {
  const label =
    status === "idle"
      ? "Idle"
      : status === "running"
        ? "Running"
        : status === "success"
          ? "Passed"
          : "Failed";
  const classes =
    status === "success"
      ? statusClasses.success
      : status === "error"
        ? statusClasses.error
        : status === "running"
          ? statusClasses.running
          : statusClasses.pending;

  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-3 py-1.5 text-xs font-semibold",
        classes,
      )}
    >
      {label}
    </span>
  );
}

async function fetchBBApi(
  baseUrl: string,
  endpoint: string,
  params?: Record<string, string>,
): Promise<ProbeResponse> {
  const url = buildApiUrl(baseUrl, endpoint, params);
  const startedAt = performance.now();
  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
  const body = await response.text();

  return {
    body,
    bodyBytes: new TextEncoder().encode(body).length,
    durationMs: performance.now() - startedAt,
    httpStatus: response.status,
    ok: response.ok,
    responseType: response.type,
    requestUrl: url.toString(),
    statusText: response.statusText,
  };
}

function buildApiUrl(
  baseUrl: string,
  endpoint: string,
  params?: Record<string, string>,
): URL {
  const trimmedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmedBaseUrl)) {
    throw new Error("Base URL must start with http:// or https://.");
  }

  const url = new URL(`${trimmedBaseUrl}/${endpoint}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  return url;
}

function assertUsableResponse(endpoint: string, response: ProbeResponse) {
  if (!response.ok) {
    throw new Error(
      `${endpoint} returned ${response.httpStatus} ${response.statusText}`.trim(),
    );
  }

  const apiError = extractApiError(response.body);
  if (apiError) {
    throw new Error(`${endpoint} returned BB API error: ${apiError}`);
  }
}

function extractApiError(xml: string): string | null {
  const match = xml.match(/<error\b[^>]*message=["']([^"']+)["']/i);
  return match?.[1] ?? null;
}

function countCountries(xml: string): number | null {
  const parsed = new DOMParser().parseFromString(xml, "text/xml");
  if (parsed.querySelector("parsererror")) {
    return null;
  }
  return parsed.querySelectorAll("country").length;
}

function buildXmlPreview(xml: string): string {
  const normalized = xml.trim();
  if (normalized.length <= 3000) {
    return normalized;
  }
  return `${normalized.slice(0, 3000)}\n...`;
}

function formatErrorMessage(error: unknown): string {
  return String(error);
}
