import { useCallback, useMemo, useState } from "react";
import type { AdminAlertRecord } from "@relayops/shared/adminApi";
import { apiRequest } from "../api/client";
import { Card, EmptyState, ErrorBanner, LoadingState, PageHeader, StatusPill, SuccessBanner } from "../components/Common";
import { useApiData } from "../hooks/useApiData";
import { formatDateTime } from "../utils";

export function AlertsPage() {
  const [message, setMessage] = useState<string | null>(null);
  const loadAlerts = useCallback(() => apiRequest<AdminAlertRecord[]>("/api/alerts"), []);
  const { data, loading, error, reload } = useApiData(loadAlerts);

  const grouped = useMemo(() => {
    const alerts = data ?? [];
    return {
      active: alerts.filter((alert) => alert.status === "active"),
      acknowledged: alerts.filter((alert) => alert.status === "acknowledged"),
      cleared: alerts.filter((alert) => alert.status === "cleared")
    };
  }, [data]);

  async function ack(key: string): Promise<void> {
    await apiRequest<{ acknowledged: boolean }>(`/api/alerts/${encodeURIComponent(key)}/ack`, {
      method: "POST",
      body: JSON.stringify({})
    });
    setMessage("Alert acknowledged.");
    await reload();
  }

  async function ackAll(): Promise<void> {
    await apiRequest<{ acknowledged: number }>("/api/alerts/ack-all", {
      method: "POST",
      body: JSON.stringify({})
    });
    setMessage("Active alerts acknowledged.");
    await reload();
  }

  async function clearAll(): Promise<void> {
    await apiRequest<{ cleared: number }>("/api/alerts/clear", {
      method: "POST"
    });
    setMessage("Alerts cleared.");
    await reload();
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Alerts"
        description="Acknowledge or clear active RelayOps alerts and inspect recent alert history."
        actions={
          <div className="button-row">
            <button className="button button--secondary" onClick={() => void ackAll()} type="button">
              Acknowledge All
            </button>
            <button className="button" onClick={() => void clearAll()} type="button">
              Clear All
            </button>
          </div>
        }
      />
      {message ? <SuccessBanner message={message} /> : null}
      {error ? <ErrorBanner message={error} /> : null}
      {loading && !data ? <LoadingState /> : null}
      {data ? (
        <div className="card-grid">
          <AlertSection title="Active Alerts" alerts={grouped.active} onAcknowledge={ack} />
          <AlertSection title="Acknowledged Alerts" alerts={grouped.acknowledged} onAcknowledge={ack} />
          <AlertSection title="Alert History" alerts={grouped.cleared} onAcknowledge={ack} />
        </div>
      ) : null}
    </div>
  );
}

function AlertSection(props: {
  title: string;
  alerts: AdminAlertRecord[];
  onAcknowledge: (key: string) => Promise<void>;
}) {
  return (
    <Card title={props.title}>
      {props.alerts.length === 0 ? (
        <EmptyState message="No alerts in this group." />
      ) : (
        <ul className="list">
          {props.alerts.map((alert) => (
            <li key={alert.dedupeKey}>
              <div className="list__row">
                <strong>{alert.title ?? alert.dedupeKey}</strong>
                <StatusPill tone={alert.severity === "error" ? "bad" : alert.severity === "warning" ? "warn" : "neutral"}>
                  {alert.severity}
                </StatusPill>
              </div>
              <p>{alert.message}</p>
              <div className="list__row">
                <span className="muted">Triggered {formatDateTime(alert.lastTriggeredAt)}</span>
                {alert.status === "active" ? (
                  <button className="button button--secondary" onClick={() => void props.onAcknowledge(alert.dedupeKey)} type="button">
                    Acknowledge
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
