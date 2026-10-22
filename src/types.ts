import type { GenerationTask, ProviderInfo } from "../shared/contracts";

export type Page = "workspace" | "project" | "studio" | "agent";
export type Mode = "t2i" | "t2v" | "i2i" | "i2v" | "multi";
export type View = "preview" | "storyboard";
export type Resolution = "1K" | "2K" | "4K" | "720p" | "1080p" | "custom";
export type Bitrate = "auto" | "8" | "16" | "custom";
export type AnimationMode = "live" | "2d" | "3d" | "stop";

export interface BoardRow {
  id: string;
  img: string | null;
  assetId?: string;
  shot: string;
  motion: string;
  desc: string;
  audio: string;
  dur: number;
  uploading?: boolean;
}

export interface CustomSize {
  width: number;
  height: number;
}

export interface ModeConfig {
  prompt: string;
  model: string;
  modelDesc: string;
  tags: string[];
  cta: string;
  eta: string;
  attach: boolean;
  attachLabel: string;
  duration: boolean;
}

export interface HistoryItem {
  id: string;
  mode: Mode;
  img: string;
  time: string;
  badge: string;
  src?: string;
  kind?: "image" | "video";
  jobId?: string;
  durationSec?: number;
  tokens?: number;
  task?: GenerationTask;
}

export interface StudioRuntime {
  online: boolean;
  activeProviderId: string | null;
  provider: ProviderInfo | null;
  providers: ProviderInfo[];
  ffmpeg: boolean;
  version: string;
  loading: boolean;
}

export interface BoardState {
  title: string;
  rows: BoardRow[];
}
