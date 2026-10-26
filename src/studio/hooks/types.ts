import type { GenerationMode } from "../../../shared/contracts";
import type { AnimationMode, Bitrate, CustomSize, Mode, Resolution, View } from "../../types";

/** 提示词栏上的一张静帧：上传中是本地 blob，完成后是素材库资源。 */
export interface Attachment {
  /** `nextAttachmentId` 分配的客户端 id，在本次页面会话内稳定。 */
  id: string;
  /** 上传中是 blob 地址，完成后是 `/media/` 或缩略图地址。 */
  url: string;
  /** 文件名或素材库原名，显示在芯片上。 */
  name: string;
  /** BFF 存好文件后写入。生成前必须有，否则该静帧不会被接受。 */
  assetId?: string;
  /** 上传结束前为 true。仍处于该状态的行会被生成拒绝。 */
  uploading?: boolean;
  /** 芯片上的上传进度，0–100。 */
  progress?: number;
}

/**
 * 外壳传入的提示函数。
 * @param message - 给用户看的文案。
 * @param type - 完成动作用 "success"，错误和普通说明用 "default"。
 * @returns 无返回值。
 */
export type StudioToast = (message: string, type?: "default" | "success") => void;

/** 把工作室 `Mode` 映射成 BFF 创建任务时期望的 `GenerationMode`。 */
export const API_MODE: Record<Mode, GenerationMode> = {
  t2i: "text-to-image",
  t2v: "text-to-video",
  i2i: "image-to-image",
  i2v: "image-to-video",
  multi: "multi-image-to-video",
};

/**
 * 点击生成时冻结的参数。
 * 之后的上传和轮询读这份快照，而不是后续渲染里的新值。
 */
export interface GenerationSnapshot {
  /** 点击时各模式的提示词。 */
  prompts: Record<Mode, string>;
  /** 各模式当时是预览还是分镜。用来决定单次生成还是分镜生成。 */
  modeViews: Record<Mode, View>;
  /** 画幅比例文案，作为 `params.aspectRatio` 发送。 */
  ratio: string;
  /** 分辨率预设，作为 `params.resolution` 发送。 */
  resolution: Resolution;
  /** `resolution` 为 "custom" 时使用的自定义像素尺寸。 */
  customSize: CustomSize;
  /** 码率预设。"auto" 时不设置 `bitrateKbps`。 */
  bitrate: Bitrate;
  /** 自定义码率，单位 Mbps。写入请求时乘以 1000。 */
  customBitrate: number;
  /** 种子原文。只有能解析成有限数字时才使用。 */
  seed: string;
  /** 图生视频的动画风格。其他模式不发送。 */
  animation: AnimationMode;
  /** 单段视频时长，单位秒。 */
  duration: number;
  /** 点击时带上的负向提示词。 */
  negativePrompt: string;
  /** 强度，界面为 0–100，请求里除以 100。 */
  strength: number;
  /** 展示给用户的 token 估算，并作为 `estimatedTokens` 发送。 */
  estimatedTokens: number;
  /** 点击发生在分镜视图时为 true。 */
  isBoard: boolean;
  /** 按钮文案，本地模拟成功提示会改写它。 */
  ctaLabel: string;
  /** 为 false 时走本地模拟。 */
  runtimeOnline: boolean;
  /** 为 false 时先提示，再走本地模拟。 */
  providerConfigured: boolean;
}

/** 附件 id 的递增计数。只在本次页面会话内有效。 */
let attachmentSeq = 0;

/**
 * 分配下一个提示词栏附件 id。
 * @returns 本次页面会话内唯一的 id，形如 `a-<n>`。
 */
export function nextAttachmentId() {
  attachmentSeq += 1;
  return `a-${attachmentSeq}`;
}
