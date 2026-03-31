import { useCallback } from "react";
import type { AdminLogEntry, AdminRuleExecutionRecord } from "@relayops/shared/adminApi";
import { apiRequest } from "../api/client";
import { Card, EmptyState, ErrorBanner, LoadingState, PageHeader, StatusPill } from "../components/Common";
import { useApiData } from "../hooks/useApiData";
import { formatDateTime } from "../utils";

export function LogsPage() {
  const loadLogs = useCallback(() => apiRequest<AdminLogEntry[]>("/api/logs"), []);
  const loadExecutions = useCallback(() => apiRequest<AdminRuleExecutionRecord[]>("/api/executions"), []);
  const logsState = useApiData(loadLogs);
  const executionState = useApiData(loadExecutions);

  return (
    <div className="page-stack">
      <PageHeader
        title="Logs"
        description="Recent adapter actions, warnings, failures, and rule execution history."
        actions={
          <button
            className="button"
            onClick={() => {
              void logsState.reload();
              void executionState.reload();
            }}
            type="button"
          >
            Refresh
          </button>
        }
      />
      {logsState.error ? <ErrorBanner message={logsState.error} /> : null}
      {executionState.error ? <ErrorBanner message={executionState.error} /> : null}
      {logsState.loading && !logsState.data ? <LoadingState /> : null}
      <div className="card-grid">
        <Card title="Runtime Logs">
          {!logsState.data ? (
            <LoadingState />
          ) : logsState.data.length === 0 ? (
            <EmptyState message="No logs yet." />
          ) : (
            <ul className="list">
              {logsState.data.map((entry) => (
                <li key={`${entry.ts}-${entry.message}`}>
                  <div className="list__row">
                    <strong>{entry.message}</strong>
                    <StatusPill tone={entry.level === "error" ? "bad" : entry.level === "warn" ? "warn" : "neutral"}>
                      {entry.level}
                    </StatusPill>
                  </div>
                  <div className="muted">{formatDateTime(entry.ts)}</div>
                  {entry.metadata ? <pre className="code-block">{JSON.stringify(entry.metadata, null, 2)}</pre> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Rule Executions">
          {!executionState.data ? (
            <LoadingState />
          ) : executionState.data.length === 0 ? (
            <EmptyState message="No rule executions yet." />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>Trigger</th>
                  <th>Status</th>
                  <th>Completed</th>
                </tr>
              </thead>
              <tbody>
                {executionState.data.map((entry) => (
                  <tr key={`${entry.executionKey}-${entry.completedAt}`}>
                    <td>{entry.ruleId}</td>
                    <td>{entry.trigger}</td>
                    <td>{entry.status}</td>
                    <td>{formatDateTime(entry.completedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
