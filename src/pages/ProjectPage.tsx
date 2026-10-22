import { useEffect, useRef, useState } from "react";
import { ArrowRight, Bot, ImagePlus, RefreshCw, Settings2 } from "lucide-react";
import type { AgentSession, MediaAsset, ProjectWithStats } from "../../shared/contracts";
import { api } from "../lib/api";
import { IMG } from "../data/mock";

interface Props {
  projectId: string;
  onEnterStudio: () => void;
  onOpenAgent: (sessionId?: string) => void;
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

export function ProjectPage({ projectId, onEnterStudio, onOpenAgent, toast }: Props) {
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
      toast("素材已写入项目", "success");
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
            <img src={project?.coverUrl || IMG.dunes} alt={`${project?.name || "项目"}封面`} />
            <div className="pp-cover-shade" />
            <span className="pp-badge">PROJECT / SQLITE</span>
            <span className="pp-cover-meta">
              {stats ? `${stats.generations} 次生成 · ${stats.assets} 素材` : "本地项目"}
            </span>
          </div>
          <div className="pp-copy">
            <span className="eyebrow">WORKSPACE / {project?.id?.toUpperCase() || "LOCAL"}</span>
            <h1>{project?.name || (offline ? "BFF 未启动" : loading ? "加载中…" : "项目")}</h1>
            <p>
              {project?.description ||
                (offline
                  ? "启动本机 BFF 后即可读取项目、会话与素材。"
                  : "项目数据从 SQLite 读取。")}
            </p>
            <div className="pp-stats">
              <span><strong>{stats?.sessions ?? 0}</strong>会话</span>
              <span><strong>{stats?.assets ?? 0}</strong>素材</span>
              <span><strong>{compact(stats?.tokens ?? 0)}</strong>tokens</span>
              <span><strong>{stats?.generations ?? 0}</strong>生成</span>
            </div>
            <div className="pp-actions">
              <button className="ws-primary" onClick={onEnterStudio}>进入创作台 <ArrowRight size={14} /></button>
              <button className="soft-btn" onClick={() => onOpenAgent(latest?.id)}><Bot size={14} /> Agent 工作区</button>
              <button className="ghost-icon" title="重新读取" aria-label="刷新项目" onClick={() => void load()}>
                <RefreshCw size={14} />
              </button>
              <button className="ghost-icon" title="项目设置" aria-label="项目设置" onClick={() => toast("项目重命名将在下一阶段接入")}>
                <Settings2 size={14} />
              </button>
            </div>
          </div>
        </header>

        <div className="pp-grid">
          <section className="pp-sessions">
            <div className="wh-section-head">
              <span>最近会话</span>
              <span className="pp-count">{sessions.length}</span>
            </div>
            {sessions.length === 0 && (
              <button className="pp-session pp-session-empty" onClick={() => onOpenAgent()}>
                <span className="ws-session-dot" />
                <div><strong>还没有会话</strong><small>进入 Agent 工作区，用一句话描述任务</small></div>
                <ArrowRight size={13} />
              </button>
            )}
            {sessions.map((session) => (
              <button key={session.id} className="pp-session" onClick={() => onOpenAgent(session.id)}>
                <span className={`ws-session-dot ${session.status === "running" ? "is-running" : ""}`} />
                <div>
                  <strong>{session.title}</strong>
                  <small>
                    {session.status === "running" ? "Agent · 执行中" : "Agent · 已就绪"} · {session.messageCount} 条消息
                  </small>
                </div>
                <em>{compact(session.tokens)}</em><time>{relative(session.updatedAt)}</time>
              </button>
            ))}
          </section>

          <section className="pp-assets">
            <div className="wh-section-head">
              <span>项目素材</span>
              <button onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? "上传中…" : "添加"} <ImagePlus size={12} />
              </button>
            </div>
            <div className="pp-asset-grid">
              {assets.map((asset, index) => (
                <button key={asset.id} onClick={() => window.open(asset.url, "_blank")}>
                  <img src={asset.thumbnailUrl || asset.url} alt={`素材 ${index + 1}`} />
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
          <div className="pp-side-row"><span>创建时间</span><strong>{project ? new Date(project.createdAt).toLocaleDateString("zh-CN") : "—"}</strong></div>
          <div className="pp-side-row"><span>最近编辑</span><strong>{project ? relative(project.updatedAt) : "—"}</strong></div>
          <div className="pp-side-row"><span>共享</span><strong>仅本地</strong></div>
          <div className="pp-side-row"><span>存储</span><strong>SQLite</strong></div>
        </div>
        <div className="wh-side-card">
          <span className="eyebrow">NEXT STEP</span>
          <p className="pp-next">
            {latest
              ? latest.status === "running"
                ? `Agent 正在执行「${latest.title}」，完成后结果会自动写入项目。`
                : `继续「${latest.title}」，或新建会话描述新任务。`
              : "进入 Agent 工作区，用一句话生成分镜、图像或成片。"}
          </p>
          <button className="ws-primary pp-small-cta" onClick={() => onOpenAgent(latest?.id)}>
            {latest ? "继续 Agent 任务" : "开始 Agent 任务"}
          </button>
        </div>
        <div className="wh-side-card">
          <span className="eyebrow">FILES</span>
          <div className="wh-recent-files">
            <div><span className="ws-file-icon csv" /><div><strong>lumen.db</strong><small>项目与会话持久化</small></div></div>
            {assets.slice(0, 2).map((asset) => (
              <div key={asset.id}>
                <span className="ws-file-icon img" />
                <div><strong>{asset.originalName || asset.id}</strong><small>{Math.round(asset.size / 1024)} KB</small></div>
              </div>
            ))}
            {assets.length === 0 && <div><span className="ws-file-icon img" /><div><strong>暂无素材</strong><small>在右侧上传</small></div></div>}
          </div>
        </div>
      </aside>
    </main>
  );
}
