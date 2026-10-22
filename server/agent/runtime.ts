import type {
  AgentMessageData,
  AgentPlanStep,
  AgentSession,
  AgentToolState,
  GenerationMode,
  GenerationRequest,
  GenerationTask,
  MediaAsset,
  StoryboardRow,
  TokenUsage,
} from "../../shared/contracts.js";
import { MODE_LABELS } from "../../shared/contracts.js";
import { ffmpegAvailable } from "../media/ffmpeg.js";
import { providerStore } from "../storage/providers.js";
import { assetStore } from "../storage/assets.js";
import { projectStore } from "../storage/projects.js";
import { agentStore } from "../storage/sessions.js";
import { isTerminal, jobStore } from "../jobs/store.js";

interface ParsedIntent {
  mode: GenerationMode;
  storyboard: boolean;
  shots: number;
  durationSec: number;
  resolution: string;
  aspectRatio: string;
  bitrateKbps?: number;
  animationMode?: "live" | "2d" | "3d" | "stop";
  negativePrompt: string;
  reason: string;
}

interface RunState {
  canceled: boolean;
  jobId?: string;
  runId: string;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const now = () => new Date().toISOString();

const SHOTS = ["远景", "特写", "中景", "全景", "近景", "微距"];
const MOTIONS = ["缓慢推进", "环绕", "横移", "缓慢拉远", "仰拍", "手持"];

const MODE_KEYWORDS: Array<{ mode: GenerationMode; words: string[] }> = [
  { mode: "multi-image-to-video", words: ["图组", "多图", "组视频", "多镜头视频", "多图视频"] },
  { mode: "image-to-video", words: ["图生视频", "首帧", "让这张图", "让画面动", "动画视频", "动起来"] },
  { mode: "image-to-image", words: ["图生图", "改图", "重绘", "参考图", "换成", "编辑图片"] },
  { mode: "text-to-video", words: ["文生视频", "视频", "短片", "广告", "成片", "分镜"] },
];

export class AgentRuntime {
  private runs = new Map<string, RunState>();
  private seq = 0;

  isRunning(sessionId: string) {
    return this.runs.has(sessionId);
  }

  cancel(sessionId: string): boolean {
    const state = this.runs.get(sessionId);
    if (!state) return false;
    state.canceled = true;
    if (state.jobId) jobStore.cancel(state.jobId);
    return true;
  }

  async send(sessionId: string, text: string): Promise<{ runId: string }> {
    const session = agentStore.get(sessionId);
    if (!session) throw new Error("会话不存在");
    if (this.runs.has(sessionId)) throw new Error("该会话正在执行，请等待完成或取消");
    const runId = `run_${Date.now().toString(36)}_${++this.seq}`;
    const state: RunState = { canceled: false, runId };
    this.runs.set(sessionId, state);
    if (session.title === "新会话" || !session.messageCount) {
      agentStore.update(sessionId, { title: text.trim().slice(0, 42) || "新会话" });
    }
    agentStore.update(sessionId, { status: "running" });
    agentStore.emit({ type: "status", status: "running", stage: "正在理解任务" }, sessionId);
    void this.execute(sessionId, text, state).finally(() => {
      this.runs.delete(sessionId);
      agentStore.update(sessionId, { status: "idle" });
      agentStore.emit({ type: "status", status: "idle", stage: "Agent 已就绪" }, sessionId);
      const next = agentStore.get(sessionId);
      if (next) agentStore.emit({ type: "done", session: next }, sessionId);
    });
    return { runId };
  }

  private async execute(sessionId: string, text: string, state: RunState) {
    const plan: AgentPlanStep[] = [
      { id: "inspect", label: "检查项目素材、Provider 与 FFmpeg", status: "pending" },
      { id: "plan", label: "拆解意图与分镜", status: "pending" },
      { id: "generate", label: "提交生成任务并跟踪进度", status: "pending" },
      { id: "compose", label: "合成与整理结果", status: "pending" },
    ];
    const tools: AgentToolState[] = [];
    const emitPlan = () => agentStore.emit({ type: "plan", steps: plan.map((step) => ({ ...step })) }, sessionId);
    emitPlan();

    const addTool = (tool: AgentToolState) => {
      tools.push(tool);
      agentStore.emit({ type: "tool", tool: { ...tool } }, sessionId);
    };
    const patchTool = (id: string, patch: Partial<AgentToolState>) => {
      const tool = tools.find((item) => item.id === id);
      if (!tool) return;
      Object.assign(tool, patch);
      agentStore.emit({ type: "tool", tool: { ...tool } }, sessionId);
    };

    try {
      const session = agentStore.get(sessionId);
      const project = session?.projectId ? projectStore.get(session.projectId) : null;
      const assets = assetStore.list({ projectId: session?.projectId || undefined, limit: 30 });
      const provider = providerStore.active();
      const ffmpeg = await ffmpegAvailable();

      /* ---------- 1. inspect ---------- */
      plan[0].status = "running";
      emitPlan();
      const inspectTool: AgentToolState = {
        id: "tool_inspect",
        name: "workspace.inspect",
        status: "running",
        detail: "正在读取项目与运行环境",
        startedAt: now(),
      };
      addTool(inspectTool);
      await delay(180);

      const inspectData: Record<string, unknown> = {
        project: project?.name || "本地工作区",
        projectId: session?.projectId || null,
        assets: assets.length,
        provider: provider ? `${provider.label} · ${provider.configured ? "已配置" : "未配置"}` : "未配置",
        ffmpeg,
        database: "sqlite",
      };
      patchTool(inspectTool.id, {
        status: "done",
        detail: `${assets.length} 张素材 · ${provider?.label || "未配置 Provider"} · FFmpeg ${ffmpeg ? "可用" : "不可用"}`,
        tokens: 0,
        data: inspectData,
        finishedAt: now(),
      });
      plan[0].status = "done";
      plan[0].note = `${assets.length} 素材`;
      emitPlan();

      this.checkCanceled(state);

      /* ---------- 2. plan ---------- */
      plan[1].status = "running";
      emitPlan();
      const intent = parseIntent(text, assets.length);
      const planTool: AgentToolState = {
        id: "tool_plan",
        name: intent.storyboard ? "storyboard.plan" : "intent.resolve",
        status: "running",
        detail: "正在拆解镜头与生成参数",
        startedAt: now(),
      };
      addTool(planTool);
      await delay(220);

      const rows = intent.storyboard ? buildStoryboard(intent, assets, text) : [];
      const modeLabel = MODE_LABELS[intent.mode];
      patchTool(planTool.id, {
        status: "done",
        detail: intent.storyboard
          ? `已规划 ${rows.length} 镜 · 总时长 ${rows.reduce((sum, row) => sum + row.durationSec, 0).toFixed(1)}s`
          : `${modeLabel} · ${intent.resolution} · ${intent.aspectRatio}`,
        tokens: 0,
        data: {
          mode: intent.mode,
          reason: intent.reason,
          resolution: intent.resolution,
          aspectRatio: intent.aspectRatio,
          durationSec: intent.durationSec,
          bitrateKbps: intent.bitrateKbps,
          rows: rows.map((row, index) => ({
            id: row.id,
            shot: row.shotSize,
            motion: row.motion,
            desc: row.description,
            dur: row.durationSec,
            index,
          })),
        },
        finishedAt: now(),
      });
      plan[1].status = "done";
      plan[1].note = intent.storyboard ? `${rows.length} 镜` : modeLabel;
      emitPlan();

      if (state.canceled) throw new CanceledError();

      /* ---------- 3. prerequisites ---------- */
      if (!provider?.configured) {
        throw new AgentError(
          "PROVIDER_NOT_CONFIGURED",
          "还没有可用的 Provider。请打开顶栏 API 状态，配置方舟/OpenAI 兼容密钥，或启用本地演示引擎。"
        );
      }
      if ((intent.mode === "image-to-image" || intent.mode === "image-to-video") && assets.length === 0) {
        throw new AgentError(
          "IMAGE_REQUIRED",
          intent.mode === "image-to-image"
            ? "图生图需要至少一张参考图。请先在创作台或项目素材中上传图片。"
            : "图生视频需要一张首帧。请先上传图片，或在提示词里改为文生视频。"
        );
      }
      if (!ffmpeg && isVideoMode(intent.mode)) {
        throw new AgentError("FFMPEG_UNAVAILABLE", "FFmpeg 不可用，无法生成或合成视频。");
      }

      /* ---------- 4. generate ---------- */
      plan[2].status = "running";
      emitPlan();
      const generateTool: AgentToolState = {
        id: "tool_generate",
        name: "media.generate",
        status: "running",
        detail: `正在提交${modeLabel}任务`,
        startedAt: now(),
      };
      addTool(generateTool);

      const request = this.buildRequest(sessionId, text, intent, rows, assets, provider.id);
      const job = jobStore.create(request);
      state.jobId = job.id;
      jobStore.appendLog(job.id, `agent session ${sessionId} run ${state.runId}`);
      patchTool(generateTool.id, {
        detail: `任务已入队 · ${modeLabel}`,
        data: { jobId: job.id, estimatedTokens: job.estimatedTokens },
      });
      agentStore.emit(
        {
          type: "progress",
          jobId: job.id,
          progress: job.progress,
          stage: job.stage,
          shots: job.shots.map((shot) => ({ order: shot.order, status: shot.status, progress: shot.progress })),
        },
        sessionId
      );

      const finalTask = await this.waitForJob(sessionId, state, job.id, (task) => {
        const tokens = task.usage?.totalTokens;
        patchTool(generateTool.id, {
          detail: `${task.stage} · ${task.progress}%`,
          tokens,
          data: {
            jobId: task.id,
            progress: task.progress,
            status: task.status,
            estimatedTokens: task.estimatedTokens,
            outputs: task.outputs,
          },
        });
        agentStore.emit(
          {
            type: "progress",
            jobId: task.id,
            progress: task.progress,
            stage: task.stage,
            shots: task.shots.map((shot) => ({
              order: shot.order,
              status: shot.status,
              progress: shot.progress,
            })),
          },
          sessionId
        );
      });

      if (finalTask.status === "canceled") throw new CanceledError();
      if (finalTask.status !== "succeeded") {
        throw new AgentError(
          finalTask.error?.code || "GENERATION_FAILED",
          finalTask.error?.message || "生成任务失败"
        );
      }

      const tokens = finalTask.usage?.totalTokens ?? finalTask.estimatedTokens;
      patchTool(generateTool.id, {
        status: "done",
        detail: `${modeLabel}完成 · ${finalTask.outputs.length} 个结果`,
        tokens,
        data: {
          jobId: finalTask.id,
          progress: 100,
          outputs: finalTask.outputs,
          usage: finalTask.usage,
          estimated: finalTask.usage?.estimated ?? true,
        },
        finishedAt: now(),
      });
      plan[2].status = "done";
      plan[2].note = `${formatTokens(tokens)} tokens`;
      emitPlan();
      agentStore.emit({ type: "tokens", tokens }, sessionId);

      /* ---------- 5. compose / wrap-up ---------- */
      plan[3].status = "running";
      emitPlan();
      if (isVideoMode(intent.mode)) {
        const composeTool: AgentToolState = {
          id: "tool_compose",
          name: "ffmpeg.compose",
          status: "done",
          detail: `已输出 ${finalTask.params.fps || 24}fps H.264 · ${finalTask.outputs[0]?.width || "—"}×${finalTask.outputs[0]?.height || "—"}`,
          tokens: 0,
          data: {
            durationSec: finalTask.outputs[0]?.durationSec,
            bitrateKbps: finalTask.params.bitrateKbps,
            outputs: finalTask.outputs,
          },
          startedAt: now(),
          finishedAt: now(),
        };
        addTool(composeTool);
      }
      await delay(120);
      plan[3].status = "done";
      plan[3].note = finalTask.outputs.length ? "可下载" : "无输出";
      emitPlan();

      const messageData: AgentMessageData = {
        plan: plan.map((step) => ({ ...step })),
        tools: tools.map((tool) => ({ ...tool })),
        rows: rows.map((row) => ({
          id: row.id,
          shot: row.shotSize,
          motion: row.motion,
          desc: row.description,
          dur: row.durationSec,
        })),
        outputs: finalTask.outputs,
        jobId: finalTask.id,
        mode: intent.mode,
        estimatedTokens: job.estimatedTokens,
        tokens,
        actions: intent.storyboard ? ["open_storyboard", "open_studio"] : ["open_studio"],
      };

      const output = finalTask.outputs[0];
      const outputText = output
        ? output.kind === "video"
          ? `${output.width || "—"}×${output.height || "—"} · ${(output.durationSec || 0).toFixed(1)}s · ${formatBytes(output.size)}`
          : `${output.width || "—"}×${output.height || "—"} · ${formatBytes(output.size)}`
        : "无输出";
      const summary = [
        `已完成${modeLabel}：${intent.reason}。`,
        intent.storyboard ? `分镜 ${rows.length} 镜，总时长 ${rows.reduce((sum, row) => sum + row.durationSec, 0).toFixed(1)}s。` : "",
        `输出 ${outputText}，消耗 ${formatTokens(tokens)} tokens${finalTask.usage?.estimated ? "（估算）" : ""}。`,
        finalTask.outputs[0]?.url ? "结果已写入项目输出，可在创作台查看或直接下载。" : "",
      ]
        .filter(Boolean)
        .join(" ");

      agentStore.addMessage(sessionId, "assistant", summary, messageData);

      if (project) projectStore.touch(project.id);
    } catch (error) {
      if (error instanceof CanceledError || state.canceled) {
        const canceledTask = state.jobId ? jobStore.get(state.jobId) : null;
        const messageData: AgentMessageData = {
          plan: plan.map((step) => ({
            ...step,
            status: step.status === "done" ? "done" : step.status === "running" ? "failed" : "pending",
          })),
          tools: tools.map((tool) => ({
            ...tool,
            status: tool.status === "running" ? "failed" : tool.status,
            detail: tool.status === "running" ? "已取消" : tool.detail,
          })),
          jobId: state.jobId,
          outputs: canceledTask?.outputs || [],
          mode: parseIntent(text, 0).mode,
          tokens: canceledTask?.usage?.totalTokens,
        };
        agentStore.addMessage(sessionId, "assistant", "已取消本次执行。已生成的部分结果保留在任务记录中。", messageData);
        return;
      }
      const agentError = error instanceof AgentError ? error : new AgentError("AGENT_FAILED", (error as Error).message);
      plan.forEach((step) => {
        if (step.status === "running") step.status = "failed";
      });
      tools.forEach((tool) => {
        if (tool.status === "running") {
          tool.status = "failed";
          tool.detail = agentError.message;
          tool.finishedAt = now();
          agentStore.emit({ type: "tool", tool: { ...tool } }, sessionId);
        }
      });
      emitPlan();
      agentStore.emit({ type: "error", message: agentError.message }, sessionId);
      agentStore.addMessage(sessionId, "assistant", `执行中断：${agentError.message}`, {
        plan: plan.map((step) => ({ ...step })),
        tools: tools.map((tool) => ({ ...tool })),
        mode: parseIntent(text, 0).mode,
        tokens: 0,
        actions: ["open_api"],
      });
      console.error(`[agent] ${sessionId} failed: ${agentError.code} ${agentError.message}`);
    }
  }

  private checkCanceled(state: RunState) {
    if (state.canceled) throw new CanceledError();
  }

  private waitForJob(
    sessionId: string,
    state: RunState,
    jobId: string,
    onProgress: (task: GenerationTask) => void
  ): Promise<GenerationTask> {
    return new Promise((resolve, reject) => {
      let done = false;
      let lastEmit = 0;
      let lastSignature = "";
      const finish = (fn: () => void) => {
        if (done) return;
        done = true;
        clearInterval(poll);
        clearTimeout(timeout);
        jobStore.events.off(jobId, listener);
        fn();
      };
      const handle = (task: GenerationTask) => {
        if (task.id !== jobId) return;
        // Cancellation is requested once by AgentRuntime.cancel(); do not call
        // jobStore.cancel() from this listener, it would re-emit into itself.
        const signature = `${task.status}:${task.progress}:${task.stage}`;
        const isFinal = isTerminal(task.status);
        if (signature !== lastSignature && (isFinal || Date.now() - lastEmit > 350)) {
          lastSignature = signature;
          lastEmit = Date.now();
          try {
            onProgress(task);
          } catch (error) {
            console.error("[agent] progress callback failed", error);
          }
        }
        if (isFinal) finish(() => resolve(task));
      };
      const listener = (task: GenerationTask) => handle(task);
      jobStore.events.on(jobId, listener);
      const current = jobStore.get(jobId);
      if (current) handle(current);
      const poll = setInterval(() => {
        const task = jobStore.get(jobId);
        if (task) handle(task);
      }, 1500);
      const timeout = setTimeout(() => {
        finish(() => reject(new AgentError("TIMEOUT", "任务等待超时，可在任务列表继续查看")));
      }, 30 * 60_000);
    });
  }

  private buildRequest(
    sessionId: string,
    text: string,
    intent: ParsedIntent,
    rows: StoryboardRow[],
    assets: MediaAsset[],
    providerId: string
  ): GenerationRequest {
    const provider = providerStore.get(providerId);
    const storyboard = intent.storyboard ? rows : [];
    const inputs =
      intent.mode === "multi-image-to-video" || intent.mode === "text-to-video" || intent.mode === "text-to-image"
        ? []
        : assets.slice(0, 2).map((asset, index) => ({
            assetId: asset.id,
            role:
              intent.mode === "image-to-video"
                ? index === 0
                  ? ("first_frame" as const)
                  : ("last_frame" as const)
                : ("reference" as const),
            order: index,
          }));

    const isStoryboard =
      intent.mode === "multi-image-to-video" ||
      (intent.mode === "text-to-video" && intent.storyboard && rows.length > 0);

    return {
      clientRequestId: `agent_${sessionId}_${Date.now().toString(36)}`,
      mode: intent.mode,
      generationType: isStoryboard ? "storyboard" : "single",
      providerId,
      modelId:
        intent.mode === "text-to-image" || intent.mode === "image-to-image"
          ? provider?.imageModel || "image-model"
          : provider?.videoModel || "video-model",
      prompt: text,
      params: {
        aspectRatio: intent.aspectRatio,
        resolution: intent.resolution,
        durationSec: intent.durationSec,
        fps: 24,
        bitrateKbps: intent.bitrateKbps,
        animationMode: intent.animationMode,
        negativePrompt: intent.negativePrompt,
        transition: "dissolve",
        shotDurationSec: rows[0]?.durationSec || 4,
        composeMode: "ai_storyboard",
      },
      inputs,
      storyboard,
      projectId: agentStore.get(sessionId)?.projectId || undefined,
      sessionId,
    };
  }
}

class AgentError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "AgentError";
  }
}

class CanceledError extends Error {
  constructor() {
    super("canceled");
    this.name = "CanceledError";
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const isVideoMode = (mode: GenerationMode) =>
  mode === "text-to-video" || mode === "image-to-video" || mode === "multi-image-to-video";

export function parseIntent(text: string, assetCount: number): ParsedIntent {
  const lower = text.toLowerCase();
  let mode: GenerationMode = "text-to-image";
  let reason = "按文生图理解";
  for (const entry of MODE_KEYWORDS) {
    if (entry.words.some((word) => lower.includes(word.toLowerCase()))) {
      mode = entry.mode;
      reason = `识别为${MODE_LABELS[mode]}`;
      break;
    }
  }
  if (mode === "text-to-image" && assetCount > 0 && /这组|这些图|参考图|素材/.test(text)) {
    mode = "image-to-image";
    reason = "检测到参考图，按图生图理解";
  }
  if (mode === "image-to-video" && assetCount === 0 && /文生视频/.test(text)) {
    mode = "text-to-video";
  }
  if (
    mode === "text-to-video" &&
    assetCount >= 2 &&
    /分镜|镜头/.test(text) &&
    !/文生视频/.test(text)
  ) {
    mode = "multi-image-to-video";
    reason = "检测到多张素材与分镜要求，按图组视频理解";
  }

  const video = isVideoMode(mode);
  const storyboard =
    mode === "multi-image-to-video" ||
    (mode === "text-to-video" && /分镜|镜头|storyboard|每镜/.test(lower));

  const perShotMatch = /每(?:一)?镜\s*(\d+(?:\.\d+)?)\s*(?:秒|s\b)/i.exec(text);
  const durationMatch = /(\d+(?:\.\d+)?)\s*(?:秒|s\b|sec)/i.exec(text);
  const shotMatch = /(\d+)\s*(?:个)?\s*(?:镜头|镜|分镜|shots?)/i.exec(text);
  const bitrateMatch = /(\d+)\s*(?:mbps|mb\/s|兆)/i.exec(lower);
  const resMatch = /\b(720p|1080p|4k)\b/i.exec(lower);

  let shots = shotMatch ? clamp(Number(shotMatch[1]), 2, 9) : 4;
  if (mode === "multi-image-to-video") shots = shotMatch ? clamp(Number(shotMatch[1]), 2, 9) : Math.min(4, Math.max(2, assetCount || 4));
  if (!storyboard) shots = 1;

  const perShot = perShotMatch ? clamp(Number(perShotMatch[1]), 1, 8) : undefined;
  const total = durationMatch ? clamp(Number(durationMatch[1]), 2, 60) : undefined;
  const durationSec =
    perShot !== undefined
      ? clamp(storyboard ? perShot * shots : perShot, 2, 60)
      : total ?? (video ? (storyboard ? shots * 4 : 5) : 5);

  let aspectRatio = "16:9";
  if (/竖屏|9:16|vertical|小红书|抖音/.test(lower)) aspectRatio = "9:16";
  else if (/方图|1:1|square/.test(lower)) aspectRatio = "1:1";
  else if (/横屏|16:9|landscape/.test(lower)) aspectRatio = "16:9";

  const resolution = resMatch
    ? resMatch[1].toLowerCase() === "4k"
      ? "4K"
      : resMatch[1].toLowerCase()
    : video
      ? "1080p"
      : "2K";

  let animationMode: ParsedIntent["animationMode"];
  if (mode === "image-to-video") {
    if (/定格/.test(text)) animationMode = "stop";
    else if (/3d|三维/i.test(text)) animationMode = "3d";
    else if (/2d|二维/i.test(text)) animationMode = "2d";
    else animationMode = "live";
  }

  return {
    mode,
    storyboard,
    shots,
    durationSec,
    resolution,
    aspectRatio,
    bitrateKbps: bitrateMatch ? clamp(Number(bitrateMatch[1]) * 1000, 2000, 80_000) : undefined,
    animationMode,
    negativePrompt: "低清晰度, 变形, 水印, 文字, 闪烁",
    reason,
  };
}

function buildStoryboard(intent: ParsedIntent, assets: MediaAsset[], text: string): StoryboardRow[] {
  const shots = intent.shots;
  const perShot = clamp(Math.round((intent.durationSec / shots) * 2) / 2, 2, 8);
  const sentences = text
    .split(/[。；;\n]/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 4 && !/^\d+$/.test(line));
  return Array.from({ length: shots }, (_, index) => {
    const asset = assets.length ? assets[index % assets.length] : null;
    return {
      id: `shot_${index + 1}_${Date.now().toString(36)}`,
      order: index,
      assetId: asset?.id,
      shotSize: SHOTS[index % SHOTS.length],
      motion: MOTIONS[index % MOTIONS.length],
      description:
        sentences[index] ||
        (index === 0
          ? "建立场景与主体，交代环境光线"
          : index === shots - 1
            ? "收束画面，余韵与留白"
            : `推进叙事：${SHOTS[index % SHOTS.length]}呈现细节`),
      audio: index === 0 ? "环境声渐入" : index === shots - 1 ? "余响淡出" : "节奏推进",
      durationSec: perShot,
    };
  });
}

const formatTokens = (value: number) => Math.round(value).toLocaleString("en-US");
const formatBytes = (bytes: number) => {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
};

export const agentRuntime = new AgentRuntime();
