import type { ReactNode } from "react";
import type { AssetRole, GenerationTask, LibraryAsset, ModelInfo } from "../../../shared/contracts";
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
} from "../../types";
import type { Attachment } from "../hooks/types";

/** 各工作室面板共用的状态和操作。 */
export interface StudioContextValue {
  /** 当前生成模式。模式页签、检查器和舞台都会读它。 */
  mode: Mode;
  /** 预览或分镜。只有文生视频和图组视频会保留分镜视图。 */
  view: View;
  /** 从某个项目进入工作室时的项目 id。上传和任务都挂在它下面。 */
  projectId?: string;
  /** 当前模式的提示词。每个模式各自保存一份。 */
  prompt: string;
  /** 下一次生成会带上的负向提示词。 */
  negativePrompt: string;
  /** 种子原文。非数字会在请求里省略。 */
  seed: string;
  /** 画幅比例文案，例如 "16:9"。驱动画板和自定义尺寸。 */
  ratio: string;
  /** 为 true 时，改自定义宽或高的一边会按 `ratio` 改另一边。 */
  ratioLocked: boolean;
  /** 当前模式的分辨率预设，或 "custom"。 */
  resolution: Resolution;
  /** 当前模式可选的预设：图像或视频。 */
  resolutionOptions: Resolution[];
  /** `resolution` 为 "custom" 时可编辑的宽高。 */
  customSize: CustomSize;
  /** 实际发送的像素尺寸：预设尺寸，或按 `ratio` 夹紧后的 `customSize`。 */
  dimensions: CustomSize;
  /** 码率预设。"auto" 不传码率；"custom" 使用 `customBitrate`。 */
  bitrate: Bitrate;
  /** 自定义码率，单位 Mbps。写入前夹紧到 2–80。 */
  customBitrate: number;
  /** 当前码率的可读文案，显示在检查器里。 */
  bitrateText: string;
  /** 单段视频模式的时长，单位秒。 */
  duration: number;
  /** 图生图强度。界面为 0–100，请求里为 0–1。 */
  strength: number;
  /** 图生视频的运动风格。仅 i2v 会发送。 */
  animation: AnimationMode;
  /** `animation` 的短标签，显示在控件旁。 */
  animationText: string;
  /** `animation` 的较长说明，显示在控件下方。 */
  animationHint: string;
  /** 当前视频模式的分镜标题和行。文生视频、图组以外为空。 */
  board: { title: string; rows: BoardRow[] };
  /** 文生视频或图组正在显示分镜而不是预览时为 true。 */
  isBoardView: boolean;
  /** 文生视频、图生视频、图组为 true。用来藏起仅图像的控件。 */
  isVideo: boolean;
  /** 生成按钮文案。分镜和非实拍动画会换成别的句子。 */
  ctaLabel: string;
  /** 当前参数的 token 估算。点击生成时冻进快照。 */
  estimatedTokens: number;
  /** 真实任务或本地模拟计时进行中时为 true。 */
  isGenerating: boolean;
  /** 当前任务或模拟计时的进度，0–100。 */
  progress: number;
  /** 生成遮罩上的阶段文案。 */
  genStage: string;
  /** 本次会话的历史卡片。选中一张会恢复对应模式和产物。 */
  history: HistoryItem[];
  /** 历史条里高亮卡片的 id。 */
  activeHistory: string;
  /** 挂在提示词栏上的参考图、首帧或镜头静帧。 */
  attachments: Attachment[];
  /** 外壳提供的供应商、路由和模型列表。 */
  runtime: StudioRuntime;
  /** 已启用、且支持当前契约模式的模型。 */
  availableModels: ModelInfo[];
  /** 下次请求使用的模型：先按模式覆盖，再路由，再当前供应商。 */
  selectedModel: ModelInfo | null;
  /**
   * 记住当前模式选用的 `modelId`。
   * @param modelId - `availableModels` 里的 id。
   * @returns 无返回值。之后读取 `selectedModel` 会优先用这次覆盖。
   */
  setModel: (modelId: string) => void;
  /**
   * 把素材库静帧放到提示词栏，或填进图组第一个空镜头。
   * @param asset - 要挂上的素材库静帧。
   * @param role - "shot" 填分镜格；其他角色变成附件。默认 "reference"。
   * @returns 无返回值。
   */
  attachAsset: (asset: LibraryAsset, role?: AssetRole) => void;
  /** 最近一次完成的任务，即使它属于别的模式。 */
  lastOutput: GenerationTask | null;
  /** `lastOutput` 的契约模式与当前模式一致时保留，否则为 null。 */
  activeOutput: GenerationTask | null;
  /** 最近一次失败或取消的文案。新一次生成开始时清空。 */
  generationError: string | null;
  /** 远程任务轮询期间的 BFF 任务 id。本地模拟时为 null。 */
  activeJobId: string | null;
  /** 本地预览是否在播放。真实 `<video>` 控件不看这个标志。 */
  isPlaying: boolean;
  /** 模拟视频预览的播放头，0–100。 */
  videoProgress: number;
  /**
   * 切换模式，并恢复该模式上次的视图。生成中不生效。
   * @param mode - 目标工作室模式。
   * @returns 无返回值。同时重置模拟播放。
   */
  switchMode: (mode: Mode) => void;
  /**
   * 在文生视频和图组之间切换预览 / 分镜。
   * @param view - "preview" 或 "storyboard"。
   * @returns 无返回值。会暂停模拟播放。图像模式忽略。
   */
  switchView: (view: View) => void;
  /**
   * 跳到图组分镜。
   * @returns 无返回值。
   */
  openStoryboard: () => void;
  /**
   * 替换当前模式保存的提示词。
   * @param value - 新的提示词。
   * @returns 无返回值。
   */
  setPrompt: (value: string) => void;
  /**
   * 替换负向提示词。
   * @param value - 新的负向提示词。
   * @returns 无返回值。
   */
  setNegativePrompt: (value: string) => void;
  /**
   * 替换种子原文。
   * @param value - 用户输入的种子。生成前不会解析。
   * @returns 无返回值。
   */
  setSeed: (value: string) => void;
  /**
   * 设置画幅比例。锁定且分辨率为自定义时，会重算 `customSize`。
   * @param value - 比例文案，例如 "16:9"。
   * @returns 无返回值。
   */
  setRatio: (value: string) => void;
  /**
   * 翻转 `ratioLocked`。
   * @returns 无返回值。
   */
  toggleRatioLock: () => void;
  /**
   * 设置当前模式的分辨率预设。
   * @param value - 预设或 "custom"。
   * @returns 无返回值。
   */
  setResolution: (value: Resolution) => void;
  /**
   * 改自定义尺寸的一边。`ratioLocked` 为真时另一边跟着变。
   * @param axis - "width" 或 "height"。
   * @param value - 像素。会按图像或视频范围夹紧。
   * @returns 无返回值。
   */
  setCustomSize: (axis: "width" | "height", value: number) => void;
  /**
   * 同时替换宽高，不再套用比例锁定。
   * @param width - 像素，会夹紧。
   * @param height - 像素，会夹紧。
   * @returns 无返回值。
   */
  setCustomDimensions: (width: number, height: number) => void;
  /**
   * 恢复默认比例、分辨率、码率、时长、强度、种子和动画。
   * @returns 无返回值。并提示参数已重置。
   */
  resetParams: () => void;
  /**
   * 设置码率预设。
   * @param value - "auto"、某个预设或 "custom"。
   * @returns 无返回值。
   */
  setBitrate: (value: Bitrate) => void;
  /**
   * 设置自定义码率，单位 Mbps。
   * @param value - 夹紧到 2–80。空输入回落到 16。
   * @returns 无返回值。
   */
  setCustomBitrate: (value: number) => void;
  /**
   * 设置单段时长，单位秒。
   * @param value - 秒。调用方只提供 5、10、15。
   * @returns 无返回值。
   */
  setDuration: (value: number) => void;
  /**
   * 设置图生图强度。
   * @param value - 强度，取值 0–100。
   * @returns 无返回值。
   */
  setStrength: (value: number) => void;
  /**
   * 设置图生视频的动画风格。
   * @param value - 动画模式。"live" 使用普通视频按钮文案。
   * @returns 无返回值。
   */
  setAnimation: (value: AnimationMode) => void;
  /**
   * 合并当前视频模式里某一行分镜。
   * @param index - 行下标。
   * @param patch - 要合并的字段。
   * @returns 无返回值。文生视频和图组以外不生效。
   */
  updateBoardRow: (index: number, patch: Partial<BoardRow>) => void;
  /**
   * 追加一行分镜。
   * @returns 无返回值。超过 9 行会拒绝并提示。
   */
  addBoardRow: () => void;
  /**
   * 删除一行分镜。
   * @param index - 行下标。
   * @returns 无返回值。至少保留 1 行，图组至少保留 2 行。
   */
  deleteBoardRow: (index: number) => void;
  /**
   * 在某行后面插入它的副本。
   * @param index - 要复制的行。
   * @returns 无返回值。超过 9 行会拒绝。
   */
  duplicateBoardRow: (index: number) => void;
  /**
   * 把分镜格指向一张已经上传的静帧。
   * @param index - 行下标。
   * @param url - 展示地址。
   * @param assetId - 静帧已入库时的素材 id。
   * @returns 无返回值。
   */
  replaceBoardImage: (index: number, url: string, assetId?: string) => void;
  /**
   * 把本地文件上传进一个分镜格。
   * @param index - 行下标。
   * @param file - 图片文件。
   * @returns 无返回值。上传结束前先显示 blob 预览。
   */
  replaceBoardImageFile: (index: number, file: File) => void;
  /**
   * 恢复当前视频模式的默认分镜。
   * @returns 无返回值。并提示恢复后的镜头数。
   */
  resetBoard: () => void;
  /**
   * 把当前分镜下载成 CSV。
   * @returns 无返回值。成功时提示。文生视频和图组以外不生效。
   */
  exportBoard: () => void;
  /**
   * 用冻结的快照开始一次生成。
   * @returns 无返回值。进度、历史和错误写进 hook 状态，不返回任务。
   */
  generate: () => void;
  /**
   * 停掉模拟计时，或请 BFF 取消 `activeJobId`。
   * @returns 无返回值。
   */
  cancelGeneration: () => void;
  /**
   * 高亮一张历史卡片并显示它的产物。
   * @param id - 历史项 id。
   * @returns 无返回值。会切到该卡片的模式，视图改为预览。
   */
  selectHistory: (id: string) => void;
  /**
   * 把本地文件上传到提示词栏。
   * @param file - 图片文件。
   * @returns 无返回值。BFF 返回素材 id 之前，该行保持 `uploading`。
   */
  addAttachment: (file: File) => void;
  /**
   * 移除提示词栏上的一个附件，并释放它的 blob 地址。
   * @param id - `nextAttachmentId` 分配的附件 id。
   * @returns 无返回值。
   */
  removeAttachment: (id: string) => void;
  /**
   * 切换模拟视频播放。
   * @returns 无返回值。
   */
  togglePlayback: () => void;
  /**
   * 设置模拟播放头。
   * @param value - 0–100。到 100 会停止播放。
   * @returns 无返回值。
   */
  setVideoProgress: (value: number) => void;
}

/** `StudioProvider` 的入参。子组件通过 `useStudio` 读取组装后的值。 */
export interface StudioProviderProps {
  /** 工作室面板。必须在这个 Provider 下面调用 `useStudio`。 */
  children: ReactNode;
  /**
   * 把消耗的 token 记到外壳余额上。
   * @param tokens - 完成任务的实际或估算 token。
   */
  onTokensUsed: (tokens: number) => void;
  /**
   * 弹出提示。工作室自己不拥有提示 UI。
   * @param message - 给用户看的文案。
   * @param type - 完成动作用 "success"，其余用 "default"。
   */
  toast: (message: string, type?: "default" | "success") => void;
  /** 外壳传来的供应商状态、路由和模型列表。 */
  runtime: StudioRuntime;
  /** 新上传和任务所属的项目。变化时会重置工作室会话状态。 */
  projectId?: string;
  /** 从作品或素材库带来的一次性预填。应用一次后清掉。 */
  intent?: StudioIntent | null;
  /**
   * `intent` 写入工作室状态后调用。
   * @returns 无返回值。外壳应丢掉这份意图，避免再次应用。
   */
  onIntentApplied?: () => void;
}
