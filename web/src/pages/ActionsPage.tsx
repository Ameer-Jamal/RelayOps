import { useCallback, useState } from "react";
import type { TargetRecord, ValidationResult } from "@relayops/shared/adminApi";
import { apiRequest } from "../api/client";
import { Card, ErrorBanner, PageHeader, SuccessBanner } from "../components/Common";
import { useApiData } from "../hooks/useApiData";

type BusyKey =
  | "teams-open"
  | "teams-validate"
  | "run-trigger"
  | "test-post"
  | "validate-config"
  | "clear-alerts";

const BUSY_LABELS: Record<BusyKey, string> = {
  "teams-open": "Opening Teams in the automation browser…",
  "teams-validate": "Validating Teams session…",
  "run-trigger": "Running rules for this trigger…",
  "test-post": "Sending test message (Teams navigation can take 30–60 s)…",
  "validate-config": "Validating configuration…",
  "clear-alerts": "Clearing alerts…"
};

export function ActionsPage() {
  const loadTargets = useCallback(() => apiRequest<TargetRecord[]>("/api/targets"), []);
  const { data: targets } = useApiData(loadTargets);
  const [trigger, setTrigger] = useState<"new_pr" | "unread_message" | "manual">("new_pr");
  const [ignoreGuards, setIgnoreGuards] = useState(false);
  const [target, setTarget] = useState<string>("");
  const [text, setText] = useState<string>("RelayOps test message");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [busyKey, setBusyKey] = useState<BusyKey | null>(null);

  const selectedTarget = (targets ?? []).find((item) => item.name === target);
  const selectedTargetIsExample =
    /^example\b/i.test(selectedTarget?.label ?? "") || /example-placeholder/i.test(selectedTarget?.url ?? "");
  const isBusy = busyKey !== null;

  async function runAction<T>(key: BusyKey, loader: () => Promise<T>, success: string): Promise<void> {
    setFeedback(null);
    setError(null);
    setBusyKey(key);
    try {
      await loader();
      setFeedback(success);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader title="Manual Actions" description="Run common operations without leaving the local admin panel." />
      {busyKey ? (
        <div className="banner banner--pending" role="status" aria-live="polite">
          {BUSY_LABELS[busyKey]}
        </div>
      ) : null}
      {feedback ? <SuccessBanner message={feedback} /> : null}
      {error ? <ErrorBanner message={error} /> : null}
      <div className="card-grid">
        <Card title="Teams Session">
          <div className="button-row">
            <button
              className="button"
              disabled={isBusy}
              onClick={() =>
                void runAction("teams-open", () => apiRequest("/api/actions/teams/open", { method: "POST" }), "Teams session opened.")
              }
              type="button"
            >
              {busyKey === "teams-open" ? "Opening…" : "Open Teams Session"}
            </button>
            <button
              className="button button--secondary"
              disabled={isBusy}
              onClick={() =>
                void runAction(
                  "teams-validate",
                  () => apiRequest("/api/actions/teams/validate", { method: "POST", body: JSON.stringify({ waitForLogin: false }) }),
                  "Teams session validated."
                )
              }
              type="button"
            >
              {busyKey === "teams-validate" ? "Validating…" : "Validate Session"}
            </button>
          </div>
        </Card>
        <Card title="Run Trigger">
          <div className="form-grid">
            <label>
              <span>Trigger</span>
              <select
                value={trigger}
                disabled={isBusy}
                onChange={(event) => setTrigger(event.target.value as typeof trigger)}
              >
                <option value="manual">manual</option>
                <option value="new_pr">new_pr</option>
                <option value="unread_message">unread_message</option>
              </select>
            </label>
          </div>
          <p className="muted narrow-note">
            `new_pr` checks your configured pull-request source. `manual` only runs rules that explicitly use
            `trigger: manual`.
          </p>
          <label className="toggle">
            <input
              checked={ignoreGuards}
              disabled={isBusy}
              onChange={(event) => setIgnoreGuards(event.target.checked)}
              type="checkbox"
            />
            <span>Ignore cooldown and dedupe guards for this manual run</span>
          </label>
          <p className="muted narrow-note">
            Test mode only. This bypasses rule cooldowns, `not_processed`, and execution-key dedupe so you can replay
            existing events without clearing the whole database.
          </p>
          <button
            className="button"
            disabled={isBusy}
            onClick={() =>
              void runAction(
                "run-trigger",
                () =>
                  apiRequest("/api/actions/run-trigger", {
                    method: "POST",
                    body: JSON.stringify({ trigger, ignoreGuards })
                  }),
                ignoreGuards
                  ? `Trigger ${trigger} finished with guard overrides.`
                  : `Trigger ${trigger} finished.`
              )
            }
            type="button"
          >
            {busyKey === "run-trigger" ? "Running…" : "Run Trigger"}
          </button>
        </Card>
        <Card title="Test Teams Post">
          <p className="muted narrow-note">
            Waits for the real send to finish. Keep the automation browser window visible; the API call can take up to a minute.
          </p>
          <div className="form-grid">
            <label>
              <span>Target</span>
              <select value={target} disabled={isBusy} onChange={(event) => setTarget(event.target.value)}>
                <option value="">Select target</option>
                {(targets ?? []).map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.label ? `${item.name} (${item.label})` : item.name}
                  </option>
                ))}
              </select>
            </label>
            {selectedTargetIsExample ? (
              <ErrorBanner message="This target still uses the public example placeholder. Update the target label in the Targets page before sending a test post." />
            ) : null}
            <label>
              <span>Text</span>
              <textarea rows={5} value={text} disabled={isBusy} onChange={(event) => setText(event.target.value)} />
            </label>
          </div>
          <button
            className="button"
            disabled={!target || !text.trim() || selectedTargetIsExample || isBusy}
            onClick={() =>
              void runAction(
                "test-post",
                () =>
                  apiRequest("/api/actions/teams/test-post", {
                    method: "POST",
                    body: JSON.stringify({ target, text })
                  }),
                "Teams test post completed."
              )
            }
            type="button"
          >
            {busyKey === "test-post" ? "Sending…" : "Send Test Post"}
          </button>
        </Card>
        <Card title="Validation">
          <div className="button-row">
            <button
              className="button button--secondary"
              disabled={isBusy}
              onClick={() =>
                void runAction(
                  "validate-config",
                  async () => {
                    const result = await apiRequest<ValidationResult>("/api/validate/config", { method: "POST" });
                    setValidation(result);
                  },
                  "Configuration validated."
                )
              }
              type="button"
            >
              {busyKey === "validate-config" ? "Validating…" : "Validate Config"}
            </button>
            <button
              className="button"
              disabled={isBusy}
              onClick={() => void runAction("clear-alerts", () => apiRequest("/api/alerts/clear", { method: "POST" }), "Alerts cleared.")}
              type="button"
            >
              {busyKey === "clear-alerts" ? "Clearing…" : "Clear Alerts"}
            </button>
          </div>
          {validation ? (
            <div className="validation-summary">
              <p>{validation.valid ? "Configuration looks valid." : "Configuration issues were found."}</p>
              {validation.issues.map((issue) => (
                <div key={`${issue.field}-${issue.message}`} className="muted">
                  {issue.field}: {issue.message}
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
