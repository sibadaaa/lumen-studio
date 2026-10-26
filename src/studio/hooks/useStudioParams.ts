import { useMemo, useRef, useState, type MutableRefObject } from "react";
import type { ModelInfo } from "../../../shared/contracts";
import {
  ANIMATION_HINTS,
  DEFAULT_PROMPTS,
  DEFAULT_RESOLUTION,
  IMAGE_RESOLUTIONS,
  MODES,
  VIDEO_RESOLUTIONS,
} from "../../data/mock";
import {
  animationLabel,
  bitrateLabel,
  clamp,
  currentDimensions,
  dimensionDefaults,
  ratioValue,
  sizeKind,
  isVideoMode,
} from "../../lib/tokens";
import type { AnimationMode, Bitrate, CustomSize, Mode, Resolution, StudioRuntime, View } from "../../types";
import { API_MODE, type StudioToast } from "./types";

/** 参数 hook 的入参。播放回调留在 Provider 里。 */
interface Options {
  /** 重置成功时用来弹提示。 */
  toast: StudioToast;
  /** 挑选 `selectedModel` 时用的供应商路由和模型。 */
  runtime: StudioRuntime;
  /** 任务进行中为 true。`switchMode` 读它来拒绝切换。 */
  generatingRef: MutableRefObject<boolean>;
  /**
   * 模式切换后调用。Provider 用它重置模拟播放。
   * @returns 无返回值。
   */
  onSwitchMode: () => void;
  /**
   * 视图切换后调用。Provider 只用它暂停播放。
   * @returns 无返回值。
   */
  onSwitchView: () => void;
}

/**
 * 管理各工作室模式的提示词、尺寸和模型选择。
 * @param options - 提示函数、运行时，以及上面的播放回调。
 * @returns 当前切片和各个 setter。按模式保存的表留在 hook 内部。
 */
export function useStudioParams({ toast, runtime, generatingRef, onSwitchMode, onSwitchView }: Options) {
  /** 当前模式。其他表都用它做下标。 */
  const [mode, setMode] = useState<Mode>("t2i");
  /** 当前模式显示的视图。图像模式一直停在预览。 */
  const [view, setView] = useState<View>("preview");
  /** 每个模式上次的视图，切走再切回时能恢复分镜。 */
  const [modeViews, setModeViews] = useState<Record<Mode, View>>({
    t2i: "preview",
    t2v: "preview",
    i2i: "preview",
    i2v: "preview",
    multi: "storyboard",
  });
  /** 按模式记住的提示词。提示词栏只改 `prompts[mode]`。 */
  const [prompts, setPrompts] = useState<Record<Mode, string>>(DEFAULT_PROMPTS);
  /** 按模式记住的分辨率预设。 */
  const [modeResolution, setModeResolution] = useState<Record<Mode, Resolution>>({ ...DEFAULT_RESOLUTION });
  /** 自定义像素尺寸，图像和视频分开存，避免两套范围互相覆盖。 */
  const [customSizes, setCustomSizes] = useState<{ image: CustomSize; video: CustomSize }>({
    image: dimensionDefaults("image"),
    video: dimensionDefaults("video"),
  });
  /** 各模式共用的画幅比例。 */
  const [ratio, setRatioState] = useState("16:9");
  /** 为 true 时宽高保持绑定在 `ratio` 上。 */
  const [ratioLocked, setRatioLocked] = useState(true);
  /** 视频输出的码率预设。 */
  const [bitrate, setBitrateState] = useState<Bitrate>("auto");
  /** 自定义码率，单位 Mbps。仅 `bitrate` 为 "custom" 时使用。 */
  const [customBitrate, setCustomBitrateState] = useState(16);
  /** 单段时长，单位秒。 */
  const [duration, setDuration] = useState(5);
  /** 图生图强度，0–100。 */
  const [strength, setStrength] = useState(62);
  /** 各模式共用的负向提示词。 */
  const [negativePrompt, setNegativePrompt] = useState("低清晰度, 变形, 水印, 文字");
  /** 用户输入的种子原文。任务 hook 稍后才解析。 */
  const [seed, setSeed] = useState("827431");
  /** 图生视频的运动风格。 */
  const [animation, setAnimation] = useState<AnimationMode>("live");
  /** 检查器里为每个模式选定的模型 id，优先于路由。 */
  const [modelOverrides, setModelOverrides] = useState<Partial<Record<Mode, string>>>({});

  /** 最新模式。`setModel` 这类 setter 用它，避免闭包住过期渲染。 */
  const modeRef = useRef(mode);
  modeRef.current = mode;

  /** 用来过滤模型和查找路由的契约模式。 */
  const contractMode = API_MODE[mode];
  /** 检查器可以为 `contractMode` 提供的模型。 */
  const availableModels = useMemo(
    () => runtime.models.filter((model) => model.enabled && model.status !== "missing" && model.modes.includes(contractMode)),
    [runtime.models, contractMode]
  );
  /** `contractMode` 的路由行。外壳没配置时为 null。 */
  const route = useMemo(
    () => runtime.routes.find((item) => item.mode === contractMode) || null,
    [runtime.routes, contractMode]
  );
  /**
   * 下次请求使用的模型。
   * 顺序：按模式覆盖，然后路由，然后当前供应商，最后列表里的第一个可用模型。
   */
  const selectedModel = useMemo<ModelInfo | null>(() => {
    const overrideId = modelOverrides[mode];
    if (overrideId) {
      const override = availableModels.find((model) => model.id === overrideId);
      if (override) return override;
    }
    if (route) {
      const routed = availableModels.find((model) => model.providerId === route.providerId && model.id === route.modelId);
      if (routed) return routed;
    }
    return availableModels.find((model) => model.providerId === runtime.activeProviderId) || availableModels[0] || null;
  }, [availableModels, route, runtime.activeProviderId, modelOverrides, mode]);
  /** 最新模型。`buildRequest` 在 await 之后读它。 */
  const selectedModelRef = useRef<ModelInfo | null>(selectedModel);
  selectedModelRef.current = selectedModel;

  /** "image" 或 "video"。决定控件改 `customSizes` 的哪一项。 */
  const kind = sizeKind(mode);
  /** 视频模式为 true。用来切换分辨率预设和尺寸上下限。 */
  const video = isVideoMode(mode);
  /** 当前模式的分辨率预设。 */
  const resolution = modeResolution[mode];
  /** 当前种类的自定义尺寸。 */
  const customSize = customSizes[kind];
  /** 视频模式正处于分镜视图时为 true。 */
  const isBoardView = (mode === "t2v" || mode === "multi") && view === "storyboard";
  /** 写入请求的像素尺寸。 */
  const dimensions = currentDimensions(mode, resolution, customSize, ratio);
  /** 检查器里按当前种类展示的预设。 */
  const resolutionOptions = video ? VIDEO_RESOLUTIONS : IMAGE_RESOLUTIONS;
  /** 当前模式和视图下的生成按钮文案。 */
  const ctaLabel = isBoardView
    ? "生成分镜视频"
    : mode === "i2v" && animation !== "live"
      ? "生成动画视频"
      : MODES[mode].cta;

  /**
   * 以短边为基准，把 `dims` 适配到 `nextRatio`。
   * 宽度夹紧到 512–8192（图像）或 512–3840（视频）。
   * 高度夹紧到 512–8192（图像）或 360–2160（视频）。
   * @param nextRatio - 宽高必须匹配的比例文案。
   * @param dims - 当前种类的自定义尺寸。
   * @returns 夹紧后的宽高。
   */
  const fitCustomToRatio = (nextRatio: string, dims: CustomSize) => {
    const base = Math.min(dims.width, dims.height);
    const nextWidth = clamp(Math.round(base), 512, video ? 3840 : 8192);
    const nextHeight = clamp(Math.round(nextWidth / ratioValue(nextRatio)), video ? 360 : 512, video ? 2160 : 8192);
    return { width: nextWidth, height: nextHeight };
  };

  /**
   * 生成进行中不切换模式。
   * @param next - 目标模式。
   * @returns 无返回值。会恢复该模式的视图并调用 `onSwitchMode`。
   */
  const switchMode = (next: Mode) => {
    if (generatingRef.current) return;
    setMode(next);
    setView(next === "t2v" || next === "multi" ? modeViews[next] : "preview");
    onSwitchMode();
  };

  /**
   * 只为文生视频和图组切换预览 / 分镜。
   * @param next - 目标视图。
   * @returns 无返回值。写入 `modeViews[mode]` 并调用 `onSwitchView`。
   */
  const switchView = (next: View) => {
    if (!(mode === "t2v" || mode === "multi")) return;
    setModeViews((prev) => ({ ...prev, [mode]: next }));
    setView(next);
    onSwitchView();
  };

  /**
   * 跳到图组分镜。
   * @returns 无返回值。
   */
  const openStoryboard = () => {
    setMode("multi");
    setModeViews((prev) => ({ ...prev, multi: "storyboard" }));
    setView("storyboard");
  };

  /**
   * 替换当前模式的提示词。
   * @param value - 新的提示词。
   * @returns 无返回值。
   */
  const setPrompt = (value: string) => setPrompts((prev) => ({ ...prev, [mode]: value }));

  /**
   * 设置画幅比例。锁定且为自定义尺寸时重算宽高。
   * @param value - 比例文案。
   * @returns 无返回值。
   */
  const setRatio = (value: string) => {
    setRatioState(value);
    if (resolution === "custom" && ratioLocked) {
      setCustomSizes((prev) => ({ ...prev, [kind]: fitCustomToRatio(value, prev[kind]) }));
    }
  };

  /**
   * 设置当前模式的分辨率预设。
   * @param value - 预设或 "custom"。
   * @returns 无返回值。
   */
  const setResolution = (value: Resolution) => setModeResolution((prev) => ({ ...prev, [mode]: value }));

  /**
   * 改自定义尺寸的一边。`ratioLocked` 为真时另一边按 `ratio` 跟随。
   * `customSize.width` 夹紧到 640–3840（视频）或 512–8192（图像）。
   * `customSize.height` 夹紧到 360–2160（视频）或 512–8192（图像）。
   * @param axis - 用户改的是宽还是高。
   * @param value - 请求的像素。非正数保留当前这一边。
   * @returns 无返回值。
   */
  const setCustomSize = (axis: "width" | "height", value: number) => {
    setCustomSizes((prev) => {
      const dims = { ...prev[kind] };
      const minW = video ? 640 : 512;
      const maxW = video ? 3840 : 8192;
      const minH = video ? 360 : 512;
      const maxH = video ? 2160 : 8192;
      if (axis === "width") {
        dims.width = clamp(Math.round(value || dims.width), minW, maxW);
        if (ratioLocked) dims.height = clamp(Math.round(dims.width / ratioValue(ratio)), minH, maxH);
      } else {
        dims.height = clamp(Math.round(value || dims.height), minH, maxH);
        if (ratioLocked) dims.width = clamp(Math.round(dims.height * ratioValue(ratio)), minW, maxW);
      }
      return { ...prev, [kind]: dims };
    });
  };

  /**
   * 同时替换自定义宽高，不套用比例锁定。
   * 宽高上下限与 `setCustomSize` 相同。
   * @param width - 请求的宽度，单位像素。
   * @param height - 请求的高度，单位像素。
   * @returns 无返回值。
   */
  const setCustomDimensions = (width: number, height: number) => {
    const minW = video ? 640 : 512;
    const maxW = video ? 3840 : 8192;
    const minH = video ? 360 : 512;
    const maxH = video ? 2160 : 8192;
    setCustomSizes((prev) => ({
      ...prev,
      [kind]: { width: clamp(Math.round(width), minW, maxW), height: clamp(Math.round(height), minH, maxH) },
    }));
  };

  /**
   * 恢复默认生成参数并提示。
   * @returns 无返回值。不清提示词、模式或模型覆盖。
   */
  const resetParams = () => {
    setModeResolution((prev) => ({ ...prev, [mode]: DEFAULT_RESOLUTION[mode] }));
    setRatioState("16:9");
    setRatioLocked(true);
    setBitrateState("auto");
    setCustomBitrateState(16);
    setDuration(5);
    setStrength(62);
    setNegativePrompt("低清晰度, 变形, 水印, 文字");
    setSeed("827431");
    setAnimation("live");
    setCustomSizes({ image: dimensionDefaults("image"), video: dimensionDefaults("video") });
    toast("参数已重置为默认值");
  };

  /**
   * 为调用当下的模式记下模型覆盖。
   * @param modelId - `availableModels` 里的 id。
   * @returns 无返回值。
   */
  const setModel = (modelId: string) => setModelOverrides((prev) => ({ ...prev, [modeRef.current]: modelId }));

  return {
    mode,
    view,
    modeRef,
    modeViews,
    prompts,
    prompt: prompts[mode],
    negativePrompt,
    seed,
    ratio,
    ratioLocked,
    resolution,
    resolutionOptions,
    customSize,
    dimensions,
    bitrate,
    customBitrate,
    bitrateText: bitrateLabel(bitrate, customBitrate),
    duration,
    strength,
    animation,
    animationText: animationLabel(animation),
    animationHint: ANIMATION_HINTS[animation],
    isBoardView,
    isVideo: video,
    ctaLabel,
    availableModels,
    selectedModel,
    selectedModelRef,
    setMode,
    setView,
    setModeViews,
    setPrompts,
    setNegativePrompt,
    setSeed,
    setDuration,
    setStrength,
    setAnimation,
    setModeResolution,
    setModelOverrides,
    switchMode,
    switchView,
    openStoryboard,
    setPrompt,
    setRatio,
    toggleRatioLock: () => setRatioLocked((prev) => !prev),
    setResolution,
    setCustomSize,
    setCustomDimensions,
    resetParams,
    setBitrate: setBitrateState,
    /** 把 `customBitrate` 夹紧到 2–80 Mbps。空输入回落到 16。 */
    setCustomBitrate: (value: number) => setCustomBitrateState(clamp(Math.round(value || 16), 2, 80)),
    setModel,
  };
}
