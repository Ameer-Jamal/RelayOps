import { useCallback } from "react";
import type { DashboardStatus } from "@relayops/shared/adminApi";
import { apiRequest } from "../api/client";
import { Card, EmptyState, ErrorBanner, LoadingState, PageHeader, StatusPill } from "../components/Common";
import { useApiData } from "../hooks/useApiData";
import { formatDateTime } from "../utils";

export function DashboardPage() {
  const loadDashboard = useCallback(() => apiRequest<DashboardStatus>("/api/status"), []);
  const { data, loading, error, reload } = useApiData(loadDashboard);

  return (
    <div className="page-stack">
      <PageHeader
        title="Dashboard"
        description="Health, recent activity, and the current RelayOps runtime status."
        actions={
          <button className="button" onClick={() => void reload()} type="button">
            Refresh
          </button>
        }
      />
      {error ? <ErrorBanner message={error} /> : null}
      {loading && !data ? <LoadingState /> : null}
      {data ? (
        <>
          <div className="card-grid card-grid--stats">
            <Card title="Runtime">
              <StatusPill tone={data.relayOpsRunning ? "good" : "bad"}>
                {data.relayOpsRunning ? "Running" : "Stopped"}
              </StatusPill>
              <dl className="details-list">
                <div><dt>Server</dt><dd>{data.serverHost}:{data.serverPort}</dd></div>
                <div><dt>Database</dt><dd>{data.databaseReachable ? "Connected" : "Unavailable"}</dd></div>
                <div><dt>Rules</dt><dd>{data.rulesCount}</dd></div>
                <div><dt>Targets</dt><dd>{data.targetsCount}</dd></div>
              </dl>
            </Card>
            <Card title="Teams">
              <StatusPill
                tone={
                  data.teams.sessionStatus === "ready"
                    ? "good"
                    : data.teams.sessionStatus === "logged_out"
                      ? "warn"
                      : "neutral"
                }
              >
                {data.teams.sessionStatus}
              </StatusPill>
              <dl className="details-list">
                <div><dt>Configured</dt><dd>{data.teams.configured ? "Yes" : "No"}</dd></div>
                <div><dt>Base URL</dt><dd>{data.teams.baseUrl}</dd></div>
                <div><dt>Profile</dt><dd>{data.browserProfileConfigured ? "Configured" : "Missing"}</dd></div>
              </dl>
            </Card>
            <Card title="Alerts">
              <div className="metric">{data.activeAlertsCount}</div>
              <p className="muted">Active alerts</p>
              <dl className="details-list">
                <div><dt>Acknowledged</dt><dd>{data.acknowledgedAlertsCount}</dd></div>
                <div><dt>Rules File</dt><dd>{data.rulesFilePath}</dd></div>
                <div><dt>Database Path</dt><dd>{data.databasePath}</dd></div>
              </dl>
            </Card>
          </div>

          <div className="card-grid">
            <Card title="Last Runs">
              {data.lastRuns.length === 0 ? (
                <EmptyState message="No executions recorded yet." />
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Trigger</th>
                      <th>Last Success</th>
                      <th>Last Failure</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lastRuns.map((item) => (
                      <tr key={item.trigger}>
                        <td>{item.trigger}</td>
                        <td>{formatDateTime(item.lastExecutedAt)}</td>
                        <td>{formatDateTime(item.lastFailedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <Card title="Recent Activity">
              {data.recentActivity.length === 0 ? (
                <EmptyState message="No recent activity." />
              ) : (
                <ul className="list">
                  {data.recentActivity.map((entry) => (
                    <li key={`${entry.ts}-${entry.message}`}>
                      <div className="list__row">
                        <strong>{entry.message}</strong>
                        <span className="muted">{entry.level}</span>
                      </div>
                      <div className="list__row">
                        <span className="muted">{formatDateTime(entry.ts)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card title="Last Warning Or Error">
            {data.lastError ? (
              <div>
                <div className="list__row">
                  <strong>{data.lastError.message}</strong>
                  <StatusPill tone={data.lastError.level === "error" ? "bad" : "warn"}>
                    {data.lastError.level}
                  </StatusPill>
                </div>
                <p className="muted">{formatDateTime(data.lastError.ts)}</p>
                {data.lastError.metadata ? (
                  <pre className="code-block">{JSON.stringify(data.lastError.metadata, null, 2)}</pre>
                ) : null}
              </div>
            ) : (
              <EmptyState message="No recent warnings or errors." />
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
