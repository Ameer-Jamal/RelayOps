import { useCallback, useEffect, useState } from "react";
import type { SetupConfigUpdateInput, SetupConfigView, ValidationResult } from "@relayops/shared/adminApi";
import { apiRequest } from "../api/client";
import { Card, ErrorBanner, LoadingState, PageHeader, SuccessBanner } from "../components/Common";
import { useApiData } from "../hooks/useApiData";

export function SetupPage() {
  const loadConfig = useCallback(() => apiRequest<SetupConfigView>("/api/config"), []);
  const { data, loading, error, reload } = useApiData(loadConfig);
  const [form, setForm] = useState<SetupConfigUpdateInput | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) {
      return;
    }

    setForm({
      browserProfileDir: data.browserProfileDir,
      browserHeadless: data.browserHeadless,
      captureScreenshots: data.captureScreenshots,
      teamsBaseUrl: data.teamsBaseUrl,
      rulesFilePath: data.rulesFilePath,
      databasePath: data.databasePath,
      newPrIntervalMs: data.newPrIntervalMs,
      unreadMessageIntervalMs: data.unreadMessageIntervalMs,
      validateSessionOnStartup: data.validateSessionOnStartup,
      waitForLoginOnStartup: data.waitForLoginOnStartup,
      alertsEnabled: data.alertsEnabled,
      alertSoundEnabled: data.alertSoundEnabled,
      logLevel: data.logLevel
    });
  }, [data]);

  async function save(): Promise<void> {
    if (!form) {
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const result = await apiRequest<{ config: SetupConfigView; requiresRestart: boolean }>("/api/config", {
        method: "PUT",
        body: JSON.stringify(form)
      });
      setMessage(result.requiresRestart ? "Saved. Restart RelayOps to apply all changes." : "Saved.");
      await reload();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  async function validate(): Promise<void> {
    const result = await apiRequest<ValidationResult>("/api/validate/config", {
      method: "POST"
    });
    setValidation(result);
  }

  function update<K extends keyof SetupConfigUpdateInput>(key: K, value: SetupConfigUpdateInput[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Setup"
        description="Edit the local RelayOps configuration. The backend persists these changes to local config files."
        actions={
          <div className="button-row">
            <button className="button button--secondary" onClick={() => void validate()} type="button">
              Validate
            </button>
            <button className="button" disabled={!form || saving} onClick={() => void save()} type="button">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        }
      />
      {error ? <ErrorBanner message={error} /> : null}
      {message ? <SuccessBanner message={message} /> : null}
      {loading && !form ? <LoadingState /> : null}
      {form ? (
        <>
          <Card title="Paths">
            <div className="form-grid">
              <label>
                <span>Browser Profile Path</span>
                <input value={form.browserProfileDir} onChange={(event) => update("browserProfileDir", event.target.value)} />
              </label>
              <label>
                <span>Rules File Path</span>
                <input value={form.rulesFilePath} onChange={(event) => update("rulesFilePath", event.target.value)} />
              </label>
              <label>
                <span>Database Path</span>
                <input value={form.databasePath} onChange={(event) => update("databasePath", event.target.value)} />
              </label>
              <label>
                <span>Teams Base URL</span>
                <input value={form.teamsBaseUrl} onChange={(event) => update("teamsBaseUrl", event.target.value)} />
              </label>
            </div>
          </Card>
          <Card title="Runtime">
            <div className="form-grid">
              <label>
                <span>New PR Poll Interval (ms)</span>
                <input
                  type="number"
                  value={form.newPrIntervalMs}
                  onChange={(event) => update("newPrIntervalMs", Number(event.target.value))}
                />
              </label>
              <label>
                <span>Unread Message Poll Interval (ms)</span>
                <input
                  type="number"
                  value={form.unreadMessageIntervalMs}
                  onChange={(event) => update("unreadMessageIntervalMs", Number(event.target.value))}
                />
              </label>
              <label>
                <span>Log Level</span>
                <select value={form.logLevel} onChange={(event) => update("logLevel", event.target.value as SetupConfigUpdateInput["logLevel"])}>
                  <option value="debug">debug</option>
                  <option value="info">info</option>
                  <option value="warn">warn</option>
                  <option value="error">error</option>
                </select>
              </label>
            </div>
            <div className="toggle-grid">
              <Toggle label="Headless Browser" checked={form.browserHeadless} onChange={(value) => update("browserHeadless", value)} />
              <Toggle label="Capture Screenshots" checked={form.captureScreenshots} onChange={(value) => update("captureScreenshots", value)} />
              <Toggle label="Validate Session On Startup" checked={form.validateSessionOnStartup} onChange={(value) => update("validateSessionOnStartup", value)} />
              <Toggle label="Wait For Login On Startup" checked={form.waitForLoginOnStartup} onChange={(value) => update("waitForLoginOnStartup", value)} />
              <Toggle label="Alerts Enabled" checked={form.alertsEnabled} onChange={(value) => update("alertsEnabled", value)} />
              <Toggle label="Alert Sound Enabled" checked={form.alertSoundEnabled} onChange={(value) => update("alertSoundEnabled", value)} />
            </div>
          </Card>
          {validation ? (
            <Card title="Validation Result">
              <p>{validation.valid ? "Configuration is valid." : "Validation found issues."}</p>
              {validation.issues.length > 0 ? (
                <ul className="list">
                  {validation.issues.map((issue) => (
                    <li key={`${issue.field}-${issue.message}`}>
                      <strong>{issue.field}</strong>
                      <div className="muted">{issue.message}</div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Toggle(props: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="toggle">
      <input checked={props.checked} onChange={(event) => props.onChange(event.target.checked)} type="checkbox" />
      <span>{props.label}</span>
    </label>
  );
}
