import type {
  GenerationMode,
  ModelInfo,
  ModelKind,
  ModelRoute,
  ModelSource,
  ModelStatus,
  ProviderCapabilities,
  ProviderInfo,
  ProviderKind,
} from "../../shared/contracts.js";
import { PROVIDER_CAPABILITIES } from "../../shared/contracts.js";
import { db, withTransaction } from "../db.js";

const now = () => new Date().toISOString();

interface ModelRow {
  provider_id: string;
  model_id: string;
  label: string;
  kind: ModelKind;
  modes_json: string;
  capabilities_json: string;
  source: ModelSource;
  enabled: number;
  user_edited: number;
  status: ModelStatus;
  last_synced_at: string | null;
  last_seen_at: string | null;
  last_used_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function parse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toModel(row: ModelRow): ModelInfo {
  return {
    providerId: row.provider_id,
    id: row.model_id,
    label: row.label || row.model_id,
    kind: row.kind,
    modes: parse<GenerationMode[]>(row.modes_json, []),
    capabilities: { ...PROVIDER_CAPABILITIES.ark, ...parse<Partial<ProviderCapabilities>>(row.capabilities_json, {}) },
    source: row.source,
    enabled: Boolean(row.enabled),
    status: row.status,
    lastSyncedAt: row.last_synced_at,
    lastSeenAt: row.last_seen_at,
    lastUsedAt: row.last_used_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const IMAGE_PATTERN = /(seedream|seededit|gpt-image|dall-e|dalle|flux|midjourney|stable-diffusion|sd3|sdxl|image)/;
const VIDEO_PATTERN = /(seedance|sora|veo|kling|runway|hunyuan-video|wanx|video)/;

/**
 * Best-effort classification from the remote model id. Anything ambiguous
 * stays "unknown" so the user has to confirm before it can be enabled.
 */
export function inferModelKind(modelId: string, providerKind: ProviderKind): {
  kind: ModelKind;
  confidence: "high" | "low";
} {
  const id = modelId.toLowerCase();
  const image = IMAGE_PATTERN.test(id);
  const video = VIDEO_PATTERN.test(id);
  if (image && !video) return { kind: "image", confidence: "high" };
  if (video && !image) return { kind: "video", confidence: "high" };
  if (providerKind === "mock") {
    if (id.includes("image")) return { kind: "image", confidence: "high" };
    if (id.includes("video")) return { kind: "video", confidence: "high" };
  }
  return { kind: "unknown", confidence: "low" };
}

export function modesFor(kind: ModelKind, providerKind: ProviderKind): GenerationMode[] {
  if (kind === "image") return ["text-to-image", "image-to-image"];
  if (kind === "video") {
    const caps = PROVIDER_CAPABILITIES[providerKind];
    return caps.multiImageToVideo
      ? ["text-to-video", "image-to-video", "multi-image-to-video"]
      : ["text-to-video", "image-to-video"];
  }
  return [];
}

/** Capability set narrowed to what a single image or video model can do. */
export function capabilitiesFor(kind: ModelKind, providerKind: ProviderKind): ProviderCapabilities {
  const base = PROVIDER_CAPABILITIES[providerKind];
  if (kind === "image") {
    return {
      ...base,
      textToImage: true,
      imageToImage: true,
      textToVideo: false,
      imageToVideo: false,
      multiImageToVideo: false,
      firstLastFrame: false,
      audio: false,
      animationModes: [],
      maxDurationSec: 0,
    };
  }
  if (kind === "video") {
    return {
      ...base,
      textToImage: false,
      imageToImage: false,
      textToVideo: true,
      imageToVideo: true,
      multiImageToVideo: base.multiImageToVideo,
      animationModes: base.animationModes,
    };
  }
  return {
    ...base,
    textToImage: false,
    imageToImage: false,
    textToVideo: false,
    imageToVideo: false,
    multiImageToVideo: false,
    firstLastFrame: false,
    audio: false,
    animationModes: [],
    maxImageCount: 0,
    maxDurationSec: 0,
  };
}

export interface ModelUpsertInput {
  providerId: string;
  modelId: string;
  label: string;
  kind: ModelKind;
  modes: GenerationMode[];
  capabilities: ProviderCapabilities;
  source: ModelSource;
  enabled: boolean;
  userEdited: boolean;
  status: ModelStatus;
  lastSyncedAt?: string | null;
  lastSeenAt?: string | null;
  lastError?: string | null;
}

export interface ModelPatch {
  label?: string;
  kind?: ModelKind;
  modes?: GenerationMode[];
  capabilities?: ProviderCapabilities;
  enabled?: boolean;
  status?: ModelStatus;
  lastError?: string | null;
  userEdited?: boolean;
}

export class ModelStore {
  private row(providerId: string, modelId: string): ModelRow | null {
    return (
      (db
        .prepare("SELECT * FROM provider_models WHERE provider_id = ? AND model_id = ?")
        .get(providerId, modelId) as ModelRow | undefined) || null
    );
  }

  list(filter: { providerId?: string; mode?: GenerationMode; enabled?: boolean; includeMissing?: boolean } = {}): ModelInfo[] {
    const clauses: string[] = [];
    const values: Array<string | number> = [];
    if (filter.providerId) {
      clauses.push("provider_id = ?");
      values.push(filter.providerId);
    }
    if (filter.enabled !== undefined) {
      clauses.push("enabled = ?");
      values.push(filter.enabled ? 1 : 0);
    }
    if (!filter.includeMissing) {
      clauses.push("status != 'missing'");
    }
    const sql = `SELECT * FROM provider_models ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY enabled DESC, kind, model_id`;
    const rows = db.prepare(sql).all(...values) as unknown as ModelRow[];
    let models = rows.map(toModel);
    if (filter.mode) {
      models = models.filter((model) => model.modes.includes(filter.mode!));
    }
    return models;
  }

  /** Includes missing rows; used by sync diffing and route warnings. */
  listRaw(providerId: string): Map<string, ModelInfo> {
    const rows = db.prepare("SELECT * FROM provider_models WHERE provider_id = ?").all(providerId) as unknown as ModelRow[];
    return new Map(rows.map((row) => [row.model_id, toModel(row)]));
  }

  find(providerId: string, modelId: string): ModelInfo | null {
    const row = this.row(providerId, modelId);
    return row ? toModel(row) : null;
  }

  count(providerId?: string): number {
    const row = providerId
      ? (db.prepare("SELECT COUNT(*) AS count FROM provider_models WHERE provider_id = ?").get(providerId) as { count: number })
      : (db.prepare("SELECT COUNT(*) AS count FROM provider_models").get() as { count: number });
    return row.count;
  }

  upsert(input: ModelUpsertInput): ModelInfo {
    const timestamp = now();
    // Sync must never overwrite user-edited entries: keep the user's label,
    // kind, modes, capabilities and source; only refresh sync bookkeeping.
    const existing = this.row(input.providerId, input.modelId);
    const preserved = existing && Boolean(existing.user_edited);
    const label = preserved ? existing!.label : input.label;
    const kind = preserved ? existing!.kind : input.kind;
    const modesJson = preserved ? existing!.modes_json : JSON.stringify(input.modes);
    const capabilitiesJson = preserved ? existing!.capabilities_json : JSON.stringify(input.capabilities);
    const source = preserved ? existing!.source : input.source;
    const enabled = preserved ? existing!.enabled : input.enabled ? 1 : 0;
    db.prepare(
      `INSERT INTO provider_models
        (provider_id, model_id, label, kind, modes_json, capabilities_json, source, enabled, user_edited,
         status, last_synced_at, last_seen_at, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider_id, model_id) DO UPDATE SET
         label = excluded.label,
         kind = excluded.kind,
         modes_json = excluded.modes_json,
         capabilities_json = excluded.capabilities_json,
         source = excluded.source,
         enabled = excluded.enabled,
         status = excluded.status,
         last_synced_at = COALESCE(excluded.last_synced_at, provider_models.last_synced_at),
         last_seen_at = COALESCE(excluded.last_seen_at, provider_models.last_seen_at),
         updated_at = excluded.updated_at`
    ).run(
      input.providerId,
      input.modelId,
      label,
      kind,
      modesJson,
      capabilitiesJson,
      source,
      enabled,
      preserved ? 1 : input.userEdited ? 1 : 0,
      input.status,
      input.lastSyncedAt ?? null,
      input.lastSeenAt ?? null,
      input.lastError ?? null,
      timestamp,
      timestamp
    );
    return this.find(input.providerId, input.modelId)!;
  }

  update(providerId: string, modelId: string, patch: ModelPatch): ModelInfo | null {
    const current = this.row(providerId, modelId);
    if (!current) return null;
    const kind = patch.kind ?? current.kind;
    const label = patch.label ?? current.label;
    const modes = patch.modes ?? parse<GenerationMode[]>(current.modes_json, []);
    const capabilities = patch.capabilities ?? parse<ProviderCapabilities>(current.capabilities_json, PROVIDER_CAPABILITIES.ark);
    const enabled = patch.enabled ?? Boolean(current.enabled);
    const status = patch.status ?? current.status;
    const userEdited = patch.userEdited ?? true;
    db.prepare(
      `UPDATE provider_models SET
         label = ?, kind = ?, modes_json = ?, capabilities_json = ?, enabled = ?, status = ?,
         user_edited = ?, last_error = COALESCE(?, last_error), updated_at = ?
       WHERE provider_id = ? AND model_id = ?`
    ).run(
      label,
      kind,
      JSON.stringify(modes),
      JSON.stringify(capabilities),
      enabled ? 1 : 0,
      status,
      userEdited ? 1 : 0,
      patch.lastError ?? null,
      now(),
      providerId,
      modelId
    );
    return this.find(providerId, modelId);
  }

  setEnabled(providerId: string, modelIds: string[], enabled: boolean): number {
    return withTransaction(() => {
      const update = db.prepare(
        "UPDATE provider_models SET enabled = ?, updated_at = ? WHERE provider_id = ? AND model_id = ?"
      );
      let changed = 0;
      for (const modelId of modelIds) {
        const result = update.run(enabled ? 1 : 0, now(), providerId, modelId);
        changed += Number(result.changes);
      }
      return changed;
    });
  }

  markMissing(providerId: string, modelId: string, at: string) {
    db.prepare(
      "UPDATE provider_models SET status = 'missing', enabled = 0, updated_at = ? WHERE provider_id = ? AND model_id = ?"
    ).run(at, providerId, modelId);
  }

  markUsed(providerId: string, modelId: string) {
    db.prepare("UPDATE provider_models SET last_used_at = ?, updated_at = ? WHERE provider_id = ? AND model_id = ?").run(
      now(),
      now(),
      providerId,
      modelId
    );
  }

  remove(providerId: string, modelId: string): boolean {
    const routed = db
      .prepare("SELECT mode FROM model_routes WHERE provider_id = ? AND model_id = ?")
      .get(providerId, modelId) as { mode: string } | undefined;
    if (routed) {
      throw new Error(`MODEL_IN_USE: 该模型是「${routed.mode}」的默认模型，请先修改路由`);
    }
    const result = db.prepare("DELETE FROM provider_models WHERE provider_id = ? AND model_id = ?").run(providerId, modelId);
    return Number(result.changes) > 0;
  }

  /** Seed catalog entries from the provider's configured image/video models. */
  seedFromProvider(provider: ProviderInfo) {
    const existing = this.count(provider.id);
    const entries: Array<{ id: string; kind: ModelKind }> = [
      { id: provider.imageModel, kind: "image" },
      { id: provider.videoModel, kind: "video" },
    ];
    const timestamp = now();
    for (const entry of entries) {
      if (!entry.id) continue;
      if (this.row(provider.id, entry.id)) continue;
      this.upsert({
        providerId: provider.id,
        modelId: entry.id,
        label: entry.id,
        kind: entry.kind,
        modes: modesFor(entry.kind, provider.kind),
        capabilities: capabilitiesFor(entry.kind, provider.kind),
        source: "seed",
        enabled: true,
        userEdited: false,
        status: "ready",
        lastSeenAt: existing === 0 ? timestamp : null,
      });
    }
  }

  listRoutes(): ModelRoute[] {
    const modes: GenerationMode[] = [
      "text-to-image",
      "text-to-video",
      "image-to-image",
      "image-to-video",
      "multi-image-to-video",
    ];
    return modes.map((mode) => this.resolveRoute(mode));
  }

  resolveRoute(mode: GenerationMode): ModelRoute {
    const row = db.prepare("SELECT * FROM model_routes WHERE mode = ?").get(mode) as
      | { mode: string; provider_id: string; model_id: string; updated_at: string }
      | undefined;
    if (!row) {
      return { mode, providerId: "", modelId: "", model: null, warning: "未设置默认模型", updatedAt: null };
    }
    const model = this.find(row.provider_id, row.model_id);
    const warning = !model
      ? "路由模型不存在，请重新选择"
      : !model.enabled
        ? "路由模型已停用"
        : model.status === "missing"
          ? "路由模型已下架"
          : !model.modes.includes(mode)
            ? "路由模型不支持当前模式"
            : null;
    return {
      mode,
      providerId: row.provider_id,
      modelId: row.model_id,
      model,
      warning,
      updatedAt: row.updated_at,
    };
  }

  setRoute(mode: GenerationMode, providerId: string, modelId: string): ModelRoute {
    db.prepare(
      `INSERT INTO model_routes (mode, provider_id, model_id, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(mode) DO UPDATE SET provider_id = excluded.provider_id, model_id = excluded.model_id, updated_at = excluded.updated_at`
    ).run(mode, providerId, modelId, now());
    return this.resolveRoute(mode);
  }
}

export const modelStore = new ModelStore();
