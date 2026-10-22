import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type {
  ApiErrorBody,
  GenerationRequest,
  GenerationTask,
  MediaAsset,
  ProviderConfigInput,
  ProviderInfo,
  ProvidersResponse,
  SystemInfo,
  Project,
  ProjectWithStats,
  AgentSession,
  AgentMessage,
} from "../shared/contracts.js";
import { PROVIDER_CAPABILITIES } from "../shared/contracts.js";
import { config, ensureDataDirs, paths } from "./config.js";
import { providerStore } from "./storage/providers.js";
import { assetStore } from "./storage/assets.js";
import { jobStore, isTerminal } from "./jobs/store.js";
import { jobRunner } from "./jobs/runner.js";
import { estimateGenerationTokens, estimateSeconds } from "./jobs/estimate.js";
import { createAdapter } from "./providers/index.js";
import { ffmpegAvailable, getFfmpegVersion } from "./media/ffmpeg.js";
import { storeImageUpload } from "./media/upload.js";
import { extensionMime } from "./media/ffmpeg.js";
import { safeMediaFile } from "./media/local.js";
import { ProviderError } from "./providers/http.js";
import { getVault } from "./security/vault.js";
import { projectStore } from "./storage/projects.js";
import { agentStore } from "./storage/sessions.js";
import { agentRuntime } from "./agent/runtime.js";
import { dbStats } from "./db.js";

ensureDataDirs();
const vault = getVault();
console.log(`[security] secret vault ready (${vault.source === "env" ? "APP_SECRET" : "data/master.key"})`);

type AppEnv = { Variables: { traceId: string } };
const app = new Hono<AppEnv>();
const rateBuckets = new Map<string, number[]>();

class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;
  constructor(
    status: number,
    code: string,
    message: string,
    options: { retryable?: boolean; details?: Record<string, unknown> } = {}
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

function rateLimit(key: string, limit: number, windowMs = 60_000) {
  const now = Date.now();
  const bucket = (rateBuckets.get(key) || []).filter((time) => now - time < windowMs);
  if (bucket.length >= limit) return false;
  bucket.push(now);
  rateBuckets.set(key, bucket);
  if (rateBuckets.size > 2000) rateBuckets.clear();
  return true;
}

function clientKey(c: { req: { header: (name: string) => string | undefined } }) {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

const generationModeSchema = z.enum([
  "text-to-image",
  "text-to-video",
  "image-to-image",
  "image-to-video",
  "multi-image-to-video",
]);
const assetRoleSchema = z.enum(["reference", "first_frame", "last_frame", "shot"]);

const paramsSchema = z
  .object({
    aspectRatio: z.string().max(12).optional(),
    resolution: z.string().max(12).optional(),
    width: z.number().int().min(256).max(8192).optional(),
    height: z.number().int().min(256).max(8192).optional(),
    bitrateKbps: z.number().int().min(1000).max(80_000).optional(),
    animationMode: z.enum(["live", "2d", "3d", "stop"]).optional(),
    durationSec: z.number().min(1).max(60).optional(),
    fps: z.number().int().min(12).max(60).optional(),
    seed: z.number().int().min(0).max(2_147_483_647).optional(),
    negativePrompt: z.string().max(300).optional(),
    strength: z.number().min(0).max(1).optional(),
    motion: z.string().max(40).optional(),
    transition: z.enum(["dissolve", "push", "fade_black", "none"]).optional(),
    shotDurationSec: z.number().min(1).max(8).optional(),
    composeMode: z.enum(["ai_storyboard", "quick_template"]).optional(),
  })
  .passthrough();

const inputSchema = z.object({
  assetId: z.string().max(80).optional(),
  url: z.string().max(2000).optional(),
  role: assetRoleSchema,
  order: z.number().int().min(0).max(16),
});

const storyboardSchema = z.object({
  id: z.string().max(80),
  order: z.number().int().min(0).max(8),
  assetId: z.string().max(80).optional(),
  imageUrl: z.string().max(2000).optional(),
  shotSize: z.string().max(20),
  motion: z.string().max(30),
  description: z.string().max(240),
  audio: z.string().max(80).optional(),
  durationSec: z.number().min(0.5).max(8),
});

const generationSchema = z.object({
  clientRequestId: z.string().min(8).max(80),
  mode: generationModeSchema,
  generationType: z.enum(["single", "storyboard"]),
  providerId: z.string().min(1).max(32),
  modelId: z.string().max(200).optional(),
  prompt: z.string().max(1000),
  params: paramsSchema,
  inputs: z.array(inputSchema).max(16).default([]),
  storyboard: z.array(storyboardSchema).max(9).optional(),
  estimatedTokens: z.number().int().min(0).optional(),
  projectId: z.string().max(80).optional(),
  sessionId: z.string().max(80).optional(),
});

const providerSchema = z.object({
  kind: z.enum(["ark", "openai_compatible", "mock"]),
  baseUrl: z.string().min(4).max(500),
  apiKey: z.string().max(500).optional(),
  imageModel: z.string().max(200),
  videoModel: z.string().max(200),
});

app.use("*", async (c, next) => {
  const traceId = crypto.randomUUID();
  c.header("x-trace-id", traceId);
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "no-referrer");
  c.set("traceId", traceId);
  const started = Date.now();
  await next();
  const duration = Date.now() - started;
  // Never log prompt bodies, authorization headers, or media contents.
  console.log(`${c.req.method} ${new URL(c.req.url).pathname} ${c.res.status} ${duration}ms ${traceId.slice(0, 8)}`);
});

const allowedOrigins = new Set([config.appOrigin, "http://127.0.0.1:5173", "http://localhost:5173"]);

app.use("/api/*", async (c, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
    const origin = c.req.header("origin");
    let allowed = !origin || allowedOrigins.has(origin);
    if (origin && !allowed) {
      // When Vite is bound to 0.0.0.0 for LAN access, the browser origin and
      // the proxied Host header share the same hostname. Allow that exact host
      // only; do not open state-changing routes to arbitrary origins.
      try {
        const originHost = new URL(origin).hostname.toLowerCase();
        const requestHost = (c.req.header("host") || "").split(":")[0].toLowerCase();
        allowed = Boolean(requestHost) && originHost === requestHost;
      } catch {
        allowed = false;
      }
    }
    if (!allowed) {
      return c.json(
        {
          error: {
            code: "ORIGIN_NOT_ALLOWED",
            message: "请求来源不在允许列表，已拒绝",
            retryable: false,
            traceId: (c.get("traceId") as string) || "",
          },
        } satisfies ApiErrorBody,
        403
      );
    }
  }
  await next();
});

app.use(
  "/api/*",
  cors({
    origin: [config.appOrigin, "http://127.0.0.1:5173", "http://localhost:5173"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "Last-Event-ID"],
    exposeHeaders: ["x-trace-id", "Idempotent-Replayed"],
    maxAge: 86400,
  })
);

app.onError((error, c) => {
  const traceId = (c.get("traceId") as string) || crypto.randomUUID();
  if (error instanceof HTTPException) return error.getResponse();
  if (error instanceof ApiError) {
    const body: ApiErrorBody = {
      error: { code: error.code, message: error.message, retryable: error.retryable, traceId, details: error.details },
    };
    return c.json(body, error.status as 400);
  }
  if (error instanceof z.ZodError) {
    const body: ApiErrorBody = {
      error: {
        code: "INVALID_REQUEST",
        message: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
        retryable: false,
        traceId,
        details: { issues: error.issues as unknown as Record<string, unknown>[] },
      },
    };
    return c.json(body, 422);
  }
  if (error instanceof ProviderError) {
    const body: ApiErrorBody = {
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        traceId,
        details: error.details,
      },
    };
    return c.json(body, 502);
  }
  console.error(`[error] ${traceId}`, error);
  const body: ApiErrorBody = {
    error: { code: "INTERNAL_ERROR", message: (error as Error).message || "服务端错误", retryable: false, traceId },
  };
  return c.json(body, 500);
});

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: `未知接口 ${c.req.method} ${c.req.path}`,
          retryable: false,
          traceId: (c.get("traceId") as string) || "",
        },
      } satisfies ApiErrorBody,
      404
    );
  }
  return c.text("LUMEN BFF", 404);
});

const api = new Hono();

api.get("/health", async (c) => {
  const ffmpeg = await ffmpegAvailable();
  return c.json({
    ok: true,
    version: config.version,
    time: new Date().toISOString(),
    ffmpeg,
  });
});

api.get("/system", async (c) => {
  const available = await ffmpegAvailable();
  const body: SystemInfo & { jobs: ReturnType<typeof jobStore.stats>; runner: ReturnType<typeof jobRunner.stats> } = {
    ok: true,
    version: config.version,
    time: new Date().toISOString(),
    ffmpeg: { available, version: getFfmpegVersion() },
    dataDir: config.dataDir,
    concurrency: config.concurrency,
    activeProviderId: providerStore.activeId,
    jobs: jobStore.stats(),
    runner: jobRunner.stats(),
    database: dbStats(),
  };
  return c.json(body);
});

api.get("/providers", (c) => {
  const body: ProvidersResponse = {
    items: providerStore.list(),
    activeProviderId: providerStore.activeId,
    backend: {
      version: config.version,
      ffmpeg: Boolean(getFfmpegVersion()),
      encryptedStorage: true,
      dataDir: config.dataDir,
      concurrency: config.concurrency,
    },
  };
  return c.json(body);
});

api.put("/providers/:providerId", async (c) => {
  const providerId = c.req.param("providerId");
  const input = providerSchema.parse(await c.req.json());
  let info: ProviderInfo;
  try {
    info = providerStore.save(providerId, input as ProviderConfigInput);
  } catch (error) {
    throw new ApiError(422, "INVALID_PROVIDER_CONFIG", (error as Error).message);
  }
  return c.json(info);
});

api.post("/providers/:providerId/activate", (c) => {
  const providerId = c.req.param("providerId");
  try {
    providerStore.setActive(providerId);
  } catch {
    throw new ApiError(404, "PROVIDER_NOT_CONFIGURED", "Provider 尚未保存配置");
  }
  return c.json(providerStore.get(providerId));
});

api.post("/providers/:providerId/test", async (c) => {
  const providerId = c.req.param("providerId");
  const provider = providerStore.getResolved(providerId);
  if (!provider) throw new ApiError(404, "PROVIDER_NOT_FOUND", "Provider 不存在");
  if (!provider.configured) throw new ApiError(422, "PROVIDER_NOT_CONFIGURED", "请先保存 API Key");
  const adapter = createAdapter(provider);
  const result = await adapter.testConnection();
  providerStore.markTested(providerId, result.latencyMs);
  return c.json({
    ok: result.ok,
    latencyMs: result.latencyMs,
    message: result.message,
    capabilities: provider.capabilities,
    models: result.models,
  });
});

api.delete("/providers/:providerId", (c) => {
  const providerId = c.req.param("providerId");
  if (!providerStore.get(providerId)) throw new ApiError(404, "PROVIDER_NOT_FOUND", "Provider 不存在");
  providerStore.clear(providerId);
  return c.body(null, 204);
});

api.get("/models", (c) => {
  const mode = c.req.query("mode");
  const provider = providerStore.active();
  if (!provider?.configured) return c.json({ items: [] });
  const modes = [
    "text-to-image",
    "text-to-video",
    "image-to-image",
    "image-to-video",
    "multi-image-to-video",
  ];
  const items = [
    {
      id: provider.imageModel,
      providerId: provider.id,
      label: `${provider.label} · 图像`,
      modes: ["text-to-image", "image-to-image"],
      capabilities: provider.capabilities,
    },
    {
      id: provider.videoModel,
      providerId: provider.id,
      label: `${provider.label} · 视频`,
      modes: ["text-to-video", "image-to-video", "multi-image-to-video"],
      capabilities: provider.capabilities,
    },
  ].filter((item) => !mode || item.modes.includes(mode));
  return c.json({ items });
});

const payloadTooLarge = (message: string) => (c: { json: (body: unknown, status: 413) => Response }) =>
  c.json(
    {
      error: { code: "PAYLOAD_TOO_LARGE", message, retryable: false, traceId: "" },
    } satisfies ApiErrorBody,
    413
  );

api.use(
  "/uploads",
  bodyLimit({
    maxSize: config.maxBatchUploadBytes,
    onError: payloadTooLarge(`上传总大小不能超过 ${Math.round(config.maxBatchUploadBytes / 1024 / 1024)}MB`),
  })
);
api.use("/generations", bodyLimit({ maxSize: 2 * 1024 * 1024, onError: payloadTooLarge("任务请求体过大") }));
api.use("/providers/*", bodyLimit({ maxSize: 2 * 1024 * 1024, onError: payloadTooLarge("配置请求体过大") }));

api.post("/uploads", async (c) => {
  if (!rateLimit(`upload:${clientKey(c)}`, 120)) {
    throw new ApiError(429, "RATE_LIMITED", "上传过于频繁，请稍后再试", { retryable: true });
  }
  const declared = Number(c.req.header("content-length") || 0);
  if (declared > config.maxBatchUploadBytes) {
    throw new ApiError(413, "UPLOAD_TOO_LARGE", `上传总大小不能超过 ${Math.round(config.maxBatchUploadBytes / 1024 / 1024)}MB`);
  }
  let body: Record<string, string | File>;
  try {
    body = await c.req.parseBody();
  } catch {
    throw new ApiError(400, "INVALID_MULTIPART", "无法解析 multipart 上传");
  }
  const file = body.file;
  if (!(file instanceof File)) throw new ApiError(400, "FILE_REQUIRED", "请选择要上传的图片");
  const purpose = typeof body.purpose === "string" ? body.purpose : "reference";
  const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : null;
  if (projectId && !projectStore.get(projectId)) {
    throw new ApiError(404, "PROJECT_NOT_FOUND", "项目不存在");
  }
  try {
    const asset = await storeImageUpload(file, purpose, projectId);
    return c.json(asset, 201);
  } catch (error) {
    const err = error as Error & { code?: string; status?: number };
    throw new ApiError(err.status || 422, err.code || "UPLOAD_FAILED", err.message);
  }
});

api.get("/assets", (c) => c.json({ items: assetStore.list({ projectId: c.req.query("projectId") }) }));

api.delete("/assets/:assetId", (c) => {
  const removed = assetStore.remove(c.req.param("assetId"));
  if (!removed) throw new ApiError(404, "ASSET_NOT_FOUND", "素材不存在");
  return c.body(null, 204);
});

api.post("/generations", async (c) => {
  if (!rateLimit(`generation:${clientKey(c)}`, 60)) {
    throw new ApiError(429, "RATE_LIMITED", "生成请求过于频繁，请稍后再试", { retryable: true });
  }
  const parsed = generationSchema.parse(await c.req.json());
  const storyboard = parsed.storyboard || [];
  const provider = providerStore.get(parsed.providerId);
  if (!provider) throw new ApiError(404, "PROVIDER_NOT_FOUND", "Provider 不存在");
  if (!provider.configured) throw new ApiError(422, "PROVIDER_NOT_CONFIGURED", "Provider 尚未配置");

  if (parsed.mode === "multi-image-to-video") {
    if (parsed.generationType !== "storyboard") {
      throw new ApiError(422, "STORYBOARD_REQUIRED", "图组视频必须使用分镜模式");
    }
    if (storyboard.length < 2 || storyboard.length > 9) {
      throw new ApiError(422, "STORYBOARD_INVALID", "图组视频需要 2–9 个镜头");
    }
  }
  if (parsed.mode === "text-to-video" && parsed.generationType === "storyboard" && storyboard.length < 1) {
    throw new ApiError(422, "STORYBOARD_INVALID", "分镜模式至少需要 1 个镜头");
  }
  if (parsed.mode === "image-to-video" && !parsed.inputs.length && !storyboard[0]?.imageUrl && !storyboard[0]?.assetId) {
    throw new ApiError(422, "IMAGE_REQUIRED", "图生视频需要首帧图片");
  }
  if (parsed.mode === "image-to-image" && !parsed.inputs.length) {
    throw new ApiError(422, "IMAGE_REQUIRED", "图生图需要参考图");
  }
  if (parsed.params.resolution === "custom" && (!parsed.params.width || !parsed.params.height)) {
    throw new ApiError(422, "INVALID_DIMENSIONS", "自定义清晰度必须同时提供宽高");
  }
  if (parsed.params.width && parsed.params.height) {
    const video = parsed.mode !== "text-to-image" && parsed.mode !== "image-to-image";
    const maxW = video ? 3840 : 8192;
    const maxH = video ? 2160 : 8192;
    if (parsed.params.width > maxW || parsed.params.height > maxH) {
      throw new ApiError(422, "INVALID_DIMENSIONS", `当前模式最大尺寸为 ${maxW}×${maxH}`);
    }
  }
  if (!parsed.prompt.trim() && parsed.mode !== "multi-image-to-video") {
    throw new ApiError(422, "PROMPT_REQUIRED", "提示词不能为空");
  }

  const idempotencyKey = c.req.header("idempotency-key") || parsed.clientRequestId;
  const existing = jobStore.findByClientRequestId(idempotencyKey);
  if (existing) {
    c.header("Idempotent-Replayed", "true");
    return c.json(jobStore.public(existing), 202);
  }

  const request: GenerationRequest = {
    ...parsed,
    clientRequestId: idempotencyKey,
    modelId:
      parsed.modelId ||
      (parsed.mode === "text-to-image" || parsed.mode === "image-to-image"
        ? provider.imageModel
        : provider.videoModel),
    params: {
      ...parsed.params,
      durationSec:
        parsed.params.durationSec ||
        (parsed.mode === "multi-image-to-video"
          ? Math.max(4, storyboard.reduce((sum, row) => sum + row.durationSec, 0))
          : 5),
      fps: parsed.params.fps || 24,
    },
    inputs: parsed.inputs,
    storyboard,
    projectId: parsed.projectId,
    sessionId: parsed.sessionId,
    estimatedTokens:
      parsed.estimatedTokens && parsed.estimatedTokens > 0
        ? parsed.estimatedTokens
        : estimateGenerationTokens(parsed.mode, parsed.params, storyboard, parsed.generationType),
  };

  if (request.projectId && !projectStore.get(request.projectId)) {
    throw new ApiError(404, "PROJECT_NOT_FOUND", "项目不存在");
  }
  if (request.sessionId && !agentStore.get(request.sessionId)) {
    throw new ApiError(404, "SESSION_NOT_FOUND", "会话不存在");
  }
  const job = jobStore.create(request);
  console.log(
    `[jobs] enqueued ${job.id} mode=${job.mode} type=${job.generationType} est=${job.estimatedTokens} tokens`
  );
  return c.json(jobStore.public(job), 202);
});

api.get("/generations", (c) => {
  const items = jobStore.list({
    mode: c.req.query("mode"),
    status: c.req.query("status"),
    projectId: c.req.query("projectId"),
    sessionId: c.req.query("sessionId"),
    limit: Number(c.req.query("limit") || 50),
  });
  return c.json({ items });
});

api.get("/generations/:id", (c) => {
  const job = jobStore.get(c.req.param("id"));
  if (!job) throw new ApiError(404, "GENERATION_NOT_FOUND", "生成任务不存在");
  return c.json(job);
});

api.post("/generations/:id/cancel", (c) => {
  const id = c.req.param("id");
  const current = jobStore.get(id);
  if (!current) throw new ApiError(404, "GENERATION_NOT_FOUND", "生成任务不存在");
  if (isTerminal(current.status)) {
    throw new ApiError(409, "TASK_TERMINAL", "任务已经结束，无法取消");
  }
  const job = jobStore.cancel(id);
  return c.json(job);
});

api.post("/generations/:id/retry", (c) => {
  const job = jobStore.retry(c.req.param("id"));
  if (!job) throw new ApiError(409, "TASK_NOT_RETRYABLE", "只有已结束的任务可以重试");
  return c.json(job, 202);
});

api.get("/generations/:id/events", (c) => {
  const id = c.req.param("id");
  const job = jobStore.get(id);
  if (!job) throw new ApiError(404, "GENERATION_NOT_FOUND", "生成任务不存在");
  c.header("Cache-Control", "no-cache, no-transform");
  c.header("Connection", "keep-alive");
  c.header("X-Accel-Buffering", "no");
  return streamSSE(c, async (stream) => {
    let closed = false;
    let resolveDone: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const listener = (next: GenerationTask) => {
      if (closed) return;
      void stream.writeSSE({ event: "progress", data: JSON.stringify(next) });
      if (isTerminal(next.status)) {
        closed = true;
        resolveDone();
      }
    };
    jobStore.events.on(id, listener);
    const heartbeat = setInterval(() => {
      if (!closed) void stream.writeSSE({ event: "ping", data: String(Date.now()) });
    }, 15_000);
    const onAbort = () => {
      closed = true;
      resolveDone();
    };
    c.req.raw.signal.addEventListener("abort", onAbort);
    try {
      await stream.writeSSE({ event: "snapshot", data: JSON.stringify(job) });
      if (isTerminal(job.status)) {
        closed = true;
        resolveDone();
      }
      await done;
    } finally {
      clearInterval(heartbeat);
      jobStore.events.off(id, listener);
      c.req.raw.signal.removeEventListener("abort", onAbort);
    }
  });
});

api.get("/usage", (c) => c.json(jobStore.usageSummary(c.req.query("projectId") || undefined)));


/* ----------------------------- projects ----------------------------- */

const projectCreateSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(240).optional(),
  coverUrl: z.string().max(2000).optional(),
});

const projectUpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(240).optional(),
  coverUrl: z.string().max(2000).optional(),
  status: z.enum(["active", "archived"]).optional(),
});

const withStats = (project: Project): ProjectWithStats => ({
  ...project,
  stats: projectStore.stats(project.id),
});

api.get("/projects", (c) => c.json({ items: projectStore.list().map(withStats) }));

api.post("/projects", async (c) => {
  const input = projectCreateSchema.parse(await c.req.json());
  const project = projectStore.create(input);
  return c.json(withStats(project), 201);
});

api.get("/projects/:projectId", (c) => {
  const project = projectStore.get(c.req.param("projectId"));
  if (!project) throw new ApiError(404, "PROJECT_NOT_FOUND", "项目不存在");
  return c.json({
    project,
    stats: projectStore.stats(project.id),
    sessions: agentStore.list(project.id).slice(0, 8),
    assets: assetStore.list({ projectId: project.id, limit: 12 }),
  });
});

api.patch("/projects/:projectId", async (c) => {
  const id = c.req.param("projectId");
  if (!projectStore.get(id)) throw new ApiError(404, "PROJECT_NOT_FOUND", "项目不存在");
  const patch = projectUpdateSchema.parse(await c.req.json());
  const project = projectStore.update(id, patch);
  return c.json(project ? withStats(project) : null);
});

api.delete("/projects/:projectId", (c) => {
  const removed = projectStore.remove(c.req.param("projectId"));
  if (!removed) throw new ApiError(404, "PROJECT_NOT_FOUND", "项目不存在");
  return c.body(null, 204);
});

/* ------------------------------- agent ------------------------------ */

const agentSendSchema = z.object({ text: z.string().min(1).max(2000) });

api.get("/agent/sessions", (c) => {
  const projectId = c.req.query("projectId") || null;
  const sessions = agentStore.list(projectId, c.req.query("q") || "");
  return c.json({ items: sessions });
});

api.post("/agent/sessions", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : projectStore.list()[0]?.id;
  if (projectId && !projectStore.get(projectId)) throw new ApiError(404, "PROJECT_NOT_FOUND", "项目不存在");
  const session = agentStore.create({ projectId, title: typeof body.title === "string" ? body.title : "新会话" });
  return c.json(session, 201);
});

api.get("/agent/sessions/:sessionId", (c) => {
  const session = agentStore.get(c.req.param("sessionId"));
  if (!session) throw new ApiError(404, "SESSION_NOT_FOUND", "会话不存在");
  return c.json({ session, messages: agentStore.messages(session.id) });
});

api.patch("/agent/sessions/:sessionId", async (c) => {
  const id = c.req.param("sessionId");
  if (!agentStore.get(id)) throw new ApiError(404, "SESSION_NOT_FOUND", "会话不存在");
  const body = await c.req.json().catch(() => ({}));
  const session = agentStore.update(id, {
    title: typeof body.title === "string" ? body.title : undefined,
    projectId: typeof body.projectId === "string" ? body.projectId : undefined,
  });
  return c.json(session);
});

api.delete("/agent/sessions/:sessionId", (c) => {
  const removed = agentStore.remove(c.req.param("sessionId"));
  if (!removed) throw new ApiError(404, "SESSION_NOT_FOUND", "会话不存在");
  return c.body(null, 204);
});

api.post("/agent/sessions/:sessionId/messages", async (c) => {
  const sessionId = c.req.param("sessionId");
  const session = agentStore.get(sessionId);
  if (!session) throw new ApiError(404, "SESSION_NOT_FOUND", "会话不存在");
  if (agentRuntime.isRunning(sessionId)) {
    throw new ApiError(409, "AGENT_BUSY", "该会话正在执行，请等待完成或取消");
  }
  const { text } = agentSendSchema.parse(await c.req.json());
  const message = agentStore.addMessage(sessionId, "user", text.trim());
  let runId = "";
  try {
    const started = await agentRuntime.send(sessionId, text.trim());
    runId = started.runId;
  } catch (error) {
    throw new ApiError(409, "AGENT_BUSY", (error as Error).message);
  }
  return c.json({ session: agentStore.get(sessionId)!, message, runId }, 202);
});

api.post("/agent/sessions/:sessionId/cancel", (c) => {
  const sessionId = c.req.param("sessionId");
  if (!agentStore.get(sessionId)) throw new ApiError(404, "SESSION_NOT_FOUND", "会话不存在");
  const canceled = agentRuntime.cancel(sessionId);
  return c.json({ canceled, session: agentStore.get(sessionId) });
});

api.get("/agent/sessions/:sessionId/events", (c) => {
  const sessionId = c.req.param("sessionId");
  const session = agentStore.get(sessionId);
  if (!session) throw new ApiError(404, "SESSION_NOT_FOUND", "会话不存在");
  c.header("Cache-Control", "no-cache, no-transform");
  c.header("Connection", "keep-alive");
  c.header("X-Accel-Buffering", "no");
  return streamSSE(c, async (stream) => {
    let closed = false;
    let resolveDone: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const listener = (event: unknown) => {
      if (closed) return;
      const payload = event as { type?: string; status?: string };
      void stream.writeSSE({
        event: "agent",
        data: JSON.stringify(payload),
      });
      if (payload.type === "done" && payload.status === undefined) {
        closed = true;
        resolveDone();
      }
    };
    agentStore.events.on(sessionId, listener);
    const heartbeat = setInterval(() => {
      if (!closed) void stream.writeSSE({ event: "ping", data: String(Date.now()) });
    }, 15_000);
    const snapshot = { type: "snapshot", session, messages: agentStore.messages(sessionId) };
    const onAbort = () => {
      closed = true;
      resolveDone();
    };
    c.req.raw.signal.addEventListener("abort", onAbort);
    try {
      await stream.writeSSE({ event: "agent", data: JSON.stringify(snapshot) });
      if (session.status !== "running") {
        // The client can still keep the stream open for future runs; but a
        // finished session shouldn't hold a connection indefinitely.
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (session.status === "idle" && !agentRuntime.isRunning(sessionId)) {
          closed = true;
          resolveDone();
        }
      }
      await done;
    } finally {
      clearInterval(heartbeat);
      agentStore.events.off(sessionId, listener);
      c.req.raw.signal.removeEventListener("abort", onAbort);
    }
  });
});

app.route("/api/v1", api);

/** Same-origin media, with HTTP Range support for video seeking. */
app.on(["GET", "HEAD"], "/media/*", (c) => {
  const pathname = new URL(c.req.url).pathname;
  const raw = pathname.replace(/^\/media\//, "");
  const [kind, ...rest] = raw.split("/");
  const file = safeMediaFile(kind, rest.join("/"));
  if (!file) throw new ApiError(404, "MEDIA_NOT_FOUND", "媒体文件不存在");
  const stat = fs.statSync(file);
  const mime = extensionMime(file);
  const range = c.req.header("range");
  const baseHeaders: Record<string, string> = {
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  };
  if (c.req.method === "HEAD") {
    c.header("Content-Length", String(stat.size));
    for (const [key, value] of Object.entries(baseHeaders)) c.header(key, value);
    return c.body(null, 200);
  }
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (start <= end && start < stat.size) {
        c.header("Content-Range", `bytes ${start}-${end}/${stat.size}`);
        c.header("Content-Length", String(end - start + 1));
        for (const [key, value] of Object.entries(baseHeaders)) c.header(key, value);
        return c.body(Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream, 206);
      }
    }
  }
  c.header("Content-Length", String(stat.size));
  for (const [key, value] of Object.entries(baseHeaders)) c.header(key, value);
  return c.body(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, 200);
});

app.get("/", (c) =>
  c.json({
    name: "LUMEN BFF",
    version: config.version,
    api: "/api/v1",
    media: "/media",
    time: new Date().toISOString(),
  })
);

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`\n  LUMEN BFF  http://${config.host}:${info.port}`);
  console.log(`  API         http://${config.host}:${info.port}/api/v1`);
  console.log(`  Data        ${config.dataDir}`);
  console.log(`  Providers   ${providerStore.list().filter((provider) => provider.configured).map((provider) => provider.id).join(", ") || "none"}`);
  void ffmpegAvailable().then((available) => {
    console.log(`  FFmpeg      ${available ? getFfmpegVersion() : "not detected"}\n`);
  });
  jobRunner.start();
});

const shutdown = () => {
  console.log("\n[jobs] shutting down…");
  jobRunner.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 4000).unref();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
