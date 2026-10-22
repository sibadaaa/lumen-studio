import type { GenerationMode, GenerationParams, StoryboardRow } from "../../shared/contracts.js";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function ratioValue(ratio = "16:9") {
  const [w, h] = ratio.split(":").map(Number);
  return w > 0 && h > 0 ? w / h : 16 / 9;
}

export function dimensionsFor(mode: GenerationMode, params: GenerationParams) {
  const video = mode !== "text-to-image" && mode !== "image-to-image";
  if (params.width && params.height) {
    return { width: Math.round(params.width), height: Math.round(params.height) };
  }
  const ratio = ratioValue(params.aspectRatio || "16:9");
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  const fit = (longEdge: number) =>
    ratio >= 1
      ? { width: even(longEdge), height: even(longEdge / ratio) }
      : { width: even(longEdge * ratio), height: even(longEdge) };
  if (params.resolution === "custom") {
    return fit(video ? 1920 : 2048);
  }
  if (video) {
    if (params.resolution === "720p") return fit(1280);
    if (params.resolution === "4K") return fit(3840);
    return fit(1920);
  }
  if (params.resolution === "1K") return fit(1280);
  if (params.resolution === "4K") return fit(3840);
  return fit(2048);
}

export function resolutionFactor(mode: GenerationMode, params: GenerationParams) {
  const video = mode !== "text-to-image" && mode !== "image-to-image";
  if (params.resolution === "custom" || (!params.resolution && params.width && params.height)) {
    const { width, height } = dimensionsFor(mode, params);
    const mp = (width * height) / 1_000_000;
    return video ? clamp(mp / 2.07, 0.4, 3.4) : clamp(mp / 2.36, 0.4, 4);
  }
  if (video) {
    return { "720p": 0.7, "1080p": 1, "4K": 1.8 }[params.resolution || "1080p"] ?? 1;
  }
  return { "1K": 0.65, "2K": 1, "4K": 2.4 }[params.resolution || "2K"] ?? 1;
}

const animationFactor: Record<string, number> = { live: 1, "2d": 1.12, "3d": 1.2, stop: 1.08 };

export function estimateGenerationTokens(
  mode: GenerationMode,
  params: GenerationParams,
  storyboard: StoryboardRow[],
  generationType: "single" | "storyboard"
): number {
  const factor = resolutionFactor(mode, params);
  const duration = Math.max(1, Number(params.durationSec || 5));
  let tokens = 0;
  if (mode === "text-to-image") tokens = 3240 * factor;
  else if (mode === "image-to-image") tokens = 4120 * factor;
  else if (mode === "text-to-video") tokens = 18600 * (duration / 5) * factor;
  else if (mode === "image-to-video") tokens = 24800 * (duration / 5) * factor;
  else tokens = 62400 * (duration / 5) * factor;
  if (mode === "image-to-video") tokens *= animationFactor[params.animationMode || "live"] || 1;

  const useBoard =
    (mode === "text-to-video" || mode === "multi-image-to-video") &&
    (generationType === "storyboard" || storyboard.length > 0);
  if (useBoard && storyboard.length) {
    const total = storyboard.reduce((sum, row) => sum + Number(row.durationSec || 0), 0);
    const perSecond = mode === "text-to-video" ? 3200 : 2800;
    const perShot = mode === "text-to-video" ? 1200 : 800;
    tokens = (total * perSecond + storyboard.length * perShot) * factor;
  }
  return Math.round(tokens / 10) * 10;
}

export function estimateSeconds(
  mode: GenerationMode,
  params: GenerationParams,
  storyboard: StoryboardRow[],
  generationType: "single" | "storyboard"
) {
  if ((mode === "text-to-video" || mode === "multi-image-to-video") && generationType === "storyboard") {
    return Math.max(45, storyboard.length * 35 + 30);
  }
  if (mode === "text-to-video") return 60;
  if (mode === "image-to-video") return 70;
  if (mode === "multi-image-to-video") return 120;
  return 20;
}
