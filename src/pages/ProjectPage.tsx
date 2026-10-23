import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Bot, ImagePlus, RefreshCw, Settings2 } from "lucide-react";
import type { AgentSession, MediaAsset, ProjectWithStats } from "../../shared/contracts";
import { api } from "../lib/api";
import { relativeTime, formatDate } from "../i18n/format";
import { IMG } from "../data/mock";

interface Props {
  projectId: string;
  onEnterStudio: () => void;
  onOpenAgent: (sessionId?: string) => void;
  onOpenAssets?: (projectId: string) => void;
  toast: (message: string, type?: "default" | "success") => void;
}

const compact = (value: number) =>
  value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)}m` : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value));

const relative = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(iso).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
};

export function ProjectPage({ projectId, onEnterStudio, onOpenAgent, onOpenAssets, toast }: Props) {
  const { t } = useTranslation("project");
  const { t: tBase } = useTranslation("base");
  const [project, setProject] = useState<ProjectWithStats | null>(null);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const detail = await api.project(projectId);
      setProject({ ...detail.project, stats: detail.stats });
      setSessions(detail.sessions);
      setAssets(detail.assets);
      setOffline(false);
    } catch {
      setOffline(true);
      setProject(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const asset = await api.upload(file, undefined, projectId);
        setAssets((prev) => [asset, ...prev]);
      }
      toast(t("uploadOk"), "success");
      await load();
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const latest = sessions[0];
  const stats = project?.stats;

  return (
    <main className="project-page">
      <section className="pp-main">
        <header className="pp-hero">
          <div className="pp-cover">
            <img src={project?.coverUrl || IMG.dunes} alt={t("coverAlt", { name: project?.name || t("titleFallback") })} />
            <div className="pp-cover-shade" />
            <span className="pp-badge">PROJECT / SQLITE</span>
            <span className="pp-cover-meta">
              {stats ? t("heroMeta", { generations: stats.generations, assets: stats.assets }) : t("localProject")}
            </span>
          </div>
          <div className="pp-copy">
            <span className="eyebrow">WORKSPACE / {project?.id?.toUpperCase() || "LOCAL"}</span>
            <h1>{project?.name || (offline ? tBase("offline") : loading ? t("loadFallback") : t("titleFallback"))}</h1>
            <p>
              {project?.description ||
                (offline ? t("pageDescOffline") : t("pageDescOnline"))}
            </p>
            <div className="pp-stats">
              <span><strong>{stats?.sessions ?? 0}</strong>{t("statSessions")}</span>
              <span><strong>{stats?.assets ?? 0}</strong>{t("statAssets")}</span>
              <span><strong>{compact(stats?.tokens ?? 0)}</strong>{t("statTokens")}</span>
              <span><strong>{stats?.generations ?? 0}</strong>{t("statGenerations")}</span>
            </div>
            <div className="pp-actions">
              <button className="ws-primary" onClick={onEnterStudio}>{t("enterStudio")} <ArrowRight size={14} /></button>
              <button className="soft-btn" onClick={() => onOpenAgent(latest?.id)}><Bot size={14} /> {t("agent")}</button>
              <button className="ghost-icon" title={t("refreshAria")} aria-label={t("refreshAria")} onClick={() => void load()}>
                <RefreshCw size={14} />
              </button>
              <button className="ghost-icon" title={t("settingsToast")} aria-label={t("settingsToast")} onClick={() => toast(t("settingsToast"))}>
                <Settings2 size={14} />
              </button>
            </div>
          </div>
        </header>

        <div className="pp-grid">
          <section className="pp-sessions">
            <div className="wh-section-head">
              <span>{t("sessionsTitle")}</span>
              <span className="pp-count">{sessions.length}</span>
            </div>
            {sessions.length === 0 && (
              <button className="pp-session pp-session-empty" onClick={() => onOpenAgent()}>
                <span className="ws-session-dot" />
                <div><strong>{t("sessionsEmpty")}</strong><small>{t("sessionsEmptyHint")}</small></div>
                <ArrowRight size={13} />
              </button>
            )}
            {sessions.map((session) => (
              <button key={session.id} className="pp-session" onClick={() => onOpenAgent(session.id)}>
                <span className={`ws-session-dot ${session.status === "running" ? "is-running" : ""}`} />
                <div>
                  <strong>{session.title}</strong>
                  <small>
                    {session.status === "running" ? t("sessionRunning") : t("sessionReady")} · {t("messages", { count: session.messageCount })}
                  </small>
                </div>
                <em>{compact(session.tokens)}</em><time>{relative(session.updatedAt)}</time>
              </button>
            ))}
          </section>

          <section className="pp-assets">
            <div className="wh-section-head">
              {onOpenAssets ? (
                <button className="pp-assets-link" onClick={() => onOpenAssets(projectId)} title={t("openAssets")}>
                  {t("assetsTitle")} <ArrowRight size={11} />
                </button>
              ) : (
                <span>{t("assetsTitle")}</span>
              )}
              <button onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? t("uploading") : t("add", { ns: "base" })} <ImagePlus size={12} />
              </button>
            </div>
            <div className="pp-asset-grid">
              {assets.map((asset, index) => (
                <button key={asset.id} onClick={() => window.open(asset.url, "_blank")}>
                  <img src={asset.thumbnailUrl || asset.url} alt={t("assetAlt", { index: index + 1 })} />
                  <span>{String(index + 1).padStart(2, "0")}</span>
                </button>
              ))}
              <button className="pp-asset-add" onClick={() => fileRef.current?.click()}>+</button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              hidden
              onChange={(event) => {
                void upload(event.target.files);
                event.target.value = "";
              }}
            />
          </section>
        </div>
      </section>

      <aside className="pp-side">
        <div className="wh-side-card">
          <span className="eyebrow">PROJECT</span>
          <div className="pp-side-row"><span>{t("createdAt")}</span><strong>{project ? formatDate(project.createdAt) : "—"}</strong></div>
          <div className="pp-side-row"><span>{t("lastEdited")}</span><strong>{project ? relativeTime(project.updatedAt) : "—"}</strong></div>
          <div className="pp-side-row"><span>{t("share")}</span><strong>{t("shareValue")}</strong></div>
          <div className="pp-side-row"><span>{t("storage")}</span><strong>{t("storageValue")}</strong></div>
        </div>
        <div className="wh-side-card">
          <span className="eyebrow">NEXT STEP</span>
          <p className="pp-next">
            {latest
              ? latest.status === "running"
                ? t("nextRunning", { title: latest.title })
                : t("nextReady", { title: latest.title })
              : t("nextEmpty")}
          </p>
          <button className="ws-primary pp-small-cta" onClick={() => onOpenAgent(latest?.id)}>
            {latest ? t("continueAgent") : t("startAgent")}
          </button>
        </div>
        <div className="wh-side-card">
          <span className="eyebrow">FILES</span>
          <div className="wh-recent-files">
            <div><span className="ws-file-icon csv" /><div><strong>lumen.db</strong><small>{t("filesPersist")}</small></div></div>
            {assets.slice(0, 2).map((asset) => (
              <div key={asset.id}>
                <span className="ws-file-icon img" />
                <div><strong>{asset.originalName || asset.id}</strong><small>{Math.round(asset.size / 1024)} KB</small></div>
              </div>
            ))}
            {assets.length === 0 && <div><span className="ws-file-icon img" /><div><strong>{t("filesNone")}</strong><small>{t("filesHint")}</small></div></div>}
          </div>
        </div>
      </aside>
    </main>
  );
}
