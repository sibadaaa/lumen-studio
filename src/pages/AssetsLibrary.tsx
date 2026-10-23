import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FolderOpen, ImagePlus, LoaderCircle, RefreshCw, UploadCloud, X } from "lucide-react";
import type { AssetFacets, AssetRole, LibraryAsset } from "../../shared/contracts";
import { api } from "../lib/api";
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
  onUseInStudio: (intent: StudioIntent) => void;
  onProjectChange?: (projectId: string | null) => void;
  toast: (message: string, type?: "default" | "success") => void;
}

const SOURCE_LABELS: Record<string, string> = {
  upload: "上传",
  work: "来自作品",
  agent: "Agent",
};

interface UploadTask {
  id: string;
  name: string;
  progress: number;
  status: "uploading" | "done" | "error";
  error?: string;
}

export function AssetsLibrary({ projectId, onUseInStudio, onProjectChange, toast }: Props) {
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [projectFilter, setProjectFilter] = useState<string>(projectId || "");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 300);
  const [kind, setKind] = useState<"" | "image" | "video">("");
  const [source, setSource] = useState<"" | "upload" | "work" | "agent">("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [unused, setUnused] = useState(false);
  const [sort, setSort] = useState<"newest" | "oldest" | "size" | "name">("newest");
  const [facets, setFacets] = useState<AssetFacets | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<LibraryAsset | null>(null);
  const [usage, setUsage] = useState<Array<{ generationId: string; mode: string; role: string; createdAt: string; workId?: string }>>([]);
  const [tagInput, setTagInput] = useState("");
  const [uploads, setUploads] = useState<UploadTask[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .projects()
      .then((data) => setProjects(data.items.map((project) => ({ id: project.id, name: project.name }))))
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    setProjectFilter(projectId || "");
  }, [projectId]);

  const loadFacets = useCallback(() => {
    api
      .assetFacets()
      .then(setFacets)
      .catch(() => setFacets(null));
  }, []);

  useEffect(() => {
    loadFacets();
  }, [loadFacets]);

  const fetcher = useCallback(
    async (cursor: string | null) =>
      api.assets(
        buildQuery({
          projectId: projectFilter || undefined,
          kind: kind || undefined,
          source: source || undefined,
          tag: tagFilter || undefined,
          unused,
          q: search || undefined,
          sort,
          limit: 24,
          cursor: cursor || undefined,
        })
      ),
    [projectFilter, kind, source, tagFilter, unused, search, sort]
  );

  const list = useCursorQuery<LibraryAsset>(fetcher, [fetcher]);

  const projectName = useMemo(() => {
    const map = new Map(projects.map((project) => [project.id, project.name]));
    return (id?: string | null) => (id ? map.get(id) || id : "未归档");
  }, [projects]);

  const patchLocal = (id: string, patch: Partial<LibraryAsset>) => {
    list.setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const uploadFiles = async (files: FileList | File[]) => {
    const queue = Array.from(files).filter((file) => /\.(png|jpe?g|webp)$/i.test(file.name));
    if (queue.length === 0) {
      toast("仅支持 PNG / JPEG / WebP 图片");
      return;
    }
    const tasks: UploadTask[] = queue.map((file, index) => ({
      id: `${Date.now()}-${index}`,
      name: file.name,
      progress: 0,
      status: "uploading",
    }));
    setUploads(tasks);
    let succeeded = 0;
    for (const [index, file] of queue.entries()) {
      const task = tasks[index];
      try {
        const asset = await api.upload(file, (percent) => {
          setUploads((prev) => prev.map((item) => (item.id === task.id ? { ...item, progress: percent } : item)));
        }, projectFilter || undefined);
        succeeded += 1;
        setUploads((prev) => prev.map((item) => (item.id === task.id ? { ...item, status: "done", progress: 100 } : item)));
        if (asset.duplicateOf) toast(`「${file.name}」素材库已有相同文件，已保留本次上传`);
        list.setItems((prev) => [asset, ...prev]);
      } catch (error) {
        setUploads((prev) =>
          prev.map((item) => (item.id === task.id ? { ...item, status: "error", error: (error as Error).message } : item))
        );
      }
    }
    if (succeeded > 0) {
      toast(`已添加 ${succeeded} 张素材`, "success");
      loadFacets();
    }
    window.setTimeout(() => setUploads((prev) => prev.filter((item) => item.status === "error")), 1600);
  };

  const openDetail = async (asset: LibraryAsset) => {
    setActive(asset);
    setTagInput("");
    try {
      const detail = await api.assetUsage(asset.id);
      setUsage(detail.items);
    } catch {
      setUsage([]);
    }
  };

  const addTag = async () => {
    if (!active || !tagInput.trim()) return;
    try {
      const updated = await api.updateAsset(active.id, { tags: [...active.tags, tagInput.trim()] });
      setActive(updated);
      patchLocal(active.id, { tags: updated.tags });
      setTagInput("");
      loadFacets();
    } catch (error) {
      toast((error as Error).message);
    }
  };

  const removeTag = async (tag: string) => {
    if (!active) return;
    try {
      const updated = await api.updateAsset(active.id, { tags: active.tags.filter((item) => item !== tag) });
      setActive(updated);
      patchLocal(active.id, { tags: updated.tags });
      loadFacets();
    } catch (error) {
      toast((error as Error).message);
    }
  };

  const remove = async (asset: LibraryAsset, force = false) => {
    if (!window.confirm(`删除素材「${asset.originalName || asset.id}」？被历史作品引用时，输入缩略图将不可用。`)) return;
    try {
      await api.deleteAsset(asset.id, force);
      list.setItems((prev) => prev.filter((item) => item.id !== asset.id));
      setActive(null);
      toast("素材已删除", "success");
      loadFacets();
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes("引用") && !force) {
        if (window.confirm(`${message}\n\n仍要删除吗？`)) await remove(asset, true);
        return;
      }
      toast(message);
    }
  };

  const bulk = async (action: "move_project" | "add_tags" | "remove_tags" | "delete", payload?: { projectId?: string | null; tags?: string[] }) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (action === "delete" && !window.confirm(`删除选中的 ${ids.length} 个素材？正在使用的素材会被跳过。`)) return;
    try {
      const result = await api.bulkAssets({ action, ids, ...payload });
      if (result.failed.length > 0) {
        toast(`成功 ${result.updated} · 失败 ${result.failed.length}：${result.failed[0].message}`);
      } else {
        toast(`已更新 ${result.updated} 个素材`, "success");
      }
      setSelected(new Set());
      await list.refresh();
      loadFacets();
    } catch (error) {
      toast((error as Error).message);
    }
  };

  const roleForAsset = (asset: LibraryAsset): AssetRole => (asset.kind === "video" ? "reference" : "reference");

  const hasFilters = Boolean(projectFilter || kind || source || tagFilter || unused || search);

  return (
    <LibraryShell
      eyebrow="ASSETS"
      title="素材库"
      description="上传、整理、复用你的参考图与首帧；生成结果请在作品库中另存。"
      stats={
        <>
          <span>{list.total} 件素材</span>
          {facets && <span className="library-stats-sub">{facets.unused} 件未使用</span>}
        </>
      }
      actions={
        <>
          <button className="soft-btn" onClick={() => void list.refresh()} aria-label="刷新素材列表">
            <RefreshCw size={13} /> 刷新
          </button>
          <button className="ws-primary" onClick={() => fileRef.current?.click()}>
            <ImagePlus size={13} /> 上传素材
          </button>
        </>
      }
      toolbar={
        <div className="library-toolbar">
          <input
            className="library-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="搜索文件名、标签…"
            aria-label="搜索素材"
          />
          <select value={projectFilter} onChange={(event) => { setProjectFilter(event.target.value); onProjectChange?.(event.target.value || null); }} aria-label="按项目筛选">
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
          <select value={source} onChange={(event) => setSource(event.target.value as "" | "upload" | "work" | "agent")} aria-label="按来源筛选">
            <option value="">全部来源</option>
            <option value="upload">上传</option>
            <option value="work">来自作品</option>
            <option value="agent">Agent</option>
          </select>
          <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} aria-label="按标签筛选">
            <option value="">全部标签</option>
            {(facets?.tags || []).map((tag) => (
              <option key={tag.value} value={tag.value}>{tag.value}（{tag.count}）</option>
            ))}
          </select>
          <button className={`library-chip ${unused ? "is-active" : ""}`} aria-pressed={unused} onClick={() => setUnused((prev) => !prev)}>
            未使用
          </button>
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="排序">
            <option value="newest">最新</option>
            <option value="oldest">最早</option>
            <option value="size">最大</option>
            <option value="name">名称</option>
          </select>
          {hasFilters && (
            <button
              className="text-btn"
              onClick={() => {
                setProjectFilter("");
                setKind("");
                setSource("");
                setTagFilter("");
                setUnused(false);
                setSearchInput("");
              }}
            >
              清除筛选
            </button>
          )}
        </div>
      }
    >
      <div
        className={`library-dropzone ${dragOver ? "is-dragover" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          void uploadFiles(event.dataTransfer.files);
        }}
      >
        <UploadCloud size={15} />
        <span>拖拽图片到这里上传 · 支持 PNG / JPEG / WebP · 单张 ≤ 20MB</span>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) void uploadFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {uploads.length > 0 && (
        <div className="upload-queue" role="status">
          {uploads.map((task) => (
            <div key={task.id} className={`upload-task is-${task.status}`}>
              <span className="upload-task-name">{task.name}</span>
              <span className="upload-task-bar"><i style={{ width: `${task.progress}%` }} /></span>
              <span className="upload-task-state">
                {task.status === "error" ? task.error || "失败" : task.status === "done" ? "完成" : `${task.progress}%`}
              </span>
              {task.status === "error" && (
                <button aria-label="移除" onClick={() => setUploads((prev) => prev.filter((item) => item.id !== task.id))}>
                  <X size={11} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {list.error && <ErrorBanner message={`无法读取素材库：${list.error}`} onRetry={() => void list.refresh()} />}

      {list.loading ? (
        <SkeletonGrid />
      ) : list.items.length === 0 ? (
        <EmptyState
          title={hasFilters ? "没有符合条件的素材" : "还没有素材"}
          description={hasFilters ? "调整筛选条件，或清除筛选查看全部素材。" : "上传第一张素材，或从作品库把成片另存为素材。"}
          action={
            !hasFilters && (
              <button className="ws-primary" onClick={() => fileRef.current?.click()}>
                <ImagePlus size={13} /> 上传素材
              </button>
            )
          }
        />
      ) : (
        <>
          <div className="library-grid is-square">
            {list.items.map((asset) => (
              <MediaCard
                key={asset.id}
                kind={asset.kind === "video" ? "video" : "image"}
                url={asset.url}
                thumbnailUrl={asset.thumbnailUrl}
                title={asset.originalName || asset.id}
                selected={selected.has(asset.id)}
                onOpen={() => void openDetail(asset)}
                onToggleSelect={() =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(asset.id)) next.delete(asset.id);
                    else next.add(asset.id);
                    return next;
                  })
                }
                meta={
                  <>
                    <span>{asset.width && asset.height ? `${asset.width}×${asset.height}` : compactBytes(asset.size)}</span>
                    <span>{SOURCE_LABELS[asset.source] || asset.source}</span>
                    <span>{projectName(asset.projectId)}</span>
                    {asset.tags.length > 0 && <em className="media-card-tags">{asset.tags.slice(0, 2).join(" · ")}{asset.tags.length > 2 ? ` +${asset.tags.length - 2}` : ""}</em>}
                  </>
                }
              />
            ))}
          </div>
          {list.nextCursor && (
            <button className="library-more" onClick={() => void list.loadMore()} disabled={list.loadingMore}>
              {list.loadingMore ? <><LoaderCircle size={13} className="spin" /> 加载中…</> : `加载更多（共 ${list.total} 件）`}
            </button>
          )}
          {selected.size > 0 && (
            <SelectionBar label={`已选 ${selected.size} 件`}>
              <select
                defaultValue=""
                aria-label="批量移动项目"
                onChange={(event) => {
                  if (event.target.value === "") return;
                  void bulk("move_project", { projectId: event.target.value === "none" ? null : event.target.value });
                }}
              >
                <option value="" disabled>移动到项目…</option>
                <option value="none">未归档</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
              <button
                onClick={() => {
                  const tag = window.prompt("输入要添加的标签")?.trim();
                  if (tag) void bulk("add_tags", { tags: [tag] });
                }}
              >
                添加标签
              </button>
              <button className="is-danger" onClick={() => void bulk("delete")}>删除</button>
              <button className="text-btn" onClick={() => setSelected(new Set())}>取消</button>
            </SelectionBar>
          )}
        </>
      )}

      <DetailDrawer open={Boolean(active)} onClose={() => setActive(null)} title="素材详情">
        {active && (
          <>
            <div className="library-preview">
              {active.kind === "video" ? (
                <video src={active.url} controls preload="metadata" aria-label={active.originalName || active.id} />
              ) : (
                <img src={active.thumbnailUrl || active.url} alt={active.originalName || active.id} />
              )}
            </div>
            <div className="library-actions-row">
              <button className="ws-primary" onClick={() => onUseInStudio({ asset: active, role: roleForAsset(active) })}>
                <FolderOpen size={13} /> 在创作台使用
              </button>
              <a className="soft-btn" href={active.url} download={active.originalName || active.id}>
                <Download size={13} /> 下载
              </a>
            </div>
            <dl className="library-detail-list">
              <div><dt>文件</dt><dd>{active.originalName || active.id}</dd></div>
              <div><dt>规格</dt><dd>{active.width && active.height ? `${active.width}×${active.height}` : "—"} · {compactBytes(active.size)} · {active.mime}</dd></div>
              <div><dt>项目</dt><dd>{projectName(active.projectId)}</dd></div>
              <div><dt>来源</dt><dd>{SOURCE_LABELS[active.source] || active.source}{active.sourceRef ? ` · ${active.sourceRef}` : ""}</dd></div>
              <div><dt>引用</dt><dd>{active.usageCount > 0 ? `被 ${active.usageCount} 个任务使用` : "未被使用"}</dd></div>
              <div><dt>上传于</dt><dd>{new Date(active.createdAt).toLocaleString("zh-CN")} · {relativeTime(active.createdAt)}</dd></div>
            </dl>
            <section className="library-detail-section">
              <h4>标签（{active.tags.length}/8）</h4>
              <div className="library-tags">
                {active.tags.map((tag) => (
                  <span key={tag} className="tag-chip">
                    {tag}
                    <button aria-label={`移除标签 ${tag}`} onClick={() => void removeTag(tag)}><X size={10} /></button>
                  </span>
                ))}
                {active.tags.length < 8 && (
                  <span className="tag-input">
                    <input
                      value={tagInput}
                      onChange={(event) => setTagInput(event.target.value)}
                      onKeyDown={(event) => event.key === "Enter" && void addTag()}
                      placeholder="添加标签"
                      aria-label="添加标签"
                    />
                    <button onClick={() => void addTag()}>添加</button>
                  </span>
                )}
              </div>
            </section>
            {usage.length > 0 && (
              <section className="library-detail-section">
                <h4>被以下任务使用</h4>
                <ul className="library-usage-list">
                  {usage.slice(0, 8).map((item) => (
                    <li key={`${item.generationId}-${item.role}`}>
                      <span>{item.mode}</span>
                      <small>{item.role} · {relativeTime(item.createdAt)}</small>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section className="library-detail-section">
              <button className="soft-btn is-danger" onClick={() => void remove(active)}>删除素材</button>
              <p className="library-footnote">删除为软删除；文件按保留策略清理，正在使用的素材会被阻止删除。</p>
            </section>
          </>
        )}
      </DetailDrawer>
    </LibraryShell>
  );
}
