export type GenerationMode =
  | "text-to-image"
  | "text-to-video"
  | "image-to-image"
  | "image-to-video"
  | "multi-image-to-video";

export type GenerationType = "single" | "storyboard";
export type AssetRole = "reference" | "first_frame" | "last_frame" | "shot";
export type ProviderKind = "ark" | "openai_compatible" | "mock";
export type AnimationMode = "live" | "2d" | "3d" | "stop";

export type TaskStatus =
  | "queued"
  | "submitting"
  | "running"
  | "postprocessing"
  | "succeeded"
  | "failed"
  | "canceled"
  | "partial_failed";

export interface ProviderCapabilities {
  textToImage: boolean;
  imageToImage: boolean;
  textToVideo: boolean;
  imageToVideo: boolean;
  multiImageToVideo: boolean;
  firstLastFrame: boolean;
  audio: boolean;
  customResolution: boolean;
  bitrateControl: boolean;
  animationModes: AnimationMode[];
  maxImageCount: number;
  maxDurationSec: number;
}

export interface ProviderInfo {
  id: string;
  kind: ProviderKind;
  label: string;
  baseUrl: string;
  keyMasked: string;
  imageModel: string;
  videoModel: string;
  capabilities: ProviderCapabilities;
  configured: boolean;
  encrypted: boolean;
  lastTestedAt: string | null;
  lastLatencyMs: number | null;
  updatedAt: string | null;
}

export interface ProvidersResponse {
  items: ProviderInfo[];
  activeProviderId: string | null;
  backend: {
    version: string;
    ffmpeg: boolean;
    encryptedStorage: boolean;
    dataDir: string;
    concurrency: number;
  };
}

export interface ProviderConfigInput {
  kind: ProviderKind;
  baseUrl: string;
  apiKey?: string;
  imageModel: string;
  videoModel: string;
}

export interface ProviderTestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
  capabilities: ProviderCapabilities;
  models?: string[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimated: boolean;
  source: "provider" | "tokenizer" | "heuristic" | "ffmpeg";
}

export interface MediaAsset {
  id: string;
  kind: "image" | "video" | "audio";
  mime: string;
  size: number;
  width?: number;
  height?: number;
  durationSec?: number;
  url: string;
  thumbnailUrl?: string;
  createdAt: string;
  originalName?: string;
}

export interface StoryboardRow {
  id: string;
  order: number;
  assetId?: string;
  imageUrl?: string;
  shotSize: string;
  motion: string;
  description: string;
  audio?: string;
  durationSec: number;
}

export interface GenerationInput {
  assetId?: string;
  url?: string;
  role: AssetRole;
  order: number;
}

export interface GenerationParams {
  aspectRatio?: string;
  resolution?: string;
  width?: number;
  height?: number;
  bitrateKbps?: number;
  animationMode?: AnimationMode;
  durationSec?: number;
  fps?: number;
  seed?: number;
  negativePrompt?: string;
  strength?: number;
  motion?: string;
  transition?: "dissolve" | "push" | "fade_black" | "none";
  shotDurationSec?: number;
  composeMode?: "ai_storyboard" | "quick_template";
}

export interface GenerationRequest {
  clientRequestId: string;
  mode: GenerationMode;
  generationType: GenerationType;
  providerId: string;
  modelId: string;
  prompt: string;
  params: GenerationParams;
  inputs: GenerationInput[];
  storyboard?: StoryboardRow[];
  estimatedTokens?: number;
  projectId?: string;
  sessionId?: string;
}

export interface GenerationError {
  code: string;
  message: string;
  retryable: boolean;
  tokensUsed?: number;
  traceId?: string;
  details?: Record<string, unknown>;
}

export interface ShotState {
  order: number;
  status: TaskStatus;
  progress: number;
  assetId?: string;
  providerTaskId?: string;
  error?: GenerationError;
}

export interface GenerationTask {
  id: string;
  clientRequestId: string;
  mode: GenerationMode;
  generationType: GenerationType;
  providerId: string;
  modelId: string;
  status: TaskStatus;
  progress: number;
  stage: string;
  prompt: string;
  params: GenerationParams;
  inputs: GenerationInput[];
  storyboard: StoryboardRow[];
  outputs: MediaAsset[];
  shots: ShotState[];
  estimatedTokens: number;
  usage: TokenUsage | null;
  estimatedSeconds: number;
  error: GenerationError | null;
  projectId?: string;
  sessionId?: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface UsageSummary {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  generations: number;
  succeeded: number;
  failed: number;
}

export interface SystemInfo {
  ok: true;
  version: string;
  time: string;
  ffmpeg: { available: boolean; version: string | null };
  dataDir: string;
  concurrency: number;
  activeProviderId: string | null;
  database?: {
    path: string;
    providers: number;
    projects: number;
    assets: number;
    generations: number;
    sessions: number;
    messages: number;
  };
  jobs?: { total: number; queued: number; running: number; succeeded: number; failed: number };
  runner?: { active: number; concurrency: number };
}

export interface ApiErrorBody {
  error: GenerationError;
}

export const PROVIDER_CAPABILITIES: Record<ProviderKind, ProviderCapabilities> = {
  ark: {
    textToImage: true,
    imageToImage: true,
    textToVideo: true,
    imageToVideo: true,
    multiImageToVideo: true,
    firstLastFrame: true,
    audio: true,
    customResolution: true,
    bitrateControl: true,
    animationModes: ["live", "2d", "3d", "stop"],
    maxImageCount: 9,
    maxDurationSec: 60,
  },
  openai_compatible: {
    textToImage: true,
    imageToImage: true,
    textToVideo: true,
    imageToVideo: true,
    multiImageToVideo: false,
    firstLastFrame: false,
    audio: false,
    customResolution: true,
    bitrateControl: true,
    animationModes: ["live"],
    maxImageCount: 4,
    maxDurationSec: 30,
  },
  mock: {
    textToImage: true,
    imageToImage: true,
    textToVideo: true,
    imageToVideo: true,
    multiImageToVideo: true,
    firstLastFrame: true,
    audio: false,
    customResolution: true,
    bitrateControl: true,
    animationModes: ["live", "2d", "3d", "stop"],
    maxImageCount: 9,
    maxDurationSec: 60,
  },
};

export const MODE_LABELS: Record<GenerationMode, string> = {
  "text-to-image": "文生图",
  "text-to-video": "文生视频",
  "image-to-image": "图生图",
  "image-to-video": "图生视频",
  "multi-image-to-video": "图组视频",
};

export const isVideoGeneration = (mode: GenerationMode) =>
  mode === "text-to-video" || mode === "image-to-video" || mode === "multi-image-to-video";


/* ------------------------------------------------------------------ */
/* Workspace, projects and Agent runtime                               */
/* ------------------------------------------------------------------ */

export type ProjectStatus = "active" | "archived";

export interface Project {
  id: string;
  name: string;
  description: string;
  coverUrl?: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectStats {
  sessions: number;
  assets: number;
  generations: number;
  tokens: number;
  lastActivityAt: string | null;
}

export interface ProjectWithStats extends Project {
  stats: ProjectStats;
}

export interface ProjectCreateInput {
  name: string;
  description?: string;
  coverUrl?: string;
}

export interface ProjectUpdateInput {
  name?: string;
  description?: string;
  coverUrl?: string;
  status?: ProjectStatus;
}

export type AgentSessionStatus = "idle" | "running" | "failed";

export interface AgentSession {
  id: string;
  projectId: string | null;
  title: string;
  status: AgentSessionStatus;
  tokens: number;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  lastMessage: string;
}

export type AgentToolStatus = "pending" | "running" | "done" | "failed";

export interface AgentToolState {
  id: string;
  name: string;
  status: AgentToolStatus;
  detail: string;
  tokens?: number;
  startedAt?: string;
  finishedAt?: string;
  data?: Record<string, unknown>;
}

export type AgentPlanStepStatus = "pending" | "running" | "done" | "failed";

export interface AgentPlanStep {
  id: string;
  label: string;
  status: AgentPlanStepStatus;
  note?: string;
}

export interface AgentMessageData {
  plan?: AgentPlanStep[];
  tools?: AgentToolState[];
  rows?: Array<{
    id: string;
    shot: string;
    motion: string;
    desc: string;
    dur: number;
  }>;
  outputs?: MediaAsset[];
  jobId?: string;
  mode?: GenerationMode;
  estimatedTokens?: number;
  tokens?: number;
  actions?: Array<"open_storyboard" | "open_studio" | "open_api">;
}

export interface AgentMessage {
  id: string;
  sessionId: string;
  seq: number;
  role: "user" | "assistant";
  text: string;
  data?: AgentMessageData;
  createdAt: string;
}

export interface AgentSessionDetail {
  session: AgentSession;
  messages: AgentMessage[];
}

export type AgentEvent =
  | { type: "snapshot"; session: AgentSession; messages: AgentMessage[] }
  | { type: "status"; status: AgentSessionStatus; stage: string }
  | { type: "plan"; steps: AgentPlanStep[] }
  | { type: "tool"; tool: AgentToolState }
  | { type: "progress"; jobId: string; progress: number; stage: string; shots?: Array<{ order: number; status: TaskStatus; progress: number }> }
  | { type: "message"; message: AgentMessage }
  | { type: "tokens"; tokens: number }
  | { type: "done"; session: AgentSession }
  | { type: "error"; message: string };

export interface AgentSendInput {
  text: string;
}

export interface AgentSendResponse {
  session: AgentSession;
  message: AgentMessage;
  runId: string;
}


/* ------------------------------------------------------------------ */
/* Model catalog, works library and asset library (M4)                 */
/* ------------------------------------------------------------------ */

export type ModelKind = "image" | "video" | "unknown";
export type ModelSource = "discovered" | "manual" | "seed";
export type ModelStatus = "ready" | "unverified" | "missing";

export interface ModelInfo {
  providerId: string;
  id: string;
  label: string;
  kind: ModelKind;
  modes: GenerationMode[];
  capabilities: ProviderCapabilities;
  source: ModelSource;
  enabled: boolean;
  status: ModelStatus;
  lastSyncedAt: string | null;
  lastSeenAt: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ModelSyncResult {
  providerId: string;
  supported: boolean;
  fetched: number;
  added: number;
  updated: number;
  missing: number;
  suggestedEnabled: string[];
  message: string;
  items: ModelInfo[];
}

export interface ModelCreateInput {
  id: string;
  label?: string;
  kind: ModelKind;
  modes: GenerationMode[];
  enabled?: boolean;
}

export interface ModelUpdateInput {
  label?: string;
  kind?: ModelKind;
  modes?: GenerationMode[];
  enabled?: boolean;
}

export interface ModelEnableInput {
  modelIds: string[];
  enabled: boolean;
}

export interface ModelRoute {
  mode: GenerationMode;
  providerId: string;
  modelId: string;
  model: ModelInfo | null;
  warning: string | null;
  updatedAt: string | null;
}

export interface ModelRouteInput {
  providerId: string;
  modelId: string;
}

export interface ModelsResponse {
  items: ModelInfo[];
}

export interface ModelRoutesResponse {
  items: ModelRoute[];
}

export type WorkSource = "studio" | "agent";

export interface WorkUsage {
  totalTokens: number;
  estimated: boolean;
}

export interface Work {
  id: string;
  generationId: string;
  attempt: number;
  outputIndex: number;
  kind: "image" | "video";
  mime: string;
  size: number;
  width?: number;
  height?: number;
  durationSec?: number;
  url: string;
  thumbnailUrl?: string;
  title: string;
  prompt: string;
  mode: GenerationMode;
  providerId: string;
  modelId: string;
  params: GenerationParams;
  inputs: GenerationInput[];
  storyboard: StoryboardRow[];
  usage: WorkUsage;
  projectId?: string;
  sessionId?: string;
  source: WorkSource;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkFacetValue {
  value: string;
  count: number;
}

export interface WorkFacets {
  total: number;
  kinds: WorkFacetValue[];
  modes: WorkFacetValue[];
  projects: WorkFacetValue[];
}

export interface WorkListResponse {
  items: Work[];
  nextCursor: string | null;
  total: number;
}

export interface WorkUpdateInput {
  title?: string;
  favorite?: boolean;
  projectId?: string | null;
}

export type WorkBulkAction = "favorite" | "unfavorite" | "move_project" | "delete" | "save_to_assets";

export interface WorkBulkInput {
  action: WorkBulkAction;
  ids: string[];
  projectId?: string | null;
}

export interface WorkBulkFailure {
  id: string;
  code: string;
  message: string;
}

export interface WorkBulkResult {
  updated: number;
  created?: number;
  failed: WorkBulkFailure[];
}

export type AssetSource = "upload" | "work" | "agent";

export interface LibraryAsset extends MediaAsset {
  projectId?: string;
  sha256?: string;
  source: AssetSource;
  sourceRef?: string;
  tags: string[];
  usageCount: number;
  updatedAt: string;
  duplicateOf?: string;
}

export interface AssetUsage {
  assetId: string;
  generationId: string;
  workId?: string;
  mode: GenerationMode;
  role: AssetRole;
  createdAt: string;
  thumbnailUrl?: string;
}

export interface AssetUsageResponse {
  items: AssetUsage[];
}

export interface AssetFacets {
  total: number;
  kinds: WorkFacetValue[];
  sources: WorkFacetValue[];
  projects: WorkFacetValue[];
  tags: WorkFacetValue[];
  used: number;
  unused: number;
}

export interface AssetListResponse {
  items: LibraryAsset[];
  nextCursor: string | null;
  total: number;
}

export interface AssetUpdateInput {
  originalName?: string;
  projectId?: string | null;
  tags?: string[];
}

export type AssetBulkAction = "move_project" | "add_tags" | "remove_tags" | "delete";

export interface AssetBulkInput {
  action: AssetBulkAction;
  ids: string[];
  projectId?: string | null;
  tags?: string[];
}

export interface AssetBulkResult {
  updated: number;
  skipped: number;
  failed: WorkBulkFailure[];
}

export interface AssetSaveResult {
  asset: LibraryAsset;
  created: boolean;
}
