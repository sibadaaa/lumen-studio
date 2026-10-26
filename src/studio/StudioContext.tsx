import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { AssetRole, LibraryAsset } from "../../shared/contracts";
import {
  ANIMATION_LABELS,
  IMG,
  MOTIONS,
  SHOT_SIZES,
} from "../data/mock";
import { getEstimatedTokens } from "../lib/tokens";
import { i18n } from "../i18n";
import type { Resolution, StudioIntent } from "../types";
import { MODE_BY_CONTRACT } from "../types";
import { useGenerationJob } from "./hooks/useGenerationJob";
import { useStoryboard } from "./hooks/useStoryboard";
import { useStudioAttachments } from "./hooks/useStudioAttachments";
import { useStudioParams } from "./hooks/useStudioParams";
import { API_MODE, nextAttachmentId, type GenerationSnapshot } from "./hooks/types";
import type { StudioContextValue, StudioProviderProps } from "./types/studio-context";

/** `StudioProvider` 挂载前为 null。仍为 null 时 `useStudio` 会抛错。 */
const StudioContext = createContext<StudioContextValue | null>(null);

/**
 * 把参数、附件、分镜和生成任务收成一份 context。
 * @param props - 外壳回调、运行时、项目，以及可选的一次性意图。
 * @returns Provider 元素。子组件用 `useStudio` 读取。
 */
export function StudioProvider({
  children,
  onTokensUsed,
  toast,
  runtime,
  projectId,
  intent,
  onIntentApplied,
}: StudioProviderProps) {
  /** `projectId` 变化时递增。进行中的上传和轮询对比它，丢掉过期结果。 */
  const projectEpochRef = useRef(0);
  /** 最新项目 id。await 之后的上传和请求读它。 */
  const projectIdRef = useRef(projectId);
  /** 上一个项目 id。重置 effect 发现仍然相同就直接返回。 */
  const lastProjectRef = useRef(projectId);
  /** 生成中为 true。切换模式时读取，不必订阅状态。 */
  const generatingRef = useRef(false);
  /** 任务 hook 用的最新运行时，避免闭包住过期的供应商配置。 */
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;

  /** 模拟视频播放。真实 `<video>` 用自己的控件。 */
  const [isPlaying, setIsPlaying] = useState(false);
  /** 模拟预览的播放头，0–100。到 100 停止播放。 */
  const [videoProgress, setVideoProgress] = useState(0);
  /**
   * 停止模拟播放并回到开头。切换模式和切换项目时调用。
   * @returns 无返回值。
   */
  const resetPlayback = () => {
    setIsPlaying(false);
    setVideoProgress(0);
  };
  /**
   * 只暂停、不回开头。切换视图时调用。
   * @returns 无返回值。
   */
  const pausePlayback = () => setIsPlaying(false);

  const params = useStudioParams({
    toast,
    runtime,
    generatingRef,
    onSwitchMode: resetPlayback,
    onSwitchView: pausePlayback,
  });
  const attachments = useStudioAttachments({ toast, projectEpochRef, projectIdRef });
  const storyboard = useStoryboard({
    mode: params.mode,
    modeRef: params.modeRef,
    toast,
    projectEpochRef,
    projectIdRef,
    uploadsRef: attachments.uploadsRef,
  });

  const estimatedTokens = useMemo(
    () =>
      getEstimatedTokens({
        mode: params.mode,
        view: params.view,
        resolution: params.resolution,
        custom: params.customSize,
        duration: params.duration,
        animation: params.animation,
        rows: storyboard.board.rows,
      }),
    [params.mode, params.view, params.resolution, params.customSize, params.duration, params.animation, storyboard.board.rows]
  );

  /** 给任务 hook 冻结的参数。每次渲染在下面赋值，点击生成时读取。 */
  const snapshotRef = useRef<GenerationSnapshot>(undefined as unknown as GenerationSnapshot);
  snapshotRef.current = {
    prompts: params.prompts,
    modeViews: params.modeViews,
    ratio: params.ratio,
    resolution: params.resolution,
    customSize: params.customSize,
    bitrate: params.bitrate,
    customBitrate: params.customBitrate,
    seed: params.seed,
    animation: params.animation,
    duration: params.duration,
    negativePrompt: params.negativePrompt,
    strength: params.strength,
    estimatedTokens,
    isBoard: params.isBoardView,
    ctaLabel: params.ctaLabel,
    runtimeOnline: runtime.online,
    providerConfigured: Boolean(runtime.provider?.configured),
  };

  const job = useGenerationJob({
    toast,
    onTokensUsed,
    snapshotRef,
    projectEpochRef,
    projectIdRef,
    generatingRef,
    runtimeRef,
    modeRef: params.modeRef,
    selectedModelRef: params.selectedModelRef,
    attachmentsRef: attachments.attachmentsRef,
    boardsRef: storyboard.boardsRef,
    uploadsRef: attachments.uploadsRef,
    setMode: params.setMode,
    setView: params.setView,
    setModeViews: params.setModeViews,
  });

  /** 最新的重置回调。切项目的 effect 读它，避免每次渲染都重新订阅。 */
  const resetBundleRef = useRef({ attachments, storyboard, job, resetPlayback });
  resetBundleRef.current = { attachments, storyboard, job, resetPlayback };

  /** 项目变化时：代次加一、中止任务、清附件和分镜静帧、重置播放。 */
  useEffect(() => {
    projectIdRef.current = projectId;
    if (lastProjectRef.current === projectId) return;
    const wasGenerating = generatingRef.current;
    lastProjectRef.current = projectId;
    projectEpochRef.current += 1;
    const bundle = resetBundleRef.current;
    bundle.job.abortForProject();
    bundle.attachments.resetForProject();
    bundle.storyboard.clearImages();
    bundle.resetPlayback();
    if (wasGenerating) toast(i18n.t("toasts.projectSwitched", { ns: "studio" }));
  }, [projectId, toast]);

  /**
   * 把素材库静帧放到提示词栏，或填进图组第一个空镜头。
   * @param asset - 素材库静帧。
   * @param role - "shot" 填分镜格。默认 "reference"。
   * @returns 无返回值。
   */
  const attachAsset = (asset: LibraryAsset, role: AssetRole = "reference") => {
    if (role === "shot") {
      storyboard.fillEmptyShot(asset);
      return;
    }
    attachments.addFromLibrary(asset, role);
  };

  /**
   * 应用一次从作品或素材库带来的跨页意图。
   * @param incoming - 要恢复的作品，或要挂上的单张素材。
   * @returns 无返回值。别的项目的作品或素材会被拒绝并提示。
   */
  const applyIntent = (incoming: StudioIntent) => {
    const currentProject = projectIdRef.current;
    /**
     * 意图属于另一个已打开项目时为 true。
     * @param owner - 作品或素材上记下的项目 id。
     * @returns 任一侧没有项目时为 false，未归属的条目仍然可以应用。
     */
    const fromOtherProject = (owner?: string) => Boolean(owner && currentProject && owner !== currentProject);

    if (incoming.work) {
      const work = incoming.work;
      const nextMode = MODE_BY_CONTRACT[work.mode] || "t2i";
      params.setMode(nextMode);
      params.setPrompts((prev) => ({ ...prev, [nextMode]: work.prompt || prev[nextMode] }));
      if (work.params.negativePrompt !== undefined) params.setNegativePrompt(work.params.negativePrompt);
      if (typeof work.params.seed === "number" && Number.isFinite(work.params.seed)) params.setSeed(String(work.params.seed));
      // `duration` 只接受 5、10 或 15 秒，其他已存值忽略。
      if (work.params.durationSec && [5, 10, 15].includes(work.params.durationSec)) params.setDuration(work.params.durationSec);
      if (work.params.animationMode && work.params.animationMode !== "live") params.setAnimation(work.params.animationMode);
      if (work.params.resolution && work.params.resolution !== "custom") {
        params.setModeResolution((prev) => ({ ...prev, [nextMode]: work.params.resolution as Resolution }));
      }
      if (work.params.strength !== undefined) params.setStrength(Math.round(work.params.strength * 100));
      if (work.modelId) params.setModelOverrides((prev) => ({ ...prev, [nextMode]: work.modelId }));
      if (fromOtherProject(work.projectId)) {
        attachments.replaceAll([]);
        toast(i18n.t("toasts.foreignWork", { ns: "studio" }));
        return;
      }
      const restored = work.inputs
        .filter((input) => input.assetId || (input.url && input.url.startsWith("/media/")))
        .map((input) => ({
          id: nextAttachmentId(),
          url: input.url || "",
          assetId: input.assetId,
          name: input.role,
          uploading: false,
          progress: 100,
        }));
      attachments.replaceAll(restored);
      toast(i18n.t("toasts.intentRefill", { ns: "studio" }), "success");
    } else if (incoming.asset) {
      if (fromOtherProject(incoming.asset.projectId)) {
        toast(i18n.t("toasts.foreignAsset", { ns: "studio" }));
        return;
      }
      attachAsset(incoming.asset, incoming.role || "reference");
    }
  };

  /** 最新的 `applyIntent`，意图 effect 不必依赖回调身份。 */
  const intentRef = useRef(applyIntent);
  intentRef.current = applyIntent;
  /** 应用一次 `intent`，然后通知外壳清掉它。 */
  useEffect(() => {
    if (!intent) return;
    intentRef.current(intent);
    onIntentApplied?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);

  /** `isPlaying` 为真时推进模拟播放头。到 100 由下面的 effect 停下。 */
  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setVideoProgress((prev) => (prev >= 100 ? 0 : prev + 1.4));
    }, 80);
    return () => window.clearInterval(timer);
  }, [isPlaying]);

  useEffect(() => {
    if (videoProgress >= 100 && isPlaying) setIsPlaying(false);
  }, [videoProgress, isPlaying]);

  /** 最近任务的契约模式与当前工作室模式一致时才保留。舞台读它。 */
  const activeOutput = job.lastOutput && job.lastOutput.mode === API_MODE[params.mode] ? job.lastOutput : null;

  const value: StudioContextValue = {
    mode: params.mode,
    view: params.view,
    projectId,
    prompt: params.prompt,
    negativePrompt: params.negativePrompt,
    seed: params.seed,
    ratio: params.ratio,
    ratioLocked: params.ratioLocked,
    resolution: params.resolution,
    resolutionOptions: params.resolutionOptions,
    customSize: params.customSize,
    dimensions: params.dimensions,
    bitrate: params.bitrate,
    customBitrate: params.customBitrate,
    bitrateText: params.bitrateText,
    duration: params.duration,
    strength: params.strength,
    animation: params.animation,
    animationText: params.animationText,
    animationHint: params.animationHint,
    board: storyboard.board,
    isBoardView: params.isBoardView,
    isVideo: params.isVideo,
    ctaLabel: params.ctaLabel,
    estimatedTokens,
    isGenerating: job.isGenerating,
    progress: job.progress,
    genStage: job.genStage,
    history: job.history,
    activeHistory: job.activeHistory,
    attachments: attachments.attachments,
    runtime,
    availableModels: params.availableModels,
    selectedModel: params.selectedModel,
    setModel: params.setModel,
    attachAsset,
    lastOutput: job.lastOutput,
    activeOutput,
    generationError: job.generationError,
    activeJobId: job.activeJobId,
    isPlaying,
    videoProgress,
    switchMode: params.switchMode,
    switchView: params.switchView,
    openStoryboard: params.openStoryboard,
    setPrompt: params.setPrompt,
    setNegativePrompt: params.setNegativePrompt,
    setSeed: params.setSeed,
    setRatio: params.setRatio,
    toggleRatioLock: params.toggleRatioLock,
    setResolution: params.setResolution,
    setCustomSize: params.setCustomSize,
    setCustomDimensions: params.setCustomDimensions,
    resetParams: params.resetParams,
    setBitrate: params.setBitrate,
    setCustomBitrate: params.setCustomBitrate,
    setDuration: params.setDuration,
    setStrength: params.setStrength,
    setAnimation: params.setAnimation,
    updateBoardRow: storyboard.updateBoardRow,
    addBoardRow: storyboard.addBoardRow,
    deleteBoardRow: storyboard.deleteBoardRow,
    duplicateBoardRow: storyboard.duplicateBoardRow,
    replaceBoardImage: storyboard.replaceBoardImage,
    replaceBoardImageFile: storyboard.replaceBoardImageFile,
    resetBoard: storyboard.resetBoard,
    exportBoard: storyboard.exportBoard,
    generate: job.generate,
    cancelGeneration: job.cancelGeneration,
    selectHistory: job.selectHistory,
    addAttachment: attachments.addAttachment,
    removeAttachment: attachments.removeAttachment,
    togglePlayback: () => setIsPlaying((prev) => !prev),
    setVideoProgress,
  };

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

/**
 * 读取工作室 context。
 * @returns 共享值。在 `StudioProvider` 外调用会抛错。
 */
export function useStudio() {
  const context = useContext(StudioContext);
  if (!context) throw new Error("useStudio must be used inside StudioProvider");
  return context;
}

export { SHOT_SIZES, MOTIONS, ANIMATION_LABELS, IMG };
