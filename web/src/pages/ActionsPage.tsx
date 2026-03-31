import { useCallback, useState } from "react";
import type { TargetRecord, ValidationResult } from "@relayops/shared/adminApi";
import { apiRequest } from "../api/client";
import { Card, ErrorBanner, PageHeader, SuccessBanner } from "../components/Common";
import { useApiData } from "../hooks/useApiData";

export function ActionsPage() {
  const loadTargets = useCallback(() => apiRequest<TargetRecord[]>("/api/targets"), []);
  const { data: targets } = useApiData(loadTargets);
  const [trigger, setTrigger] = useState<"new_pr" | "unread_message" | "manual">("manual");
  const [target, setTarget] = useState<string>("");
  const [text, setText] = useState<string>("RelayOps test message");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const selectedTarget = (targets ?? []).find((item) => item.name === target);
  const selectedTargetIsExample =
    /^example\b/i.test(selectedTarget?.label ?? "") || /example-placeholder/i.test(selectedTarget?.url ?? "");

  async function runAction<T>(loader: () => Promise<T>, success: string): Promise<void> {
    setFeedback(null);
    setError(null);
    try {
      await loader();
      setFeedback(success);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <div className="page-stack">
      <PageHeader title="Manual Actions" description="Run common operations without leaving the local admin panel." />
      {feedback ? <SuccessBanner message={feedback} /> : null}
      {error ? <ErrorBanner message={error} /> : null}
      <div className="card-grid">
        <Card title="Teams Session">
          <div className="button-row">
            <button
              className="button"
              onClick={() => void runAction(() => apiRequest("/api/actions/teams/open", { method: "POST" }), "Teams session opened.")}
              type="button"
            >
              Open Teams Session
            </button>
            <button
              className="button button--secondary"
              onClick={() =>
                void runAction(
                  () => apiRequest("/api/actions/teams/validate", { method: "POST", body: JSON.stringify({ waitForLogin: false }) }),
                  "Teams session validated."
                )
              }
              type="button"
            >
              Validate Session
            </button>
          </div>
        </Card>
        <Card title="Run Trigger">
          <div className="form-grid">
            <label>
              <span>Trigger</span>
              <select value={trigger} onChange={(event) => setTrigger(event.target.value as typeof trigger)}>
                <option value="manual">manual</option>
                <option value="new_pr">new_pr</option>
                <option value="unread_message">unread_message</option>
              </select>
            </label>
          </div>
          <button
            className="button"
            onClick={() =>
              void runAction(
                () => apiRequest("/api/actions/run-trigger", { method: "POST", body: JSON.stringify({ trigger }) }),
                `Trigger ${trigger} executed.`
              )
            }
            type="button"
          >
            Run Trigger
          </button>
        </Card>
        <Card title="Test Teams Post">
          <div className="form-grid">
            <label>
              <span>Target</span>
              <select value={target} onChange={(event) => setTarget(event.target.value)}>
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
              <textarea rows={5} value={text} onChange={(event) => setText(event.target.value)} />
            </label>
          </div>
          <button
            className="button"
            disabled={!target || !text.trim() || selectedTargetIsExample}
            onClick={() =>
              void runAction(
                () =>
                  apiRequest("/api/actions/teams/test-post", {
                    method: "POST",
                    body: JSON.stringify({ target, text })
                  }),
                "Teams test post requested."
              )
            }
            type="button"
          >
            Send Test Post
          </button>
        </Card>
        <Card title="Validation">
          <div className="button-row">
            <button
              className="button button--secondary"
              onClick={() =>
                void runAction(async () => {
                  const result = await apiRequest<ValidationResult>("/api/validate/config", { method: "POST" });
                  setValidation(result);
                }, "Configuration validated.")
              }
              type="button"
            >
              Validate Config
            </button>
            <button
              className="button"
              onClick={() => void runAction(() => apiRequest("/api/alerts/clear", { method: "POST" }), "Alerts cleared.")}
              type="button"
            >
              Clear Alerts
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
