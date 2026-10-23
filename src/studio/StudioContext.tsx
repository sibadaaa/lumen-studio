import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  AssetRole,
  GenerationMode,
  GenerationRequest,
  GenerationTask,
  LibraryAsset,
  MediaAsset,
  ModelInfo,
  StoryboardRow,
} from "../../shared/contracts";
import { api, makeClientRequestId, sleep } from "../lib/api";
import {
  ANIMATION_HINTS,
  ANIMATION_LABELS,
  DEFAULT_BOARDS,
  DEFAULT_PROMPTS,
  DEFAULT_RESOLUTION,
  IMAGE_RESOLUTIONS,
  IMG,
  MODES,
  MOTIONS,
  SHOT_SIZES,
  VIDEO_RESOLUTIONS,
} from "../data/mock";
import {
  animationLabel,
  bitrateLabel,
  clamp,
  currentDimensions,
  dimensionDefaults,
  formatTokens,
  getEstimatedTokens,
  isVideoMode,
  ratioValue,
  sizeKind,
} from "../lib/tokens";
import type {
  AnimationMode,
  Bitrate,
  BoardRow,
  CustomSize,
  HistoryItem,
  Mode,
  Resolution,
  StudioIntent,
  StudioRuntime,
  View,
} from "../types";
import { MODE_BY_CONTRACT } from "../types";
import { i18n } from "../i18n";

interface Attachment {
  id: string;
  url: string;
  name: string;
  assetId?: string;
  uploading?: boolean;
  progress?: number;
}

const API_MODE: Record<Mode, GenerationMode> = {
  t2i: "text-to-image",
  t2v: "text-to-video",
  i2i: "image-to-image",
  i2v: "image-to-video",
  multi: "multi-image-to-video",
};

interface StudioContextValue {
  mode: Mode;
  view: View;
  projectId?: string;
  prompt: string;
  negativePrompt: string;
  seed: string;
  ratio: string;
  ratioLocked: boolean;
  resolution: Resolution;
  resolutionOptions: Resolution[];
  customSize: CustomSize;
  dimensions: CustomSize;
  bitrate: Bitrate;
  customBitrate: number;
  bitrateText: string;
  duration: number;
  strength: number;
  animation: AnimationMode;
  animationText: string;
  animationHint: string;
  board: { title: string; rows: BoardRow[] };
  isBoardView: boolean;
  isVideo: boolean;
  ctaLabel: string;
  estimatedTokens: number;
  isGenerating: boolean;
  progress: number;
  genStage: string;
  history: HistoryItem[];
  activeHistory: string;
  attachments: Attachment[];
  runtime: StudioRuntime;
  availableModels: ModelInfo[];
  selectedModel: ModelInfo | null;
  setModel: (modelId: string) => void;
  attachAsset: (asset: LibraryAsset, role?: AssetRole) => void;
  lastOutput: GenerationTask | null;
  activeOutput: GenerationTask | null;
  generationError: string | null;
  activeJobId: string | null;
  isPlaying: boolean;
  videoProgress: number;
  switchMode: (mode: Mode) => void;
  switchView: (view: View) => void;
  openStoryboard: () => void;
  setPrompt: (value: string) => void;
  setNegativePrompt: (value: string) => void;
  setSeed: (value: string) => void;
  setRatio: (value: string) => void;
  toggleRatioLock: () => void;
  setResolution: (value: Resolution) => void;
  setCustomSize: (axis: "width" | "height", value: number) => void;
  setCustomDimensions: (width: number, height: number) => void;
  resetParams: () => void;
  setBitrate: (value: Bitrate) => void;
  setCustomBitrate: (value: number) => void;
  setDuration: (value: number) => void;
  setStrength: (value: number) => void;
  setAnimation: (value: AnimationMode) => void;
  updateBoardRow: (index: number, patch: Partial<BoardRow>) => void;
  addBoardRow: () => void;
  deleteBoardRow: (index: number) => void;
  duplicateBoardRow: (index: number) => void;
  replaceBoardImage: (index: number, url: string, assetId?: string) => void;
  replaceBoardImageFile: (index: number, file: File) => void;
  resetBoard: () => void;
  exportBoard: () => void;
  generate: () => void;
  cancelGeneration: () => void;
  selectHistory: (id: string) => void;
  addAttachment: (file: File) => void;
  removeAttachment: (id: string) => void;
  togglePlayback: () => void;
  setVideoProgress: (value: number) => void;
}

const StudioContext = createContext<StudioContextValue | null>(null);

const INITIAL_HISTORY: HistoryItem[] = [
  { id: "h1", mode: "t2i", img: IMG.glass, time: "刚刚", badge: "图" },
  { id: "h2", mode: "t2v", img: IMG.nebula, time: "2 分钟前", badge: "影" },
  { id: "h3", mode: "i2i", img: IMG.tide, time: "6 分钟前", badge: "图" },
  { id: "h4", mode: "multi", img: IMG.dunes, time: "12 分钟前", badge: "组" },
];

let attachmentSeq = 0;

const demoImage = (mode: Mode) =>
  mode === "t2i"
    ? IMG.glass
    : mode === "t2v"
      ? IMG.nebula
      : mode === "i2i"
        ? IMG.tide
        : mode === "i2v"
          ? IMG.dunes
          : IMG.pastel;

export function StudioProvider({
  children,
  onTokensUsed,
  toast,
  runtime,
  projectId,
  intent,
  onIntentApplied,
}: {
  children: ReactNode;
  onTokensUsed: (tokens: number) => void;
  toast: (message: string, type?: "default" | "success") => void;
  runtime: StudioRuntime;
  projectId?: string;
  intent?: StudioIntent | null;
  onIntentApplied?: () => void;
}) {
  const [mode, setMode] = useState<Mode>("t2i");
  const [view, setView] = useState<View>("preview");
  const [modeViews, setModeViews] = useState<Record<Mode, View>>({
    t2i: "preview",
    t2v: "preview",
    i2i: "preview",
    i2v: "preview",
    multi: "storyboard",
  });
  const [prompts, setPrompts] = useState<Record<Mode, string>>(DEFAULT_PROMPTS);
  const [modeResolution, setModeResolution] = useState<Record<Mode, Resolution>>({ ...DEFAULT_RESOLUTION });
  const [customSizes, setCustomSizes] = useState<{ image: CustomSize; video: CustomSize }>({
    image: dimensionDefaults("image"),
    video: dimensionDefaults("video"),
  });
  const [ratio, setRatioState] = useState("16:9");
  const [ratioLocked, setRatioLocked] = useState(true);
  const [bitrate, setBitrateState] = useState<Bitrate>("auto");
  const [customBitrate, setCustomBitrateState] = useState(16);
  const [duration, setDurationState] = useState(5);
  const [strength, setStrengthState] = useState(62);
  const [negativePrompt, setNegativePrompt] = useState("低清晰度, 变形, 水印, 文字");
  const [seed, setSeed] = useState("827431");
  const [animation, setAnimationState] = useState<AnimationMode>("live");
  const [boards, setBoards] = useState(DEFAULT_BOARDS);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [genStage, setGenStage] = useState(() => i18n.t("genStage.prepare", { ns: "studio" }));
  const [history, setHistory] = useState<HistoryItem[]>(INITIAL_HISTORY);
  const [activeHistory, setActiveHistory] = useState("h1");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [lastOutput, setLastOutput] = useState<GenerationTask | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [modelOverrides, setModelOverrides] = useState<Partial<Record<Mode, string>>>({});
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const timerRef = useRef<number | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const pollTokenRef = useRef(0);
  const mockCancelRef = useRef(false);
  const uploadsRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const attachmentsRef = useRef<Attachment[]>([]);
  const boardsRef = useRef(boards);
  const modeRef = useRef(mode);
  const runtimeRef = useRef(runtime);
  const projectIdRef = useRef(projectId);
  const projectEpochRef = useRef(0);
  const lastProjectRef = useRef(projectId);
  const generatingRef = useRef(isGenerating);
  const modelOverridesRef = useRef(modelOverrides);

  useEffect(() => {
    modelOverridesRef.current = modelOverrides;
  }, [modelOverrides]);

  /* -------------------- model catalog selection (M4) -------------------- */
  const contractMode = API_MODE[mode];
  const availableModels = useMemo(
    () => runtime.models.filter((model) => model.enabled && model.status !== "missing" && model.modes.includes(contractMode)),
    [runtime.models, contractMode]
  );
  const route = useMemo(() => runtime.routes.find((item) => item.mode === contractMode) || null, [runtime.routes, contractMode]);
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
    return (
      availableModels.find((model) => model.providerId === runtime.activeProviderId) ||
      availableModels[0] ||
      null
    );
  }, [availableModels, route, runtime.activeProviderId, modelOverrides, mode]);
  const selectedModelRef = useRef<ModelInfo | null>(selectedModel);
  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);
  useEffect(() => {
    boardsRef.current = boards;
  }, [boards]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    runtimeRef.current = runtime;
  }, [runtime]);
  useEffect(() => {
    generatingRef.current = isGenerating;
  }, [isGenerating]);
  useEffect(() => {
    projectIdRef.current = projectId;
    if (lastProjectRef.current === projectId) return;

    // Project switched: invalidate in-flight uploads/generation callbacks and
    // drop every piece of studio state that belongs to the previous project.
    const wasGenerating = generatingRef.current;
    lastProjectRef.current = projectId;
    projectEpochRef.current += 1;
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
    uploadsRef.current.clear();
    setAttachments((prev) => {
      for (const item of prev) {
        if (item.url.startsWith("blob:")) URL.revokeObjectURL(item.url);
      }
      return [];
    });
    attachmentsRef.current = [];
    setBoards((prev) => {
      const next = { ...prev };
      (Object.keys(next) as Array<keyof typeof next>).forEach((boardMode) => {
        next[boardMode] = {
          ...next[boardMode],
          rows: next[boardMode].rows.map((row) => ({ ...row, img: null, assetId: undefined, uploading: false })),
        };
      });
      boardsRef.current = next;
      return next;
    });
    setHistory([]);
    setActiveHistory("");
    setLastOutput(null);
    setActiveJobId(null);
    setGenerationError(null);
    setIsGenerating(false);
    setProgress(0);
    setIsPlaying(false);
    setVideoProgress(0);
    if (wasGenerating) toast(i18n.t("toasts.projectSwitched", { ns: "studio" }));
  }, [projectId, toast]);
  useEffect(() => {
    return () => {
      pollTokenRef.current += 1;
      if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
    };
  }, []);

  const kind = sizeKind(mode);
  const video = isVideoMode(mode);
  const resolution = modeResolution[mode];
  const customSize = customSizes[kind];
  const board = mode === "t2v" || mode === "multi" ? boards[mode] : { title: "分镜脚本", rows: [] };
  const isBoard = (mode === "t2v" || mode === "multi") && view === "storyboard";
  const estimatedTokens = useMemo(
    () =>
      getEstimatedTokens({
        mode,
        view,
        resolution,
        custom: customSize,
        duration,
        animation,
        rows: board.rows,
      }),
    [mode, view, resolution, customSize, duration, animation, board.rows]
  );
  const dimensions = currentDimensions(mode, resolution, customSize, ratio);
  const resolutionOptions = video ? VIDEO_RESOLUTIONS : IMAGE_RESOLUTIONS;
  const activeOutput = lastOutput && lastOutput.mode === API_MODE[mode] ? lastOutput : null;
  const ctaLabel = isBoard
    ? "生成分镜视频"
    : mode === "i2v" && animation !== "live"
      ? "生成动画视频"
      : MODES[mode].cta;

  const fitCustomToRatio = useCallback(
    (nextRatio: string, dims: CustomSize) => {
      const base = Math.min(dims.width, dims.height);
      const nextWidth = clamp(Math.round(base), 512, video ? 3840 : 8192);
      const nextHeight = clamp(Math.round(nextWidth / ratioValue(nextRatio)), video ? 360 : 512, video ? 2160 : 8192);
      return { width: nextWidth, height: nextHeight };
    },
    [video]
  );

  const switchMode = (next: Mode) => {
    if (isGenerating) return;
    setMode(next);
    setView(next === "t2v" || next === "multi" ? modeViews[next] : "preview");
    setIsPlaying(false);
    setVideoProgress(0);
  };

  const switchView = (next: View) => {
    if (!(mode === "t2v" || mode === "multi")) return;
    setModeViews((prev) => ({ ...prev, [mode]: next }));
    setView(next);
    setIsPlaying(false);
  };

  const openStoryboard = () => {
    setMode("multi");
    setModeViews((prev) => ({ ...prev, multi: "storyboard" }));
    setView("storyboard");
  };

  const setPrompt = (value: string) => setPrompts((prev) => ({ ...prev, [mode]: value }));

  const setRatio = (value: string) => {
    setRatioState(value);
    if (resolution === "custom" && ratioLocked) {
      setCustomSizes((prev) => ({ ...prev, [kind]: fitCustomToRatio(value, prev[kind]) }));
    }
  };

  const setResolution = (value: Resolution) => setModeResolution((prev) => ({ ...prev, [mode]: value }));

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

  const resetParams = () => {
    setModeResolution((prev) => ({ ...prev, [mode]: DEFAULT_RESOLUTION[mode] }));
    setRatioState("16:9");
    setRatioLocked(true);
    setBitrateState("auto");
    setCustomBitrateState(16);
    setDurationState(5);
    setStrengthState(62);
    setNegativePrompt("低清晰度, 变形, 水印, 文字");
    setSeed("827431");
    setAnimationState("live");
    setCustomSizes({ image: dimensionDefaults("image"), video: dimensionDefaults("video") });
    toast("参数已重置为默认值");
  };

  const updateBoard = (updater: (rows: BoardRow[]) => BoardRow[]) => {
    if (mode !== "t2v" && mode !== "multi") return;
    setBoards((prev) => ({ ...prev, [mode]: { ...prev[mode], rows: updater(prev[mode].rows) } }));
  };

  const updateBoardRow = (index: number, patch: Partial<BoardRow>) =>
    updateBoard((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const addBoardRow = () => {
    updateBoard((rows) => {
      if (rows.length >= 9) {
        toast("最多支持 9 个镜头");
        return rows;
      }
      const last = rows[rows.length - 1];
      return [
        ...rows,
        {
          id: `row-${Date.now()}`,
          img: null,
          shot: "中景",
          motion: "缓慢推进",
          desc: "",
          audio: "",
          dur: Math.min(8, Math.max(2, Number(last?.dur) || 3)),
        },
      ];
    });
  };

  const deleteBoardRow = (index: number) => {
    const minRows = mode === "multi" ? 2 : 1;
    updateBoard((rows) => {
      if (rows.length <= minRows) {
        toast(mode === "multi" ? "图组视频至少保留 2 个镜头" : "至少保留 1 个镜头");
        return rows;
      }
      return rows.filter((_, i) => i !== index);
    });
  };

  const duplicateBoardRow = (index: number) => {
    updateBoard((rows) => {
      if (rows.length >= 9) {
        toast("最多支持 9 个镜头");
        return rows;
      }
      const next = [...rows];
      next.splice(index + 1, 0, { ...rows[index], id: `row-${Date.now()}` });
      return next;
    });
  };

  const resetBoard = () => {
    if (mode !== "t2v" && mode !== "multi") return;
    setBoards((prev) => ({ ...prev, [mode]: JSON.parse(JSON.stringify(DEFAULT_BOARDS[mode])) }));
    toast(`已根据提示词拆分为 ${DEFAULT_BOARDS[mode].rows.length} 个镜头`, "success");
  };

  const exportBoard = () => {
    if (mode !== "t2v" && mode !== "multi") return;
    const header = ["镜号", "景别", "运镜", "画面描述", "台词/音效", "时长(s)"];
    const lines = board.rows.map((row, index) =>
      [String(index + 1).padStart(2, "0"), row.shot, row.motion, row.desc, row.audio, row.dur]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(",")
    );
    const blob = new Blob([`\ufeff${header.join(",")}\n${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lumen-storyboard-${mode}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("分镜表已导出 CSV", "success");
  };

  const patchAttachment = (id: string, patch: Partial<Attachment>) => {
    setAttachments((prev) => {
      const next = prev.map((item) => (item.id === id ? { ...item, ...patch } : item));
      attachmentsRef.current = next;
      return next;
    });
  };

  const addAttachment = (file: File) => {
    const id = `a-${++attachmentSeq}`;
    const url = URL.createObjectURL(file);
    const epoch = projectEpochRef.current;
    setAttachments((prev) => {
      const next = [...prev, { id, url, name: file.name, uploading: true, progress: 0 }];
      attachmentsRef.current = next;
      return next;
    });
    const upload = api
      .upload(file, (progress) => patchAttachment(id, { progress }), projectIdRef.current)
      .then((asset) => {
        if (epoch !== projectEpochRef.current) return null;
        patchAttachment(id, { assetId: asset.id, uploading: false, progress: 100, url: asset.thumbnailUrl || asset.url });
        toast(i18n.t("composer.uploadOk", { ns: "studio" }), "success");
        return asset.url;
      })
      .catch((error: Error) => {
        if (epoch !== projectEpochRef.current) return null;
        patchAttachment(id, { uploading: false, progress: 0 });
        toast(i18n.t("composer.uploadFail", { ns: "studio", message: error.message }), "default");
        return null;
      });
    uploadsRef.current.set(id, upload);
  };

  const removeAttachment = (id: string) => {
    uploadsRef.current.delete(id);
    setAttachments((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target && target.url.startsWith("blob:")) URL.revokeObjectURL(target.url);
      const next = prev.filter((item) => item.id !== id);
      attachmentsRef.current = next;
      return next;
    });
  };

  /** Fill a library asset into the current mode without re-uploading. */
  const attachAsset = (asset: LibraryAsset, role: AssetRole = "reference") => {
    const url = asset.thumbnailUrl || asset.url;
    if (role === "shot") {
      setBoards((prev) => {
        const rows = prev.multi.rows;
        const index = rows.findIndex((row) => !row.assetId && !row.img);
        if (index < 0) return prev;
        return {
          ...prev,
          multi: {
            ...prev.multi,
            rows: rows.map((row, i) => (i === index ? { ...row, img: url, assetId: asset.id, uploading: false } : row)),
          },
        };
      });
      toast(i18n.t("toasts.refilledShot", { ns: "studio" }), "success");
      return;
    }
    setAttachments((prev) => {
      const next = [
        ...prev,
        { id: `a-${++attachmentSeq}`, url, assetId: asset.id, name: asset.originalName || asset.id, uploading: false, progress: 100 },
      ];
      attachmentsRef.current = next;
      return next;
    });
    const key = role === "first_frame" ? "refilledFirst" : role === "last_frame" ? "refilledLast" : "refilledRef";
    toast(i18n.t(`toasts.${key}`, { ns: "studio" }), "success");
  };

  /** Apply a cross-page intent (from the works or assets library) once. */
  const applyIntent = (incoming: StudioIntent) => {
    const currentProject = projectIdRef.current;
    const fromOtherProject = (owner?: string) => Boolean(owner && currentProject && owner !== currentProject);

    if (incoming.work) {
      const work = incoming.work;
      const nextMode = MODE_BY_CONTRACT[work.mode] || "t2i";
      setMode(nextMode);
      setPrompts((prev) => ({ ...prev, [nextMode]: work.prompt || prev[nextMode] }));
      if (work.params.negativePrompt !== undefined) setNegativePrompt(work.params.negativePrompt);
      if (typeof work.params.seed === "number" && Number.isFinite(work.params.seed)) setSeed(String(work.params.seed));
      if (work.params.durationSec && [5, 10, 15].includes(work.params.durationSec)) setDurationState(work.params.durationSec);
      if (work.params.animationMode && work.params.animationMode !== "live") setAnimationState(work.params.animationMode);
      if (work.params.resolution && work.params.resolution !== "custom") {
        setModeResolution((prev) => ({ ...prev, [nextMode]: work.params.resolution as Resolution }));
      }
      if (work.params.strength !== undefined) setStrengthState(Math.round(work.params.strength * 100));
      if (work.modelId) setModelOverrides((prev) => ({ ...prev, [nextMode]: work.modelId }));
      if (fromOtherProject(work.projectId)) {
        // Cross-project work: restore prompt/params only, never its assets.
        setAttachments([]);
        attachmentsRef.current = [];
        toast(i18n.t("toasts.foreignWork", { ns: "studio" }));
        return;
      }
      const restored = work.inputs
        .filter((input) => input.assetId || (input.url && input.url.startsWith("/media/")))
        .map((input) => ({
          id: `a-${++attachmentSeq}`,
          url: input.url || "",
          assetId: input.assetId,
          name: input.role,
          uploading: false,
          progress: 100,
        }));
      setAttachments(restored);
      attachmentsRef.current = restored;
      toast(i18n.t("toasts.intentRefill", { ns: "studio" }), "success");
    } else if (incoming.asset) {
      if (fromOtherProject(incoming.asset.projectId)) {
        toast(i18n.t("toasts.foreignAsset", { ns: "studio" }));
        return;
      }
      attachAsset(incoming.asset, incoming.role || "reference");
    }
  };

  const intentRef = useRef(applyIntent);
  intentRef.current = applyIntent;
  useEffect(() => {
    if (!intent) return;
    intentRef.current(intent);
    onIntentApplied?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);

  const replaceBoardImage = (index: number, url: string, assetId?: string) => {
    updateBoardRow(index, { img: url, assetId, uploading: false });
  };

  const replaceBoardImageFile = (index: number, file: File) => {
    const currentMode = modeRef.current;
    if (currentMode !== "t2v" && currentMode !== "multi") return;
    const boardMode = currentMode as "t2v" | "multi";
    const localUrl = URL.createObjectURL(file);
    const epoch = projectEpochRef.current;
    setBoards((prev) => {
      const next = {
        ...prev,
        [boardMode]: {
          ...prev[boardMode],
          rows: prev[boardMode].rows.map((row, i) => (i === index ? { ...row, img: localUrl, assetId: undefined, uploading: true } : row)),
        },
      };
      boardsRef.current = next;
      return next;
    });
    const uploadId = `board-${currentMode}-${index}-${Date.now()}`;
    const task = api
      .upload(file, undefined, projectIdRef.current)
      .then((asset) => {
        if (epoch !== projectEpochRef.current) return null;
        setBoards((prev) => {
          const next = {
            ...prev,
            [boardMode]: {
              ...prev[boardMode],
              rows: prev[boardMode].rows.map((row, i) =>
                i === index ? { ...row, img: asset.url, assetId: asset.id, uploading: false } : row
              ),
            },
          };
          boardsRef.current = next;
          return next;
        });
        toast("分镜画面已上传", "success");
        return asset.url;
      })
      .catch((error: Error) => {
        if (epoch !== projectEpochRef.current) return null;
        setBoards((prev) => {
          const next = {
            ...prev,
            [boardMode]: {
              ...prev[boardMode],
              rows: prev[boardMode].rows.map((row, i) => (i === index ? { ...row, uploading: false } : row)),
            },
          };
          boardsRef.current = next;
          return next;
        });
        toast(`${error.message}，分镜保留本地预览`);
        return null;
      });
    uploadsRef.current.set(uploadId, task);
  };

  const appendHistory = (task: GenerationTask, currentMode: Mode) => {
    const output = task.outputs[0];
    const item = {
      id: `h-${Date.now()}`,
      mode: currentMode,
      img: output?.thumbnailUrl || (output?.kind === "image" ? output.url : demoImage(currentMode)),
      time: "刚刚",
      badge: currentMode === "t2i" || currentMode === "i2i" ? "图" : currentMode === "multi" ? "组" : "影",
      src: output?.url,
      kind: output?.kind === "video" ? ("video" as const) : output?.kind === "image" ? ("image" as const) : undefined,
      jobId: task.id,
      durationSec: output?.durationSec,
      tokens: task.usage?.totalTokens,
      task,
    };
    setHistory((prev) => [item, ...prev.slice(0, 4)]);
    setActiveHistory(item.id);
  };

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
          if (wasBoard) {
            setModeViews((prev) => ({ ...prev, [currentMode]: "preview" }));
            setView("preview");
          }
          const done = label.startsWith("生成") ? label.replace("生成", "已生成") : label.replace("合成", "已合成");
          toast(`${done} · ${formatTokens(tokens)} tokens · Mock 预览`, "success");
          const item = {
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

  const pollGeneration = async (jobId: string, currentMode: Mode) => {
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
        if (modeViews[currentMode] === "storyboard" || currentMode === "multi") {
          setModeViews((prev) => ({ ...prev, [currentMode]: "preview" }));
          setView("preview");
        }
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

  const ensureUploads = async () => {
    const pending = [...uploadsRef.current.values()];
    if (pending.length) await Promise.allSettled(pending);
    const invalid = attachmentsRef.current.filter(
      (item) => item.uploading || (!item.assetId && item.url.startsWith("blob:"))
    );
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

  const buildRequest = (currentMode: Mode): GenerationRequest | null => {
    const currentView = modeViews[currentMode] || "preview";
    const isStoryboard =
      currentMode === "multi" || (currentMode === "t2v" && currentView === "storyboard");
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
      currentMode === "t2i" || currentMode === "i2i"
        ? provider?.imageModel || "lumen-mock-image"
        : provider?.videoModel || "lumen-mock-video";
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
    const dims = currentDimensions(currentMode, resolution, customSize, ratio);
    const bitrateKbps =
      bitrate === "auto" ? undefined : bitrate === "custom" ? customBitrate * 1000 : Number(bitrate) * 1000;
    const seedValue = Number(seed);
    return {
      clientRequestId: makeClientRequestId(),
      mode: API_MODE[currentMode],
      generationType: isStoryboard ? "storyboard" : "single",
      providerId,
      modelId,
      prompt: prompts[currentMode],
      params: {
        aspectRatio: ratio,
        resolution,
        width: dims.width,
        height: dims.height,
        bitrateKbps,
        animationMode: currentMode === "i2v" ? animation : undefined,
        durationSec: duration,
        fps: 24,
        seed: Number.isFinite(seedValue) ? seedValue : undefined,
        negativePrompt,
        strength: strength / 100,
        transition: "dissolve",
        shotDurationSec: 3,
        composeMode: "ai_storyboard",
      },
      inputs,
      storyboard: isStoryboard ? storyboard : [],
      estimatedTokens,
      projectId: projectIdRef.current,
    };
  };

  const generate = async () => {
    if (isGenerating) return;
    const currentMode = modeRef.current;
    if (!prompts[currentMode].trim() && currentMode !== "multi") {
      toast("先写一句提示词，再开始生成");
      return;
    }
    const epoch = projectEpochRef.current;
    const tokens = estimatedTokens;
    const wasBoard = isBoard;
    const label = ctaLabel;
    setGenerationError(null);
    setLastOutput(null);
    mockCancelRef.current = false;
    setIsGenerating(true);
    setProgress(0);

    if (!runtime.online || !runtime.provider?.configured) {
      if (!runtime.online) {
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
    const request = buildRequest(currentMode);
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
          if (wasBoard) {
            setModeViews((prev) => ({ ...prev, [currentMode]: "preview" }));
            setView("preview");
          }
          toast(`${task.stage} · ${formatTokens(task.usage?.totalTokens ?? task.estimatedTokens)} tokens`, "success");
        } else {
          setIsGenerating(false);
          setActiveJobId(null);
          setGenerationError(task.error?.message || "任务已结束");
          toast(task.error?.message || "任务已结束");
        }
        return;
      }
      await pollGeneration(task.id, currentMode);
    } catch (error) {
      if (epoch !== projectEpochRef.current) return;
      setIsGenerating(false);
      setActiveJobId(null);
      const message = (error as Error).message;
      setGenerationError(message);
      toast(message);
    }
  };

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

  const selectHistory = (id: string) => {
    const item = history.find((entry) => entry.id === id);
    if (!item) return;
    setActiveHistory(id);
    setMode(item.mode);
    setLastOutput(item.task || null);
    setView("preview");
  };

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

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  const value: StudioContextValue = {
    mode,
    view,
    projectId,
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
    board,
    isBoardView: isBoard,
    isVideo: video,
    ctaLabel,
    estimatedTokens,
    isGenerating,
    progress,
    genStage,
    history,
    activeHistory,
    attachments,
    runtime,
    availableModels,
    selectedModel,
    setModel: (modelId) => setModelOverrides((prev) => ({ ...prev, [modeRef.current]: modelId })),
    attachAsset,
    lastOutput,
    activeOutput,
    generationError,
    activeJobId,
    isPlaying,
    videoProgress,
    switchMode,
    switchView,
    openStoryboard,
    setPrompt,
    setNegativePrompt,
    setSeed,
    setRatio,
    toggleRatioLock: () => setRatioLocked((prev) => !prev),
    setResolution,
    setCustomSize,
    setCustomDimensions,
    resetParams,
    setBitrate: setBitrateState,
    setCustomBitrate: (value) => setCustomBitrateState(clamp(Math.round(value || 16), 2, 80)),
    setDuration: setDurationState,
    setStrength: setStrengthState,
    setAnimation: setAnimationState,
    updateBoardRow,
    addBoardRow,
    deleteBoardRow,
    duplicateBoardRow,
    replaceBoardImage,
    replaceBoardImageFile,
    resetBoard,
    exportBoard,
    generate,
    cancelGeneration,
    selectHistory,
    addAttachment,
    removeAttachment,
    togglePlayback: () => setIsPlaying((prev) => !prev),
    setVideoProgress,
  };

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const context = useContext(StudioContext);
  if (!context) throw new Error("useStudio must be used inside StudioProvider");
  return context;
}

export { SHOT_SIZES, MOTIONS, ANIMATION_LABELS, IMG };
