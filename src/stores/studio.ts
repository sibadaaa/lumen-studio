import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import type {
  AssetRole,
  GenerationMode,
  GenerationRequest,
  GenerationTask,
  LibraryAsset,
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
  VIDEO_RESOLUTIONS,
} from "../data/mock";
import {
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
  BoardState,
  CustomSize,
  HistoryItem,
  Mode,
  Resolution,
  View,
} from "../types";
import { MODE_BY_CONTRACT } from "../types";
import { i18n } from "../i18n";
import { useAppStore } from "./app";

export interface Attachment {
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

const tr = (key: string, options?: Record<string, unknown>) => {
  const translate = i18n.t as (key: string, options?: Record<string, unknown>) => string;
  return translate(key, { ns: "studio", ...options });
};

export const useStudioStore = defineStore("studio", () => {
  const app = useAppStore();

  const mode = ref<Mode>("t2i");
  const view = ref<View>("preview");
  const modeViews = ref<Record<Mode, View>>({
    t2i: "preview",
    t2v: "preview",
    i2i: "preview",
    i2v: "preview",
    multi: "storyboard",
  });
  const prompts = ref<Record<Mode, string>>({ ...DEFAULT_PROMPTS });
  const modeResolution = ref<Record<Mode, Resolution>>({ ...DEFAULT_RESOLUTION });
  const customSizes = ref<{ image: CustomSize; video: CustomSize }>({
    image: dimensionDefaults("image"),
    video: dimensionDefaults("video"),
  });
  const ratio = ref("16:9");
  const ratioLocked = ref(true);
  const bitrate = ref<Bitrate>("auto");
  const customBitrate = ref(16);
  const duration = ref(5);
  const strength = ref(62);
  const negativePrompt = ref("低清晰度, 变形, 水印, 文字");
  const seed = ref("827431");
  const animation = ref<AnimationMode>("live");
  const boards = ref<Record<"t2v" | "multi", BoardState>>(
    JSON.parse(JSON.stringify(DEFAULT_BOARDS))
  );
  const isGenerating = ref(false);
  const progress = ref(0);
  const genStage = ref(tr("genStage.prepare"));
  const history = ref<HistoryItem[]>([...INITIAL_HISTORY]);
  const activeHistory = ref("h1");
  const attachments = ref<Attachment[]>([]);
  const lastOutput = ref<GenerationTask | null>(null);
  const activeJobId = ref<string | null>(null);
  const generationError = ref<string | null>(null);
  const modelOverrides = ref<Partial<Record<Mode, string>>>({});
  const isPlaying = ref(false);
  const videoProgress = ref(0);

  let timer: number | null = null;
  let pollToken = 0;
  let mockCancel = false;
  let projectEpoch = 0;
  let lastProjectId = app.projectId;
  const uploads = new Map<string, Promise<string | null>>();

  const kind = computed(() => sizeKind(mode.value));
  const isVideo = computed(() => isVideoMode(mode.value));
  const resolution = computed(() => modeResolution.value[mode.value]);
  const customSize = computed(() => customSizes.value[kind.value]);
  const board = computed(() =>
    mode.value === "t2v" || mode.value === "multi"
      ? boards.value[mode.value]
      : { title: "分镜脚本", rows: [] as BoardRow[] }
  );
  const isBoardView = computed(
    () => (mode.value === "t2v" || mode.value === "multi") && view.value === "storyboard"
  );
  const estimatedTokens = computed(() =>
    getEstimatedTokens({
      mode: mode.value,
      view: view.value,
      resolution: resolution.value,
      custom: customSize.value,
      duration: duration.value,
      animation: animation.value,
      rows: board.value.rows,
    })
  );
  const dimensions = computed(() =>
    currentDimensions(mode.value, resolution.value, customSize.value, ratio.value)
  );
  const resolutionOptions = computed(() => (isVideo.value ? VIDEO_RESOLUTIONS : IMAGE_RESOLUTIONS));
  const activeOutput = computed(() =>
    lastOutput.value && lastOutput.value.mode === API_MODE[mode.value] ? lastOutput.value : null
  );
  const ctaLabel = computed(() => {
    if (isBoardView.value) return tr("cta.storyboard");
    if (mode.value === "i2v" && animation.value !== "live") return tr("cta.animation");
    return MODES[mode.value].cta;
  });

  const contractMode = computed(() => API_MODE[mode.value]);
  const availableModels = computed(() =>
    app.runtime.models.filter(
      (model) => model.enabled && model.status !== "missing" && model.modes.includes(contractMode.value)
    )
  );
  const route = computed(() => app.runtime.routes.find((item) => item.mode === contractMode.value) || null);
  const selectedModel = computed<ModelInfo | null>(() => {
    const overrideId = modelOverrides.value[mode.value];
    if (overrideId) {
      const override = availableModels.value.find((model) => model.id === overrideId);
      if (override) return override;
    }
    if (route.value) {
      const routed = availableModels.value.find(
        (model) => model.providerId === route.value!.providerId && model.id === route.value!.modelId
      );
      if (routed) return routed;
    }
    return (
      availableModels.value.find((model) => model.providerId === app.runtime.activeProviderId) ||
      availableModels.value[0] ||
      null
    );
  });

  const prompt = computed({
    get: () => prompts.value[mode.value],
    set: (value: string) => {
      prompts.value = { ...prompts.value, [mode.value]: value };
    },
  });

  const bitrateText = computed(() => bitrateLabel(bitrate.value, customBitrate.value));
  const animationText = computed(() => ANIMATION_LABELS[animation.value]);
  const animationHint = computed(() => ANIMATION_HINTS[animation.value]);

  function fitCustomToRatio(nextRatio: string, dims: CustomSize) {
    const base = Math.min(dims.width, dims.height);
    const nextWidth = clamp(Math.round(base), 512, isVideo.value ? 3840 : 8192);
    const nextHeight = clamp(
      Math.round(nextWidth / ratioValue(nextRatio)),
      isVideo.value ? 360 : 512,
      isVideo.value ? 2160 : 8192
    );
    return { width: nextWidth, height: nextHeight };
  }

  function switchMode(next: Mode) {
    if (isGenerating.value) return;
    mode.value = next;
    view.value = next === "t2v" || next === "multi" ? modeViews.value[next] : "preview";
    isPlaying.value = false;
    videoProgress.value = 0;
  }

  function switchView(next: View) {
    if (!(mode.value === "t2v" || mode.value === "multi")) return;
    modeViews.value = { ...modeViews.value, [mode.value]: next };
    view.value = next;
    isPlaying.value = false;
  }

  function openStoryboard() {
    mode.value = "multi";
    modeViews.value = { ...modeViews.value, multi: "storyboard" };
    view.value = "storyboard";
  }

  function setRatio(value: string) {
    ratio.value = value;
    if (resolution.value === "custom" && ratioLocked.value) {
      customSizes.value = {
        ...customSizes.value,
        [kind.value]: fitCustomToRatio(value, customSizes.value[kind.value]),
      };
    }
  }

  function setResolution(value: Resolution) {
    modeResolution.value = { ...modeResolution.value, [mode.value]: value };
  }

  function setCustomSize(axis: "width" | "height", value: number) {
    const dims = { ...customSizes.value[kind.value] };
    const video = isVideo.value;
    const minW = video ? 640 : 512;
    const maxW = video ? 3840 : 8192;
    const minH = video ? 360 : 512;
    const maxH = video ? 2160 : 8192;
    if (axis === "width") {
      dims.width = clamp(Math.round(value || dims.width), minW, maxW);
      if (ratioLocked.value) dims.height = clamp(Math.round(dims.width / ratioValue(ratio.value)), minH, maxH);
    } else {
      dims.height = clamp(Math.round(value || dims.height), minH, maxH);
      if (ratioLocked.value) dims.width = clamp(Math.round(dims.height * ratioValue(ratio.value)), minW, maxW);
    }
    customSizes.value = { ...customSizes.value, [kind.value]: dims };
  }

  function setCustomDimensions(width: number, height: number) {
    const video = isVideo.value;
    customSizes.value = {
      ...customSizes.value,
      [kind.value]: {
        width: clamp(Math.round(width), video ? 640 : 512, video ? 3840 : 8192),
        height: clamp(Math.round(height), video ? 360 : 512, video ? 2160 : 8192),
      },
    };
  }

  function resetParams() {
    modeResolution.value = { ...modeResolution.value, [mode.value]: DEFAULT_RESOLUTION[mode.value] };
    ratio.value = "16:9";
    ratioLocked.value = true;
    bitrate.value = "auto";
    customBitrate.value = 16;
    duration.value = 5;
    strength.value = 62;
    negativePrompt.value = "低清晰度, 变形, 水印, 文字";
    seed.value = "827431";
    animation.value = "live";
    customSizes.value = { image: dimensionDefaults("image"), video: dimensionDefaults("video") };
    app.toast("参数已重置为默认值");
  }

  function updateBoard(updater: (rows: BoardRow[]) => BoardRow[]) {
    if (mode.value !== "t2v" && mode.value !== "multi") return;
    const currentMode = mode.value;
    boards.value = {
      ...boards.value,
      [currentMode]: { ...boards.value[currentMode], rows: updater(boards.value[currentMode].rows) },
    };
  }

  function updateBoardRow(index: number, patch: Partial<BoardRow>) {
    updateBoard((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addBoardRow() {
    updateBoard((rows) => {
      if (rows.length >= 9) {
        app.toast("最多支持 9 个镜头");
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
  }

  function deleteBoardRow(index: number) {
    const minRows = mode.value === "multi" ? 2 : 1;
    updateBoard((rows) => {
      if (rows.length <= minRows) {
        app.toast(mode.value === "multi" ? "图组视频至少保留 2 个镜头" : "至少保留 1 个镜头");
        return rows;
      }
      return rows.filter((_, i) => i !== index);
    });
  }

  function duplicateBoardRow(index: number) {
    updateBoard((rows) => {
      if (rows.length >= 9) {
        app.toast("最多支持 9 个镜头");
        return rows;
      }
      const next = [...rows];
      next.splice(index + 1, 0, { ...rows[index], id: `row-${Date.now()}` });
      return next;
    });
  }

  function resetBoard() {
    if (mode.value !== "t2v" && mode.value !== "multi") return;
    const currentMode = mode.value;
    boards.value = {
      ...boards.value,
      [currentMode]: JSON.parse(JSON.stringify(DEFAULT_BOARDS[currentMode])),
    };
    app.toast(`已根据提示词拆分为 ${DEFAULT_BOARDS[currentMode].rows.length} 个镜头`, "success");
  }

  function exportBoard() {
    if (mode.value !== "t2v" && mode.value !== "multi") return;
    const header = ["镜号", "景别", "运镜", "画面描述", "台词/音效", "时长(s)"];
    const lines = board.value.rows.map((row, index) =>
      [String(index + 1).padStart(2, "0"), row.shot, row.motion, row.desc, row.audio, row.dur]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(",")
    );
    const blob = new Blob([`\ufeff${header.join(",")}\n${lines.join("\n")}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lumen-storyboard-${mode.value}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    app.toast("分镜表已导出 CSV", "success");
  }

  function patchAttachment(id: string, patch: Partial<Attachment>) {
    attachments.value = attachments.value.map((item) => (item.id === id ? { ...item, ...patch } : item));
  }

  function addAttachment(file: File) {
    const id = `a-${++attachmentSeq}`;
    const url = URL.createObjectURL(file);
    const epoch = projectEpoch;
    attachments.value = [...attachments.value, { id, url, name: file.name, uploading: true, progress: 0 }];
    const upload = api
      .upload(file, (value) => patchAttachment(id, { progress: value }), app.projectId)
      .then((asset) => {
        if (epoch !== projectEpoch) return null;
        patchAttachment(id, {
          assetId: asset.id,
          uploading: false,
          progress: 100,
          url: asset.thumbnailUrl || asset.url,
        });
        app.toast(tr("composer.uploadOk"), "success");
        return asset.url;
      })
      .catch((error: Error) => {
        if (epoch !== projectEpoch) return null;
        patchAttachment(id, { uploading: false, progress: 0 });
        app.toast(tr("composer.uploadFail", { message: error.message }));
        return null;
      });
    uploads.set(id, upload);
  }

  function removeAttachment(id: string) {
    uploads.delete(id);
    const target = attachments.value.find((item) => item.id === id);
    if (target && target.url.startsWith("blob:")) URL.revokeObjectURL(target.url);
    attachments.value = attachments.value.filter((item) => item.id !== id);
  }

  /** Fill a library asset into the current mode without re-uploading. */
  function attachAsset(asset: LibraryAsset, role: AssetRole = "reference") {
    const url = asset.thumbnailUrl || asset.url;
    if (role === "shot") {
      const rows = boards.value.multi.rows;
      const index = rows.findIndex((row) => !row.assetId && !row.img);
      if (index < 0) return;
      boards.value = {
        ...boards.value,
        multi: {
          ...boards.value.multi,
          rows: rows.map((row, i) =>
            i === index ? { ...row, img: url, assetId: asset.id, uploading: false } : row
          ),
        },
      };
      app.toast(tr("toasts.refilledShot"), "success");
      return;
    }
    attachments.value = [
      ...attachments.value,
      {
        id: `a-${++attachmentSeq}`,
        url,
        assetId: asset.id,
        name: asset.originalName || asset.id,
        uploading: false,
        progress: 100,
      },
    ];
    const key = role === "first_frame" ? "refilledFirst" : role === "last_frame" ? "refilledLast" : "refilledRef";
    app.toast(tr(`toasts.${key}`), "success");
  }

  /** Apply a cross-page intent (from the works or assets library) once. */
  function applyIntent(incoming: import("../types").StudioIntent) {
    const currentProject = app.projectId;
    const fromOtherProject = (owner?: string) => Boolean(owner && currentProject && owner !== currentProject);

    if (incoming.work) {
      const work = incoming.work;
      const nextMode = MODE_BY_CONTRACT[work.mode] || "t2i";
      mode.value = nextMode;
      prompts.value = { ...prompts.value, [nextMode]: work.prompt || prompts.value[nextMode] };
      if (work.params.negativePrompt !== undefined) negativePrompt.value = work.params.negativePrompt;
      if (typeof work.params.seed === "number" && Number.isFinite(work.params.seed)) seed.value = String(work.params.seed);
      if (work.params.durationSec && [5, 10, 15].includes(work.params.durationSec)) duration.value = work.params.durationSec;
      if (work.params.animationMode && work.params.animationMode !== "live") animation.value = work.params.animationMode;
      if (work.params.resolution && work.params.resolution !== "custom") {
        modeResolution.value = { ...modeResolution.value, [nextMode]: work.params.resolution as Resolution };
      }
      if (work.params.strength !== undefined) strength.value = Math.round(work.params.strength * 100);
      if (work.modelId) modelOverrides.value = { ...modelOverrides.value, [nextMode]: work.modelId };
      if (fromOtherProject(work.projectId)) {
        attachments.value = [];
        app.toast(tr("toasts.foreignWork"));
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
      attachments.value = restored;
      app.toast(tr("toasts.intentRefill"), "success");
    } else if (incoming.asset) {
      if (fromOtherProject(incoming.asset.projectId)) {
        app.toast(tr("toasts.foreignAsset"));
        return;
      }
      attachAsset(incoming.asset, incoming.role || "reference");
    }
  }

  function replaceBoardImage(index: number, url: string, assetId?: string) {
    updateBoardRow(index, { img: url, assetId, uploading: false });
  }

  function replaceBoardImageFile(index: number, file: File) {
    const currentMode = mode.value;
    if (currentMode !== "t2v" && currentMode !== "multi") return;
    const boardMode = currentMode as "t2v" | "multi";
    const localUrl = URL.createObjectURL(file);
    const epoch = projectEpoch;
    boards.value = {
      ...boards.value,
      [boardMode]: {
        ...boards.value[boardMode],
        rows: boards.value[boardMode].rows.map((row, i) =>
          i === index ? { ...row, img: localUrl, assetId: undefined, uploading: true } : row
        ),
      },
    };
    const uploadId = `board-${currentMode}-${index}-${Date.now()}`;
    const task = api
      .upload(file, undefined, app.projectId)
      .then((asset) => {
        if (epoch !== projectEpoch) return null;
        boards.value = {
          ...boards.value,
          [boardMode]: {
            ...boards.value[boardMode],
            rows: boards.value[boardMode].rows.map((row, i) =>
              i === index ? { ...row, img: asset.url, assetId: asset.id, uploading: false } : row
            ),
          },
        };
        app.toast("分镜画面已上传", "success");
        return asset.url;
      })
      .catch((error: Error) => {
        if (epoch !== projectEpoch) return null;
        boards.value = {
          ...boards.value,
          [boardMode]: {
            ...boards.value[boardMode],
            rows: boards.value[boardMode].rows.map((row, i) =>
              i === index ? { ...row, uploading: false } : row
            ),
          },
        };
        app.toast(`${error.message}，分镜保留本地预览`);
        return null;
      });
    uploads.set(uploadId, task);
  }

  function appendHistory(task: GenerationTask, currentMode: Mode) {
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
    history.value = [item, ...history.value.slice(0, 4)];
    activeHistory.value = item.id;
  }

  function startMockGeneration(tokens: number, wasBoard: boolean, label: string, currentMode: Mode) {
    const stages = wasBoard
      ? ["正在校验分镜表", "正在拆分镜头节奏", "正在并行生成各镜", "正在统一色调与转场", "即将完成合成"]
      : ["正在解析画面意图", "正在构建潜空间", "正在渲染光影与细节", "正在整理生成结果", "即将完成"];
    genStage.value = stages[0];
    const started = performance.now();
    const total = currentMode === "multi" || wasBoard ? 4200 : 3000;
    const epoch = projectEpoch;
    if (timer) window.clearInterval(timer);
    timer = window.setInterval(() => {
      if (mockCancel) return;
      if (epoch !== projectEpoch) {
        if (timer) window.clearInterval(timer);
        timer = null;
        return;
      }
      const elapsed = performance.now() - started;
      const next = Math.min(99, Math.round((elapsed / total) * 100));
      const stageIndex = Math.min(stages.length - 1, Math.floor((next / 100) * stages.length));
      progress.value = next;
      genStage.value = stages[stageIndex];
      if (elapsed >= total) {
        if (timer) window.clearInterval(timer);
        timer = null;
        progress.value = 100;
        genStage.value = "生成完成";
        window.setTimeout(() => {
          if (epoch !== projectEpoch) return;
          isGenerating.value = false;
          app.addTokens(tokens);
          if (wasBoard) {
            modeViews.value = { ...modeViews.value, [currentMode]: "preview" };
            view.value = "preview";
          }
          const done = label.startsWith("生成") ? label.replace("生成", "已生成") : label.replace("合成", "已合成");
          app.toast(`${done} · ${formatTokens(tokens)} tokens · Mock 预览`, "success");
          const item: HistoryItem = {
            id: `h-${Date.now()}`,
            mode: currentMode,
            img: demoImage(currentMode),
            time: "刚刚",
            badge: currentMode === "t2i" || currentMode === "i2i" ? "图" : currentMode === "multi" ? "组" : "影",
            tokens,
          };
          history.value = [item, ...history.value.slice(0, 4)];
          activeHistory.value = item.id;
        }, 350);
      }
    }, 90);
  }

  async function pollGeneration(jobId: string, currentMode: Mode) {
    const token = ++pollToken;
    const epoch = projectEpoch;
    let failures = 0;
    let handled = false;
    while (!handled && token === pollToken && epoch === projectEpoch) {
      await sleep(900);
      if (token !== pollToken || epoch !== projectEpoch) return;
      let task: GenerationTask;
      try {
        task = await api.getGeneration(jobId);
      } catch (error) {
        failures += 1;
        if (failures >= 4) {
          isGenerating.value = false;
          const message = (error as Error).message;
          generationError.value = message;
          app.toast(`无法获取任务状态：${message}`);
          return;
        }
        continue;
      }
      if (token !== pollToken || epoch !== projectEpoch) return;
      progress.value = task.progress;
      genStage.value = task.stage;
      if (task.status === "succeeded") {
        handled = true;
        progress.value = 100;
        genStage.value = task.stage || "生成完成";
        isGenerating.value = false;
        activeJobId.value = null;
        generationError.value = null;
        lastOutput.value = task;
        const tokens = task.usage?.totalTokens ?? task.estimatedTokens;
        app.addTokens(tokens);
        if (modeViews.value[currentMode] === "storyboard" || currentMode === "multi") {
          modeViews.value = { ...modeViews.value, [currentMode]: "preview" };
          view.value = "preview";
        }
        appendHistory(task, currentMode);
        app.toast(
          `${task.stage} · ${formatTokens(tokens)} tokens${task.usage?.estimated ? " · 估算" : ""}`,
          "success"
        );
        return;
      }
      if (task.status === "failed" || task.status === "canceled" || task.status === "partial_failed") {
        handled = true;
        isGenerating.value = false;
        activeJobId.value = null;
        const message = task.error?.message || (task.status === "canceled" ? "任务已取消" : "生成失败");
        generationError.value = message;
        if (task.usage?.totalTokens) app.addTokens(task.usage.totalTokens);
        app.toast(message);
        return;
      }
    }
  }

  async function ensureUploads() {
    const pending = [...uploads.values()];
    if (pending.length) await Promise.allSettled(pending);
    const invalid = attachments.value.filter(
      (item) => item.uploading || (!item.assetId && item.url.startsWith("blob:"))
    );
    if (invalid.length) {
      app.toast("部分素材仍在上传或上传失败，请移除后重试");
      return false;
    }
    const activeMode = mode.value;
    if (activeMode === "t2v" || activeMode === "multi") {
      const rows = boards.value[activeMode].rows;
      if (rows.some((row) => row.uploading || (row.img?.startsWith("blob:") && !row.assetId))) {
        app.toast(tr("toasts.boardUploading"));
        return false;
      }
    }
    return true;
  }

  function buildRequest(currentMode: Mode): GenerationRequest | null {
    const currentView = modeViews.value[currentMode] || "preview";
    const isStoryboard = currentMode === "multi" || (currentMode === "t2v" && currentView === "storyboard");
    const usable = attachments.value.filter((item) => item.assetId || item.url.startsWith("/media/"));
    if (currentMode === "i2i" && usable.length === 0) {
      app.toast(tr("toasts.needRef"));
      return null;
    }
    if (currentMode === "i2v" && usable.length === 0 && !boards.value.multi.rows[0]?.assetId) {
      app.toast(tr("toasts.needFirst"));
      return null;
    }
    const provider = app.runtime.provider;
    const fallbackModelId =
      currentMode === "t2i" || currentMode === "i2i"
        ? provider?.imageModel || "lumen-mock-image"
        : provider?.videoModel || "lumen-mock-video";
    const selected = selectedModel.value;
    const modelId = selected?.id || fallbackModelId;
    const providerId = selected?.providerId || app.runtime.activeProviderId || "mock";
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
    const rows =
      currentMode === "t2v" || currentMode === "multi" ? boards.value[currentMode].rows : [];
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
    const dims = currentDimensions(currentMode, resolution.value, customSize.value, ratio.value);
    const bitrateKbps =
      bitrate.value === "auto"
        ? undefined
        : bitrate.value === "custom"
          ? customBitrate.value * 1000
          : Number(bitrate.value) * 1000;
    const seedValue = Number(seed.value);
    return {
      clientRequestId: makeClientRequestId(),
      mode: API_MODE[currentMode],
      generationType: isStoryboard ? "storyboard" : "single",
      providerId,
      modelId,
      prompt: prompts.value[currentMode],
      params: {
        aspectRatio: ratio.value,
        resolution: resolution.value,
        width: dims.width,
        height: dims.height,
        bitrateKbps,
        animationMode: currentMode === "i2v" ? animation.value : undefined,
        durationSec: duration.value,
        fps: 24,
        seed: Number.isFinite(seedValue) ? seedValue : undefined,
        negativePrompt: negativePrompt.value,
        strength: strength.value / 100,
        transition: "dissolve",
        shotDurationSec: 3,
        composeMode: "ai_storyboard",
      },
      inputs,
      storyboard: isStoryboard ? storyboard : [],
      estimatedTokens: estimatedTokens.value,
      projectId: app.projectId,
    };
  }

  async function generate() {
    if (isGenerating.value) return;
    const currentMode = mode.value;
    if (!prompts.value[currentMode].trim() && currentMode !== "multi") {
      app.toast("先写一句提示词，再开始生成");
      return;
    }
    const epoch = projectEpoch;
    const tokens = estimatedTokens.value;
    const wasBoard = isBoardView.value;
    const label = ctaLabel.value;
    generationError.value = null;
    lastOutput.value = null;
    mockCancel = false;
    isGenerating.value = true;
    progress.value = 0;

    if (!app.runtime.online || !app.runtime.provider?.configured) {
      if (!app.runtime.online) {
        startMockGeneration(tokens, wasBoard, label, currentMode);
        return;
      }
      app.toast("当前 Provider 尚未配置，已使用本地 Mock 预览");
      startMockGeneration(tokens, wasBoard, label, currentMode);
      return;
    }

    genStage.value = "正在上传并校验素材";
    if (!(await ensureUploads())) {
      isGenerating.value = false;
      return;
    }
    if (epoch !== projectEpoch) return;
    const request = buildRequest(currentMode);
    if (!request) {
      isGenerating.value = false;
      return;
    }
    genStage.value = "正在提交任务到本机 BFF";
    try {
      const task = await api.createGeneration(request);
      if (epoch !== projectEpoch) return;
      activeJobId.value = task.id;
      genStage.value = task.stage;
      progress.value = task.progress;
      if (["succeeded", "failed", "canceled", "partial_failed"].includes(task.status)) {
        if (task.status === "succeeded") {
          lastOutput.value = task;
          isGenerating.value = false;
          activeJobId.value = null;
          app.addTokens(task.usage?.totalTokens ?? task.estimatedTokens);
          appendHistory(task, currentMode);
          if (wasBoard) {
            modeViews.value = { ...modeViews.value, [currentMode]: "preview" };
            view.value = "preview";
          }
          app.toast(
            `${task.stage} · ${formatTokens(task.usage?.totalTokens ?? task.estimatedTokens)} tokens`,
            "success"
          );
        } else {
          isGenerating.value = false;
          activeJobId.value = null;
          generationError.value = task.error?.message || "任务已结束";
          app.toast(task.error?.message || "任务已结束");
        }
        return;
      }
      await pollGeneration(task.id, currentMode);
    } catch (error) {
      if (epoch !== projectEpoch) return;
      isGenerating.value = false;
      activeJobId.value = null;
      const message = (error as Error).message;
      generationError.value = message;
      app.toast(message);
    }
  }

  function cancelGeneration() {
    pollToken += 1;
    mockCancel = true;
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
    const jobId = activeJobId.value;
    isGenerating.value = false;
    activeJobId.value = null;
    if (jobId) {
      void api
        .cancelGeneration(jobId)
        .then(() => app.toast("已请求取消任务"))
        .catch((error: Error) => app.toast(error.message));
    } else {
      app.toast("已取消本次生成");
    }
  }

  function selectHistory(id: string) {
    const item = history.value.find((entry) => entry.id === id);
    if (!item) return;
    activeHistory.value = id;
    mode.value = item.mode;
    lastOutput.value = item.task || null;
    view.value = "preview";
  }

  function togglePlayback() {
    isPlaying.value = !isPlaying.value;
  }

  function setVideoProgress(value: number) {
    videoProgress.value = value;
  }

  /* Playback simulation */
  let playTimer: number | null = null;
  watch(isPlaying, (playing) => {
    if (playTimer) {
      window.clearInterval(playTimer);
      playTimer = null;
    }
    if (!playing) return;
    playTimer = window.setInterval(() => {
      videoProgress.value = videoProgress.value >= 100 ? 0 : videoProgress.value + 1.4;
      if (videoProgress.value >= 100) isPlaying.value = false;
    }, 80);
  });

  /* Project switching invalidates in-flight work and project-scoped state. */
  watch(
    () => app.projectId,
    (projectId) => {
      if (lastProjectId === projectId) return;
      const wasGenerating = isGenerating.value;
      lastProjectId = projectId;
      projectEpoch += 1;
      pollToken += 1;
      mockCancel = true;
      if (timer) {
        window.clearInterval(timer);
        timer = null;
      }
      uploads.clear();
      for (const item of attachments.value) {
        if (item.url.startsWith("blob:")) URL.revokeObjectURL(item.url);
      }
      attachments.value = [];
      const nextBoards = JSON.parse(JSON.stringify(boards.value));
      (Object.keys(nextBoards) as Array<keyof typeof nextBoards>).forEach((boardMode) => {
        nextBoards[boardMode].rows = nextBoards[boardMode].rows.map((row: BoardRow) => ({
          ...row,
          img: null,
          assetId: undefined,
          uploading: false,
        }));
      });
      boards.value = nextBoards;
      history.value = [];
      activeHistory.value = "";
      lastOutput.value = null;
      activeJobId.value = null;
      generationError.value = null;
      isGenerating.value = false;
      progress.value = 0;
      isPlaying.value = false;
      videoProgress.value = 0;
      if (wasGenerating) app.toast(tr("toasts.projectSwitched"));
    }
  );

  return {
    mode,
    view,
    prompt,
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
    bitrateText,
    duration,
    strength,
    animation,
    animationText,
    animationHint,
    board,
    isBoardView,
    isVideo,
    ctaLabel,
    estimatedTokens,
    isGenerating,
    progress,
    genStage,
    history,
    activeHistory,
    attachments,
    availableModels,
    selectedModel,
    lastOutput,
    activeOutput,
    generationError,
    activeJobId,
    isPlaying,
    videoProgress,
    setPrompt: (value: string) => {
      prompt.value = value;
    },
    setModel: (modelId: string) => {
      modelOverrides.value = { ...modelOverrides.value, [mode.value]: modelId };
    },
    attachAsset,
    switchMode,
    switchView,
    openStoryboard,
    setRatio,
    toggleRatioLock: () => {
      ratioLocked.value = !ratioLocked.value;
    },
    setResolution,
    setCustomSize,
    setCustomDimensions,
    resetParams,
    setBitrate: (value: Bitrate) => {
      bitrate.value = value;
    },
    setCustomBitrate: (value: number) => {
      customBitrate.value = clamp(Math.round(value || 16), 2, 80);
    },
    setDuration: (value: number) => {
      duration.value = value;
    },
    setStrength: (value: number) => {
      strength.value = value;
    },
    setAnimation: (value: AnimationMode) => {
      animation.value = value;
    },
    setNegativePrompt: (value: string) => {
      negativePrompt.value = value;
    },
    setSeed: (value: string) => {
      seed.value = value;
    },
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
    applyIntent,
    togglePlayback,
    setVideoProgress,
  };
});

export type StudioStore = ReturnType<typeof useStudioStore>;
export { SHOT_SIZES, MOTIONS } from "../data/mock";
