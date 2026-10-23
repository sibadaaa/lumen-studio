import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Download, Plus, RefreshCw } from "lucide-react";
import type { ProjectWithStats, UsageSummary } from "../../shared/contracts";
import { api } from "../lib/api";
import { relativeTime } from "../i18n/format";
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
  return relativeTime(iso);
};

export function WorkspaceHome({ onOpenProject, toast }: Props) {
  const { t } = useTranslation("workspace");
  const { t: tBase } = useTranslation("base");
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
        name: name.trim() || t("defaultProjectName", { count: projects.length + 1 }),
        description: t("defaultProjectDesc"),
        coverUrl: IMG.dunes,
      });
      setProjects((prev) => [project, ...prev]);
      setCreating(false);
      setName("");
      toast(t("created"), "success");
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
            <h1>{t("title")}</h1>
            <p>
              {online
                ? t("descOnline", { projects: projects.length, tokens: compact(totalTokens) })
                : t("descOffline", { projects: projects.length })}
            </p>
          </div>
          <div className="wh-actions">
            <button className="soft-btn" onClick={() => void load()} title={t("refresh")}>
              <RefreshCw size={14} /> {t("refresh")}
            </button>
            <button className="soft-btn" onClick={() => toast(t("import"))}>
              <Download size={14} /> {t("import")}
            </button>
            <button className="ws-primary" onClick={() => setCreating((prev) => !prev)}>
              <Plus size={14} /> {t("newProject")}
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
              placeholder={t("createPlaceholder")}
              maxLength={80}
            />
            <button className="ws-primary" onClick={() => void createProject()} disabled={creatingBusy}>
              {creatingBusy ? t("creating") : t("createAndOpen")}
            </button>
            <button className="text-btn" onClick={() => setCreating(false)}>{tBase("cancel")}</button>
          </div>
        )}

        <div className="project-grid">
          {projects.map((project) => (
            <button
              key={project.id}
              className={`project-card ${project.status === "active" ? "is-active" : ""}`}
              onClick={() => onOpenProject({ id: project.id, name: project.name })}
              aria-label={`${project.name}`}
            >
              <div className="project-card-cover">
                <img src={project.coverUrl || IMG.dunes} alt={t("coverAlt", { name: project.name })} />
                <span className="project-card-badge">
                  {project.status === "archived" ? t("badgeArchived") : project.stats.sessions ? t("badgeActive") : t("badgeRecent")}
                </span>
                <span className="project-card-tokens">{compact(project.stats.tokens)} tokens</span>
              </div>
              <div className="project-card-body">
                <div>
                  <h2>{project.name}</h2>
                  <p>{project.description || t("localProject")}</p>
                </div>
                <span className="project-card-arrow">↗</span>
              </div>
              <div className="project-card-meta">
                <span>{project.stats.sessions} {t("sessions")}</span>
                <span>{project.stats.assets} {t("assets")}</span>
                <time>{relative(project.stats.lastActivityAt || project.updatedAt)}</time>
              </div>
            </button>
          ))}

          {!loading && projects.length === 0 && (
            <button className="project-card project-new" onClick={() => setCreating(true)}>
              <span className="project-new-icon">+</span>
              <strong>{t("newProject")}</strong>
              <small>{t("startBody")}</small>
            </button>
          )}
        </div>

        <section className="wh-activity">
          <div className="wh-section-head">
            <span>{t("activityTitle")}</span>
            <button onClick={() => void load()}>
              {t("activityAll")} <ArrowRight size={12} />
            </button>
          </div>
          <div className="wh-activity-list">
            {projects.slice(0, 4).map((project) => (
              <div key={project.id}>
                <span className={`wh-activity-dot ${project.stats.assets ? "image" : "storyboard"}`} />
                <div>
                  <strong>{project.name}</strong>
                  <p>{t("activityLine", { generations: project.stats.generations, sessions: project.stats.sessions, assets: project.stats.assets })}</p>
                </div>
                <em>{compact(project.stats.tokens)} tokens</em>
                <time>{relative(project.stats.lastActivityAt || project.updatedAt)}</time>
              </div>
            ))}
            {projects.length === 0 && <p className="wh-empty-line">{t("activityEmpty")}</p>}
          </div>
        </section>
      </section>

      <aside className="wh-side">
        <div className="wh-side-card wh-usage-card">
          <span className="eyebrow">USAGE</span>
          <div className="wh-usage-big">{compact(totalTokens)} <small>{t("tokensLabel")}</small></div>
          <p>{t("usageTitle")} · {t("usageProjects", { count: projects.length })} · {t("usageSessions", { count: sessions })}</p>
          <div className="wh-usage-bars">
            <div>
              <span>{t("usageDone")}</span>
              <i style={{ ["--w" as string]: `${usage?.generations ? Math.round(((usage.succeeded || 0) / usage.generations) * 100) : 0}%` }} />
              <em>{usage?.succeeded ?? 0}</em>
            </div>
            <div>
              <span>{t("usageFailed")}</span>
              <i style={{ ["--w" as string]: `${usage?.generations ? Math.round(((usage.failed || 0) / usage.generations) * 100) : 0}%` }} />
              <em>{usage?.failed ?? 0}</em>
            </div>
            <div>
              <span>{t("usageOutput")}</span>
              <i style={{ ["--w" as string]: "58%" }} />
              <em>{compact(usage?.outputTokens ?? totalTokens)}</em>
            </div>
          </div>
        </div>
        <div className="wh-side-card">
          <span className="eyebrow">STORAGE</span>
          <div className="wh-recent-files">
            <div><span className="ws-file-icon csv" /><div><strong>lumen.db</strong><small>{t("storageDb")}</small></div></div>
            <div><span className="ws-file-icon video" /><div><strong>outputs/</strong><small>{t("storageOutputs", { count: usage?.generations ?? 0 })}</small></div></div>
            <div><span className="ws-file-icon img" /><div><strong>assets/</strong><small>{t("storageAssets", { count: projects.reduce((sum, project) => sum + project.stats.assets, 0) })}</small></div></div>
          </div>
        </div>
        <div className="wh-side-card wh-hint-card">
          <span className="eyebrow">START HERE</span>
          <p>{t("startBody")}</p>
          <button className="text-btn" onClick={() => projects[0] && onOpenProject({ id: projects[0].id, name: projects[0].name })}>
            {t("startOpen", { name: projects[0]?.name || tBase("unfiled") })} <ArrowRight size={12} />
          </button>
        </div>
      </aside>
    </main>
  );
}
