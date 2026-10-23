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
import { formatDateTime } from "../i18n/format";
import { useTranslation } from "react-i18next";
import type { StudioIntent } from "../types";

interface Props {
  projectId?: string | null;
  onUseInStudio: (intent: StudioIntent) => void;
  onProjectChange?: (projectId: string | null) => void;
  toast: (message: string, type?: "default" | "success") => void;
}

interface UploadTask {
  id: string;
  name: string;
  progress: number;
  status: "uploading" | "done" | "error";
  error?: string;
}

export function AssetsLibrary({ projectId, onUseInStudio, onProjectChange, toast }: Props) {
  const { t } = useTranslation("assets");
  const { t: tBase } = useTranslation("base");
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

  const projectName = useMemo(
    () => (id?: string | null) => (id ? projects.find((project) => project.id === id)?.name || id : tBase("unfiled")),
    [projects, tBase]
  );

  const patchLocal = (id: string, patch: Partial<LibraryAsset>) => {
    list.setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const uploadFiles = async (files: FileList | File[]) => {
    const queue = Array.from(files).filter((file) => /\.(png|jpe?g|webp)$/i.test(file.name));
    if (queue.length === 0) {
      toast(t("onlyImages"));
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
        if (asset.duplicateOf) toast(t("duplicate", { name: file.name }));
        list.setItems((prev) => [asset, ...prev]);
      } catch (error) {
        setUploads((prev) =>
          prev.map((item) => (item.id === task.id ? { ...item, status: "error", error: (error as Error).message } : item))
        );
      }
    }
    if (succeeded > 0) {
      toast(t("added", { count: succeeded }), "success");
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
    if (!window.confirm(t("drawer.deleteConfirm", { name: asset.originalName || asset.id }))) return;
    try {
      await api.deleteAsset(asset.id, force);
      list.setItems((prev) => prev.filter((item) => item.id !== asset.id));
      setActive(null);
      toast(t("drawer.deleted"), "success");
      loadFacets();
    } catch (error) {
      const message = (error as Error).message;
      if ((error as { code?: string }).code === "ASSET_REFERENCED" && !force) {
        if (window.confirm(`${message}\n\n仍要删除吗？`)) await remove(asset, true);
        return;
      }
      toast(message);
    }
  };

  const bulk = async (action: "move_project" | "add_tags" | "remove_tags" | "delete", payload?: { projectId?: string | null; tags?: string[] }) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (action === "delete" && !window.confirm(t("bulk.deleteConfirm", { count: ids.length }))) return;
    try {
      const result = await api.bulkAssets({ action, ids, ...payload });
      if (result.failed.length > 0) {
        toast(t("bulk.partial", { updated: result.updated, failed: result.failed.length, message: result.failed[0].message }));
      } else {
        toast(t("bulk.done", { count: result.updated }), "success");
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
      title={t("title")}
      description={t("desc")}
      stats={
        <>
          <span>{t("stats", { count: list.total })}</span>
          {facets && <span className="library-stats-sub">{t("statsUnused", { count: facets.unused })}</span>}
        </>
      }
      actions={
        <>
          <button className="soft-btn" onClick={() => void list.refresh()} aria-label={t("refreshAria")}>
            <RefreshCw size={13} /> {tBase("refresh")}
          </button>
          <button className="ws-primary" onClick={() => fileRef.current?.click()}>
            <ImagePlus size={13} /> {t("upload")}
          </button>
        </>
      }
      toolbar={
        <div className="library-toolbar">
          <input
            className="library-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
          />
          <select value={projectFilter} onChange={(event) => { setProjectFilter(event.target.value); onProjectChange?.(event.target.value || null); }} aria-label={t("filterProject")}>
            <option value="">{tBase("all")}</option>
            <option value="none">{tBase("unfiled")}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
          <select value={kind} onChange={(event) => setKind(event.target.value as "" | "image" | "video")} aria-label={t("filterKind")}>
            <option value="">{t("kind.all")}</option>
            <option value="image">{t("kind.image")}</option>
            <option value="video">{t("kind.video")}</option>
          </select>
          <select value={source} onChange={(event) => setSource(event.target.value as "" | "upload" | "work" | "agent")} aria-label={t("filterSource")}>
            <option value="">{t("source.all")}</option>
            <option value="upload">{t("source.upload")}</option>
            <option value="work">{t("source.work")}</option>
            <option value="agent">{t("source.agent")}</option>
          </select>
          <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} aria-label={t("filterTag")}>
            <option value="">{t("tagAll")}</option>
            {(facets?.tags || []).map((tag) => (
              <option key={tag.value} value={tag.value}>{t("tagWithCount", { tag: tag.value, count: tag.count })}</option>
            ))}
          </select>
          <button className={`library-chip ${unused ? "is-active" : ""}`} aria-pressed={unused} onClick={() => setUnused((prev) => !prev)}>
            {t("unused")}
          </button>
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label={t("sortLabel")}>
            <option value="newest">{t("sort.newest")}</option>
            <option value="oldest">{t("sort.oldest")}</option>
            <option value="size">{t("sort.size")}</option>
            <option value="name">{t("sort.name")}</option>
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
              {tBase("clearFilters")}
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
        <span>{t("dropzone")}</span>
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
                {task.status === "error" ? task.error || t("uploadFailed") : task.status === "done" ? t("uploadDone") : `${task.progress}%`}
              </span>
              {task.status === "error" && (
                <button aria-label={tBase("delete")} onClick={() => setUploads((prev) => prev.filter((item) => item.id !== task.id))}>
                  <X size={11} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {list.error && <ErrorBanner message={t("errorRead", { message: list.error })} onRetry={() => void list.refresh()} />}

      {list.loading ? (
        <SkeletonGrid />
      ) : list.items.length === 0 ? (
        <EmptyState
          title={hasFilters ? t("emptyFilteredTitle") : t("emptyTitle")}
          description={hasFilters ? t("emptyFilteredBody") : t("emptyBody")}
          action={
            !hasFilters && (
              <button className="ws-primary" onClick={() => fileRef.current?.click()}>
                <ImagePlus size={13} /> {t("upload")}
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
                    <span>{t(`source.${asset.source}`)}</span>
                    <span>{projectName(asset.projectId)}</span>
                    {asset.tags.length > 0 && <em className="media-card-tags">{asset.tags.slice(0, 2).join(" · ")}{asset.tags.length > 2 ? ` +${asset.tags.length - 2}` : ""}</em>}
                  </>
                }
              />
            ))}
          </div>
          {list.nextCursor && (
            <button className="library-more" onClick={() => void list.loadMore()} disabled={list.loadingMore}>
              {list.loadingMore ? <><LoaderCircle size={13} className="spin" /> {tBase("loadingMore")}</> : t("loadMore", { count: list.total })}
            </button>
          )}
          {selected.size > 0 && (
            <SelectionBar label={tBase("selected", { count: selected.size })}>
              <select
                defaultValue=""
                aria-label={t("bulk.movePlaceholder")}
                onChange={(event) => {
                  if (event.target.value === "") return;
                  void bulk("move_project", { projectId: event.target.value === "none" ? null : event.target.value });
                }}
              >
                <option value="" disabled>{t("bulk.movePlaceholder")}</option>
                <option value="none">{tBase("unfiled")}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
              <button
                onClick={() => {
                  const tag = window.prompt(t("bulk.addTagsPrompt"))?.trim();
                  if (tag) void bulk("add_tags", { tags: [tag] });
                }}
              >
                {t("bulk.addTags")}
              </button>
              <button className="is-danger" onClick={() => void bulk("delete")}>{tBase("delete")}</button>
              <button className="text-btn" onClick={() => setSelected(new Set())}>{tBase("cancel")}</button>
            </SelectionBar>
          )}
        </>
      )}

      <DetailDrawer open={Boolean(active)} onClose={() => setActive(null)} title={t("drawer.title")}>
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
                <FolderOpen size={13} /> {t("drawer.useInStudio")}
              </button>
              <a className="soft-btn" href={active.url} download={active.originalName || active.id}>
                <Download size={13} /> {tBase("download")}
              </a>
            </div>
            <dl className="library-detail-list">
              <div><dt>{t("drawer.file")}</dt><dd>{active.originalName || active.id}</dd></div>
              <div><dt>{t("drawer.spec")}</dt><dd>{active.width && active.height ? `${active.width}×${active.height}` : "—"} · {compactBytes(active.size)} · {active.mime}</dd></div>
              <div><dt>{t("drawer.project")}</dt><dd>{projectName(active.projectId)}</dd></div>
              <div><dt>{t("drawer.source")}</dt><dd>{t(`source.${active.source}`)}{active.sourceRef ? ` · ${active.sourceRef}` : ""}</dd></div>
              <div><dt>{t("drawer.usage")}</dt><dd>{active.usageCount > 0 ? t("drawer.usedBy", { count: active.usageCount }) : t("drawer.unused")}</dd></div>
              <div><dt>{t("drawer.uploadedAt")}</dt><dd>{formatDateTime(active.createdAt)} · {relativeTime(active.createdAt)}</dd></div>
            </dl>
            <section className="library-detail-section">
              <h4>{t("drawer.tags", { count: active.tags.length })}</h4>
              <div className="library-tags">
                {active.tags.map((tag) => (
                  <span key={tag} className="tag-chip">
                    {tag}
                    <button aria-label={t("drawer.removeTagAria", { tag })} onClick={() => void removeTag(tag)}><X size={10} /></button>
                  </span>
                ))}
                {active.tags.length < 8 && (
                  <span className="tag-input">
                    <input
                      value={tagInput}
                      onChange={(event) => setTagInput(event.target.value)}
                      onKeyDown={(event) => event.key === "Enter" && void addTag()}
                      placeholder={t("drawer.tagPlaceholder")}
                      aria-label={t("drawer.tagPlaceholder")}
                    />
                    <button onClick={() => void addTag()}>{t("drawer.addTag")}</button>
                  </span>
                )}
              </div>
            </section>
            {usage.length > 0 && (
              <section className="library-detail-section">
                <h4>{t("drawer.usageTitle")}</h4>
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
              <button className="soft-btn is-danger" onClick={() => void remove(active)}>{t("drawer.delete")}</button>
              <p className="library-footnote">{t("drawer.deleteNote")}</p>
            </section>
          </>
        )}
      </DetailDrawer>
    </LibraryShell>
  );
}
