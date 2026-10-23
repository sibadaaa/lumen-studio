import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import type {
  GenerationRequest,
  GenerationTask,
  TaskStatus,
  TokenUsage,
  UsageSummary,
} from "../../shared/contracts.js";
import { db } from "../db.js";
import { estimateGenerationTokens, estimateSeconds } from "./estimate.js";
import { assetUsageStore } from "../storage/asset-usage.js";

export interface InternalJobState {
  canceled: boolean;
  cancelRequestedAt: string | null;
  providerTaskId: string | null;
  shotProviderTaskIds: Record<string, string>;
  attempts: number;
  usageEstimated: boolean;
  logs: Array<{ at: string; message: string }>;
  clientIp?: string;
}

export interface StoredJob extends GenerationTask {
  internal: InternalJobState;
}

interface JobRow {
  id: string;
  client_request_id: string;
  mode: GenerationTask["mode"];
  generation_type: GenerationTask["generationType"];
  provider_id: string;
  model_id: string;
  status: TaskStatus;
  progress: number;
  stage: string;
  prompt: string;
  params_json: string;
  inputs_json: string;
  storyboard_json: string;
  outputs_json: string;
  shots_json: string;
  estimated_tokens: number;
  usage_json: string | null;
  error_json: string | null;
  estimated_seconds: number;
  project_id: string | null;
  session_id: string | null;
  internal_json: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
}

const now = () => new Date().toISOString();
export const terminalStatuses: TaskStatus[] = ["succeeded", "failed", "canceled", "partial_failed"];
export const isTerminal = (status: TaskStatus) => terminalStatuses.includes(status);

const parse = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

function emptyInternal(): InternalJobState {
  return {
    canceled: false,
    cancelRequestedAt: null,
    providerTaskId: null,
    shotProviderTaskIds: {},
    attempts: 0,
    usageEstimated: true,
    logs: [],
  };
}

function rowToJob(row: JobRow): StoredJob {
  const internal: InternalJobState = { ...emptyInternal(), ...parse(row.internal_json, {}) };
  return {
    id: row.id,
    clientRequestId: row.client_request_id,
    mode: row.mode,
    generationType: row.generation_type,
    providerId: row.provider_id,
    modelId: row.model_id,
    status: row.status,
    progress: row.progress,
    stage: row.stage,
    prompt: row.prompt,
    params: parse(row.params_json, {}),
    inputs: parse(row.inputs_json, []),
    storyboard: parse(row.storyboard_json, []),
    outputs: parse(row.outputs_json, []),
    shots: parse(row.shots_json, []),
    estimatedTokens: row.estimated_tokens,
    usage: parse<TokenUsage | null>(row.usage_json, null),
    error: parse(row.error_json, null),
    estimatedSeconds: row.estimated_seconds,
    projectId: row.project_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
    internal,
  };
}

export class JobStore {
  readonly events = new EventEmitter();

  constructor() {
    this.events.setMaxListeners(80);
    this.recover();
  }

  private recover() {
    const rows = db
      .prepare("SELECT * FROM generations WHERE status NOT IN ('succeeded','failed','canceled','partial_failed')")
      .all() as unknown as JobRow[];
    if (!rows.length) return;
    const update = db.prepare(
      "UPDATE generations SET status = ?, progress = 0, stage = ?, started_at = NULL, finished_at = ?, internal_json = ?, updated_at = ? WHERE id = ?"
    );
    for (const row of rows) {
      const job = rowToJob(row);
      const canceled = job.internal.canceled;
      const shots = job.shots.map((shot) => ({ ...shot, status: "queued" as const, progress: 0, providerTaskId: undefined }));
      update.run(
        canceled ? "canceled" : "queued",
        canceled ? "已取消" : "服务重启，重新入队",
        canceled ? now() : null,
        JSON.stringify({ ...job.internal, providerTaskId: null, shotProviderTaskIds: {} }),
        now(),
        job.id
      );
      db.prepare("UPDATE generations SET shots_json = ? WHERE id = ?").run(JSON.stringify(shots), job.id);
    }
    console.log(`[jobs] recovered ${rows.length} unfinished job(s) from SQLite`);
  }

  newId() {
    return `gen_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
  }

  private write(job: StoredJob) {
    db.prepare(
      `UPDATE generations SET
        status = ?, progress = ?, stage = ?, prompt = ?,
        params_json = ?, inputs_json = ?, storyboard_json = ?, outputs_json = ?, shots_json = ?,
        estimated_tokens = ?, usage_json = ?, error_json = ?, estimated_seconds = ?,
        project_id = ?, session_id = ?, internal_json = ?,
        started_at = ?, finished_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      job.status,
      job.progress,
      job.stage,
      job.prompt,
      JSON.stringify(job.params),
      JSON.stringify(job.inputs),
      JSON.stringify(job.storyboard),
      JSON.stringify(job.outputs),
      JSON.stringify(job.shots),
      job.estimatedTokens,
      job.usage ? JSON.stringify(job.usage) : null,
      job.error ? JSON.stringify(job.error) : null,
      job.estimatedSeconds,
      job.projectId ?? null,
      job.sessionId ?? null,
      JSON.stringify(job.internal),
      job.startedAt,
      job.finishedAt,
      job.updatedAt,
      job.id
    );
  }

  create(request: GenerationRequest): StoredJob {
    const existing = this.findByClientRequestId(request.clientRequestId);
    if (existing) return existing;
    const id = this.newId();
    const timestamp = now();
    const storyboard = request.storyboard || [];
    const estimatedTokens =
      request.estimatedTokens && request.estimatedTokens > 0
        ? Math.round(request.estimatedTokens)
        : estimateGenerationTokens(request.mode, request.params, storyboard, request.generationType);
    const job: StoredJob = {
      id,
      clientRequestId: request.clientRequestId,
      mode: request.mode,
      generationType: request.generationType,
      providerId: request.providerId,
      modelId: request.modelId,
      status: "queued",
      progress: 0,
      stage: "已入队 · 等待 Worker",
      prompt: request.prompt,
      params: request.params,
      inputs: request.inputs,
      storyboard,
      outputs: [],
      shots: storyboard.map((row, index) => ({
        order: row.order ?? index,
        status: "queued" as TaskStatus,
        progress: 0,
      })),
      estimatedTokens,
      usage: null,
      estimatedSeconds: estimateSeconds(request.mode, request.params, storyboard, request.generationType),
      error: null,
      projectId: request.projectId,
      sessionId: request.sessionId,
      createdAt: timestamp,
      startedAt: null,
      finishedAt: null,
      updatedAt: timestamp,
      internal: emptyInternal(),
    };
    db.prepare(
      `INSERT INTO generations
        (id, client_request_id, mode, generation_type, provider_id, model_id, status, progress, stage, prompt,
         params_json, inputs_json, storyboard_json, outputs_json, shots_json, estimated_tokens, usage_json, error_json,
         estimated_seconds, project_id, session_id, internal_json, created_at, started_at, finished_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      job.id,
      job.clientRequestId,
      job.mode,
      job.generationType,
      job.providerId,
      job.modelId,
      job.status,
      job.progress,
      job.stage,
      job.prompt,
      JSON.stringify(job.params),
      JSON.stringify(job.inputs),
      JSON.stringify(job.storyboard),
      JSON.stringify(job.outputs),
      JSON.stringify(job.shots),
      job.estimatedTokens,
      null,
      null,
      job.estimatedSeconds,
      job.projectId ?? null,
      job.sessionId ?? null,
      JSON.stringify(job.internal),
      job.createdAt,
      null,
      null,
      job.updatedAt
    );
    try {
      // Record which upload assets this task consumes; failure must not break
      // task creation. Startup reconciliation covers any missed rows.
      assetUsageStore.recordForJob(job);
    } catch {
      /* ignore */
    }
    this.emit(job);
    return job;
  }

  /** Raw jobs including internal state, for backfill and reconciliation. */
  listInternal(options: { status?: string; limit?: number } = {}): StoredJob[] {
    const limit = Math.min(500, options.limit || 200);
    const rows = options.status
      ? (db
          .prepare("SELECT * FROM generations WHERE status = ? ORDER BY created_at DESC LIMIT ?")
          .all(options.status, limit) as unknown as JobRow[])
      : (db.prepare("SELECT * FROM generations ORDER BY created_at DESC LIMIT ?").all(limit) as unknown as JobRow[]);
    return rows.map(rowToJob);
  }

  private emitterPayload(job: StoredJob) {
    const { internal: _internal, ...rest } = job;
    return rest as GenerationTask;
  }

  private emit(job: StoredJob) {
    const payload = this.emitterPayload(job);
    this.events.emit(job.id, payload);
    this.events.emit("any", payload);
  }

  private load(id: string): StoredJob | null {
    const row = db.prepare("SELECT * FROM generations WHERE id = ?").get(id) as JobRow | undefined;
    return row ? rowToJob(row) : null;
  }

  update(id: string, patch: Partial<GenerationTask> & { internal?: Partial<InternalJobState> }) {
    const job = this.load(id);
    if (!job) return null;
    const { internal, ...rest } = patch;
    Object.assign(job, rest);
    if (internal) Object.assign(job.internal, internal);
    job.updatedAt = now();
    this.write(job);
    this.emit(job);
    return job;
  }

  mutate(id: string, updater: (job: StoredJob) => void) {
    const job = this.load(id);
    if (!job) return null;
    updater(job);
    job.updatedAt = now();
    this.write(job);
    this.emit(job);
    return job;
  }

  raw(id: string): StoredJob | null {
    return this.load(id);
  }

  public(job: StoredJob): GenerationTask {
    const { internal: _internal, ...rest } = job;
    return rest;
  }

  get(id: string): GenerationTask | null {
    const job = this.load(id);
    return job ? this.public(job) : null;
  }

  findByClientRequestId(clientRequestId: string): StoredJob | null {
    const row = db
      .prepare("SELECT * FROM generations WHERE client_request_id = ?")
      .get(clientRequestId) as JobRow | undefined;
    return row ? rowToJob(row) : null;
  }

  list(
    options: { mode?: string; status?: string; projectId?: string; sessionId?: string; limit?: number } = {}
  ): GenerationTask[] {
    const clauses: string[] = [];
    const values: Array<string | number> = [];
    if (options.mode) {
      clauses.push("mode = ?");
      values.push(options.mode);
    }
    if (options.status) {
      clauses.push("status = ?");
      values.push(options.status);
    }
    if (options.projectId) {
      clauses.push("project_id = ?");
      values.push(options.projectId);
    }
    if (options.sessionId) {
      clauses.push("session_id = ?");
      values.push(options.sessionId);
    }
    const limit = Math.min(100, options.limit || 50);
    const sql = `SELECT * FROM generations ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`;
    const rows = db.prepare(sql).all(...values, limit) as unknown as JobRow[];
    return rows.map((row) => this.public(rowToJob(row)));
  }

  queued(limit = 10): StoredJob[] {
    const rows = db
      .prepare("SELECT * FROM generations WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?")
      .all(limit) as unknown as JobRow[];
    return rows.map(rowToJob).filter((job) => !job.internal.canceled);
  }

  cancel(id: string): GenerationTask | null {
    const job = this.load(id);
    if (!job) return null;
    if (isTerminal(job.status)) return this.public(job);
    // Idempotent: repeated cancel calls (UI button + agent cancellation) must
    // not re-emit progress events, otherwise subscribers can recurse forever.
    if (job.internal.canceled) return this.public(job);
    job.internal.canceled = true;
    job.internal.cancelRequestedAt = now();
    if (job.status === "queued") {
      job.status = "canceled";
      job.stage = "已取消";
      job.finishedAt = now();
    } else {
      job.stage = "正在取消 · 等待 Provider 停止";
    }
    job.updatedAt = now();
    this.write(job);
    this.emit(job);
    return this.public(job);
  }

  retry(id: string): GenerationTask | null {
    const job = this.load(id);
    if (!job || !isTerminal(job.status)) return null;
    job.status = "queued";
    job.progress = 0;
    job.stage = "已重新入队";
    job.outputs = [];
    job.error = null;
    job.startedAt = null;
    job.finishedAt = null;
    job.shots = job.shots.map((shot) => ({ order: shot.order, status: "queued", progress: 0 }));
    job.internal.canceled = false;
    job.internal.cancelRequestedAt = null;
    job.internal.providerTaskId = null;
    job.internal.shotProviderTaskIds = {};
    job.internal.attempts += 1;
    job.updatedAt = now();
    this.write(job);
    this.emit(job);
    return this.public(job);
  }

  addUsage(id: string, usage: TokenUsage) {
    const job = this.load(id);
    if (!job) return;
    if (!job.usage) {
      job.usage = { ...usage };
    } else {
      job.usage = {
        inputTokens: job.usage.inputTokens + usage.inputTokens,
        outputTokens: job.usage.outputTokens + usage.outputTokens,
        totalTokens: job.usage.totalTokens + usage.totalTokens,
        estimated: job.usage.estimated || usage.estimated,
        source: job.usage.estimated || usage.estimated ? "heuristic" : "provider",
      };
    }
    job.internal.usageEstimated = job.usage.estimated;
    job.updatedAt = now();
    this.write(job);
  }

  appendLog(id: string, message: string) {
    const job = this.load(id);
    if (!job) return;
    job.internal.logs.push({ at: now(), message });
    if (job.internal.logs.length > 80) job.internal.logs.shift();
    job.updatedAt = now();
    this.write(job);
  }

  usageSummary(projectId?: string): UsageSummary {
    const rows = (projectId
      ? db.prepare("SELECT status, usage_json FROM generations WHERE project_id = ?").all(projectId)
      : db.prepare("SELECT status, usage_json FROM generations").all()) as unknown as Array<{
      status: string;
      usage_json: string | null;
    }>;
    const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    for (const row of rows) {
      const parsed = parse<TokenUsage | null>(row.usage_json, null);
      if (!parsed) continue;
      usage.inputTokens += parsed.inputTokens;
      usage.outputTokens += parsed.outputTokens;
      usage.totalTokens += parsed.totalTokens;
    }
    return {
      ...usage,
      generations: rows.length,
      succeeded: rows.filter((row) => row.status === "succeeded").length,
      failed: rows.filter((row) => row.status === "failed").length,
    };
  }

  stats() {
    const rows = db.prepare("SELECT status, COUNT(*) AS count FROM generations GROUP BY status").all() as unknown as Array<{
      status: string;
      count: number;
    }>;
    const byStatus = new Map(rows.map((row) => [row.status, row.count]));
    return {
      total: rows.reduce((sum, row) => sum + row.count, 0),
      queued: byStatus.get("queued") || 0,
      running: ["submitting", "running", "postprocessing"].reduce((sum, status) => sum + (byStatus.get(status) || 0), 0),
      succeeded: byStatus.get("succeeded") || 0,
      failed: byStatus.get("failed") || 0,
    };
  }
}

export const jobStore = new JobStore();
