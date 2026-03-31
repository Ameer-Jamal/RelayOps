import type { ReactNode } from "react";

export function PageHeader(props: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{props.title}</h1>
        <p>{props.description}</p>
      </div>
      {props.actions ? <div className="page-header__actions">{props.actions}</div> : null}
    </div>
  );
}

export function Card(props: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`card${props.className ? ` ${props.className}` : ""}`}>
      {props.title ? <h2>{props.title}</h2> : null}
      {props.children}
    </section>
  );
}

export function ErrorBanner(props: { message: string }) {
  return <div className="banner banner--error">{props.message}</div>;
}

export function SuccessBanner(props: { message: string }) {
  return <div className="banner banner--success">{props.message}</div>;
}

export function LoadingState() {
  return <div className="empty-state">Loading…</div>;
}

export function EmptyState(props: { message: string }) {
  return <div className="empty-state">{props.message}</div>;
}

export function StatusPill(props: { tone: "good" | "warn" | "bad" | "neutral"; children: ReactNode }) {
  return <span className={`status-pill status-pill--${props.tone}`}>{props.children}</span>;
}
