import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { GenerationRequest, GenerationTask, StoryboardRow } from "../../../shared/contracts";
import { api, makeClientRequestId, sleep } from "../../lib/api";
import { IMG } from "../../data/mock";
import { currentDimensions, formatTokens } from "../../lib/tokens";
import { i18n } from "../../i18n";
import type { HistoryItem, Mode, StudioRuntime, View } from "../../types";
import { API_MODE, type Attachment, type GenerationSnapshot, type StudioToast } from "./types";
import type { BoardState } from "../../types";

/** 会话还没有真实结果时显示的占位卡片。 */
const INITIAL_HISTORY: HistoryItem[] = [
  { id: "h1", mode: "t2i", img: IMG.glass, time: "刚刚", badge: "图" },
  { id: "h2", mode: "t2v", img: IMG.nebula, time: "2 分钟前", badge: "影" },
  { id: "h3", mode: "i2i", img: IMG.tide, time: "6 分钟前", badge: "图" },
  { id: "h4", mode: "multi", img: IMG.dunes, time: "12 分钟前", badge: "组" },
];

/**
 * 模拟历史卡片用的海报。这些卡片没有真实产物地址。
 * @param mode - 这次模拟使用的工作室模式。
 * @returns 打包在应用里的演示图地址。
 */
const demoImage = (mode: Mode) =>
  mode === "t2i" ? IMG.glass : mode === "t2v" ? IMG.nebula : mode === "i2i" ? IMG.tide : mode === "i2v" ? IMG.dunes : IMG.pastel;

/** 生成 hook 的入参。ref 在 await 之后读取，因此保持最新。 */
interface Options {
  /** 校验、进度和错误用来弹提示。 */
  toast: StudioToast;
  /**
   * 任务完成或失败后扣 token。
   * @param tokens - 实际或估算总量。
   * @returns 无返回值。
   */
  onTokensUsed: (tokens: number) => void;
  /** 点击时冻结的参数。`generate` 读它，而不是后续渲染。 */
  snapshotRef: MutableRefObject<GenerationSnapshot>;
  /** 切项目时递增。轮询和模拟计时发现不再匹配就退出。 */
  projectEpochRef: MutableRefObject<number>;
  /** 抄到请求上的项目 id。 */
  projectIdRef: MutableRefObject<string | undefined>;
  /** 参数 hook 用来拦住模式切换的共享标志。 */
  generatingRef: MutableRefObject<boolean>;
  /** 最新运行时。点击时的供应商配置在快照里检查。 */
  runtimeRef: MutableRefObject<StudioRuntime>;
  /** 调用时的模式。提示词和分镜查找用它，不用闭包里的渲染。 */
  modeRef: MutableRefObject<Mode>;
  /** 这次请求选中的模型。什么都没配置时可能为 null。 */
  selectedModelRef: MutableRefObject<import("../../../shared/contracts").ModelInfo | null>;
  /** 提示词栏静帧。变成输入前会滤成已上传的素材。 */
  attachmentsRef: MutableRefObject<Attachment[]>;
  /** 文生视频和图组分镜。分镜请求从这里拷行。 */
  boardsRef: MutableRefObject<Record<"t2v" | "multi", BoardState>>;
  /** 进行中的提示词栏和分镜格上传。`ensureUploads` 等待这张表。 */
  uploadsRef: MutableRefObject<Map<string, Promise<string | null>>>;
  /**
   * 选中历史卡片时切换模式。
   * @param mode - 卡片上记下的模式。
   * @returns 无返回值。
   */
  setMode: (mode: Mode) => void;
  /**
   * 选中历史后强制回到预览。
   * @param view - 这个 hook 只会传入 "preview"。
   * @returns 无返回值。
   */
  setView: (view: View) => void;
  /**
   * 把刚完成的模式切到预览。
   * @param updater - 映射按模式保存的视图表。
   * @returns 无返回值。
   */
  setModeViews: (updater: (prev: Record<Mode, View>) => Record<Mode, View>) => void;
}

/**
 * 提交、轮询、模拟和取消一次生成，并维护会话历史。
 * @param options - 提示函数、token 回调，以及上面列出的 ref。
 * @returns 任务状态，以及 `generate`、`cancelGeneration`、`selectHistory`、`abortForProject`。
 */
export function useGenerationJob({
  toast,
  onTokensUsed,
  snapshotRef,
  projectEpochRef,
  projectIdRef,
  generatingRef,
  runtimeRef,
  modeRef,
  selectedModelRef,
  attachmentsRef,
  boardsRef,
  uploadsRef,
  setMode,
  setView,
  setModeViews,
}: Options) {
  /** 从点击到任务、模拟计时或取消结束为止为 true。 */
  const [isGenerating, setIsGenerating] = useState(false);
  /** 0–100。模拟在计时结束前最高停在 99。 */
  const [progress, setProgress] = useState(0);
  /** 遮罩上的句子。一开始是准备阶段的文案。 */
  const [genStage, setGenStage] = useState(() => i18n.t("genStage.prepare", { ns: "studio" }));
  /** 历史条卡片，新的在前，最多 5 张。 */
  const [history, setHistory] = useState<HistoryItem[]>(INITIAL_HISTORY);
  /** 高亮历史卡片的 id。 */
  const [activeHistory, setActiveHistory] = useState("h1");
  /** BFF 返回的最近一次任务，不限模式。Provider 再按舞台过滤。 */
  const [lastOutput, setLastOutput] = useState<GenerationTask | null>(null);
  /** 远程任务 id。模拟期间为 null，取消只在本地进行。 */
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  /** 最近一次错误文案。`generate` 开始时清空。 */
  const [generationError, setGenerationError] = useState<string | null>(null);

  /** 递增后让进行中的轮询循环失效。 */
  const pollTokenRef = useRef(0);
  /** 取消时置位，模拟定时器就不再推进进度。 */
  const mockCancelRef = useRef(false);
  /** 模拟进度定时器的 interval id。 */
  const timerRef = useRef<number | null>(null);
  /** 预留的定时器槽。切项目中止和卸载时清掉。 */
  const pollTimerRef = useRef<number | null>(null);

  generatingRef.current = isGenerating;

  /**
   * 分镜任务结束后，把 `currentMode` 显示成预览。
   * @param currentMode - 刚结束的模式。
   * @returns 无返回值。
   */
  const showPreview = (currentMode: Mode) => {
    setModeViews((prev) => ({ ...prev, [currentMode]: "preview" }));
    setView("preview");
  };

  /**
   * 用完成的任务在历史最前面插一张卡片并高亮。
   * @param task - 成功的生成任务。
   * @param currentMode - 任务所属的工作室模式。
   * @returns 无返回值。只保留最新的五张。
   */
  const appendHistory = (task: GenerationTask, currentMode: Mode) => {
    const output = task.outputs[0];
    const item: HistoryItem = {
      id: `h-${Date.now()}`,
      mode: currentMode,
      img: output?.thumbnailUrl || (output?.kind === "image" ? output.url : demoImage(currentMode)),
      time: "刚刚",
      badge: currentMode === "t2i" || currentMode === "i2i" ? "图" : currentMode === "multi" ? "组" : "影",
      src: output?.url,
      kind: output?.kind === "video" ? "video" : output?.kind === "image" ? "image" : undefined,
      jobId: task.id,
      durationSec: output?.durationSec,
      tokens: task.usage?.totalTokens,
      task,
    };
    setHistory((prev) => [item, ...prev.slice(0, 4)]);
    setActiveHistory(item.id);
  };

  /**
   * 运行时离线或供应商未配置时，跑一个本地计时器。
   * @param tokens - 计时结束时计入的估算值。
   * @param wasBoard - 为 true 时结束会把该模式切到预览。
   * @param label - 按钮文案，会改写成成功提示。
   * @param currentMode - 用来决定时长和演示海报的模式。
   * @returns 无返回值。写入进度和一张模拟历史卡片。不调用 BFF。
   */
  const startMockGeneration = (tokens: number, wasBoard: boolean, label: string, currentMode: Mode) => {
    const stages = wasBoard
      ? ["正在校验分镜表", "正在拆分镜头节奏", "正在并行生成各镜", "正在统一色调与转场", "即将完成合成"]
      : ["正在解析画面意图", "正在构建潜空间", "正在渲染光影与细节", "正在整理生成结果", "即将完成"];
    setGenStage(stages[0]);
    const started = performance.now();
    const total = currentMode === "multi" || wasBoard ? 4200 : 3000;
    const epoch = projectEpochRef.current;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      if (mockCancelRef.current) return;
      if (epoch !== projectEpochRef.current) {
        if (timerRef.current) window.clearInterval(timerRef.current);
        timerRef.current = null;
        return;
      }
      const elapsed = performance.now() - started;
      const next = Math.min(99, Math.round((elapsed / total) * 100));
      const stageIndex = Math.min(stages.length - 1, Math.floor((next / 100) * stages.length));
      setProgress(next);
      setGenStage(stages[stageIndex]);
      if (elapsed >= total) {
        if (timerRef.current) window.clearInterval(timerRef.current);
        timerRef.current = null;
        setProgress(100);
        setGenStage("生成完成");
        window.setTimeout(() => {
          if (epoch !== projectEpochRef.current) return;
          setIsGenerating(false);
          onTokensUsed(tokens);
          if (wasBoard) showPreview(currentMode);
          const done = label.startsWith("生成") ? label.replace("生成", "已生成") : label.replace("合成", "已合成");
          toast(`${done} · ${formatTokens(tokens)} tokens · Mock 预览`, "success");
          const item: HistoryItem = {
            id: `h-${Date.now()}`,
            mode: currentMode,
            img: demoImage(currentMode),
            time: "刚刚",
            badge: currentMode === "t2i" || currentMode === "i2i" ? "图" : currentMode === "multi" ? "组" : "影",
            tokens,
          };
          setHistory((prev) => [item, ...prev.slice(0, 4)]);
          setActiveHistory(item.id);
        }, 350);
      }
    }, 90);
  };

  /**
   * 轮询一个远程任务，直到它结束，或更新的轮询、切项目抢先。
   * 连续 4 次拉取失败后放弃。
   * @param jobId - 创建接口返回的任务 id。
   * @param currentMode - 要打开预览、并用来标记历史的模式。
   * @param modeViews - 点击时冻结的视图。成功时分镜视图会翻到预览。
   * @returns 无返回值。写入进度、`lastOutput`、历史和错误。
   */
  const pollGeneration = async (jobId: string, currentMode: Mode, modeViews: GenerationSnapshot["modeViews"]) => {
    const token = ++pollTokenRef.current;
    const epoch = projectEpochRef.current;
    let failures = 0;
    let handled = false;
    while (!handled && token === pollTokenRef.current && epoch === projectEpochRef.current) {
      await sleep(900);
      if (token !== pollTokenRef.current || epoch !== projectEpochRef.current) return;
      let task: GenerationTask;
      try {
        task = await api.getGeneration(jobId);
      } catch (error) {
        failures += 1;
        if (failures >= 4) {
          setIsGenerating(false);
          const message = (error as Error).message;
          setGenerationError(message);
          toast(`无法获取任务状态：${message}`);
          return;
        }
        continue;
      }
      if (token !== pollTokenRef.current || epoch !== projectEpochRef.current) return;
      setProgress(task.progress);
      setGenStage(task.stage);
      if (task.status === "succeeded") {
        handled = true;
        setProgress(100);
        setGenStage(task.stage || "生成完成");
        setIsGenerating(false);
        setActiveJobId(null);
        setGenerationError(null);
        setLastOutput(task);
        const tokens = task.usage?.totalTokens ?? task.estimatedTokens;
        onTokensUsed(tokens);
        if (modeViews[currentMode] === "storyboard" || currentMode === "multi") showPreview(currentMode);
        appendHistory(task, currentMode);
        toast(`${task.stage} · ${formatTokens(tokens)} tokens${task.usage?.estimated ? " · 估算" : ""}`, "success");
        return;
      }
      if (task.status === "failed" || task.status === "canceled" || task.status === "partial_failed") {
        handled = true;
        setIsGenerating(false);
        setActiveJobId(null);
        const message = task.error?.message || (task.status === "canceled" ? "任务已取消" : "生成失败");
        setGenerationError(message);
        if (task.usage?.totalTokens) onTokensUsed(task.usage.totalTokens);
        toast(message);
        return;
      }
    }
  };

  /**
   * 等待进行中的上传，并拒绝始终没有素材 id 的行。
   * @returns 提示词栏静帧和视频分镜格都可以发送时为 true。
   */
  const ensureUploads = async () => {
    const pending = [...uploadsRef.current.values()];
    if (pending.length) await Promise.allSettled(pending);
    const invalid = attachmentsRef.current.filter((item) => item.uploading || (!item.assetId && item.url.startsWith("blob:")));
    if (invalid.length) {
      toast("部分素材仍在上传或上传失败，请移除后重试");
      return false;
    }
    const activeMode = modeRef.current;
    if (activeMode === "t2v" || activeMode === "multi") {
      const rows = boardsRef.current[activeMode].rows;
      if (rows.some((row) => row.uploading || (row.img?.startsWith("blob:") && !row.assetId))) {
        toast(i18n.t("toasts.boardUploading", { ns: "studio" }));
        return false;
      }
    }
    return true;
  };

  /**
   * 用冻结快照以及最新附件、分镜组装 BFF 请求。
   * 每个分镜的 `durationSec` 夹紧到 0.5–8 秒。
   * @param currentMode - 正在生成的模式。
   * @param snap - 点击时捕获的参数。
   * @returns 请求体；缺少必需静帧时为 null。
   */
  const buildRequest = (currentMode: Mode, snap: GenerationSnapshot): GenerationRequest | null => {
    const currentView = snap.modeViews[currentMode] || "preview";
    const isStoryboard = currentMode === "multi" || (currentMode === "t2v" && currentView === "storyboard");
    const usable = attachmentsRef.current.filter((item) => item.assetId || item.url.startsWith("/media/"));
    if (currentMode === "i2i" && usable.length === 0) {
      toast(i18n.t("toasts.needRef", { ns: "studio" }));
      return null;
    }
    if (currentMode === "i2v" && usable.length === 0 && !boardsRef.current.multi.rows[0]?.assetId) {
      toast(i18n.t("toasts.needFirst", { ns: "studio" }));
      return null;
    }
    const provider = runtimeRef.current.provider;
    const fallbackModelId =
      currentMode === "t2i" || currentMode === "i2i" ? provider?.imageModel || "lumen-mock-image" : provider?.videoModel || "lumen-mock-video";
    const selected = selectedModelRef.current;
    const modelId = selected?.id || fallbackModelId;
    const providerId = selected?.providerId || runtimeRef.current.activeProviderId || "mock";
    const inputs = usable.map((item, index) => ({
      assetId: item.assetId,
      url: item.assetId ? undefined : item.url,
      role:
        currentMode === "i2v"
          ? index === 0
            ? ("first_frame" as const)
            : ("last_frame" as const)
          : currentMode === "multi"
            ? ("shot" as const)
            : ("reference" as const),
      order: index,
    }));
    const rows = currentMode === "t2v" || currentMode === "multi" ? boardsRef.current[currentMode].rows : [];
    const storyboard: StoryboardRow[] = rows.map((row, index) => ({
      id: row.id,
      order: index,
      assetId: row.assetId,
      imageUrl: row.assetId ? undefined : row.img?.startsWith("/") ? row.img : undefined,
      shotSize: row.shot,
      motion: row.motion,
      description: row.desc || `镜头 ${index + 1}`,
      audio: row.audio,
      durationSec: Math.min(8, Math.max(0.5, Number(row.dur) || 3)),
    }));
    const dims = currentDimensions(currentMode, snap.resolution, snap.customSize, snap.ratio);
    const bitrateKbps = snap.bitrate === "auto" ? undefined : snap.bitrate === "custom" ? snap.customBitrate * 1000 : Number(snap.bitrate) * 1000;
    const seedValue = Number(snap.seed);
    return {
      clientRequestId: makeClientRequestId(),
      mode: API_MODE[currentMode],
      generationType: isStoryboard ? "storyboard" : "single",
      providerId,
      modelId,
      prompt: snap.prompts[currentMode],
      params: {
        aspectRatio: snap.ratio,
        resolution: snap.resolution,
        width: dims.width,
        height: dims.height,
        bitrateKbps,
        animationMode: currentMode === "i2v" ? snap.animation : undefined,
        durationSec: snap.duration,
        fps: 24,
        seed: Number.isFinite(seedValue) ? seedValue : undefined,
        negativePrompt: snap.negativePrompt,
        strength: snap.strength / 100,
        transition: "dissolve",
        shotDurationSec: 3,
        composeMode: "ai_storyboard",
      },
      inputs,
      storyboard: isStoryboard ? storyboard : [],
      estimatedTokens: snap.estimatedTokens,
      projectId: projectIdRef.current,
    };
  };

  /**
   * 从 `snapshotRef` 开始一次生成。
   * @returns 无返回值。已有任务在跑，或提示词为空（图组除外）时不生效。
   * 离线或未配置的供应商走模拟；否则提交并轮询。
   */
  const generate = async () => {
    if (isGenerating) return;
    const snap = snapshotRef.current;
    const currentMode = modeRef.current;
    if (!snap.prompts[currentMode].trim() && currentMode !== "multi") {
      toast("先写一句提示词，再开始生成");
      return;
    }
    const epoch = projectEpochRef.current;
    const tokens = snap.estimatedTokens;
    const wasBoard = snap.isBoard;
    const label = snap.ctaLabel;
    setGenerationError(null);
    setLastOutput(null);
    mockCancelRef.current = false;
    setIsGenerating(true);
    setProgress(0);

    if (!snap.runtimeOnline || !snap.providerConfigured) {
      if (!snap.runtimeOnline) {
        startMockGeneration(tokens, wasBoard, label, currentMode);
        return;
      }
      toast("当前 Provider 尚未配置，已使用本地 Mock 预览");
      startMockGeneration(tokens, wasBoard, label, currentMode);
      return;
    }

    setGenStage("正在上传并校验素材");
    if (!(await ensureUploads())) {
      setIsGenerating(false);
      return;
    }
    if (epoch !== projectEpochRef.current) return;
    const request = buildRequest(currentMode, snap);
    if (!request) {
      setIsGenerating(false);
      return;
    }
    setGenStage("正在提交任务到本机 BFF");
    try {
      const task = await api.createGeneration(request);
      if (epoch !== projectEpochRef.current) return;
      setActiveJobId(task.id);
      setGenStage(task.stage);
      setProgress(task.progress);
      if (["succeeded", "failed", "canceled", "partial_failed"].includes(task.status)) {
        if (task.status === "succeeded") {
          setLastOutput(task);
          setIsGenerating(false);
          setActiveJobId(null);
          onTokensUsed(task.usage?.totalTokens ?? task.estimatedTokens);
          appendHistory(task, currentMode);
          if (wasBoard) showPreview(currentMode);
          toast(`${task.stage} · ${formatTokens(task.usage?.totalTokens ?? task.estimatedTokens)} tokens`, "success");
        } else {
          setIsGenerating(false);
          setActiveJobId(null);
          setGenerationError(task.error?.message || "任务已结束");
          toast(task.error?.message || "任务已结束");
        }
        return;
      }
      await pollGeneration(task.id, currentMode, snap.modeViews);
    } catch (error) {
      if (epoch !== projectEpochRef.current) return;
      setIsGenerating(false);
      setActiveJobId(null);
      const message = (error as Error).message;
      setGenerationError(message);
      toast(message);
    }
  };

  /**
   * 停掉本地计时，或请 BFF 取消 `activeJobId`。
   * @returns 无返回值。递增 `pollTokenRef`，让轮询循环退出。
   */
  const cancelGeneration = () => {
    pollTokenRef.current += 1;
    mockCancelRef.current = true;
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const jobId = activeJobId;
    setIsGenerating(false);
    setActiveJobId(null);
    if (jobId) {
      void api
        .cancelGeneration(jobId)
        .then(() => toast("已请求取消任务"))
        .catch((error: Error) => toast(error.message));
    } else {
      toast("已取消本次生成");
    }
  };

  /**
   * 高亮一张历史卡片，并在预览里显示它的产物。
   * @param id - 历史项 id。
   * @returns 无返回值。id 不存在时不生效。模式切到卡片上的模式。
   */
  const selectHistory = (id: string) => {
    const item = history.find((entry) => entry.id === id);
    if (!item) return;
    setActiveHistory(id);
    setMode(item.mode);
    setLastOutput(item.task || null);
    setView("preview");
  };

  /**
   * 打开的项目变化时丢掉进行中的任务和历史。
   * @returns 无返回值。不调用 BFF 的取消接口。
   */
  const abortForProject = () => {
    pollTokenRef.current += 1;
    mockCancelRef.current = true;
    if (pollTimerRef.current) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setHistory([]);
    setActiveHistory("");
    setLastOutput(null);
    setActiveJobId(null);
    setGenerationError(null);
    setIsGenerating(false);
    setProgress(0);
  };

  useEffect(() => {
    return () => {
      pollTokenRef.current += 1;
      if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  return {
    isGenerating,
    progress,
    genStage,
    history,
    activeHistory,
    lastOutput,
    activeJobId,
    generationError,
    generate,
    cancelGeneration,
    selectHistory,
    abortForProject,
  };
}
