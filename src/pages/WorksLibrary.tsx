import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { formatDateTime } from "../i18n/format";
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
  const { t } = useTranslation("works");
  const { t: tBase } = useTranslation("base");
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

  const projectName = useMemo(
    () => (id?: string | null) => (id ? projects.find((project) => project.id === id)?.name || id : tBase("unfiled")),
    [projects, tBase]
  );

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
      toast(t("drawer.renamed"), "success");
    } catch (error) {
      toast((error as Error).message);
    }
  };

  const moveTo = async (work: Work, target: string | null) => {
    try {
      const updated = await api.updateWork(work.id, { projectId: target });
      patchLocal(work.id, { projectId: updated.projectId });
      setActive(updated);
      toast(t("drawer.moved"), "success");
    } catch (error) {
      toast((error as Error).message);
    }
  };

  const remove = async (work: Work) => {
    if (!window.confirm(t("drawer.deleteConfirm", { title: work.title }))) return;
    try {
      await api.deleteWork(work.id);
      list.setItems((prev) => prev.filter((item) => item.id !== work.id));
      setActive(null);
      toast(t("drawer.deleted"), "success");
    } catch (error) {
      toast((error as Error).message);
    }
  };

  const saveToAssets = async (work: Work) => {
    setBusy(true);
    try {
      const result = await api.saveWorkToAssets(work.id);
      toast(result.created ? t("drawer.savedToAssets") : t("drawer.alreadySaved"), "success");
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
    if (action === "delete" && !window.confirm(t("bulk.deleteConfirm", { count: ids.length }))) return;
    setBusy(true);
    try {
      const result = await api.bulkWorks({ action, ids, projectId: target });
      if (result.failed.length > 0) {
        toast(t("bulk.partial", { updated: result.updated, failed: result.failed.length, message: result.failed[0].message }));
      } else {
        toast(action === "save_to_assets" ? t("bulk.saved", { count: result.created || 0 }) : t("bulk.done", { count: result.updated }), "success");
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
      title={t("title")}
      description={t("desc")}
      stats={
        <>
          <span>{t("stats", { count: list.total })}</span>
          {!list.loading && <span className="library-stats-sub">{t("statsTokens", { count: compactTokens(list.items.reduce((sum, item) => sum + item.usage.totalTokens, 0)) })}</span>}
        </>
      }
      actions={
        <button className="soft-btn" onClick={() => void list.refresh()} aria-label={tBase("refresh")}>
          <RefreshCw size={13} /> {tBase("refresh")}
        </button>
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
          <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} aria-label={t("filterProject")}>
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
          <select value={mode} onChange={(event) => setMode(event.target.value as "" | GenerationMode)} aria-label={t("filterMode")}>
            <option value="">{t("modeAll")}</option>
            {MODE_OPTIONS.map((item) => (
              <option key={item} value={item}>{MODE_LABELS[item]}</option>
            ))}
          </select>
          <button className={`library-chip ${favorite ? "is-active" : ""}`} aria-pressed={favorite} onClick={() => setFavorite((prev) => !prev)}>
            {t("favorite")}
          </button>
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label={t("sortLabel")}>
            <option value="newest">{t("sort.newest")}</option>
            <option value="oldest">{t("sort.oldest")}</option>
            <option value="tokens">{t("sort.tokens")}</option>
            <option value="duration">{t("sort.duration")}</option>
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
              {tBase("clearFilters")}
            </button>
          )}
        </div>
      }
    >
      {list.error && <ErrorBanner message={t("errorRead", { message: list.error })} onRetry={() => void list.refresh()} />}

      {list.loading ? (
        <SkeletonGrid />
      ) : list.items.length === 0 ? (
        <EmptyState
          title={hasFilters ? t("emptyFilteredTitle") : t("emptyTitle")}
          description={hasFilters ? t("emptyFilteredBody") : t("emptyBody")}
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
              {list.loadingMore ? <><LoaderCircle size={13} className="spin" /> {tBase("loadingMore")}</> : <><Plus size={13} /> {t("loadMore", { count: list.total })}</>}
            </button>
          )}
          {selected.size > 0 && (
            <SelectionBar label={tBase("selected", { count: selected.size })}>
              <button disabled={busy} onClick={() => void bulk("favorite")}>{tBase("favorite")}</button>
              <button disabled={busy} onClick={() => void bulk("unfavorite")}>{tBase("unfavorite")}</button>
              <button disabled={busy} onClick={() => void bulk("save_to_assets")}>{t("bulk.save")}</button>
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
                <option value="" disabled>{t("bulk.movePlaceholder")}</option>
                <option value="none">{tBase("unfiled")}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
              <button className="is-danger" disabled={busy} onClick={() => void bulk("delete")}>{tBase("delete")}</button>
              <button className="text-btn" onClick={() => setSelected(new Set())}>{tBase("cancel")}</button>
            </SelectionBar>
          )}
        </>
      )}

      <DetailDrawer open={Boolean(active)} onClose={() => setActive(null)} title={t("drawer.title")} wide>
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
                <Download size={13} /> {tBase("download")}
              </a>
              <button className="ws-primary" onClick={() => reuse(active)}>
                <Sparkles size={13} /> {t("drawer.reuse")}
              </button>
              <button className="soft-btn" onClick={() => reuse(active, true)}>{t("drawer.variant")}</button>
              <button className="soft-btn" disabled={busy} onClick={() => void saveToAssets(active)}>{t("drawer.saveToAssets")}</button>
            </div>
            <dl className="library-detail-list">
              <div><dt>{t("drawer.model")}</dt><dd>{active.providerId} · {active.modelId}</dd></div>
              <div><dt>{t("drawer.spec")}</dt><dd>{active.params.resolution || "—"} · {active.params.aspectRatio || "—"}{active.durationSec ? ` · ${Math.round(active.durationSec)}s` : ""}</dd></div>
              <div><dt>{t("drawer.usage")}</dt><dd>{active.usage.totalTokens.toLocaleString()} tokens{active.usage.estimated ? t("drawer.usageEstimated") : t("drawer.usageActual")}</dd></div>
              <div><dt>{t("drawer.project")}</dt><dd>{projectName(active.projectId)}</dd></div>
              <div><dt>{t("drawer.source")}</dt><dd>{active.source === "agent" ? t("drawer.sourceAgent") : t("drawer.sourceStudio")} · {active.generationId}</dd></div>
              <div><dt>{t("drawer.time")}</dt><dd>{formatDateTime(active.createdAt)}</dd></div>
            </dl>
            <section className="library-detail-section">
              <h4>{t("drawer.prompt")} <button className="text-btn" onClick={() => void navigator.clipboard.writeText(active.prompt)}>{tBase("copy")}</button></h4>
              <p>{active.prompt || "（无提示词）"}</p>
            </section>
            {active.inputs.length > 0 && (
              <section className="library-detail-section">
                <h4>{t("drawer.inputs", { count: active.inputs.length })}</h4>
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
              <h4>{t("drawer.manage")}</h4>
              <div className="library-manage-row">
                <input
                  value={renaming}
                  onChange={(event) => setRenaming(event.target.value)}
                  placeholder={active.title}
                  aria-label={t("drawer.newTitle")}
                  onKeyDown={(event) => event.key === "Enter" && void rename(active)}
                />
                <button className="soft-btn" onClick={() => void rename(active)}>{tBase("rename")}</button>
              </div>
              <div className="library-manage-row">
                <select
                  value={active.projectId || ""}
                  aria-label={t("drawer.moveLabel")}
                  onChange={(event) => void moveTo(active, event.target.value || null)}
                >
                  <option value="">{tBase("unfiled")}</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
                <button className="soft-btn is-danger" onClick={() => void remove(active)}>{t("drawer.delete")}</button>
              </div>
              <p className="library-footnote">
                {t("drawer.file", { size: compactBytes(active.size) })} · {t("drawer.deleteNote")}
              </p>
            </section>
          </>
        )}
      </DetailDrawer>
    </LibraryShell>
  );
}
