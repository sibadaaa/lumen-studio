import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type {
  ApiErrorBody,
  GenerationRequest,
  GenerationTask,
  GenerationMode,
  LibraryAsset,
  MediaAsset,
  ModelInfo,
  ModelRoutesResponse,
  ModelSyncResult,
  ModelsResponse,
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
import { assetUsageStore } from "./storage/asset-usage.js";
import { modelStore, inferModelKind, modesFor, capabilitiesFor } from "./storage/models.js";
import { workStore } from "./storage/works.js";
import { importWorkAsAsset } from "./media/asset-import.js";
import { jobStore, isTerminal } from "./jobs/store.js";
import { jobRunner } from "./jobs/runner.js";
import { estimateGenerationTokens, estimateSeconds } from "./jobs/estimate.js";
import { createAdapter } from "./providers/index.js";
import type { RemoteModel } from "./providers/types.js";
import { ffmpegAvailable, getFfmpegVersion } from "./media/ffmpeg.js";
import { storeImageUpload } from "./media/upload.js";
import { extensionMime } from "./media/ffmpeg.js";
import { safeMediaFile } from "./media/local.js";
import { ProviderError } from "./providers/http.js";
import { getVault } from "./security/vault.js";
import { projectStore } from "./storage/projects.js";
import { agentStore } from "./storage/sessions.js";
import { agentRuntime } from "./agent/runtime.js";
import { db, dbStats, getSetting, setSetting, withTransaction } from "./db.js";

ensureDataDirs();
const vault = getVault();
console.log(`[security] secret vault ready (${vault.source === "env" ? "APP_SECRET" : "data/master.key"})`);

/**
 * M4 startup hooks: seed the model catalog from configured providers, then
 * reconcile works and asset usages for anything a crash may have missed.
 */
function runStartupReconciliation() {
  try {
    for (const provider of providerStore.list()) {
      if (!provider.configured) continue;
      modelStore.seedFromProvider(provider);
    }
    const seeded = modelStore.count();
    console.log(`[models] catalog ready (${seeded} model(s))`);
  } catch (error) {
    console.error("[models] seed failed:", (error as Error).message);
  }
  try {
    const created = workStore.reconcile(jobStore.listInternal({ status: "succeeded", limit: 200 }));
    if (created > 0) console.log(`[works] reconciled ${created} work(s) from history`);
    if (!getSetting("works_backfill_v1")) {
      setSetting("works_backfill_v1", new Date().toISOString());
    }
  } catch (error) {
    console.error("[works] reconcile failed:", (error as Error).message);
  }
  try {
    assetUsageStore.backfill(jobStore.listInternal({ limit: 200 }));
    if (!getSetting("asset_usage_backfill_v1")) {
      setSetting("asset_usage_backfill_v1", new Date().toISOString());
    }
  } catch (error) {
    console.error("[assets] usage reconcile failed:", (error as Error).message);
  }
  void backfillAssetHashes();
}

/** Hash legacy uploads in small batches so boot is never blocked. */
async function backfillAssetHashes() {
  if (getSetting("assets_hash_backfill_v1")) return;
  try {
    const { createHash } = await import("node:crypto");
    const pending = assetStore.search({ limit: 100 }).items.filter((item) => !item.sha256);
    for (const item of pending) {
      const relative = item.url.replace(/^\/media\/assets\//, "");
      const file = path.resolve(paths.assets, decodeURIComponent(relative));
      if (!file.startsWith(paths.assets) || !fs.existsSync(file)) continue;
      const sha256 = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      db.prepare("UPDATE assets SET sha256 = ? WHERE id = ?").run(sha256, item.id);
    }
    setSetting("assets_hash_backfill_v1", new Date().toISOString());
    if (pending.length > 0) console.log(`[assets] hashed ${pending.length} legacy upload(s)`);
  } catch (error) {
    console.error("[assets] hash backfill failed:", (error as Error).message);
  }
}

runStartupReconciliation();

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
  const providerId = c.req.query("providerId") || providerStore.activeId || undefined;
  const enabledOnly = c.req.query("enabled") !== "0";

  // Catalog path: seeded/discovered models win over the legacy synthesis.
  const catalog = modelStore.list({ providerId, enabled: enabledOnly || undefined });
  if (catalog.length > 0) {
    const items = mode ? catalog.filter((model) => model.modes.includes(mode as GenerationMode)) : catalog;
    return c.json({ items } satisfies ModelsResponse);
  }

  // Legacy fallback: synthesize the two configured models so old clients and
  // unseeded providers keep working.
  const provider = providerId ? providerStore.get(providerId) : providerStore.active();
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

/* --------------------------- model catalog --------------------------- */

const modelCreateSchema = z.object({
  id: z.string().min(1).max(200),
  label: z.string().max(200).optional(),
  kind: z.enum(["image", "video", "unknown"]),
  modes: z.array(generationModeSchema).max(5),
  enabled: z.boolean().optional(),
});

const modelUpdateSchema = z.object({
  label: z.string().max(200).optional(),
  kind: z.enum(["image", "video", "unknown"]).optional(),
  modes: z.array(generationModeSchema).max(5).optional(),
  enabled: z.boolean().optional(),
});

const modelEnableSchema = z.object({
  modelIds: z.array(z.string().min(1).max(200)).min(1).max(100),
  enabled: z.boolean(),
});

function requireProvider(providerId: string) {
  const provider = providerStore.get(providerId);
  if (!provider) throw new ApiError(404, "PROVIDER_NOT_FOUND", "Provider 不存在");
  return provider;
}

api.get("/providers/:providerId/models", (c) => {
  const providerId = c.req.param("providerId");
  requireProvider(providerId);
  const enabled = c.req.query("enabled");
  const items = modelStore.list({
    providerId,
    enabled: enabled === undefined ? undefined : enabled === "1",
    includeMissing: c.req.query("includeMissing") === "1",
  });
  return c.json({ items } satisfies ModelsResponse);
});

api.post("/providers/:providerId/models/enable", async (c) => {
  const providerId = c.req.param("providerId");
  requireProvider(providerId);
  const body = modelEnableSchema.parse(await c.req.json());
  const changed = modelStore.setEnabled(providerId, body.modelIds, body.enabled);
  return c.json({ changed, items: modelStore.list({ providerId, includeMissing: true }) });
});

api.post("/providers/:providerId/models/sync", async (c) => {
  const providerId = c.req.param("providerId");
  const provider = requireProvider(providerId);
  if (!provider.configured) {
    throw new ApiError(422, "PROVIDER_NOT_CONFIGURED", "请先保存并测试连接");
  }
  if (!rateLimit(`modelsync:${providerId}`, 10)) {
    throw new ApiError(429, "RATE_LIMITED", "模型同步过于频繁，请稍后再试", { retryable: true });
  }
  const resolved = providerStore.getResolved(providerId)!;
  const adapter = createAdapter(resolved);
  if (!adapter.listModels) {
    return c.json({
      providerId,
      supported: false,
      fetched: 0,
      added: 0,
      updated: 0,
      missing: 0,
      suggestedEnabled: [],
      message: "该 Provider 不支持模型列表，可手动添加模型",
      items: modelStore.list({ providerId, includeMissing: true }),
    } satisfies ModelSyncResult);
  }

  const started = Date.now();
  let remote: RemoteModel[];
  try {
    remote = await adapter.listModels();
  } catch (error) {
    const err = error as { status?: number | null; code?: string; message?: string };
    const message = err.message || "模型列表获取失败";
    providerStore.markModelsSynced(providerId, null, message);
    if (err.status === 401 || err.status === 403) {
      throw new ApiError(502, "MODEL_DISCOVERY_AUTH", message);
    }
    if (err.status === 404 || err.status === 405) {
      return c.json({
        providerId,
        supported: false,
        fetched: 0,
        added: 0,
        updated: 0,
        missing: 0,
        suggestedEnabled: [],
        message: "该网关未开放模型列表，可手动添加模型",
        items: modelStore.list({ providerId, includeMissing: true }),
      } satisfies ModelSyncResult);
    }
    throw new ApiError(502, err.code || "MODEL_DISCOVERY_NETWORK", message);
  }

  // Cap the response: model ids are attacker-controllable for custom gateways.
  const deduped = new Map<string, RemoteModel>();
  for (const item of remote.slice(0, 500)) {
    const id = String(item.id || "").trim().slice(0, 200);
    if (id && !deduped.has(id)) deduped.set(id, { ...item, id });
  }

  const result = withTransaction(() => {
    let added = 0;
    let updated = 0;
    let missing = 0;
    const suggested: string[] = [];
    const existing = modelStore.listRaw(providerId);
    const timestamp = new Date().toISOString();

    for (const remoteModel of deduped.values()) {
      const current = existing.get(remoteModel.id);
      const inferred = inferModelKind(remoteModel.id, provider.kind);
      const kind = current?.source === "manual" || (current && current.label !== current.id) ? current.kind : inferred.kind;
      const userEdited = Boolean(current?.source === "manual");
      const modes = userEdited && current ? current.modes : modesFor(kind, provider.kind);
      const capabilities = userEdited && current ? current.capabilities : capabilitiesFor(kind, provider.kind);
      modelStore.upsert({
        providerId,
        modelId: remoteModel.id,
        label: remoteModel.label || remoteModel.id,
        kind,
        modes,
        capabilities,
        source: userEdited ? "manual" : current?.source === "seed" ? "seed" : "discovered",
        enabled: current?.enabled ?? false,
        userEdited,
        status: "ready",
        lastSyncedAt: timestamp,
        lastSeenAt: timestamp,
      });
      if (!current) {
        added += 1;
        if (inferred.confidence === "high" && kind !== "unknown") suggested.push(remoteModel.id);
      } else {
        updated += 1;
      }
    }

    if (deduped.size > 0) {
      for (const [modelId, current] of existing) {
        if (current.source !== "discovered") continue;
        if (!deduped.has(modelId)) {
          modelStore.markMissing(providerId, modelId, timestamp);
          missing += 1;
        }
      }
    }

    providerStore.markModelsSynced(providerId, timestamp, null);
    return { added, updated, missing, suggested };
  });

  console.log(
    `[models] synced ${providerId}: fetched=${deduped.size} added=${result.added} updated=${result.updated} missing=${result.missing} in ${Date.now() - started}ms`
  );
  return c.json({
    providerId,
    supported: true,
    fetched: deduped.size,
    ...result,
    suggestedEnabled: result.suggested,
    message: `已更新模型目录 · 新增 ${result.added}，更新 ${result.updated}，未再出现 ${result.missing}`,
    items: modelStore.list({ providerId, includeMissing: true }),
  } satisfies ModelSyncResult);
});

api.post("/providers/:providerId/models", async (c) => {
  const providerId = c.req.param("providerId");
  const provider = requireProvider(providerId);
  const body = modelCreateSchema.parse(await c.req.json());
  if (modelStore.find(providerId, body.id)) {
    throw new ApiError(409, "MODEL_EXISTS", "该模型已在目录中");
  }
  const kind = body.kind === "unknown" ? "unknown" : body.kind;
  const modes = kind === "unknown" ? [] : body.modes;
  const info = modelStore.upsert({
    providerId,
    modelId: body.id,
    label: body.label || body.id,
    kind,
    modes,
    capabilities: capabilitiesFor(kind, provider.kind),
    source: "manual",
    enabled: body.enabled ?? kind !== "unknown",
    userEdited: true,
    status: kind === "unknown" ? "unverified" : "ready",
  });
  return c.json(info, 201);
});

api.patch("/providers/:providerId/models/:modelId", async (c) => {
  const providerId = c.req.param("providerId");
  const provider = requireProvider(providerId);
  const modelId = c.req.param("modelId");
  if (!modelStore.find(providerId, modelId)) throw new ApiError(404, "MODEL_NOT_FOUND", "模型不存在");
  const body = modelUpdateSchema.parse(await c.req.json());
  const capabilities =
    body.kind && body.kind !== modelStore.find(providerId, modelId)?.kind
      ? capabilitiesFor(body.kind, provider.kind)
      : undefined;
  const info = modelStore.update(providerId, modelId, {
    ...body,
    ...(capabilities ? { capabilities } : {}),
    userEdited: true,
  });
  return c.json(info);
});

api.post("/providers/:providerId/models/:modelId/verify", async (c) => {
  const providerId = c.req.param("providerId");
  requireProvider(providerId);
  const modelId = c.req.param("modelId");
  const model = modelStore.find(providerId, modelId);
  if (!model) throw new ApiError(404, "MODEL_NOT_FOUND", "模型不存在");
  const resolved = providerStore.getResolved(providerId)!;
  const adapter = createAdapter(resolved);
  let reachable = false;
  let message = "本地目录模型 · 未发起任何生成请求";
  if (adapter.listModels) {
    try {
      const models = await adapter.listModels();
      reachable = models.some((item) => item.id === modelId);
      message = reachable ? `远程目录中找到模型（${models.length} 个候选）` : "远程模型列表中未找到该模型";
    } catch (error) {
      message = `远程目录不可用：${(error as Error).message}`;
    }
  }
  const info = modelStore.update(providerId, modelId, {
    status: reachable ? "ready" : "unverified",
    lastError: reachable ? null : message,
  });
  return c.json({ ok: reachable, message, model: info });
});

api.delete("/providers/:providerId/models/:modelId", (c) => {
  const providerId = c.req.param("providerId");
  requireProvider(providerId);
  const modelId = c.req.param("modelId");
  try {
    if (!modelStore.remove(providerId, modelId)) throw new ApiError(404, "MODEL_NOT_FOUND", "模型不存在");
  } catch (error) {
    if ((error as Error).message.startsWith("MODEL_IN_USE")) {
      throw new ApiError(409, "MODEL_IN_USE", (error as Error).message.replace("MODEL_IN_USE: ", ""));
    }
    throw error;
  }
  return c.body(null, 204);
});

api.get("/model-routes", (c) => {
  return c.json({ items: modelStore.listRoutes() } satisfies ModelRoutesResponse);
});

api.put("/model-routes/:mode", async (c) => {
  const mode = generationModeSchema.parse(c.req.param("mode"));
  const body = z.object({ providerId: z.string().min(1).max(32), modelId: z.string().min(1).max(200) }).parse(
    await c.req.json()
  );
  const provider = providerStore.get(body.providerId);
  if (!provider) throw new ApiError(404, "PROVIDER_NOT_FOUND", "Provider 不存在");
  const model = modelStore.find(body.providerId, body.modelId);
  if (!model) throw new ApiError(404, "MODEL_NOT_FOUND", "模型不在目录中，请先获取或添加");
  const force = c.req.query("force") === "1";
  if (!force && (!model.enabled || model.status === "missing" || !model.modes.includes(mode))) {
    throw new ApiError(422, "MODEL_ROUTE_INVALID", "该模型未启用、已下架或不支持当前模式");
  }
  const route = modelStore.setRoute(mode, body.providerId, body.modelId);
  return c.json(route);
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
  const tags = typeof body.tags === "string" ? body.tags.split(/[,\n]/).map((tag) => tag.trim()).filter(Boolean) : [];
  try {
    const asset = await storeImageUpload(file, purpose, projectId);
    if (tags.length > 0) assetStore.setTags(asset.id, tags);
    const detail = assetStore.getDetail(asset.id);
    return c.json(detail || asset, 201);
  } catch (error) {
    const err = error as Error & { code?: string; status?: number };
    throw new ApiError(err.status || 422, err.code || "UPLOAD_FAILED", err.message);
  }
});

/* ------------------------- asset library ---------------------------- */

/** Stream a stored file as an attachment-safe response (no Range needed here). */
function serveLocalFile(c: Context, file: string, mime: string) {
  const stat = fs.statSync(file);
  c.header("Content-Type", mime);
  c.header("Content-Length", String(stat.size));
  c.header("Accept-Ranges", "bytes");
  c.header("Cache-Control", "private, max-age=86400");
  c.header("X-Content-Type-Options", "nosniff");
  return c.body(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, 200);
}

api.get("/assets", (c) => {
  const query = c.req.query();
  const page = assetStore.search({
    projectId: query.projectId || undefined,
    kind: query.kind || undefined,
    source: query.source || undefined,
    tag: query.tag ? query.tag.split(",").map((tag) => tag.trim()).filter(Boolean) : undefined,
    unused: query.unused === "1",
    duplicate: query.duplicate === "1",
    q: query.q || undefined,
    from: query.from || undefined,
    to: query.to || undefined,
    cursor: query.cursor || undefined,
    limit: Number(query.limit || 24),
    sort: (query.sort as "newest" | "oldest" | "size" | "name") || undefined,
  });
  return c.json(page);
});

api.get("/assets/facets", (c) => c.json(assetStore.facets()));

api.get("/assets/:assetId", (c) => {
  const asset = assetStore.getDetail(c.req.param("assetId"));
  if (!asset) throw new ApiError(404, "ASSET_NOT_FOUND", "素材不存在");
  return c.json(asset);
});

api.patch("/assets/:assetId", async (c) => {
  const id = c.req.param("assetId");
  if (!assetStore.get(id)) throw new ApiError(404, "ASSET_NOT_FOUND", "素材不存在");
  const body = z
    .object({
      originalName: z.string().max(160).optional(),
      projectId: z.string().max(80).nullable().optional(),
      tags: z.array(z.string().max(24)).max(8).optional(),
    })
    .parse(await c.req.json());
  if (body.projectId && !projectStore.get(body.projectId)) {
    throw new ApiError(404, "PROJECT_NOT_FOUND", "项目不存在");
  }
  if (body.tags !== undefined) assetStore.setTags(id, body.tags);
  const asset = assetStore.updateMeta(id, { originalName: body.originalName, projectId: body.projectId });
  return c.json(asset);
});

api.delete("/assets/:assetId", (c) => {
  const id = c.req.param("assetId");
  if (!assetStore.get(id)) throw new ApiError(404, "ASSET_NOT_FOUND", "素材不存在");
  const running = assetUsageStore.countRunning(id);
  if (running > 0) {
    throw new ApiError(409, "ASSET_IN_USE", `有 ${running} 个任务正在使用该素材，完成后再删除`);
  }
  const usage = assetUsageStore.countForAsset(id);
  const force = c.req.query("force") === "1";
  if (usage > 0 && !force) {
    throw new ApiError(409, "ASSET_REFERENCED", `该素材被 ${usage} 个任务引用，确认后再删除`, {
      details: { usageCount: usage },
    });
  }
  assetStore.softDelete(id);
  console.log(`[assets] deleted ${id} (usage=${usage})`);
  return c.body(null, 204);
});

api.post("/assets/bulk", async (c) => {
  const body = z
    .object({
      action: z.enum(["move_project", "add_tags", "remove_tags", "delete"]),
      ids: z.array(z.string().max(80)).min(1).max(100),
      projectId: z.string().max(80).nullable().optional(),
      tags: z.array(z.string().max(24)).max(20).optional(),
    })
    .parse(await c.req.json());
  const result = { updated: 0, skipped: 0, failed: [] as Array<{ id: string; code: string; message: string }> };
  if (body.action === "move_project" && body.projectId && !projectStore.get(body.projectId)) {
    throw new ApiError(404, "PROJECT_NOT_FOUND", "项目不存在");
  }
  for (const id of body.ids) {
    if (!assetStore.get(id)) {
      result.failed.push({ id, code: "ASSET_NOT_FOUND", message: "素材不存在" });
      continue;
    }
    if (body.action === "move_project") {
      assetStore.updateMeta(id, { projectId: body.projectId ?? null });
      result.updated += 1;
    } else if (body.action === "add_tags") {
      const { added, skipped } = assetStore.addTags(id, body.tags || []);
      result.updated += added.length > 0 ? 1 : 0;
      result.skipped += skipped;
    } else if (body.action === "remove_tags") {
      result.updated += assetStore.removeTags(id, body.tags || []) > 0 ? 1 : 0;
    } else if (body.action === "delete") {
      if (assetUsageStore.countRunning(id) > 0) {
        result.failed.push({ id, code: "ASSET_IN_USE", message: "有任务正在使用该素材" });
        continue;
      }
      if (assetStore.softDelete(id)) result.updated += 1;
    }
  }
  return c.json(result);
});

api.get("/assets/:assetId/usage", (c) => {
  const id = c.req.param("assetId");
  if (!assetStore.get(id)) throw new ApiError(404, "ASSET_NOT_FOUND", "素材不存在");
  return c.json({ items: assetUsageStore.listForAsset(id) });
});

api.get("/assets/:assetId/download", (c) => {
  const asset = assetStore.get(c.req.param("assetId"));
  if (!asset) throw new ApiError(404, "ASSET_NOT_FOUND", "素材不存在");
  const relative = asset.url.replace(/^\/media\/assets\//, "");
  const file = safeMediaFile("assets", relative);
  if (!file) throw new ApiError(410, "ASSET_FILE_MISSING", "素材文件不存在或已清理");
  const name = encodeURIComponent(asset.originalName || `${asset.id}.${extensionMime(file).split("/")[1] || "bin"}`);
  c.header("Content-Disposition", `attachment; filename*=UTF-8''${name}`);
  return serveLocalFile(c, file, extensionMime(file));
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

  // Model catalog validation: only enforced when the model exists in the
  // catalog, so legacy configs and unseeded providers keep working.
  const requestModelId =
    parsed.modelId ||
    (parsed.mode === "text-to-image" || parsed.mode === "image-to-image" ? provider.imageModel : provider.videoModel);
  const catalogModel = modelStore.find(parsed.providerId, requestModelId);
  if (catalogModel) {
    if (!catalogModel.enabled) {
      throw new ApiError(422, "MODEL_NOT_READY", "当前模型未启用，请在模型库启用后再生成");
    }
    if (catalogModel.status === "missing") {
      throw new ApiError(422, "MODEL_MISSING", "当前模型已下架，请重新获取或更换模型");
    }
    if (!catalogModel.modes.includes(parsed.mode)) {
      throw new ApiError(422, "MODEL_MODE_UNSUPPORTED", "当前模型不支持该生成模式，请更换模型");
    }
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
  if (catalogModel) modelStore.markUsed(parsed.providerId, requestModelId);
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


/* ------------------------------ works ------------------------------- */

const workUpdateSchema = z.object({
  title: z.string().max(80).optional(),
  favorite: z.boolean().optional(),
  projectId: z.string().max(80).nullable().optional(),
});

const workBulkSchema = z.object({
  action: z.enum(["favorite", "unfavorite", "move_project", "delete", "save_to_assets"]),
  ids: z.array(z.string().max(120)).min(1).max(100),
  projectId: z.string().max(80).nullable().optional(),
});

api.get("/works", (c) => {
  const query = c.req.query();
  return c.json(
    workStore.list({
      projectId: query.projectId || undefined,
      mode: query.mode || undefined,
      kind: query.kind || undefined,
      providerId: query.providerId || undefined,
      modelId: query.modelId || undefined,
      favorite: query.favorite === "1",
      q: query.q || undefined,
      from: query.from || undefined,
      to: query.to || undefined,
      cursor: query.cursor || undefined,
      limit: Number(query.limit || 24),
      sort: (query.sort as "newest" | "oldest" | "tokens" | "duration") || undefined,
    })
  );
});

api.get("/works/facets", (c) => c.json(workStore.facets()));

api.post("/works/bulk", async (c) => {
  const body = workBulkSchema.parse(await c.req.json());
  if (body.action === "move_project" && body.projectId && !projectStore.get(body.projectId)) {
    throw new ApiError(404, "PROJECT_NOT_FOUND", "项目不存在");
  }
  if (body.action === "save_to_assets") {
    let created = 0;
    const failed: Array<{ id: string; code: string; message: string }> = [];
    for (const id of body.ids) {
      const work = workStore.get(id);
      if (!work) {
        failed.push({ id, code: "WORK_NOT_FOUND", message: "作品不存在" });
        continue;
      }
      try {
        const result = await importWorkAsAsset(work);
        if (result.created) created += 1;
      } catch (error) {
        const err = error as { code?: string; status?: number; message?: string };
        failed.push({ id, code: err.code || "WORK_SAVE_FAILED", message: err.message || "另存失败" });
      }
    }
    return c.json({ updated: body.ids.length - failed.length, created, failed });
  }
  return c.json(workStore.bulk(body.action, body.ids, body.projectId));
});

api.get("/works/:workId", (c) => {
  const work = workStore.get(c.req.param("workId"));
  if (!work) throw new ApiError(404, "WORK_NOT_FOUND", "作品不存在");
  return c.json(work);
});

api.patch("/works/:workId", async (c) => {
  const id = c.req.param("workId");
  if (!workStore.get(id)) throw new ApiError(404, "WORK_NOT_FOUND", "作品不存在");
  const body = workUpdateSchema.parse(await c.req.json());
  if (body.projectId && !projectStore.get(body.projectId)) {
    throw new ApiError(404, "PROJECT_NOT_FOUND", "项目不存在");
  }
  const work = workStore.update(id, body);
  return c.json(work);
});

api.delete("/works/:workId", (c) => {
  if (!workStore.softDelete(c.req.param("workId"))) throw new ApiError(404, "WORK_NOT_FOUND", "作品不存在");
  return c.body(null, 204);
});

api.post("/works/:workId/save-to-assets", async (c) => {
  const work = workStore.get(c.req.param("workId"));
  if (!work) throw new ApiError(404, "WORK_NOT_FOUND", "作品不存在");
  try {
    const result = await importWorkAsAsset(work);
    return c.json(result, result.created ? 201 : 200);
  } catch (error) {
    const err = error as { code?: string; status?: number; message?: string };
    throw new ApiError(err.status || 500, err.code || "WORK_SAVE_FAILED", err.message || "另存为素材失败");
  }
});

api.get("/works/:workId/download", (c) => {
  const work = workStore.get(c.req.param("workId"));
  if (!work) throw new ApiError(404, "WORK_NOT_FOUND", "作品不存在");
  const relative = work.url.replace(/^\/media\/outputs\//, "");
  const file = safeMediaFile("outputs", relative);
  if (!file) throw new ApiError(410, "WORK_FILE_MISSING", "作品文件不存在或已清理");
  const ext = path.extname(file) || (work.kind === "video" ? ".mp4" : ".jpg");
  const name = encodeURIComponent(`${work.title || work.id}${ext}`);
  c.header("Content-Disposition", `attachment; filename*=UTF-8''${name}`);
  return serveLocalFile(c, file, extensionMime(file));
});


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
