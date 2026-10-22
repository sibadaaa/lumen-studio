import { useEffect, useState } from "react";
import { ArrowRight, Download, Plus, RefreshCw } from "lucide-react";
import type { ProjectWithStats, UsageSummary } from "../../shared/contracts";
import { api } from "../lib/api";
import { IMG } from "../data/mock";

interface Props {
  onOpenProject: (project: { id: string; name: string }) => void;
  toast: (message: string, type?: "default" | "success") => void;
}

const DEMO_PROJECTS: ProjectWithStats[] = [
  {
    id: "proj_product",
    name: "产品短片",
    description: "15 秒竖屏产品广告 · 4 个镜头",
    coverUrl: IMG.dunes,
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stats: { sessions: 0, assets: 0, generations: 0, tokens: 0, lastActivityAt: null },
  },
  {
    id: "proj_glass",
    name: "雾中玻璃仪式",
    description: "分镜实验 · 3 个镜头",
    coverUrl: IMG.glass,
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stats: { sessions: 0, assets: 0, generations: 0, tokens: 0, lastActivityAt: null },
  },
];

const compact = (value: number) =>
  value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)}m` : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value));

const relative = (iso: string | null) => {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(iso).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
};

export function WorkspaceHome({ onOpenProject, toast }: Props) {
  const [projects, setProjects] = useState<ProjectWithStats[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [online, setOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [creatingBusy, setCreatingBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [list, summary] = await Promise.all([api.projects(), api.usage()]);
      setProjects(list.items);
      setUsage(summary);
      setOnline(true);
    } catch {
      setOnline(false);
      setProjects(DEMO_PROJECTS);
      setUsage(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const createProject = async () => {
    if (creatingBusy) return;
    setCreatingBusy(true);
    try {
      const project = await api.createProject({
        name: name.trim() || `未命名项目 ${projects.length + 1}`,
        description: "从空白画布开始",
        coverUrl: IMG.dunes,
      });
      setProjects((prev) => [project, ...prev]);
      setCreating(false);
      setName("");
      toast("项目已创建并写入 SQLite", "success");
      onOpenProject({ id: project.id, name: project.name });
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setCreatingBusy(false);
    }
  };

  const totalTokens = usage?.totalTokens ?? projects.reduce((sum, project) => sum + project.stats.tokens, 0);
  const sessions = projects.reduce((sum, project) => sum + project.stats.sessions, 0);

  return (
    <main className="workspace-home">
      <section className="wh-main">
        <header className="wh-head">
          <div>
            <span className="eyebrow">WORKSPACE</span>
            <h1>工作区</h1>
            <p>
              {online ? "本地 SQLite 工作区" : "BFF 未启动 · 显示演示项目"} · {projects.length} 个项目 ·{" "}
              {compact(totalTokens)} tokens
            </p>
          </div>
          <div className="wh-actions">
            <button className="soft-btn" onClick={() => void load()} title="重新读取项目">
              <RefreshCw size={14} /> 刷新
            </button>
            <button className="soft-btn" onClick={() => toast("导入项目将在下一阶段接入")}>
              <Download size={14} /> 导入
            </button>
            <button className="ws-primary" onClick={() => setCreating((prev) => !prev)}>
              <Plus size={14} /> 新建项目
            </button>
          </div>
        </header>

        {creating && (
          <div className="wh-create-row">
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createProject();
                if (event.key === "Escape") setCreating(false);
              }}
              placeholder="项目名称，例如「秋季香水短片」"
              maxLength={80}
            />
            <button className="ws-primary" onClick={() => void createProject()} disabled={creatingBusy}>
              {creatingBusy ? "创建中…" : "创建并打开"}
            </button>
            <button className="text-btn" onClick={() => setCreating(false)}>取消</button>
          </div>
        )}

        <div className="project-grid">
          {projects.map((project) => (
            <button
              key={project.id}
              className={`project-card ${project.status === "active" ? "is-active" : ""}`}
              onClick={() => onOpenProject({ id: project.id, name: project.name })}
            >
              <div className="project-card-cover">
                <img src={project.coverUrl || IMG.dunes} alt={`${project.name}项目封面`} />
                <span className="project-card-badge">
                  {project.status === "archived" ? "已归档" : project.stats.sessions ? "进行中" : "最近编辑"}
                </span>
                <span className="project-card-tokens">{compact(project.stats.tokens)} tokens</span>
              </div>
              <div className="project-card-body">
                <div>
                  <h2>{project.name}</h2>
                  <p>{project.description || "本地项目"}</p>
                </div>
                <span className="project-card-arrow">↗</span>
              </div>
              <div className="project-card-meta">
                <span>{project.stats.sessions} 会话</span>
                <span>{project.stats.assets} 素材</span>
                <time>{relative(project.stats.lastActivityAt || project.updatedAt)}</time>
              </div>
            </button>
          ))}

          {!loading && projects.length === 0 && (
            <button className="project-card project-new" onClick={() => setCreating(true)}>
              <span className="project-new-icon">+</span>
              <strong>新建项目</strong>
              <small>从空白画布开始，或导入素材</small>
            </button>
          )}
        </div>

        <section className="wh-activity">
          <div className="wh-section-head">
            <span>最近活动</span>
            <button onClick={() => void load()}>
              全部活动 <ArrowRight size={12} />
            </button>
          </div>
          <div className="wh-activity-list">
            {projects.slice(0, 4).map((project) => (
              <div key={project.id}>
                <span className={`wh-activity-dot ${project.stats.assets ? "image" : "storyboard"}`} />
                <div>
                  <strong>{project.name}</strong>
                  <p>
                    {project.stats.generations} 次生成 · {project.stats.sessions} 个会话 ·{" "}
                    {project.stats.assets} 个素材
                  </p>
                </div>
                <em>{compact(project.stats.tokens)} tokens</em>
                <time>{relative(project.stats.lastActivityAt || project.updatedAt)}</time>
              </div>
            ))}
            {projects.length === 0 && <p className="wh-empty-line">还没有活动记录。</p>}
          </div>
        </section>
      </section>

      <aside className="wh-side">
        <div className="wh-side-card wh-usage-card">
          <span className="eyebrow">USAGE</span>
          <div className="wh-usage-big">{compact(totalTokens)} <small>tokens</small></div>
          <p>本工作区 · {projects.length} 个项目 · {sessions} 个会话</p>
          <div className="wh-usage-bars">
            <div>
              <span>已完成生成</span>
              <i style={{ ["--w" as string]: `${usage?.generations ? Math.round(((usage.succeeded || 0) / usage.generations) * 100) : 0}%` }} />
              <em>{usage?.succeeded ?? 0}</em>
            </div>
            <div>
              <span>失败任务</span>
              <i style={{ ["--w" as string]: `${usage?.generations ? Math.round(((usage.failed || 0) / usage.generations) * 100) : 0}%` }} />
              <em>{usage?.failed ?? 0}</em>
            </div>
            <div>
              <span>输出 tokens</span>
              <i style={{ ["--w" as string]: "58%" }} />
              <em>{compact(usage?.outputTokens ?? totalTokens)}</em>
            </div>
          </div>
        </div>
        <div className="wh-side-card">
          <span className="eyebrow">STORAGE</span>
          <div className="wh-recent-files">
            <div><span className="ws-file-icon csv" /><div><strong>lumen.db</strong><small>SQLite · WAL</small></div></div>
            <div><span className="ws-file-icon video" /><div><strong>outputs/</strong><small>{usage?.generations ?? 0} 个任务输出</small></div></div>
            <div><span className="ws-file-icon img" /><div><strong>assets/</strong><small>{projects.reduce((sum, project) => sum + project.stats.assets, 0)} 个素材</small></div></div>
          </div>
        </div>
        <div className="wh-side-card wh-hint-card">
          <span className="eyebrow">START HERE</span>
          <p>选择项目进入创作台，或从 Agent 工作区用一句话描述任务。</p>
          <button className="text-btn" onClick={() => projects[0] && onOpenProject({ id: projects[0].id, name: projects[0].name })}>
            打开{projects[0]?.name || "项目"} <ArrowRight size={12} />
          </button>
        </div>
      </aside>
    </main>
  );
}
