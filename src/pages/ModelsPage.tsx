import { useCallback, useEffect, useMemo, useState } from "react";
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

const KIND_LABELS: Record<string, string> = {
  image: "图像",
  video: "视频",
  unknown: "待确认",
};

const STATUS_LABELS: Record<string, string> = {
  ready: "就绪",
  unverified: "未验证",
  missing: "已下架",
};

interface Props {
  runtime: StudioRuntime;
  onRefresh: () => Promise<void>;
  onOpenApi: () => void;
  toast: (message: string, type?: "default" | "success") => void;
}

export function ModelsPage({ runtime, onRefresh, onOpenApi, toast }: Props) {
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
      toast(`已启用 ${result.changed} 个模型`, "success");
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
      toast("模型已从目录移除", "success");
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
      toast("模型已添加", "success");
      await onRefresh();
    } catch (error) {
      toast((error as Error).message);
    }
  };

  const saveRoute = async (mode: GenerationMode, model: ModelInfo) => {
    try {
      const route = await api.updateModelRoute(mode, { providerId: model.providerId, modelId: model.id });
      setRoutes((prev) => prev.map((item) => (item.mode === mode ? route : item)));
      toast(`已设置${MODE_LABELS[mode]}默认模型`, "success");
    } catch (error) {
      const message = (error as Error).message;
      toast(message);
      if (message.includes("未启用") || message.includes("不支持")) {
        try {
          const route = await api.updateModelRoute(mode, { providerId: model.providerId, modelId: model.id }, true);
          setRoutes((prev) => prev.map((item) => (item.mode === mode ? route : item)));
          toast("已保存，但该模型能力不完整，生成时可能受限");
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
    toast(changed > 0 ? `已为 ${changed} 个模式匹配默认模型` : "没有可用模型可以匹配", changed > 0 ? "success" : "default");
  };

  return (
    <main className="models-page">
      <section className="library-main">
        <header className="library-head">
          <div>
            <span className="eyebrow">API &amp; MODELS</span>
            <h1>API 与模型</h1>
            <p>
              连接生成服务、获取模型目录，并为五种模式设置默认模型。密钥仅存于服务端。
              {!runtime.online && <strong className="models-offline"> · 本机 BFF 未启动</strong>}
            </p>
          </div>
          <div className="library-head-side">
            <div className="library-stats">
              <span>{models.length} 个模型</span>
              <span>{models.filter((model) => model.enabled).length} 已启用</span>
            </div>
          </div>
        </header>

        <div className="models-tabs" role="tablist" aria-label="API 与模型分区">
          {([
            ["connections", "连接"],
            ["catalog", `模型库 ${models.length ? models.length : ""}`],
            ["routes", "路由"],
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
                  placeholder="搜索模型 ID…"
                  aria-label="搜索模型"
                />
                <div className="library-chips" role="group" aria-label="类型筛选">
                  {(["all", "image", "video", "unknown"] as const).map((kind) => (
                    <button key={kind} aria-pressed={kindFilter === kind} className={kindFilter === kind ? "is-active" : ""} onClick={() => setKindFilter(kind)}>
                      {kind === "all" ? "全部" : KIND_LABELS[kind]}
                    </button>
                  ))}
                </div>
                <div className="library-actions">
                  <button className="soft-btn" onClick={() => setAdding((prev) => !prev)}>手动添加</button>
                  <button className="ws-primary" onClick={() => void sync()} disabled={syncing || !runtime.online}>
                    {syncing ? <><LoaderCircle size={13} className="spin" /> 正在获取…</> : <><RefreshCw size={13} /> 获取模型</>}
                  </button>
                </div>
              </div>

              {syncResult && (
                <div className={`models-sync-banner ${syncResult.supported ? "" : "is-warning"}`}>
                  <span>{syncResult.message}</span>
                  {syncResult.suggestedEnabled.length > 0 && (
                    <button onClick={() => void enableSuggested()}>启用建议模型（{syncResult.suggestedEnabled.length}）</button>
                  )}
                </div>
              )}

              {adding && (
                <div className="models-add-row">
                  <input
                    autoFocus
                    value={newModelId}
                    onChange={(event) => setNewModelId(event.target.value)}
                    placeholder="模型 ID，例如 doubao-seedream-4-0-250828 或 ep-2026…"
                  />
                  <div className="library-chips">
                    {(["image", "video"] as const).map((kind) => (
                      <button key={kind} aria-pressed={newModelKind === kind} className={newModelKind === kind ? "is-active" : ""} onClick={() => setNewModelKind(kind)}>
                        {KIND_LABELS[kind]}
                      </button>
                    ))}
                  </div>
                  <button className="ws-primary" onClick={() => void addManual()}>添加</button>
                </div>
              )}

              {loading ? (
                <p className="library-loading">正在读取模型目录…</p>
              ) : filtered.length === 0 ? (
                <div className="library-empty">
                  <h3>还没有模型</h3>
                  <p>点击「获取模型」从 {provider?.label || "当前连接"} 拉取模型列表，或手动添加模型 ID。</p>
                </div>
              ) : (
                <div className="model-table" role="table" aria-label="模型目录">
                  <div className="model-table-head" role="row">
                    <span>启用</span>
                    <span>模型</span>
                    <span>类型</span>
                    <span>支持模式</span>
                    <span>状态</span>
                    <span>最近使用</span>
                    <span />
                  </div>
                  {filtered.map((model) => (
                    <div key={model.id} className={`model-row ${model.enabled ? "is-enabled" : ""}`} role="row">
                      <span>
                        <input
                          type="checkbox"
                          checked={model.enabled}
                          disabled={model.kind === "unknown"}
                          aria-label={`启用 ${model.id}`}
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
                          aria-label="模型类型"
                          onChange={(event) => void changeKind(model, event.target.value as "image" | "video" | "unknown")}
                        >
                          {(["image", "video", "unknown"] as const).map((kind) => (
                            <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>
                          ))}
                        </select>
                      </span>
                      <span className="model-modes">
                        {model.modes.length === 0 ? "—" : model.modes.map((mode) => MODE_LABELS[mode]).join(" / ")}
                      </span>
                      <span className={`model-status is-${model.status}`}>{STATUS_LABELS[model.status]}</span>
                      <span>{model.lastUsedAt ? relativeTime(model.lastUsedAt) : "未使用"}</span>
                      <span className="model-row-actions">
                        <button title="删除模型" aria-label={`删除 ${model.id}`} onClick={() => void removeModel(model)}>✕</button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <p className="library-footnote">
                {provider?.label || "当前连接"} · 模型目录保存在本地 SQLite；同步不会调用生成接口，也不消耗 tokens。
              </p>
            </>
          )}

          {tab === "routes" && (
            <>
              <div className="library-toolbar">
                <p className="library-hint">为每种生成模式选择默认模型；能力不完整时可保存，但生成前会再次校验。</p>
                <div className="library-actions">
                  <button className="ws-primary" onClick={() => void autoMatch()}>自动匹配</button>
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
                        aria-label={`${MODE_LABELS[mode]}默认模型`}
                        onChange={(event) => {
                          const [pid, mid] = event.target.value.split("::");
                          const model = models.find((item) => item.providerId === pid && item.id === mid);
                          if (model) void saveRoute(mode, model);
                        }}
                      >
                        <option value="">未设置</option>
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
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});

  const test = async (provider: ProviderInfo) => {
    setTesting(provider.id);
    try {
      const result = await api.testProvider(provider.id);
      setResults((prev) => ({ ...prev, [provider.id]: `${result.message}${result.latencyMs ? ` · ${result.latencyMs}ms` : ""}` }));
      if (result.ok) toast("连接正常", "success");
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
      toast(`已切换到 ${provider.label}`, "success");
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
              {provider.id === activeId ? <><CheckCircle2 size={12} /> 当前连接</> : provider.configured ? "已配置" : "未配置"}
            </span>
          </header>
          <dl>
            <div><dt>Base URL</dt><dd>{provider.baseUrl}</dd></div>
            <div><dt>密钥</dt><dd>{provider.kind === "mock" ? "本地演示 · 无需密钥" : provider.keyMasked || "未设置"}</dd></div>
            <div><dt>图像 / 视频模型</dt><dd>{provider.imageModel} / {provider.videoModel}</dd></div>
            <div><dt>最近测试</dt><dd>{provider.lastTestedAt ? `${relativeTime(provider.lastTestedAt)} · ${provider.lastLatencyMs ?? "—"}ms` : "未测试"}</dd></div>
          </dl>
          {results[provider.id] && <p className="provider-test-result">{results[provider.id]}</p>}
          <footer>
            <button className="soft-btn" onClick={() => void test(provider)} disabled={testing === provider.id}>
              {testing === provider.id ? <><LoaderCircle size={13} className="spin" /> 正在握手…</> : <><ShieldCheck size={13} /> 测试连接</>}
            </button>
            {provider.id !== activeId && provider.configured && (
              <button className="soft-btn" onClick={() => void activate(provider)}>
                <PlugZap size={13} /> 设为当前
              </button>
            )}
            <button className="soft-btn" onClick={onOpenApi}>编辑配置</button>
          </footer>
        </article>
      ))}
    </div>
  );
}
