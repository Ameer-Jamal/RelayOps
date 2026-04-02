import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from "react";
import type { SetupConfigUpdateInput, SetupConfigView, ValidationResult } from "@relayops/shared/adminApi";

function setupConfigFingerprint(data: SetupConfigView): string {
  return JSON.stringify({
    rulesFilePath: data.rulesFilePath,
    browserProfileDir: data.browserProfileDir,
    browserHeadless: data.browserHeadless,
    captureScreenshots: data.captureScreenshots,
    teamsBaseUrl: data.teamsBaseUrl,
    databasePath: data.databasePath,
    newPrIntervalMs: data.newPrIntervalMs,
    unreadMessageIntervalMs: data.unreadMessageIntervalMs,
    validateSessionOnStartup: data.validateSessionOnStartup,
    waitForLoginOnStartup: data.waitForLoginOnStartup,
    alertsEnabled: data.alertsEnabled,
    alertSoundEnabled: data.alertSoundEnabled,
    bitbucketWorkspace: data.bitbucketWorkspace,
    bitbucketUsername: data.bitbucketUsername,
    bitbucketRepositories: data.bitbucketRepositories,
    bitbucketAuthorUuid: data.bitbucketAuthorUuid,
    bitbucketAppPasswordSet: data.bitbucketAppPasswordSet,
    logLevel: data.logLevel
  });
}
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
  const [showBitbucketAppPassword, setShowBitbucketAppPassword] = useState(false);
  const lastSetupFingerprintRef = useRef<string | null>(null);

  useEffect(() => {
    if (!data) {
      return;
    }

    const fingerprint = setupConfigFingerprint(data);
    if (lastSetupFingerprintRef.current === fingerprint) {
      return;
    }

    lastSetupFingerprintRef.current = fingerprint;

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
      bitbucketWorkspace: data.bitbucketWorkspace,
      bitbucketUsername: data.bitbucketUsername,
      bitbucketRepositories: data.bitbucketRepositories,
      bitbucketAuthorUuid: data.bitbucketAuthorUuid,
      bitbucketAppPassword: "",
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

  function pasteIntoBitbucketAppPassword(event: ClipboardEvent<HTMLInputElement>): void {
    const el = event.currentTarget;
    event.preventDefault();
    event.stopPropagation();

    const start = typeof el.selectionStart === "number" ? el.selectionStart : 0;
    const end = typeof el.selectionEnd === "number" ? el.selectionEnd : start;

    const applyPasted = (pasted: string): void => {
      if (!pasted) {
        return;
      }
      setForm((current) => {
        if (!current) {
          return current;
        }
        const cur = current.bitbucketAppPassword ?? "";
        return { ...current, bitbucketAppPassword: cur.slice(0, start) + pasted + cur.slice(end) };
      });
      const caret = start + pasted.length;
      requestAnimationFrame(() => {
        try {
          el.setSelectionRange(caret, caret);
        } catch {
          /* ignore: some browsers block selection on password inputs */
        }
      });
    };

    const sync =
      event.clipboardData?.getData("text/plain") ?? event.clipboardData?.getData("text") ?? "";

    void (async () => {
      let text = sync;
      try {
        if (navigator.clipboard?.readText) {
          const clip = await navigator.clipboard.readText();
          if (clip.length > text.length) {
            text = clip;
          }
        }
      } catch {
        /* e.g. permission denied — use sync payload only */
      }
      applyPasted(text);
    })();
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
          <Card title="Bitbucket Pull Requests">
            <div className="form-grid">
              <label>
                <span>Workspace</span>
                <input
                  placeholder="etqdev"
                  value={form.bitbucketWorkspace}
                  onChange={(event) => update("bitbucketWorkspace", event.target.value)}
                />
              </label>
              <label>
                <span>Username</span>
                <input
                  placeholder="your-bitbucket-username"
                  value={form.bitbucketUsername}
                  onChange={(event) => update("bitbucketUsername", event.target.value)}
                />
              </label>
              <label>
                <span>App Password</span>
                <input
                  type={showBitbucketAppPassword ? "text" : "password"}
                  name="bitbucket-app-password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={data?.bitbucketAppPasswordSet ? "Saved locally. Enter to replace." : "Required to enable Bitbucket sync"}
                  value={form.bitbucketAppPassword ?? ""}
                  onChange={(event) => update("bitbucketAppPassword", event.target.value)}
                  onPaste={pasteIntoBitbucketAppPassword}
                />
              </label>
              <label className="toggle-inline">
                <input
                  checked={showBitbucketAppPassword}
                  onChange={(event) => setShowBitbucketAppPassword(event.target.checked)}
                  type="checkbox"
                />
                <span>Show app password (use when paste only inserts one character — common with masked fields on macOS)</span>
              </label>
              <label>
                <span>Repositories</span>
                <input
                  placeholder="Optional: repo-one, repo-two"
                  value={form.bitbucketRepositories}
                  onChange={(event) => update("bitbucketRepositories", event.target.value)}
                />
              </label>
              <label>
                <span>Author UUID</span>
                <input
                  placeholder="712020:..."
                  value={form.bitbucketAuthorUuid}
                  onChange={(event) => update("bitbucketAuthorUuid", event.target.value)}
                />
              </label>
            </div>
            <div className="muted">
              RelayOps uses the Bitbucket Cloud REST API, not the web pull-request page. Leave Repositories blank to
              scan every repository in the workspace, or enter a comma-separated list to narrow the scan if your
              workspace is large. The <code>author</code> query value from the Bitbucket web UI can be pasted into
              Author UUID to filter to only your PRs.
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
