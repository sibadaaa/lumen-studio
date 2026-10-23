import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, LoaderCircle, Plus, RefreshCw, Sparkles } from "lucide-react";
import type { GenerationMode, ProjectWithStats, Work } from "../../shared/contracts";
import { MODE_LABELS } from "../../shared/contracts";
import { api } from "../lib/api";
import { compactTokens } from "../lib/tokens";
import { buildQuery, useCursorQuery, useDebouncedValue } from "../library/hooks";
import {
  DetailDrawer,
  EmptyState,
  ErrorBanner,
  LibraryShell,
  MediaCard,
  SelectionBar,
  SkeletonGrid,
  compactBytes,
  relativeTime,
} from "../library/ui";
import type { StudioIntent } from "../types";

interface Props {
  projectId?: string | null;
  onOpenStudio: (intent: StudioIntent) => void;
  toast: (message: string, type?: "default" | "success") => void;
}

const MODE_OPTIONS: GenerationMode[] = [
  "text-to-image",
  "text-to-video",
  "image-to-image",
  "image-to-video",
  "multi-image-to-video",
];

export function WorksLibrary({ projectId, onOpenStudio, toast }: Props) {
  const [projects, setProjects] = useState<ProjectWithStats[]>([]);
  const [projectFilter, setProjectFilter] = useState<string>(projectId || "");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 300);
  const [kind, setKind] = useState<"" | "image" | "video">("");
  const [mode, setMode] = useState<"" | GenerationMode>("");
  const [favorite, setFavorite] = useState(false);
  const [sort, setSort] = useState<"newest" | "oldest" | "tokens" | "duration">("newest");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<Work | null>(null);
  const [renaming, setRenaming] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .projects()
      .then((data) => setProjects(data.items))
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    setProjectFilter(projectId || "");
  }, [projectId]);

  const fetcher = useCallback(
    async (cursor: string | null) =>
      api.works(
        buildQuery({
          projectId: projectFilter || undefined,
          kind: kind || undefined,
          mode: mode || undefined,
          favorite,
          q: search || undefined,
          sort,
          limit: 24,
          cursor: cursor || undefined,
        })
      ),
    [projectFilter, kind, mode, favorite, search, sort]
  );

  const list = useCursorQuery<Work>(fetcher, [fetcher]);

  const projectName = useMemo(() => {
    const map = new Map(projects.map((project) => [project.id, project.name]));
    return (id?: string | null) => (id ? map.get(id) || id : "未归档");
  }, [projects]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const patchLocal = (id: string, patch: Partial<Work>) => {
    list.setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const toggleFavorite = async (work: Work) => {
    patchLocal(work.id, { favorite: !work.favorite });
    try {
      await api.updateWork(work.id, { favorite: !work.favorite });
      if (active?.id === work.id) setActive((prev) => (prev ? { ...prev, favorite: !work.favorite } : prev));
    } catch (error) {
      patchLocal(work.id, { favorite: work.favorite });
      toast((error as Error).message);
    }
  };

  const rename = async (work: Work) => {
    const title = renaming.trim();
    if (!title) return;
    try {
      const updated = await api.updateWork(work.id, { title });
      patchLocal(work.id, { title: updated.title });
      setActive(updated);
      setRenaming("");
      toast("已重命名", "success");
    } catch (error) {
      toast((error as Error).message);
    }
  };

  const moveTo = async (work: Work, target: string | null) => {
    try {
      const updated = await api.updateWork(work.id, { projectId: target });
      patchLocal(work.id, { projectId: updated.projectId });
      setActive(updated);
      toast("已移动项目", "success");
    } catch (error) {
      toast((error as Error).message);
    }
  };

  const remove = async (work: Work) => {
    if (!window.confirm(`删除作品「${work.title}」？任务记录与 tokens 统计仍会保留。`)) return;
    try {
      await api.deleteWork(work.id);
      list.setItems((prev) => prev.filter((item) => item.id !== work.id));
      setActive(null);
      toast("作品已删除", "success");
    } catch (error) {
      toast((error as Error).message);
    }
  };

  const saveToAssets = async (work: Work) => {
    setBusy(true);
    try {
      const result = await api.saveWorkToAssets(work.id);
      toast(result.created ? "已加入素材库" : "该作品已经在素材库中", "success");
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const bulk = async (
    action: "favorite" | "unfavorite" | "delete" | "save_to_assets" | "move_project",
    target?: string | null
  ) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (action === "delete" && !window.confirm(`删除选中的 ${ids.length} 件作品？此操作不可撤销。`)) return;
    setBusy(true);
    try {
      const result = await api.bulkWorks({ action, ids, projectId: target });
      if (result.failed.length > 0) {
        toast(`成功 ${result.updated} · 失败 ${result.failed.length}：${result.failed[0].message}`);
      } else {
        toast(action === "save_to_assets" ? `已加入素材库 ${result.created || 0} 件` : `已更新 ${result.updated} 件`, "success");
      }
      setSelected(new Set());
      await list.refresh();
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reuse = (work: Work, variant = false) => {
    onOpenStudio({ work: variant ? { ...work, params: { ...work.params, seed: undefined } } : work });
  };

  const hasFilters = Boolean(projectFilter || kind || mode || favorite || search);

  return (
    <LibraryShell
      eyebrow="WORKS"
      title="作品库"
      description="成功生成的结果，按时间倒序；失败与取消的任务不会进入作品库。"
      stats={
        <>
          <span>{list.total} 件作品</span>
          {!list.loading && <span className="library-stats-sub">{compactTokens(list.items.reduce((sum, item) => sum + item.usage.totalTokens, 0))} tokens（当前页）</span>}
        </>
      }
      actions={
        <button className="soft-btn" onClick={() => void list.refresh()} aria-label="刷新作品列表">
          <RefreshCw size={13} /> 刷新
        </button>
      }
      toolbar={
        <div className="library-toolbar">
          <input
            className="library-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="搜索标题、提示词…"
            aria-label="搜索作品"
          />
          <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} aria-label="按项目筛选">
            <option value="">全部项目</option>
            <option value="none">未归档</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
          <select value={kind} onChange={(event) => setKind(event.target.value as "" | "image" | "video")} aria-label="按类型筛选">
            <option value="">全部类型</option>
            <option value="image">图片</option>
            <option value="video">视频</option>
          </select>
          <select value={mode} onChange={(event) => setMode(event.target.value as "" | GenerationMode)} aria-label="按模式筛选">
            <option value="">全部模式</option>
            {MODE_OPTIONS.map((item) => (
              <option key={item} value={item}>{MODE_LABELS[item]}</option>
            ))}
          </select>
          <button className={`library-chip ${favorite ? "is-active" : ""}`} aria-pressed={favorite} onClick={() => setFavorite((prev) => !prev)}>
            仅看收藏
          </button>
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="排序">
            <option value="newest">最新</option>
            <option value="oldest">最早</option>
            <option value="tokens">tokens 高→低</option>
            <option value="duration">时长长→短</option>
          </select>
          {hasFilters && (
            <button
              className="text-btn"
              onClick={() => {
                setProjectFilter("");
                setKind("");
                setMode("");
                setFavorite(false);
                setSearchInput("");
              }}
            >
              清除筛选
            </button>
          )}
        </div>
      }
    >
      {list.error && <ErrorBanner message={`无法读取作品库：${list.error}`} onRetry={() => void list.refresh()} />}

      {list.loading ? (
        <SkeletonGrid />
      ) : list.items.length === 0 ? (
        <EmptyState
          title={hasFilters ? "没有符合条件的作品" : "还没有作品"}
          description={
            hasFilters
              ? "调整筛选条件，或清除筛选查看全部作品。"
              : "去创作台生成第一张图或第一段视频，成功后会自动出现在这里。"
          }
        />
      ) : (
        <>
          <div className="library-grid">
            {list.items.map((work) => (
              <MediaCard
                key={work.id}
                kind={work.kind}
                url={work.url}
                thumbnailUrl={work.thumbnailUrl}
                title={work.title}
                durationSec={work.durationSec}
                favorite={work.favorite}
                selected={selected.has(work.id)}
                onOpen={() => {
                  setActive(work);
                  setRenaming("");
                }}
                onToggleFavorite={() => void toggleFavorite(work)}
                onToggleSelect={() => toggleSelect(work.id)}
                meta={
                  <>
                    <em>{MODE_LABELS[work.mode]}</em>
                    <span>{work.modelId.split("/").pop() || work.modelId}</span>
                    <span>{compactTokens(work.usage.totalTokens)} tokens</span>
                    <time>{relativeTime(work.createdAt)}</time>
                  </>
                }
                badges={<span className={`badge badge-${work.source}`}>{work.source === "agent" ? "Agent" : "Studio"}</span>}
              />
            ))}
          </div>
          {list.nextCursor && (
            <button className="library-more" onClick={() => void list.loadMore()} disabled={list.loadingMore}>
              {list.loadingMore ? <><LoaderCircle size={13} className="spin" /> 加载中…</> : <><Plus size={13} /> 加载更多（共 {list.total} 件）</>}
            </button>
          )}
          {selected.size > 0 && (
            <SelectionBar label={`已选 ${selected.size} 件`}>
              <button disabled={busy} onClick={() => void bulk("favorite")}>收藏</button>
              <button disabled={busy} onClick={() => void bulk("unfavorite")}>取消收藏</button>
              <button disabled={busy} onClick={() => void bulk("save_to_assets")}>另存为素材</button>
              <select
                defaultValue=""
                disabled={busy}
                aria-label="批量移动项目"
                onChange={(event) => {
                  if (event.target.value === "") return;
                  const target = event.target.value === "none" ? null : event.target.value;
                  void bulk("move_project", target);
                }}
              >
                <option value="" disabled>移动到项目…</option>
                <option value="none">未归档</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
              <button className="is-danger" disabled={busy} onClick={() => void bulk("delete")}>删除</button>
              <button className="text-btn" onClick={() => setSelected(new Set())}>取消</button>
            </SelectionBar>
          )}
        </>
      )}

      <DetailDrawer open={Boolean(active)} onClose={() => setActive(null)} title="作品详情" wide>
        {active && (
          <>
            <div className="library-preview">
              {active.kind === "video" ? (
                <video src={active.url} controls preload="metadata" aria-label={active.title} />
              ) : (
                <img src={active.url} alt={active.title} />
              )}
            </div>
            <div className="library-actions-row">
              <a className="soft-btn" href={active.url} download={`${active.title || active.id}`}>
                <Download size={13} /> 下载
              </a>
              <button className="ws-primary" onClick={() => reuse(active)}>
                <Sparkles size={13} /> 复用参数
              </button>
              <button className="soft-btn" onClick={() => reuse(active, true)}>生成变体</button>
              <button className="soft-btn" disabled={busy} onClick={() => void saveToAssets(active)}>另存为素材</button>
            </div>
            <dl className="library-detail-list">
              <div><dt>模型</dt><dd>{active.providerId} · {active.modelId}</dd></div>
              <div><dt>规格</dt><dd>{active.params.resolution || "—"} · {active.params.aspectRatio || "—"}{active.durationSec ? ` · ${Math.round(active.durationSec)}s` : ""}</dd></div>
              <div><dt>消耗</dt><dd>{active.usage.totalTokens.toLocaleString()} tokens{active.usage.estimated ? "（估算）" : "（Provider 实际）"}</dd></div>
              <div><dt>项目</dt><dd>{projectName(active.projectId)}</dd></div>
              <div><dt>来源</dt><dd>{active.source === "agent" ? "Agent 工作区" : "创作台"} · {active.generationId}</dd></div>
              <div><dt>时间</dt><dd>{new Date(active.createdAt).toLocaleString("zh-CN")}</dd></div>
            </dl>
            <section className="library-detail-section">
              <h4>提示词 <button className="text-btn" onClick={() => void navigator.clipboard.writeText(active.prompt)}>复制</button></h4>
              <p>{active.prompt || "（无提示词）"}</p>
            </section>
            {active.inputs.length > 0 && (
              <section className="library-detail-section">
                <h4>输入素材（{active.inputs.length}）</h4>
                <div className="library-mini-thumbs">
                  {active.inputs.map((input, index) => (
                    <span key={`${input.assetId || input.url}-${index}`} title={input.role}>
                      {input.url ? <img src={input.url} alt={input.role} /> : <i>{input.role}</i>}
                    </span>
                  ))}
                </div>
              </section>
            )}
            <section className="library-detail-section">
              <h4>管理</h4>
              <div className="library-manage-row">
                <input
                  value={renaming}
                  onChange={(event) => setRenaming(event.target.value)}
                  placeholder={active.title}
                  aria-label="新标题"
                  onKeyDown={(event) => event.key === "Enter" && void rename(active)}
                />
                <button className="soft-btn" onClick={() => void rename(active)}>重命名</button>
              </div>
              <div className="library-manage-row">
                <select
                  value={active.projectId || ""}
                  aria-label="移动到项目"
                  onChange={(event) => void moveTo(active, event.target.value || null)}
                >
                  <option value="">未归档</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
                <button className="soft-btn is-danger" onClick={() => void remove(active)}>删除作品</button>
              </div>
              <p className="library-footnote">
                文件 {compactBytes(active.size)} · 删除后作品从作品库移除，底层文件按保留策略清理。
              </p>
            </section>
          </>
        )}
      </DetailDrawer>
    </LibraryShell>
  );
}
