import { ANIMATION_LABELS, ANIMATION_TOKEN_FACTOR, BITRATE_LABELS } from "../data/mock";
import type { AnimationMode, Bitrate, BoardRow, CustomSize, Mode, Resolution, View } from "../types";

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const formatTokens = (value: number) => Math.round(value).toLocaleString("en-US");
export const compactTokens = (value: number) => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}m`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
};
export const ratioValue = (ratio: string) => {
  const [w, h] = ratio.split(":").map(Number);
  return w / h || 16 / 9;
};
export const isVideoMode = (mode: Mode) => ["t2v", "i2v", "multi"].includes(mode);
export const sizeKind = (mode: Mode): "image" | "video" => (isVideoMode(mode) ? "video" : "image");
export const dimensionDefaults = (kind: "image" | "video"): CustomSize =>
  kind === "video" ? { width: 1920, height: 1080 } : { width: 2048, height: 1152 };

const factorForPreset = (kind: "image" | "video", resolution: Resolution) => {
  if (kind === "video") {
    return { "720p": 0.7, "1080p": 1, "4K": 1.8 }[resolution as "720p" | "1080p" | "4K"] ?? 1;
  }
  return { "1K": 0.65, "2K": 1, "4K": 2.4 }[resolution as "1K" | "2K" | "4K"] ?? 1;
};

export const resolutionFactor = (mode: Mode, resolution: Resolution, custom: CustomSize) => {
  const kind = sizeKind(mode);
  if (resolution === "custom") {
    const mp = (custom.width * custom.height) / 1_000_000;
    return kind === "video" ? clamp(mp / 2.07, 0.4, 3.4) : clamp(mp / 2.36, 0.4, 4);
  }
  return factorForPreset(kind, resolution);
};

export const currentDimensions = (
  mode: Mode,
  resolution: Resolution,
  custom: CustomSize,
  ratio = "16:9"
) => {
  if (resolution === "custom") return custom;
  const kind = sizeKind(mode);
  const value = ratioValue(ratio);
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const fit = (longEdge: number) =>
    value >= 1
      ? { width: even(longEdge), height: even(longEdge / value) }
      : { width: even(longEdge * value), height: even(longEdge) };
  if (kind === "video") {
    return fit(
      { "720p": 1280, "1080p": 1920, "4K": 3840 }[resolution as "720p" | "1080p" | "4K"] ?? 1920
    );
  }
  return fit({ "1K": 1280, "2K": 2048, "4K": 3840 }[resolution as "1K" | "2K" | "4K"] ?? 2048);
};

export const getBaseTokens = (options: {
  mode: Mode;
  resolution: Resolution;
  custom: CustomSize;
  duration: number;
  animation: AnimationMode;
}) => {
  const { mode, resolution, custom, duration, animation } = options;
  const factor = resolutionFactor(mode, resolution, custom);
  let tokens = 0;
  if (mode === "t2i") tokens = 3240 * factor;
  else if (mode === "i2i") tokens = 4120 * factor;
  else if (mode === "t2v") tokens = 18600 * (duration / 5) * factor;
  else if (mode === "i2v") tokens = 24800 * (duration / 5) * factor;
  else if (mode === "multi") tokens = 62400 * (duration / 5) * factor;
  if (mode === "i2v") tokens *= ANIMATION_TOKEN_FACTOR[animation] || 1;
  return tokens;
};

export const getBoardTokens = (rows: BoardRow[], mode: Mode, resolution: Resolution, custom: CustomSize) => {
  const total = rows.reduce((sum, row) => sum + Number(row.dur || 0), 0);
  const perSecond = mode === "t2v" ? 3200 : 2800;
  const perShot = mode === "t2v" ? 1200 : 800;
  return Math.round((total * perSecond + rows.length * perShot) * resolutionFactor(mode, resolution, custom));
};

export const getEstimatedTokens = (options: {
  mode: Mode;
  view: View;
  resolution: Resolution;
  custom: CustomSize;
  duration: number;
  animation: AnimationMode;
  rows: BoardRow[];
}) => {
  const raw =
    ["t2v", "multi"].includes(options.mode) && options.view === "storyboard"
      ? getBoardTokens(options.rows, options.mode, options.resolution, options.custom)
      : getBaseTokens(options);
  return Math.round(raw / 10) * 10;
};

export const bitrateLabel = (bitrate: Bitrate, custom: number) => {
  if (bitrate === "auto") return "自动";
  if (bitrate === "custom") return `${custom} Mbps`;
  return BITRATE_LABELS[bitrate];
};

export const animationLabel = (mode: AnimationMode) => ANIMATION_LABELS[mode];
