import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, LoaderCircle, PlugZap, RefreshCw, ShieldCheck } from "lucide-react";
import type {
  GenerationMode,
  ModelInfo,
  ModelSyncResult,
  ProviderInfo,
} from "../../shared/contracts";
import { MODE_LABELS } from "../../shared/contracts";
import { api } from "../lib/api";
import { relativeTime } from "../library/ui";
import type { StudioRuntime } from "../types";

const MODE_ORDER: GenerationMode[] = [
  "text-to-image",
  "text-to-video",
  "image-to-image",
  "image-to-video",
  "multi-image-to-video",
];

interface Props {
  runtime: StudioRuntime;
  onRefresh: () => Promise<void>;
  onOpenApi: () => void;
  toast: (message: string, type?: "default" | "success") => void;
}

export function ModelsPage({ runtime, onRefresh, onOpenApi, toast }: Props) {
  const { t } = useTranslation("models");
  const [tab, setTab] = useState<"connections" | "catalog" | "routes">(
    runtime.online && runtime.activeProviderId ? "catalog" : "connections"
  );
  const [providerId, setProviderId] = useState<string>(runtime.activeProviderId || "ark");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [routes, setRoutes] = useState(runtime.routes);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<ModelSyncResult | null>(null);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "image" | "video" | "unknown">("all");
  const [adding, setAdding] = useState(false);
  const [newModelId, setNewModelId] = useState("");
  const [newModelKind, setNewModelKind] = useState<"image" | "video">("image");

  const provider = runtime.providers.find((item) => item.id === providerId) || null;

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const [detail, routeList] = await Promise.all([api.providerModels(providerId), api.modelRoutes()]);
      setModels(detail.items);
      setRoutes(routeList.items);
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [providerId, toast]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return models.filter((model) => {
      if (kindFilter !== "all" && model.kind !== kindFilter) return false;
      if (keyword && !model.id.toLowerCase().includes(keyword) && !model.label.toLowerCase().includes(keyword)) return false;
      return true;
    });
  }, [models, search, kindFilter]);

  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await api.syncModels(providerId);
      setSyncResult(result);
      setModels(result.items);
      if (result.supported) {
        toast(result.message, "success");
      } else {
        toast(result.message);
      }
      await onRefresh();
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const toggleEnabled = async (model: ModelInfo) => {
    try {
      const result = await api.enableModels(providerId, [model.id], !model.enabled);
      setModels(result.items);
      await onRefresh();
    } catch (error) {
      toast((error as Error).message);
    }
  };

  const enableSuggested = async () => {
    if (!syncResult?.suggestedEnabled.length) return;
    try {
      const result = await api.enableModels(providerId, syncResult.suggestedEnabled, true);
      setModels(result.items);
      setSyncResult((prev) => (prev ? { ...prev, suggestedEnabled: [] } : prev));
      toast(t("catalog.enabledSuggested", { count: result.changed }), "success");
      await onRefresh();
    } catch (error) {
      toast((error as Error).message);
    }
  };

  const changeKind = async (model: ModelInfo, kind: "image" | "video" | "unknown") => {
    try {
      const updated = await api.updateModel(providerId, model.id, { kind });
      setModels((prev) => prev.map((item) => (item.id === model.id ? updated : item)));
    } catch (error) {
      toast((error as Error).message);
    }
  };

  const removeModel = async (model: ModelInfo) => {
    try {
      await api.deleteModel(providerId, model.id);
      setModels((prev) => prev.filter((item) => item.id !== model.id));
      toast(t("catalog.deleted"), "success");
    } catch (error) {
      toast((error as Error).message);
    }
  };

  const addManual = async () => {
    const id = newModelId.trim();
    if (!id) return;
    try {
      const created = await api.addModel(providerId, {
        id,
        kind: newModelKind,
        modes: newModelKind === "image" ? ["text-to-image", "image-to-image"] : ["text-to-video", "image-to-video"],
      });
      setModels((prev) => [...prev, created]);
      setNewModelId("");
      setAdding(false);
      toast(t("catalog.added"), "success");
      await onRefresh();
    } catch (error) {
      toast((error as Error).message);
    }
  };

  const saveRoute = async (mode: GenerationMode, model: ModelInfo) => {
    try {
      const route = await api.updateModelRoute(mode, { providerId: model.providerId, modelId: model.id });
      setRoutes((prev) => prev.map((item) => (item.mode === mode ? route : item)));
      toast(t("routes.saved", { mode: MODE_LABELS[mode] }), "success");
    } catch (error) {
      const message = (error as Error).message;
      toast(message);
      if (/未启用|不支持|disabled|unsupported|invalid/i.test(message)) {
        try {
          const route = await api.updateModelRoute(mode, { providerId: model.providerId, modelId: model.id }, true);
          setRoutes((prev) => prev.map((item) => (item.mode === mode ? route : item)));
          toast(t("routes.savedWithWarning"));
        } catch {
          /* ignore */
        }
      }
    }
  };

  const autoMatch = async () => {
    const active = runtime.activeProviderId;
    let changed = 0;
    for (const mode of MODE_ORDER) {
      const candidates = models.filter((model) => model.enabled && model.status !== "missing" && model.modes.includes(mode));
      if (candidates.length === 0) continue;
      const preferred =
        candidates.find((model) => model.providerId === active && model.source === "seed") ||
        candidates.find((model) => model.providerId === active) ||
        candidates[0];
      try {
        await api.updateModelRoute(mode, { providerId: preferred.providerId, modelId: preferred.id });
        changed += 1;
      } catch {
        /* keep going */
      }
    }
    const routeList = await api.modelRoutes();
    setRoutes(routeList.items);
    toast(changed > 0 ? t("routes.matched", { count: changed }) : t("routes.unmatched"), changed > 0 ? "success" : "default");
  };

  return (
    <main className="models-page">
      <section className="library-main">
        <header className="library-head">
          <div>
            <span className="eyebrow">API &amp; MODELS</span>
            <h1>{t("title")}</h1>
            <p>
              {t("desc")}
              {!runtime.online && <strong className="models-offline">{t("descOfflineSuffix")}</strong>}
            </p>
          </div>
          <div className="library-head-side">
            <div className="library-stats">
              <span>{t("statsModels", { count: models.length })}</span>
              <span>{t("statsEnabled", { count: models.filter((model) => model.enabled).length })}</span>
            </div>
          </div>
        </header>

        <div className="models-tabs" role="tablist" aria-label={t("title")}>
          {([
            ["connections", t("tabs.connections")],
            ["catalog", `${t("tabs.catalog")}${models.length ? ` ${models.length}` : ""}`],
            ["routes", t("tabs.routes")],
          ] as const).map(([key, label]) => (
            <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "is-active" : ""} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>

        <div className="library-content">
          {tab === "connections" && (
            <ConnectionsTab providers={runtime.providers} activeId={runtime.activeProviderId} onOpenApi={onOpenApi} onRefresh={onRefresh} toast={toast} />
          )}

          {tab === "catalog" && (
            <>
              <div className="library-toolbar models-toolbar">
                <input
                  className="library-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("catalog.searchPlaceholder")}
                  aria-label={t("catalog.searchAria")}
                />
                <div className="library-chips" role="group" aria-label={t("catalog.kindLabel")}>
                  {(["all", "image", "video", "unknown"] as const).map((kind) => (
                    <button key={kind} aria-pressed={kindFilter === kind} className={kindFilter === kind ? "is-active" : ""} onClick={() => setKindFilter(kind)}>
                      {kind === "all" ? t("catalog.all") : t(`catalog.kind.${kind}`)}
                    </button>
                  ))}
                </div>
                <div className="library-actions">
                  <button className="soft-btn" onClick={() => setAdding((prev) => !prev)}>{t("catalog.manual")}</button>
                  <button className="ws-primary" onClick={() => void sync()} disabled={syncing || !runtime.online}>
                    {syncing ? <><LoaderCircle size={13} className="spin" /> {t("catalog.fetching")}</> : <><RefreshCw size={13} /> {t("catalog.fetch")}</>}
                  </button>
                </div>
              </div>

              {syncResult && (
                <div className={`models-sync-banner ${syncResult.supported ? "" : "is-warning"}`}>
                  <span>{syncResult.message}</span>
                  {syncResult.suggestedEnabled.length > 0 && (
                    <button onClick={() => void enableSuggested()}>{t("catalog.enableSuggested", { count: syncResult.suggestedEnabled.length })}</button>
                  )}
                </div>
              )}

              {adding && (
                <div className="models-add-row">
                  <input
                    autoFocus
                    value={newModelId}
                    onChange={(event) => setNewModelId(event.target.value)}
                    placeholder={t("catalog.addPlaceholder")}
                  />
                  <div className="library-chips">
                    {(["image", "video"] as const).map((kind) => (
                      <button key={kind} aria-pressed={newModelKind === kind} className={newModelKind === kind ? "is-active" : ""} onClick={() => setNewModelKind(kind)}>
                        {t(`catalog.kind.${kind}`)}
                      </button>
                    ))}
                  </div>
                  <button className="ws-primary" onClick={() => void addManual()}>{t("catalog.add")}</button>
                </div>
              )}

              {loading ? (
                <p className="library-loading">{t("catalog.loading")}</p>
              ) : filtered.length === 0 ? (
                <div className="library-empty">
                  <h3>{t("catalog.emptyTitle")}</h3>
                  <p>{t("catalog.emptyBody", { provider: provider?.label || "" })}</p>
                </div>
              ) : (
                <div className="model-table" role="table" aria-label={t("tabs.catalog")}>
                  <div className="model-table-head" role="row">
                    <span>{t("catalog.table.enabled")}</span>
                    <span>{t("catalog.table.model")}</span>
                    <span>{t("catalog.table.kind")}</span>
                    <span>{t("catalog.table.modes")}</span>
                    <span>{t("catalog.table.status")}</span>
                    <span>{t("catalog.table.lastUsed")}</span>
                    <span />
                  </div>
                  {filtered.map((model) => (
                    <div key={model.id} className={`model-row ${model.enabled ? "is-enabled" : ""}`} role="row">
                      <span>
                        <input
                          type="checkbox"
                          checked={model.enabled}
                          disabled={model.kind === "unknown"}
                          aria-label={t("catalog.enableAria", { id: model.id })}
                          onChange={() => void toggleEnabled(model)}
                        />
                      </span>
                      <span className="model-id" title={model.id}>
                        <strong>{model.label !== model.id ? model.label : model.id}</strong>
                        {model.label !== model.id && <small>{model.id}</small>}
                      </span>
                      <span>
                        <select
                          value={model.kind}
                          aria-label={t("catalog.kindLabel")}
                          onChange={(event) => void changeKind(model, event.target.value as "image" | "video" | "unknown")}
                        >
                          {(["image", "video", "unknown"] as const).map((kind) => (
                            <option key={kind} value={kind}>{t(`catalog.kind.${kind}`)}</option>
                          ))}
                        </select>
                      </span>
                      <span className="model-modes">
                        {model.modes.length === 0 ? "—" : model.modes.map((mode) => MODE_LABELS[mode]).join(" / ")}
                      </span>
                      <span className={`model-status is-${model.status}`}>{t(`catalog.status.${model.status}`)}</span>
                      <span>{model.lastUsedAt ? relativeTime(model.lastUsedAt) : t("catalog.neverUsed")}</span>
                      <span className="model-row-actions">
                        <button title={t("catalog.deleteTitle")} aria-label={t("catalog.table.deleteAria", { id: model.id })} onClick={() => void removeModel(model)}>✕</button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <p className="library-footnote">
                {t("catalog.footnote", { provider: provider?.label || "" })}
              </p>
            </>
          )}

          {tab === "routes" && (
            <>
              <div className="library-toolbar">
                <p className="library-hint">{t("routes.hint")}</p>
                <div className="library-actions">
                  <button className="ws-primary" onClick={() => void autoMatch()}>{t("routes.auto")}</button>
                </div>
              </div>
              <div className="model-routes">
                {MODE_ORDER.map((mode) => {
                  const route = routes.find((item) => item.mode === mode);
                  const candidates = models.filter(
                    (model) => model.enabled && model.status !== "missing" && model.modes.includes(mode)
                  );
                  const selectedKey = route ? `${route.providerId}::${route.modelId}` : "";
                  return (
                    <div key={mode} className="model-route-row">
                      <strong>{MODE_LABELS[mode]}</strong>
                      <select
                        value={selectedKey}
                        aria-label={t("routes.selectAria", { mode: MODE_LABELS[mode] })}
                        onChange={(event) => {
                          const [pid, mid] = event.target.value.split("::");
                          const model = models.find((item) => item.providerId === pid && item.id === mid);
                          if (model) void saveRoute(mode, model);
                        }}
                      >
                        <option value="">{t("routes.unset")}</option>
                        {candidates.map((model) => (
                          <option key={`${model.providerId}::${model.id}`} value={`${model.providerId}::${model.id}`}>
                            {model.label} · {model.providerId}
                          </option>
                        ))}
                      </select>
                      {route?.warning && <em className="model-route-warning">⚠ {route.warning}</em>}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function ConnectionsTab({
  providers,
  activeId,
  onOpenApi,
  onRefresh,
  toast,
}: {
  providers: ProviderInfo[];
  activeId: string | null;
  onOpenApi: () => void;
  onRefresh: () => Promise<void>;
  toast: (message: string, type?: "default" | "success") => void;
}) {
  const { t } = useTranslation("models");
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});

  const test = async (provider: ProviderInfo) => {
    setTesting(provider.id);
    try {
      const result = await api.testProvider(provider.id);
      setResults((prev) => ({ ...prev, [provider.id]: `${result.message}${result.latencyMs ? ` · ${result.latencyMs}ms` : ""}` }));
      if (result.ok) toast(t("connections.ok"), "success");
      await onRefresh();
    } catch (error) {
      setResults((prev) => ({ ...prev, [provider.id]: (error as Error).message }));
    } finally {
      setTesting(null);
    }
  };

  const activate = async (provider: ProviderInfo) => {
    try {
      await api.activateProvider(provider.id);
      await onRefresh();
      toast(t("connections.switched", { provider: provider.label }), "success");
    } catch (error) {
      toast((error as Error).message);
    }
  };

  return (
    <div className="provider-cards">
      {providers.map((provider) => (
        <article key={provider.id} className={`provider-card ${provider.id === activeId ? "is-active" : ""}`}>
          <header>
            <strong>{provider.label}</strong>
            <span className={`provider-state ${provider.configured ? "ok" : ""}`}>
              {provider.id === activeId ? <><CheckCircle2 size={12} /> {t("connections.active")}</> : provider.configured ? t("connections.configured") : t("connections.unconfigured")}
            </span>
          </header>
          <dl>
            <div><dt>{t("connections.baseUrl")}</dt><dd>{provider.baseUrl}</dd></div>
            <div><dt>{t("connections.key")}</dt><dd>{provider.kind === "mock" ? t("connections.keyLocal") : provider.keyMasked || t("connections.keyNotSet")}</dd></div>
            <div><dt>{t("connections.models")}</dt><dd>{provider.imageModel} / {provider.videoModel}</dd></div>
            <div><dt>{t("connections.lastTest")}</dt><dd>{provider.lastTestedAt ? `${relativeTime(provider.lastTestedAt)} · ${provider.lastLatencyMs ?? "—"}ms` : t("connections.never")}</dd></div>
          </dl>
          {results[provider.id] && <p className="provider-test-result">{results[provider.id]}</p>}
          <footer>
            <button className="soft-btn" onClick={() => void test(provider)} disabled={testing === provider.id}>
              {testing === provider.id ? <><LoaderCircle size={13} className="spin" /> {t("connections.testing")}</> : <><ShieldCheck size={13} /> {t("connections.test")}</>}
            </button>
            {provider.id !== activeId && provider.configured && (
              <button className="soft-btn" onClick={() => void activate(provider)}>
                <PlugZap size={13} /> {t("connections.setActive")}
              </button>
            )}
            <button className="soft-btn" onClick={onOpenApi}>{t("connections.edit")}</button>
          </footer>
        </article>
      ))}
    </div>
  );
}
