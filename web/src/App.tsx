import { useEffect, useMemo, useState } from "react";
import { AppShell, type NavItem } from "./components/AppShell";
import { DashboardPage } from "./pages/DashboardPage";
import { SetupPage } from "./pages/SetupPage";
import { AlertsPage } from "./pages/AlertsPage";
import { ActionsPage } from "./pages/ActionsPage";
import { LogsPage } from "./pages/LogsPage";
import { TargetsPage } from "./pages/TargetsPage";
import { RulesPage } from "./pages/RulesPage";

const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "setup", label: "Setup" },
  { key: "alerts", label: "Alerts" },
  { key: "actions", label: "Manual Actions" },
  { key: "logs", label: "Logs" },
  { key: "targets", label: "Targets" },
  { key: "rules", label: "Rules" }
];

function getPageFromHash(): string {
  const hash = window.location.hash.replace("#", "");
  return NAV_ITEMS.some((item) => item.key === hash) ? hash : "dashboard";
}

export function App() {
  const [page, setPage] = useState<string>(getPageFromHash());

  useEffect(() => {
    const onHashChange = () => {
      setPage(getPageFromHash());
    };

    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  const content = useMemo(() => {
    switch (page) {
      case "setup":
        return <SetupPage />;
      case "alerts":
        return <AlertsPage />;
      case "actions":
        return <ActionsPage />;
      case "logs":
        return <LogsPage />;
      case "targets":
        return <TargetsPage />;
      case "rules":
        return <RulesPage />;
      case "dashboard":
      default:
        return <DashboardPage />;
    }
  }, [page]);

  return (
    <AppShell
      currentPage={page}
      items={NAV_ITEMS}
      onNavigate={(nextPage) => {
        window.location.hash = nextPage;
        setPage(nextPage);
      }}
    >
      {content}
    </AppShell>
  );
}
