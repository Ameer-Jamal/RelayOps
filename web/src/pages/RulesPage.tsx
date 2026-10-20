import { useCallback, useEffect, useRef, useState } from "react";
import type { RuleRecord, RulesConfigView, TargetRecord, TeamsDirectoryEntry } from "@relayops/shared/adminApi";
import { DestinationPicker, destinationLabel } from "../components/DestinationPicker";
import { apiRequest } from "../api/client";
import { Card, ErrorBanner, LoadingState, PageHeader, SuccessBanner } from "../components/Common";
import { useApiData } from "../hooks/useApiData";

const EMPTY_RULE: RuleRecord = {
  id: "",
  enabled: true,
  trigger: "manual",
  cooldownMinutes: 0,
  dedupeKey: "",
  actions: [{ type: "clear_alerts" }]
};

export function RulesPage({ initialDestination = null }: { initialDestination?: TeamsDirectoryEntry | null }) {
  const loadRules = useCallback(() => apiRequest<RulesConfigView>("/api/rules-config"), []);
  const { data, loading, error, reload } = useApiData(loadRules);
  const [rules, setRules] = useState<RuleRecord[]>([]);
  const [targets, setTargets] = useState<TargetRecord[]>([]);
  const [destinations, setDestinations] = useState<Record<string, TeamsDirectoryEntry>>(
    initialDestination ? { [initialDestination.id]: initialDestination } : {}
  );
  const [message, setMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const draftAdded = useRef(false);

  useEffect(() => {
    if (!data) {
      return;
    }

    if (initialDestination && !draftAdded.current) {
      draftAdded.current = true;
      let id = "message-draft";
      let suffix = 1;
      while (data.rules.some(rule => rule.id === id)) id = `message-draft-${suffix++}`;
      setRules([...data.rules, { ...EMPTY_RULE, id, enabled: false,
        actions: [{ type: "post_message", target: initialDestination.id, template: "" }] }]);
      setMessage(`Unsaved rule draft for ${destinationLabel(initialDestination)}. Choose a trigger and message, then save. Enable it when ready.`);
    } else setRules(data.rules);
    setTargets(data.targets);
  }, [data, initialDestination]);

  async function save(): Promise<void> {
    setSaving(true);
    setSaveError(null);
    try {
    const result = await apiRequest<RulesConfigView>("/api/rules", {
      method: "PUT",
      body: JSON.stringify({ rules })
    });
    setRules(result.rules);
    setMessage("Rules saved.");
    await reload();
    } catch (error) { setSaveError(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  }

  function updateRule(index: number, patch: Partial<RuleRecord>) {
    setRules((current) => current.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, ...patch } : rule)));
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Rules"
        description="Edit common RelayOps workflows through a structured local editor backed by the rules file."
        actions={
          <div className="button-row">
            <button className="button button--secondary" onClick={() => setRules((current) => [...current, { ...EMPTY_RULE, id: `rule-${current.length + 1}` }])} type="button">
              Add Rule
            </button>
            <button className="button" disabled={saving || loading} onClick={() => void save()} type="button">
              {saving ? "Saving…" : "Save Rules"}
            </button>
          </div>
        }
      />
      {message ? <SuccessBanner message={message} /> : null}
      {error ? <ErrorBanner message={error} /> : null}
      {saveError ? <ErrorBanner message={saveError} /> : null}
      {loading && !data ? <LoadingState /> : null}
      <div className="editor-stack">
        {rules.map((rule, index) => (
          <Card key={`${rule.id}-${index}`} title={rule.id || `Rule ${index + 1}`}>
            <div className="form-grid">
              <label>
                <span>Rule ID</span>
                <input value={rule.id} onChange={(event) => updateRule(index, { id: event.target.value })} />
              </label>
              <label>
                <span>Trigger</span>
                <select value={rule.trigger} onChange={(event) => updateRule(index, { trigger: event.target.value as RuleRecord["trigger"] })}>
                  <option value="new_pr">new_pr</option>
                  <option value="unread_message">unread_message</option>
                  <option value="manual">manual</option>
                </select>
              </label>
              <label>
                <span>Dedupe Key</span>
                <input value={rule.dedupeKey ?? ""} onChange={(event) => updateRule(index, { dedupeKey: event.target.value })} />
              </label>
              <label>
                <span>Cooldown Minutes</span>
                <input
                  type="number"
                  value={rule.cooldownMinutes ?? 0}
                  onChange={(event) => updateRule(index, { cooldownMinutes: Number(event.target.value) })}
                />
              </label>
              <label className="toggle">
                <input
                  checked={rule.enabled !== false}
                  onChange={(event) => updateRule(index, { enabled: event.target.checked })}
                  type="checkbox"
                />
                <span>Enabled</span>
              </label>
            </div>

            <div className="subsection">
              <h3>Condition</h3>
              <div className="form-grid">
                <label>
                  <span>Condition Type</span>
                  <select
                    value={rule.condition?.type ?? "always"}
                    onChange={(event) =>
                      updateRule(index, {
                        condition: {
                          type: event.target.value as NonNullable<RuleRecord["condition"]>["type"]
                        }
                      })
                    }
                  >
                    <option value="always">always</option>
                    <option value="not_processed">not_processed</option>
                    <option value="older_than_minutes">older_than_minutes</option>
                    <option value="cooldown_elapsed">cooldown_elapsed</option>
                  </select>
                </label>
                <label>
                  <span>Condition Minutes</span>
                  <input
                    type="number"
                    value={rule.condition?.minutes ?? 0}
                    onChange={(event) =>
                      updateRule(index, {
                        condition: {
                          ...(rule.condition ?? { type: "older_than_minutes" }),
                          minutes: Number(event.target.value)
                        }
                      })
                    }
                  />
                </label>
                <label>
                  <span>Condition Key</span>
                  <input
                    value={rule.condition?.key ?? ""}
                    onChange={(event) =>
                      updateRule(index, {
                        condition: {
                          ...(rule.condition ?? { type: "cooldown_elapsed" }),
                          key: event.target.value
                        }
                      })
                    }
                  />
                </label>
              </div>
            </div>

            <div className="subsection">
              <h3>Primary Action</h3>
              <div className="form-grid">
                <label>
                  <span>Action Type</span>
                  <select
                    value={rule.actions?.[0]?.type ?? "clear_alerts"}
                    onChange={(event) =>
                      updateRule(index, {
                        actions: [
                          {
                            ...(rule.actions?.[0] ?? {}),
                            type: event.target.value as NonNullable<RuleRecord["actions"]>[number]["type"]
                          }
                        ]
                      })
                    }
                  >
                    <option value="post_message">post_message</option>
                    <option value="alert">alert</option>
                    <option value="clear_alerts">clear_alerts</option>
                  </select>
                </label>
                <label>
                  <span>Target</span>
                  <select
                    value={rule.actions?.[0]?.target ?? ""}
                    onChange={(event) =>
                      updateRule(index, {
                        actions: [
                          {
                            ...(rule.actions?.[0] ?? { type: "post_message" }),
                            target: event.target.value
                          }
                        ]
                      })
                    }
                  >
                    <option value="">None</option>
                    {rule.actions?.[0]?.target && !targets.some(target => target.name === rule.actions?.[0]?.target) ?
                      <option value={rule.actions[0].target}>{destinations[rule.actions[0].target] ? destinationLabel(destinations[rule.actions[0].target]) : rule.actions[0].target} (exact destination)</option> : null}
                    {targets.map((target) => (
                      <option key={target.name} value={target.name}>
                        {target.name}
                      </option>
                    ))}
                  </select>
                </label>
                {rule.actions?.[0]?.type === "post_message" ? <DestinationPicker
                  value={destinations[rule.actions[0].target ?? ""] ?? null}
                  onChange={(entry) => {
                    setDestinations(current => ({ ...current, [entry.id]: entry }));
                    updateRule(index, { actions: [{ ...(rule.actions?.[0] ?? { type: "post_message" }), target: entry.id }] });
                  }}
                /> : null}
                <label>
                  <span>Severity</span>
                  <select
                    value={rule.actions?.[0]?.severity ?? "info"}
                    onChange={(event) =>
                      updateRule(index, {
                        actions: [
                          {
                            ...(rule.actions?.[0] ?? { type: "alert" }),
                            severity: event.target.value as NonNullable<RuleRecord["actions"]>[number]["severity"]
                          }
                        ]
                      })
                    }
                  >
                    <option value="info">info</option>
                    <option value="warning">warning</option>
                    <option value="error">error</option>
                  </select>
                </label>
              </div>
              <label>
                <span>Template / Message</span>
                <textarea
                  rows={6}
                  value={rule.actions?.[0]?.template ?? rule.actions?.[0]?.message ?? ""}
                  onChange={(event) =>
                    updateRule(index, {
                      actions: [
                        {
                          ...(rule.actions?.[0] ?? { type: "post_message" }),
                          template: event.target.value,
                          message: event.target.value
                        }
                      ]
                    })
                  }
                />
              </label>
            </div>

            <div className="button-row">
              <button className="button button--ghost" onClick={() => setRules((current) => current.filter((_, ruleIndex) => ruleIndex !== index))} type="button">
                Remove Rule
              </button>
            </div>
          </Card>
        ))}
      </div>
      {data ? (
        <Card title="Current YAML">
          <pre className="code-block">{data.rawYaml}</pre>
        </Card>
      ) : null}
    </div>
  );
}
