import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Film,
  MoreHorizontal,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import type {
  AgentEvent,
  AgentMessage,
  AgentPlanStep,
  AgentSession,
  AgentToolState,
  MediaAsset,
  ProjectWithStats,
  SystemInfo,
} from "../../shared/contracts";
import { api, subscribeAgentEvents } from "../lib/api";
import { useStudio } from "../studio/StudioContext";

interface Props {
  hidden: boolean;
  projectId: string;
  initialSessionId?: string | null;
  onBackToStudio: () => void;
  onOpenApi: () => void;
  toast: (message: string, type?: "default" | "success") => void;
}

const compact = (value: number) =>
  value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)}m` : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value));

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });

const relative = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(iso).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
};

const TOOL_ICONS: Record<string, typeof Wrench> = {
  "workspace.inspect": Wrench,
  "storyboard.plan": Sparkles,
  "intent.resolve": Sparkles,
  "media.generate": Film,
  "ffmpeg.compose": Film,
};

function ToolCard({ tool, onOpenStoryboard }: { tool: AgentToolState; onOpenStoryboard: () => void }) {
  const Icon = TOOL_ICONS[tool.name] || Wrench;
  const data = tool.data || {};
  const rows = Array.isArray(data.rows) ? (data.rows as Array<{ shot: string; motion: string; desc: string; dur: number }>) : [];
  const outputs = Array.isArray(data.outputs) ? (data.outputs as MediaAsset[]) : [];
  const inspect = tool.name === "workspace.inspect";
  return (
    <details className="ws-tool" open={tool.status !== "done" || rows.length > 0}>
      <summary>
        <span className={`ws-tool-icon ${tool.status}`}>
          {tool.status === "done" ? <Check size={13} /> : tool.status === "failed" ? <X size={13} /> : <RefreshCw size={13} />}
        </span>
        <span className="ws-tool-name">
          <strong>{tool.name}</strong>
          <small>{tool.detail}</small>
        </span>
        <span className={`ws-tool-status ${tool.status}`}>
          {tool.status === "done" ? "成功" : tool.status === "failed" ? "失败" : "运行中"}
        </span>
        {tool.tokens ? <span className="ws-tool-tokens">{compact(tool.tokens)} tokens</span> : <span className="ws-tool-tokens">—</span>}
        <ChevronDown className="ws-chevron" size={12} />
      </summary>
      <div className="ws-tool-body">
        {inspect && (
          <>
            <div className="ws-kv"><span>项目</span><code>{String(data.project || "—")}</code></div>
            <div className="ws-kv"><span>素材</span><code>{String(data.assets ?? 0)} images</code></div>
            <div className="ws-kv"><span>Provider</span><code>{String(data.provider || "—")}</code></div>
            <div className="ws-kv"><span>编码 / 存储</span><code>FFmpeg {data.ffmpeg ? "可用" : "不可用"} · {String(data.database || "sqlite")}</code></div>
          </>
        )}
        {rows.length > 0 && (
          <>
            <div className="ws-mini-table">
              <div className="ws-mini-row head"><span>#</span><span>景别</span><span>运镜</span><span>画面</span><span>时长</span></div>
              {rows.map((row, index) => (
                <div className="ws-mini-row" key={`${row.shot}-${index}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <span>{row.shot}</span>
                  <span>{row.motion}</span>
                  <span>{row.desc}</span>
                  <span>{Number(row.dur).toFixed(1)}s</span>
                </div>
              ))}
            </div>
            <button className="ws-inline-action" onClick={onOpenStoryboard}>
              在创作台打开分镜表 <ArrowRight size={12} />
            </button>
          </>
        )}
        {outputs.length > 0 && (
          <div className="ws-gen-grid">
            {outputs.map((output) =>
              output.kind === "video" ? (
                <div className="ws-gen-video" key={output.id}>
                  <video src={output.url} poster={output.thumbnailUrl} controls playsInline preload="metadata" />
                </div>
              ) : (
                <a className="ws-gen-thumb" key={output.id} href={output.url} target="_blank" rel="noreferrer">
                  <img src={output.thumbnailUrl || output.url} alt="生成结果" />
                  <span>IMG</span>
                </a>
              )
            )}
          </div>
        )}
        {!inspect && rows.length === 0 && outputs.length === 0 && (
          <div className="ws-kv"><span>状态</span><code>{tool.detail}</code></div>
        )}
        {data.jobId ? <div className="ws-kv"><span>任务</span><code>{String(data.jobId)}</code></div> : null}
      </div>
    </details>
  );
}

function PlanCard({ steps }: { steps: AgentPlanStep[] }) {
  if (!steps.length) return null;
  const done = steps.filter((step) => step.status === "done").length;
  return (
    <div className="ws-plan">
      <div className="ws-plan-head"><span>执行计划</span><strong>{done} / {steps.length}</strong></div>
      {steps.map((step) => (
        <div key={step.id} className={`ws-plan-step ${step.status}`}>
          <i>{step.status === "done" ? "✓" : step.status === "failed" ? "!" : ""}</i>
          <span>{step.label}</span>
          <em>{step.note || (step.status === "running" ? "进行中" : step.status === "pending" ? "待执行" : "")}</em>
        </div>
      ))}
    </div>
  );
}

function Outputs({ outputs }: { outputs: MediaAsset[] }) {
  if (!outputs.length) return null;
  return (
    <div className="ws-outputs">
      {outputs.map((output) =>
        output.kind === "video" ? (
          <div className="ws-output-video" key={output.id}>
            <video src={output.url} poster={output.thumbnailUrl} controls playsInline preload="metadata" />
            <div className="ws-output-meta">
              <span>{output.width}×{output.height} · {(output.durationSec || 0).toFixed(1)}s</span>
              <a href={output.url} download>下载 MP4</a>
            </div>
          </div>
        ) : (
          <a className="ws-output-image" key={output.id} href={output.url} target="_blank" rel="noreferrer">
            <img src={output.url} alt="生成结果" />
            <span>{output.width}×{output.height} · 下载</span>
          </a>
        )
      )}
    </div>
  );
}

export function AgentWorkspace({ hidden, projectId, initialSessionId, onBackToStudio, onOpenApi, toast }: Props) {
  const studio = useStudio();
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [session, setSession] = useState<AgentSession | null>(null);
  const [query, setQuery] = useState("");
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState("Agent 已就绪");
  const [plan, setPlan] = useState<AgentPlanStep[]>([]);
  const [tools, setTools] = useState<AgentToolState[]>([]);
  const [progress, setProgress] = useState<{ progress: number; stage: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [project, setProject] = useState<ProjectWithStats | null>(null);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [online, setOnline] = useState(true);
  const threadRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<(() => void) | null>(null);

  const openStoryboard = () => {
    studio.openStoryboard();
    onBackToStudio();
    toast("已打开分镜表", "success");
  };

  const subscribe = (sessionId: string) => {
    closeRef.current?.();
    closeRef.current = null;
    setRunning(true);
    setError(null);
    closeRef.current = subscribeAgentEvents(
      sessionId,
      (event: AgentEvent) => {
        switch (event.type) {
          case "snapshot":
            setSession(event.session);
            setMessages(event.messages);
            break;
          case "status":
            setRunning(event.status === "running");
            setStage(event.stage);
            break;
          case "plan":
            setPlan(event.steps);
            break;
          case "tool":
            setTools((prev) => {
              const index = prev.findIndex((item) => item.id === event.tool.id);
              if (index === -1) return [...prev, event.tool];
              const next = [...prev];
              next[index] = event.tool;
              return next;
            });
            break;
          case "progress":
            setProgress({ progress: event.progress, stage: event.stage });
            break;
          case "message":
            setMessages((prev) => (prev.some((item) => item.id === event.message.id) ? prev : [...prev, event.message]));
            if (event.message.role === "assistant") {
              setPlan([]);
              setTools([]);
              setProgress(null);
              void api.agentSessions(projectId).then((list) => setSessions(list.items)).catch(() => undefined);
            }
            break;
          case "tokens":
            setSession((prev) => (prev ? { ...prev, tokens: event.tokens } : prev));
            break;
          case "error":
            setError(event.message);
            break;
          case "done":
            setSession(event.session);
            setRunning(false);
            setStage("Agent 已就绪");
            closeRef.current?.();
            closeRef.current = null;
            void api.agentSessions(projectId).then((list) => setSessions(list.items)).catch(() => undefined);
            // Reconcile with SQLite in case a message event was missed while
            // the connection was being established.
            void api
              .agentSession(sessionId)
              .then((detail) => {
                setSession(detail.session);
                setMessages(detail.messages);
              })
              .catch(() => undefined);
            break;
          default:
            break;
        }
      },
      () => {
        setRunning(false);
        closeRef.current = null;
      }
    );
  };

  const loadSession = async (id: string) => {
    try {
      const detail = await api.agentSession(id);
      setSession(detail.session);
      setMessages(detail.messages);
      setRunning(detail.session.status === "running");
      setStage(detail.session.status === "running" ? "Agent 正在执行" : "Agent 已就绪");
      if (detail.session.status === "running") subscribe(id);
      else {
        closeRef.current?.();
        closeRef.current = null;
      }
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const loadSessions = async (selectId?: string | null) => {
    try {
      const [list, info, detail] = await Promise.all([
        api.agentSessions(projectId),
        api.system(),
        api.project(projectId),
      ]);
      setSessions(list.items);
      setSystem(info);
      setProject({ ...detail.project, stats: detail.stats });
      setAssets(detail.assets);
      setOnline(true);
      const target =
        (selectId && list.items.find((item) => item.id === selectId)) ||
        (initialSessionId && list.items.find((item) => item.id === initialSessionId)) ||
        list.items[0];
      if (target) {
        setActiveId(target.id);
        await loadSession(target.id);
      } else {
        setActiveId(null);
        setSession(null);
        setMessages([]);
      }
    } catch {
      setOnline(false);
      setSessions([]);
      setSession(null);
      setMessages([]);
    }
  };

  useEffect(() => {
    void loadSessions(initialSessionId || undefined);
    return () => {
      closeRef.current?.();
      closeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, initialSessionId]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, tools, plan, running]);

  const send = async () => {
    const text = input.trim();
    if (!text || !activeId || running) return;
    setInput("");
    setError(null);
    setTools([]);
    setPlan([]);
    setProgress(null);
    setRunning(true);
    setStage("正在理解任务");
    const optimistic: AgentMessage = {
      id: `temp_${Date.now()}`,
      sessionId: activeId,
      seq: (messages.at(-1)?.seq || 0) + 1,
      role: "user",
      text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    try {
      const response = await api.sendAgentMessage(activeId, text);
      setMessages((prev) => (prev.some((item) => item.id === response.message.id) ? prev : prev.map((item) => (item.id === optimistic.id ? response.message : item))));
      setSession(response.session);
      setSessions((prev) => prev.map((item) => (item.id === response.session.id ? response.session : item)));
      subscribe(activeId);
    } catch (err) {
      setRunning(false);
      setStage("Agent 已就绪");
      setError((err as Error).message);
      toast((err as Error).message);
    }
  };

  const cancel = async () => {
    if (!activeId) return;
    setStage("正在取消…");
    try {
      await api.cancelAgent(activeId);
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const newSession = async () => {
    try {
      const created = await api.createAgentSession(projectId);
      setSessions((prev) => [created, ...prev]);
      setActiveId(created.id);
      setSession(created);
      setMessages([]);
      setPlan([]);
      setTools([]);
      setProgress(null);
      setError(null);
      setRunning(false);
      closeRef.current?.();
      closeRef.current = null;
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const openSession = async (id: string) => {
    if (running) {
      toast("当前会话正在执行，请先等待或取消");
      return;
    }
    setActiveId(id);
    setPlan([]);
    setTools([]);
    setProgress(null);
    setError(null);
    await loadSession(id);
  };

  const filtered = useMemo(
    () => sessions.filter((item) => !query || item.title.toLowerCase().includes(query.toLowerCase())),
    [sessions, query]
  );

  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const effectivePlan = plan.length ? plan : lastAssistant?.data?.plan || [];
  const effectiveTools = tools.length ? tools : lastAssistant?.data?.tools || [];
  const doneSteps = effectivePlan.filter((step) => step.status === "done").length;
  const usagePercent = Math.min(100, Math.round(((session?.tokens || 0) / 128_000) * 100));
  const latestOutputs = lastAssistant?.data?.outputs || [];
  const title = session?.title || "新会话";

  return (
    <main className="workspace-page" hidden={hidden}>
      <aside className="ws-sessions" aria-label="会话列表">
        <div className="ws-brand">
          <div><span className="eyebrow">WORKSPACE</span><h2>{project?.name || "本地项目"}</h2></div>
          <button className="ws-new" title="新建会话" aria-label="新建会话" onClick={() => void newSession()}><Plus size={15} /></button>
        </div>
        <div className="ws-workspace-switch">
          <span className="ws-workspace-mark">P</span>
          <div><strong>{project?.name || "本地项目"}</strong><small>{online ? "SQLite · 本地工作区" : "BFF 未连接"} · {sessions.length} 个会话</small></div>
          <ChevronDown size={13} />
        </div>
        <label className="ws-search">
          <Search size={13} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索会话" aria-label="搜索会话" />
          <kbd>⌘K</kbd>
        </label>

        <div className="ws-session-scroll">
          <div className="ws-section-label"><span>会话</span><em>{filtered.length}</em></div>
          {filtered.map((item) => (
            <button
              key={item.id}
              className={`ws-session ${activeId === item.id ? "is-active" : ""}`}
              onClick={() => void openSession(item.id)}
            >
              <span className={`ws-session-dot ${item.status === "running" ? "is-running" : ""}`} />
              <span className="ws-session-body">
                <strong title={item.title}>{item.title}</strong>
                <small>{item.status === "running" ? "执行中" : `${item.messageCount} 条消息`} · {compact(item.tokens)} tokens</small>
              </span>
              <time>{relative(item.updatedAt)}</time>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="ws-session-empty">
              <p>{online ? "还没有会话" : "BFF 未启动，无法读取会话"}</p>
              {online && <button className="text-btn" onClick={() => void newSession()}>新建会话 <ArrowRight size={12} /></button>}
            </div>
          )}
        </div>

        <div className="ws-sessions-foot">
          <div className="ws-usage"><span>本工作区</span><strong>{compact(sessions.reduce((sum, item) => sum + item.tokens, 0))} <small>tokens</small></strong></div>
          <button className="ws-settings-btn" onClick={onOpenApi}><Settings2 size={13} />API 设置</button>
        </div>
      </aside>

      <section className="ws-main" aria-label="会话">
        <header className="ws-head">
          <div className="ws-head-title">
            <span className="eyebrow">SESSION / {session ? session.id.slice(-6).toUpperCase() : "NEW"}</span>
            <div className="ws-title-row">
              <h1 title={title}>{title}</h1>
              <span className={`ws-agent-status ${running ? "is-running" : ""}`}><i />{running ? stage : "Agent 已就绪"}</span>
            </div>
          </div>
          <div className="ws-head-actions">
            <button className="ws-back" onClick={onBackToStudio}><ArrowLeft size={12} />创作台</button>
            <span className="ws-model-chip"><span className="ws-model-dot" />local-agent <ChevronDown size={10} /></span>
            <span className="ws-context-chip" title={`会话累计 ${session?.tokens || 0} tokens`}><i style={{ ["--p" as string]: usagePercent }} />{usagePercent}%</span>
            <button className="ghost-icon" aria-label="更多" onClick={() => toast("会话重命名 / 删除将在下一阶段接入")}><MoreHorizontal size={14} /></button>
          </div>
        </header>

        <div className="ws-thread" ref={threadRef}>
          <div className="ws-date"><span>{online ? "SQLite 持久化会话 · 工具真实执行" : "BFF 未连接"}</span></div>

          {!activeId && (
            <div className="ws-empty">
              <span className="ws-empty-mark">✦</span>
              <h3>{online ? "还没有会话" : "无法连接本机 BFF"}</h3>
              <p>
                {online
                  ? "新建会话后，用一句话描述任务。Agent 会读取项目素材，自动选择生图、生视频或图组视频工具，并给出计划、调用工具、等待真实任务完成。"
                  : "运行 npm run dev:all 启动 BFF 后刷新页面。Agent 会话、消息与工具事件都存储在 SQLite。"}
              </p>
              {online && (
                <div className="ws-empty-hints">
                  <span onClick={() => void newSession()}>新建会话</span>
                  <span>试试：用这 2 张图做 3 镜图组视频，竖屏 720p</span>
                </div>
              )}
            </div>
          )}

          {activeId && messages.length === 0 && !running && (
            <div className="ws-empty">
              <span className="ws-empty-mark">✦</span>
              <h3>新会话已创建</h3>
              <p>描述你想完成的任务。Agent 会读取项目素材，自动选择生图、生视频或分镜工具，并在执行前给出计划。</p>
              <div className="ws-empty-hints">
                <span onClick={() => setInput("用这 2 张图做 3 镜图组视频，竖屏，每镜 2 秒，720p，10 Mbps")}>把这组图做成图组视频</span>
                <span onClick={() => setInput("生成一张 2K 电影静帧，雾中玻璃与琥珀光")}>生成 2K 电影静帧</span>
              </div>
            </div>
          )}

          {messages.map((message) => {
            if (message.role === "user") {
              return (
                <article key={message.id} className="ws-msg ws-user">
                  <div className="ws-msg-meta"><span>你</span><time>{clock(message.createdAt)}</time></div>
                  <div className="ws-bubble">{message.text}</div>
                </article>
              );
            }
            const data = message.data || {};
            return (
              <article key={message.id} className="ws-msg ws-assistant">
                <div className="ws-avatar">L</div>
                <div className="ws-msg-body">
                  <div className="ws-msg-meta">
                    <span>LUMEN Agent</span>
                    <span className="ws-msg-model">local-agent</span>
                    <time>{clock(message.createdAt)}</time>
                    {data.tokens ? <em>{compact(data.tokens)} tokens</em> : null}
                  </div>
                  <p>{message.text}</p>
                  {(data.tools || []).map((tool) => (
                    <ToolCard key={tool.id} tool={tool} onOpenStoryboard={openStoryboard} />
                  ))}
                  <PlanCard steps={data.plan || []} />
                  <Outputs outputs={data.outputs || []} />
                  <div className="ws-msg-actions">
                    {(data.actions || []).includes("open_storyboard") && (
                      <button className="ws-inline-action" onClick={openStoryboard}>打开分镜表 <ArrowRight size={12} /></button>
                    )}
                    {(data.actions || []).includes("open_studio") && (
                      <button className="ws-inline-action" onClick={onBackToStudio}>在创作台查看 <ArrowRight size={12} /></button>
                    )}
                    {(data.actions || []).includes("open_api") && (
                      <button className="ws-inline-action" onClick={onOpenApi}>打开 API 设置 <ArrowRight size={12} /></button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}

          {running && (
            <article className="ws-msg ws-assistant">
              <div className="ws-avatar">L</div>
              <div className="ws-msg-body">
                <div className="ws-msg-meta"><span>LUMEN Agent</span><time>刚刚</time><em>{stage}</em></div>
                {tools.length === 0 && (
                  <div className="ws-typing-line"><i /><i /><i /><span>正在检查素材与工具…</span></div>
                )}
                {tools.map((tool) => (
                  <ToolCard key={tool.id} tool={tool} onOpenStoryboard={openStoryboard} />
                ))}
                <PlanCard steps={plan} />
                {progress && (
                  <div className="ws-tool ws-tool-progress">
                    <div className="ws-tool-progress-head">
                      <span className="ws-tool-icon running"><RefreshCw size={13} /></span>
                      <span className="ws-tool-name"><strong>media.generate</strong><small>{progress.stage}</small></span>
                      <span className="ws-tool-status running">{progress.progress}%</span>
                      <button className="text-btn" onClick={() => void cancel()}>取消</button>
                    </div>
                    <div className="ws-progress"><i style={{ width: `${progress.progress}%` }} /></div>
                    <div className="ws-progress-meta"><span>任务在 BFF 后台执行</span><span>可在后台继续</span></div>
                  </div>
                )}
                {error && <p className="ws-error-line">{error}</p>}
              </div>
            </article>
          )}
        </div>

        <div className="ws-composer">
          <div className="ws-composer-box">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder={running ? "Agent 正在执行，可取消或等待完成…" : "描述任务，例如：把这 2 张图做成 3 镜竖屏图组视频，720p，10 Mbps"}
            />
            <div className="ws-composer-tools">
              <div className="ws-composer-left">
                <button className="ws-chip" onClick={() => toast(`项目素材 ${assets.length} 张，可直接在提示词中引用`)}>
                  <Paperclip size={11} />素材 {assets.length}
                </button>
                <button className="ws-chip" onClick={() => toast("可用工具：workspace.inspect / storyboard.plan / media.generate / ffmpeg.compose")}>
                  <Wrench size={11} />工具
                </button>
                <button className="ws-chip" onClick={() => void newSession()}><Plus size={11} />新会话</button>
              </div>
              <div className="ws-composer-right">
                <span className="ws-context-hint"><i />{compact(session?.tokens || 0)} / 128k</span>
                {running ? (
                  <button className="ws-send ws-stop" onClick={() => void cancel()} aria-label="取消执行">■</button>
                ) : (
                  <button className="ws-send" onClick={() => void send()} aria-label="发送消息"><ArrowRight size={15} /></button>
                )}
              </div>
            </div>
          </div>
          <div className="ws-composer-hint">Enter 发送 · Shift + Enter 换行 · 工具真实调用 BFF 任务队列</div>
        </div>

        <footer className="ws-statusbar">
          <span className="ws-status-left"><i className="ws-status-live" />本地工作区</span>
          <span>local-agent</span>
          <span>{running ? stage : "就绪"}</span>
          <span>工具 4</span><span>自动批准</span>
          <span className="ws-status-right">LUMEN AGENT · SQLite</span>
        </footer>
      </section>

      <aside className="ws-context" aria-label="上下文">
        <div className="ws-context-head">
          <div><span className="eyebrow">CONTEXT</span><h2>上下文</h2></div>
          <button className="ghost-icon" title="刷新上下文" onClick={() => void loadSessions(activeId)}><RefreshCw size={14} /></button>
        </div>
        <div className="ws-context-scroll">
          <section className="ws-context-card ws-context-usage">
            <div className="ws-ring" style={{ ["--p" as string]: usagePercent }}><span>{usagePercent}%</span></div>
            <div className="ws-usage-copy">
              <strong>{compact(session?.tokens || 0)} <small>/ 128k tokens</small></strong><span>会话累计</span>
              <div className="ws-usage-bar"><i style={{ width: `${usagePercent}%` }} /></div>
              <div className="ws-usage-split"><span>{session?.messageCount || messages.length} 条消息</span><span>{sessions.length} 个会话</span></div>
            </div>
          </section>
          <section className="ws-context-section">
            <div className="ws-context-section-head"><h3>会话目标</h3></div>
            <div className="ws-goal">
              <div className="ws-goal-top"><span className="ws-goal-dot" /><strong>{title}</strong></div>
              <p>{effectivePlan.length ? `${doneSteps} / ${effectivePlan.length} 步完成` : "等待任务描述"}</p>
              <div className="ws-goal-bar"><i style={{ width: `${effectivePlan.length ? Math.round((doneSteps / effectivePlan.length) * 100) : 0}%` }} /></div>
              <div className="ws-goal-meta">
                <span>{running ? "执行中" : lastAssistant ? "已完成" : "待开始"}</span>
                <span>{effectivePlan.length ? `${Math.round((doneSteps / effectivePlan.length) * 100)}%` : "0%"}</span>
              </div>
            </div>
          </section>
          <section className="ws-context-section">
            <div className="ws-context-section-head"><h3>工具</h3><span className="ws-auto"><i />自动批准</span></div>
            <div className="ws-tool-list">
              {(effectiveTools.length
                ? effectiveTools
                : ([
                    { id: "t1", name: "workspace.inspect", status: "pending", detail: "" },
                    { id: "t2", name: "storyboard.plan", status: "pending", detail: "" },
                    { id: "t3", name: "media.generate", status: "pending", detail: "" },
                    { id: "t4", name: "ffmpeg.compose", status: "pending", detail: "" },
                  ] satisfies AgentToolState[])
              ).map((tool) => (
                <div key={tool.id}>
                  <span className={`ws-tool-dot ${tool.status === "done" ? "done" : tool.status === "running" ? "running" : ""}`} />
                  <code>{tool.name}</code>
                  <em>{tool.tokens ? compact(tool.tokens) : tool.status === "done" ? "✓" : "—"}</em>
                </div>
              ))}
            </div>
          </section>
          <section className="ws-context-section">
            <div className="ws-context-section-head"><h3>工作区文件</h3><span>{assets.length + latestOutputs.length}</span></div>
            <div className="ws-file-list">
              {assets.slice(0, 3).map((asset) => (
                <div key={asset.id}>
                  <span className="ws-file-icon img" />
                  <span>{asset.originalName || asset.id}</span>
                  <em>{Math.round(asset.size / 1024)} KB</em>
                </div>
              ))}
              {latestOutputs.slice(0, 2).map((output) => (
                <div key={output.id}>
                  <span className={`ws-file-icon ${output.kind === "video" ? "video" : "img"}`} />
                  <span>{output.kind === "video" ? "final.mp4" : "output.jpg"}</span>
                  <em>{Math.round(output.size / 1024)} KB</em>
                </div>
              ))}
              {assets.length === 0 && latestOutputs.length === 0 && (
                <div><span className="ws-file-icon img" /><span>暂无文件</span><em>—</em></div>
              )}
            </div>
          </section>
          <section className="ws-context-section">
            <div className="ws-context-section-head"><h3>运行环境</h3></div>
            <div className="ws-env">
              <div><span>Provider</span><code>{system?.activeProviderId || "—"}</code></div>
              <div><span>编码</span><code>{system?.ffmpeg?.available ? "FFmpeg 可用" : "FFmpeg 未检测"}</code></div>
              <div><span>存储</span><code>sqlite · ./data</code></div>
            </div>
          </section>
        </div>
        <div className="ws-context-foot"><span><i />127.0.0.1 · 本地</span><button onClick={onOpenApi}>API 设置</button></div>
      </aside>
    </main>
  );
}
