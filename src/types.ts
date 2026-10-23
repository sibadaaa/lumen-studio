import type {
  AssetRole,
  GenerationTask,
  LibraryAsset,
  ModelInfo,
  ModelRoute,
  ProviderInfo,
  Work,
} from "../shared/contracts";

export type Page = "workspace" | "project" | "studio" | "agent" | "works" | "assets" | "models";
export type Mode = "t2i" | "t2v" | "i2i" | "i2v" | "multi";
export type View = "preview" | "storyboard";
export type Resolution = "1K" | "2K" | "4K" | "720p" | "1080p" | "custom";
export type Bitrate = "auto" | "8" | "16" | "custom";
export type AnimationMode = "live" | "2d" | "3d" | "stop";

export const MODE_BY_CONTRACT: Record<string, Mode> = {
  "text-to-image": "t2i",
  "text-to-video": "t2v",
  "image-to-image": "i2i",
  "image-to-video": "i2v",
  "multi-image-to-video": "multi",
};

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
  models: ModelInfo[];
  routes: ModelRoute[];
  ffmpeg: boolean;
  version: string;
  loading: boolean;
}

/** Cross-page intent: open the studio pre-filled from a work or an asset. */
export interface StudioIntent {
  work?: Work;
  asset?: LibraryAsset;
  role?: AssetRole;
}

export interface BoardState {
  title: string;
  rows: BoardRow[];
}
