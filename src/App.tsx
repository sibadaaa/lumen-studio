import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FolderOpen,
  HelpCircle,
  Keyboard,
  LayoutDashboard,
  LayoutGrid,
  Plug,
} from "lucide-react";
import { ApiModal } from "./components/ApiModal";
import { SettingsMenu } from "./components/SettingsMenu";
import { ToastViewport, type ToastItem } from "./components/Toast";
import { useTranslation } from "react-i18next";
import type { ModelInfo, ModelRoute } from "../shared/contracts";
import { AgentWorkspace } from "./pages/AgentWorkspace";
import { AssetsLibrary } from "./pages/AssetsLibrary";
import { ModelsPage } from "./pages/ModelsPage";
import { ProjectPage } from "./pages/ProjectPage";
import { WorksLibrary } from "./pages/WorksLibrary";
import { StudioPage } from "./studio/StudioPage";
import { StudioProvider } from "./studio/StudioContext";
import { WorkspaceHome } from "./pages/WorkspaceHome";
import { api } from "./lib/api";
import { SHORTCUTS_ENABLED } from "./lib/features";
import { compactTokens, formatTokens } from "./lib/tokens";
import type { Page, StudioIntent, StudioRuntime } from "./types";

const OFFLINE_RUNTIME: StudioRuntime = {
  online: false,
  activeProviderId: null,
  provider: null,
  providers: [],
  models: [],
  routes: [],
  ffmpeg: false,
  version: "0.2.0",
  loading: true,
};

export default function App() {
  const { t } = useTranslation("base");
  const [page, setPage] = useState<Page>("workspace");
  const [projectId, setProjectId] = useState("proj_product");
  const [projectName, setProjectName] = useState("产品短片");
  const [agentSessionId, setAgentSessionId] = useState<string | null>(null);
  const [sessionTokens, setSessionTokens] = useState(128420);
  const [apiOpen, setApiOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [runtime, setRuntime] = useState<StudioRuntime>(OFFLINE_RUNTIME);
  const [libraryProjectId, setLibraryProjectId] = useState<string | null>(null);
  const [studioIntent, setStudioIntent] = useState<StudioIntent | null>(null);

  const toast = useCallback((message: string, type: "default" | "success" = "default") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 2800);
  }, []);

  const refreshRuntime = useCallback(async (options: { catalog?: boolean } = {}) => {
    setRuntime((prev) => ({ ...prev, loading: true }));
    try {
      const data = await api.providers();
      const provider = data.items.find((item) => item.id === data.activeProviderId) || null;
      let models = [] as ModelInfo[];
      let routes = [] as ModelRoute[];
      try {
        const [modelData, routeData] = await Promise.all([api.models("?enabled=0"), api.modelRoutes()]);
        models = modelData.items;
        routes = routeData.items;
      } catch {
        // Catalog is optional; the studio falls back to provider image/video models.
      }
      void options;
      setRuntime({
        online: true,
        activeProviderId: data.activeProviderId,
        provider,
        providers: data.items,
        models,
        routes,
        ffmpeg: data.backend.ffmpeg,
        version: data.backend.version,
        loading: false,
      });
    } catch {
      setRuntime((prev) => ({
        ...prev,
        online: false,
        loading: false,
        provider: null,
        activeProviderId: null,
        models: [],
        routes: [],
      }));
    }
  }, []);

  useEffect(() => {
    void refreshRuntime();
    const timer = window.setInterval(() => void refreshRuntime(), 30_000);
    return () => window.clearInterval(timer);
  }, [refreshRuntime]);

  useEffect(() => {
    document.body.dataset.page = page;
  }, [page]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (SHORTCUTS_ENABLED && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j" && page === "studio") {
        event.preventDefault();
        setPage("agent");
      }
      if (event.key === "Escape" && apiOpen) setApiOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, apiOpen]);

  const jump = useMemo(() => {
    if (page === "project") return { label: t("workspace"), target: "workspace" as Page };
    if (page === "studio") return { label: t("project"), target: "project" as Page };
    if (page === "agent") return { label: t("studio"), target: "studio" as Page };
    if (page === "works" || page === "assets" || page === "models")
      return { label: t("workspace"), target: "workspace" as Page };
    return null;
  }, [page, t]);

  const pageLabel = (target: Page) =>
    target === "works" ? t("works") : target === "assets" ? t("assets") : target === "models" ? t("models") : t("workspace");
  const crumbs = useMemo(() => {
    const items: { label: string; page?: Page }[] = [
      { label: t("workspace"), page: page === "workspace" ? undefined : "workspace" },
    ];
    if (page === "workspace") items.push({ label: t("allProjects") });
    if (page === "project") items.push({ label: projectName });
    if (page === "studio")
      items.push({ label: projectName, page: "project" }, { label: t("studio") });
    if (page === "agent")
      items.push(
        { label: projectName, page: "project" },
        { label: t("studio"), page: "studio" },
        { label: t("agent") }
      );
    if (page === "works") items.push({ label: t("works") });
    if (page === "assets") items.push({ label: t("assets") });
    if (page === "models") items.push({ label: t("models") });
    return items;
  }, [page, projectName, t]);

  const goPage = (target: Page) => setPage(target);

  const goWorkspace = () => setPage("workspace");

  return (
    <>
      <div className="app">
        <aside className="rail">
          <button className="rail-logo" aria-label="LUMEN 流明" onClick={goWorkspace}>
            <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <circle cx="16" cy="16" r="11.2" stroke="currentColor" strokeWidth="1.2" opacity=".55" />
              <path d="M16 4.8a11.2 11.2 0 0 0 0 22.4 11.2 11.2 0 0 0 0-22.4Z" fill="currentColor" opacity=".16" />
              <circle cx="20.4" cy="11.6" r="2.3" fill="currentColor" />
            </svg>
          </button>

          <nav className="rail-nav" aria-label={t("mainNav")}>
            {([
              ["workspace", t("workspace"), LayoutDashboard],
              ["works", t("works"), LayoutGrid],
              ["assets", t("assets"), FolderOpen],
              ["models", t("models"), Plug],
            ] as const).map(([target, label, Icon]) => (
              <button
                key={target}
                className={`rail-item ${page === target ? "is-active" : ""}`}
                data-tip={pageLabel(target)}
                aria-label={pageLabel(target)}
                aria-current={page === target ? "page" : undefined}
                onClick={() => goPage(target)}
              >
                <Icon size={21} strokeWidth={1.4} />
                {target === "workspace" && <span className="rail-indicator" />}
              </button>
            ))}
          </nav>

          <div className="rail-bottom">
            {SHORTCUTS_ENABLED && (
              <button className="rail-item" data-tip={t("shortcuts")} aria-label={t("shortcuts")} onClick={() => toast(t("shortcutsToast"))}>
                <Keyboard size={21} strokeWidth={1.4} />
              </button>
            )}
          </div>
        </aside>

        <div className="shell">
          <header className="topbar">
            <div className="topbar-left">
              <span className="wordmark">LUMEN</span>
              <span className="wordmark-cn">流明</span>
              <span className="crumb-sep">/</span>
              <nav className="breadcrumbs" aria-label={t("breadcrumb")}>
                {crumbs.map((crumb, index) => (
                  <span key={`${crumb.label}-${index}`} style={{ display: "contents" }}>
                    {index > 0 && <span className="crumb-sep">/</span>}
                    {crumb.page ? (
                      <button className="crumb-link" onClick={() => setPage(crumb.page!)}>
                        {crumb.label}
                      </button>
                    ) : (
                      <span className="crumb-current">{crumb.label}</span>
                    )}
                  </span>
                ))}
              </nav>
              <span className="autosave"><i />{t("autosave")}</span>
            </div>
            <div className="topbar-right">
              <button className={`api-pill ${runtime.online ? "is-online" : ""}`} onClick={() => goPage("models")} aria-haspopup="dialog" title={t("models")}>
                <span className="live-dot" />
                <span>{runtime.online ? (runtime.provider?.kind === "mock" ? (runtime.provider?.label || t("workspace")) : runtime.provider?.label || t("models")) : t("mockFallback")}</span>
                <span className="pill-divider" />
                <span className="api-provider">
                  {!runtime.online ? "OFFLINE" : runtime.provider?.kind === "mock" ? "MOCK" : runtime.provider?.configured ? "LIVE" : "SETUP"}
                </span>
              </button>
              <button className="token-chip" title={t("tokenTitle", { count: formatTokens(sessionTokens) })}>
                <svg className="token-ring" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <circle cx="9" cy="9" r="6.4" stroke="currentColor" strokeWidth="1.1" opacity=".22" />
                  <path d="M9 2.6a6.4 6.4 0 0 1 6.2 4.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  <path d="M9 5.2v3.9l2.6 1.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="token-value">{compactTokens(sessionTokens)}</span>
                <span className="token-unit">tokens</span>
              </button>
              <span className="local-badge" title={t("localTitle")}><i />LOCAL</span>
              <button
                className="page-jump"
                hidden={!jump}
                onClick={() => jump && setPage(jump.target)}
              >
                {jump?.label}
              </button>
              <SettingsMenu />
              <button className="icon-btn" title={t("help")} aria-label={t("help")} onClick={() => toast(t("helpToast"))}>
                <HelpCircle size={18} strokeWidth={1.4} />
              </button>
            </div>
          </header>

          {page === "workspace" && (
            <WorkspaceHome
              onOpenProject={(project) => {
                setProjectId(project.id);
                setProjectName(project.name);
                setAgentSessionId(null);
                setLibraryProjectId(null);
                setStudioIntent(null);
                setPage("project");
              }}
              toast={toast}
            />
          )}
          {page === "project" && (
            <ProjectPage
              projectId={projectId}
              onEnterStudio={() => setPage("studio")}
              onOpenAgent={(sessionId) => {
                setAgentSessionId(sessionId || null);
                setPage("agent");
              }}
              onOpenAssets={(id) => {
                setLibraryProjectId(id);
                setPage("assets");
              }}
              toast={toast}
            />
          )}
          {page === "works" && (
            <WorksLibrary
              projectId={libraryProjectId}
              onOpenStudio={(intent) => {
                setStudioIntent(intent);
                setPage("studio");
              }}
              toast={toast}
            />
          )}
          {page === "assets" && (
            <AssetsLibrary
              projectId={libraryProjectId}
              onProjectChange={setLibraryProjectId}
              onUseInStudio={(intent) => {
                setStudioIntent(intent);
                setPage("studio");
              }}
              toast={toast}
            />
          )}
          {page === "models" && (
            <ModelsPage runtime={runtime} onRefresh={refreshRuntime} onOpenApi={() => setApiOpen(true)} toast={toast} />
          )}

          <StudioProvider
            runtime={runtime}
            projectId={projectId}
            intent={page === "studio" ? studioIntent : null}
            onIntentApplied={() => setStudioIntent(null)}
            onTokensUsed={(tokens) => setSessionTokens((prev) => prev + tokens)}
            toast={toast}
          >
            <StudioPage
              hidden={page !== "studio"}
              onOpenAgent={() => {
                setAgentSessionId(null);
                setPage("agent");
              }}
              toast={toast}
            />
            <AgentWorkspace
              hidden={page !== "agent"}
              projectId={projectId}
              initialSessionId={agentSessionId}
              onBackToStudio={() => setPage("studio")}
              onOpenApi={() => setApiOpen(true)}
              toast={toast}
            />
          </StudioProvider>
        </div>
      </div>

      <ApiModal
        open={apiOpen}
        onClose={() => setApiOpen(false)}
        toast={toast}
        runtime={runtime}
        onRefresh={refreshRuntime}
      />
      <ToastViewport items={toasts} />
    </>
  );
}
