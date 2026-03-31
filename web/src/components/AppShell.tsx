import type { ReactNode } from "react";

export interface NavItem {
  key: string;
  label: string;
}

interface AppShellProps {
  currentPage: string;
  items: NavItem[];
  onNavigate: (page: string) => void;
  children: ReactNode;
}

export function AppShell({ currentPage, items, onNavigate, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <div className="sidebar__title">RelayOps</div>
          <div className="sidebar__subtitle">Local Admin</div>
        </div>
        <nav className="sidebar__nav">
          {items.map((item) => (
            <button
              key={item.key}
              className={item.key === currentPage ? "nav-link nav-link--active" : "nav-link"}
              onClick={() => onNavigate(item.key)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
