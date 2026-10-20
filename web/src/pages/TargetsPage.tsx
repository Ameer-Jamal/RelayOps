import { useCallback, useEffect, useState } from "react";
import type { RulesConfigView, TargetRecord, TeamsDirectoryView, TeamsDirectoryEntry } from "@relayops/shared/adminApi";
import { DestinationPicker, destinationLabel } from "../components/DestinationPicker";
import { apiRequest } from "../api/client";
import { Card, ErrorBanner, LoadingState, PageHeader, SuccessBanner } from "../components/Common";
import { useApiData } from "../hooks/useApiData";

const EMPTY_TARGET: TargetRecord = {
  name: "",
  kind: "channel",
  label: "",
  url: ""
};

export function TargetsPage() {
  const loadTargets = useCallback(() => apiRequest<TargetRecord[]>("/api/targets"), []);
  const { data, loading, error, reload } = useApiData(loadTargets);
  const [targets, setTargets] = useState<TargetRecord[]>([]);
  const loadDirectory = useCallback(async () => {
    const cached = await apiRequest<TeamsDirectoryView>("/api/teams/directory");
    return cached.stale
      ? apiRequest<TeamsDirectoryView>("/api/teams/directory/refresh", { method: "POST" })
      : cached;
  }, []);
  const { data: directory, loading: discovering, error: directoryError, setData: setDirectory } = useApiData(loadDirectory);
  const [refreshing, setRefreshing] = useState(false);
  const isDiscovering = discovering || refreshing;
  const [selected, setSelected] = useState<TeamsDirectoryEntry | null>(null);
  const [revision, setRevision] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setTargets(data ?? []);
  }, [data]);

  async function save(): Promise<void> {
    setSaving(true);
    setSaveError(null);
    try {
      const sanitized = targets.filter((target) => target.name.trim());
      const result = await apiRequest<RulesConfigView>("/api/targets", {
        method: "PUT", body: JSON.stringify({ targets: sanitized })
      });
      setTargets(result.targets);
      setMessage("Aliases saved.");
      await reload();
    } catch (error) { setSaveError(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  }

  async function refreshDirectory() {
    setRefreshing(true);
    setSaveError(null);
    try {
      setDirectory(await apiRequest<TeamsDirectoryView>("/api/teams/directory/refresh", { method: "POST" }));
      setSelected(null);
      setRevision((value) => value + 1);
    } catch (error) { setSaveError(error instanceof Error ? error.message : String(error)); }
    finally { setRefreshing(false); }
  }

  async function copyId(id: string) {
    try { await navigator.clipboard.writeText(id); setCopiedId(id); }
    catch { setSaveError("Could not copy automatically. Select and copy the conversation ID below."); }
  }

  function update(index: number, patch: Partial<TargetRecord>) {
    setTargets((current) => current.map((target, targetIndex) => (targetIndex === index ? { ...target, ...patch } : target)));
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Targets"
        description="Find Teams chats, people, and channels automatically. Named aliases are optional."
        actions={
          <div className="button-row">
            <button className="button button--secondary" disabled={saving} onClick={() => setTargets((current) => [...current, { ...EMPTY_TARGET }])} type="button">
              Add Alias
            </button>
            <button className="button" disabled={saving} onClick={() => void save()} type="button">
              {saving ? "Saving…" : "Save Aliases"}
            </button>
          </div>
        }
      />
      {message ? <SuccessBanner message={message} /> : null}
      {error ? <ErrorBanner message={error} /> : null}
      {loading && !data ? <LoadingState /> : null}
      {saveError ? <ErrorBanner message={saveError} /> : null}
      <Card title="Your Teams Directory">
        <div className="directory-toolbar">
          <DestinationPicker value={selected} onChange={setSelected} disabled={isDiscovering} revision={revision} />
          <button className="button button--secondary" type="button" disabled={isDiscovering} onClick={() => void refreshDirectory()}>
            {isDiscovering ? "Discovering…" : "Refresh Directory"}
          </button>
        </div>
        <p className="muted" role="status" aria-live="polite">
          {isDiscovering ? "Checking Teams API access and discovering destinations. This may take a minute." : directory?.updatedAt
            ? `${directory.total} destinations · ${directory.accountEmail ?? "Signed-in Teams account"} · Updated ${new Date(directory.updatedAt).toLocaleString()}${directory.stale ? " · Cached data needs a refresh" : ""}`
            : "No directory cached yet. Refresh to test API access. Discovery sends no messages."}
        </p>
        {directoryError ? <ErrorBanner message={directoryError} /> : null}
        {directory?.api.state !== "ready" && directory?.api.message ? <ErrorBanner message={directory.api.message} /> : null}
        {directory?.api.state === "ready" ? <p className="muted">Teams API access verified. Chat and channel metadata is cached locally; message history is not cached.</p> : null}
        {directory?.warnings.map((warning) => <p className="muted" key={warning}>{warning}</p>)}
        {selected ? (
          <div className="directory-entry" aria-label="Selected destination">
            <div><strong>{destinationLabel(selected)}</strong><p className="muted">{selected.memberEmails.join(", ") || selected.kind}</p><code className="directory-id">{selected.id}</code></div>
            <div className="button-row">
              <a className="button button--secondary" href={selected.url} target="_blank" rel="noreferrer">Open in Teams</a>
              <button className="button button--ghost" type="button" onClick={() => void copyId(selected.id)}>{copiedId === selected.id ? "Copied" : "Copy ID"}</button>
            </div>
          </div>
        ) : <p className="muted">Open the picker to search by name, email, team, or ID. Results are filtered on the server and shown 30 at a time.</p>}
      </Card>
      <details className="card optional-aliases">
        <summary>Optional Named Aliases</summary>
        <p className="muted">
          Use aliases for recurring rules or familiar shortcuts. Paste a destination link from Teams when you need an explicit mapping; discovered destinations work without aliases.
        </p>
        <div className="editor-stack">
          {targets.map((target, index) => (
            <div className="editor-row" key={index}>
              <input placeholder="name" value={target.name} onChange={(event) => update(index, { name: event.target.value })} />
              <select value={target.kind ?? "channel"} onChange={(event) => update(index, { kind: event.target.value as TargetRecord["kind"] })}>
                <option value="channel">channel</option>
                <option value="chat">chat</option>
                <option value="unknown">unknown</option>
              </select>
              <input placeholder="label (preferred)" value={target.label ?? ""} onChange={(event) => update(index, { label: event.target.value })} />
              <input placeholder="url (optional deep link)" value={target.url ?? ""} onChange={(event) => update(index, { url: event.target.value })} />
              <button className="button button--ghost" onClick={() => setTargets((current) => current.filter((_, targetIndex) => targetIndex !== index))} type="button">
                Remove
              </button>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
