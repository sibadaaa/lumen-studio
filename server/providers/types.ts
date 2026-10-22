import type {
  AnimationMode,
  AssetRole,
  GenerationMode,
  ProviderCapabilities,
  TokenUsage,
} from "../../shared/contracts.js";

export interface ProviderImageInput {
  url: string;
  role: AssetRole;
  order: number;
}

export interface ProviderRequest {
  mode: GenerationMode;
  model: string;
  prompt: string;
  negativePrompt?: string;
  images: ProviderImageInput[];
  ratio: string;
  resolution: string;
  width: number;
  height: number;
  bitrateKbps?: number;
  animationMode?: AnimationMode;
  durationSec: number;
  fps: number;
  seed?: number;
  strength?: number;
  motion?: string;
}

export interface ProviderOutput {
  kind: "image" | "video";
  url?: string;
  data?: Buffer;
  mime: string;
  width?: number;
  height?: number;
  durationSec?: number;
  headers?: Record<string, string>;
}

export interface ProviderTask {
  providerTaskId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress?: number;
  outputs?: ProviderOutput[];
  usage?: TokenUsage;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
}

export interface ProviderTestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
  models?: string[];
}

export interface ProviderAdapter {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  testConnection(): Promise<ProviderTestResult>;
  submit(request: ProviderRequest): Promise<ProviderTask>;
  poll(providerTaskId: string): Promise<ProviderTask>;
  cancel?(providerTaskId: string): Promise<void>;
}

export interface ResolvedProviderConfig {
  id: string;
  kind: "ark" | "openai_compatible" | "mock";
  baseUrl: string;
  apiKey: string;
  imageModel: string;
  videoModel: string;
}

export const isVideoMode = (mode: GenerationMode) =>
  mode === "text-to-video" || mode === "image-to-video" || mode === "multi-image-to-video";

export const isImageMode = (mode: GenerationMode) => mode === "text-to-image" || mode === "image-to-image";
