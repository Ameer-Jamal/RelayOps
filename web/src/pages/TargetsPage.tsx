import { useCallback, useEffect, useState } from "react";
import type { RulesConfigView, TargetRecord } from "@relayops/shared/adminApi";
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
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setTargets(data ?? []);
  }, [data]);

  async function save(): Promise<void> {
    const sanitized = targets.filter((target) => target.name.trim());
    const result = await apiRequest<RulesConfigView>("/api/targets", {
      method: "PUT",
      body: JSON.stringify({ targets: sanitized })
    });
    setTargets(result.targets);
    setMessage("Targets saved.");
    await reload();
  }

  function update(index: number, patch: Partial<TargetRecord>) {
    setTargets((current) => current.map((target, targetIndex) => (targetIndex === index ? { ...target, ...patch } : target)));
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Targets"
        description="Manage named Teams destinations and other messaging targets stored in the local rules file."
        actions={
          <div className="button-row">
            <button className="button button--secondary" onClick={() => setTargets((current) => [...current, { ...EMPTY_TARGET }])} type="button">
              Add Target
            </button>
            <button className="button" onClick={() => void save()} type="button">
              Save Targets
            </button>
          </div>
        }
      />
      {message ? <SuccessBanner message={message} /> : null}
      {error ? <ErrorBanner message={error} /> : null}
      {loading && !data ? <LoadingState /> : null}
      <Card title="Named Targets">
        <p className="muted">
          Prefer a stable Teams label. RelayOps now navigates by label first and uses the URL only as a fallback, since copied Teams SPA links can trigger the desktop-app launcher flow.
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
      </Card>
    </div>
  );
}
