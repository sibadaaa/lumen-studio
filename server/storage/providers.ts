import path from "node:path";
import {
  PROVIDER_CAPABILITIES,
  type ProviderConfigInput,
  type ProviderInfo,
  type ProviderKind,
} from "../../shared/contracts.js";
import { config } from "../config.js";
import { db, getSetting, setSetting } from "../db.js";
import { getVault, maskSecret } from "../security/vault.js";

interface ProviderRow {
  id: string;
  kind: ProviderKind;
  base_url: string;
  image_model: string;
  video_model: string;
  key_encrypted: string;
  updated_at: string | null;
  last_tested_at: string | null;
  last_latency_ms: number | null;
}

interface ProviderDefault {
  id: string;
  kind: ProviderKind;
  label: string;
  baseUrl: string;
  imageModel: string;
  videoModel: string;
}

export const PROVIDER_DEFAULTS: Record<string, ProviderDefault> = {
  ark: {
    id: "ark",
    kind: "ark",
    label: "火山方舟",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    imageModel: "doubao-seedream-4-0-250828",
    videoModel: "doubao-seedance-1-0-pro-250528",
  },
  openai: {
    id: "openai",
    kind: "openai_compatible",
    label: "OpenAI 兼容",
    baseUrl: "https://api.openai.com/v1",
    imageModel: "gpt-image-1",
    videoModel: "sora-2",
  },
  custom: {
    id: "custom",
    kind: "openai_compatible",
    label: "自定义网关",
    baseUrl: "http://127.0.0.1:8080/v1",
    imageModel: "custom-image-model",
    videoModel: "custom-video-model",
  },
  mock: {
    id: "mock",
    kind: "mock",
    label: "本地演示",
    baseUrl: "local://mock",
    imageModel: "lumen-mock-image",
    videoModel: "lumen-mock-video",
  },
};

export interface ResolvedProvider extends ProviderInfo {
  apiKey: string;
}

const now = () => new Date().toISOString();

export class ProviderStore {
  constructor() {
    this.bootstrap();
  }

  private row(id: string): ProviderRow | null {
    return (db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as ProviderRow | undefined) || null;
  }

  private rows(): ProviderRow[] {
    return db.prepare("SELECT * FROM providers").all() as unknown as ProviderRow[];
  }

  private upsert(record: {
    id: string;
    kind: ProviderKind;
    baseUrl: string;
    imageModel: string;
    videoModel: string;
    keyEncrypted: string;
    lastTestedAt?: string | null;
    lastLatencyMs?: number | null;
  }) {
    db.prepare(
      `INSERT INTO providers (id, kind, base_url, image_model, video_model, key_encrypted, updated_at, last_tested_at, last_latency_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind,
         base_url = excluded.base_url,
         image_model = excluded.image_model,
         video_model = excluded.video_model,
         key_encrypted = excluded.key_encrypted,
         updated_at = excluded.updated_at,
         last_tested_at = COALESCE(excluded.last_tested_at, providers.last_tested_at),
         last_latency_ms = COALESCE(excluded.last_latency_ms, providers.last_latency_ms)`
    ).run(
      record.id,
      record.kind,
      record.baseUrl,
      record.imageModel,
      record.videoModel,
      record.keyEncrypted,
      now(),
      record.lastTestedAt ?? null,
      record.lastLatencyMs ?? null
    );
  }

  /** Env bootstrap is for the workspace database only, so test databases stay on mock. */
  private usesWorkspaceData() {
    return path.resolve(config.dataDir) === path.resolve(config.rootDir, "data");
  }

  /**
   * Import the custom OpenAI-compatible gateway from CUSTOM_* env vars.
   * A saved key is left untouched so later edits in the API dialog win.
   */
  private importCustomFromEnv() {
    if (!this.usesWorkspaceData()) return false;
    const apiKey = (process.env.CUSTOM_API_KEY || "").trim();
    if (!apiKey) return false;
    const existing = this.row("custom");
    if (existing && this.isConfigured(existing)) return false;
    const def = PROVIDER_DEFAULTS.custom;
    const imageModel = (process.env.CUSTOM_IMAGE_MODEL || def.imageModel).trim();
    const videoModel = (process.env.CUSTOM_VIDEO_MODEL || def.videoModel).trim();
    if (!imageModel || !videoModel) return false;
    this.upsert({
      id: "custom",
      kind: "openai_compatible",
      baseUrl: (process.env.CUSTOM_BASE_URL || def.baseUrl).trim().replace(/\/$/, ""),
      imageModel,
      videoModel,
      keyEncrypted: getVault().encrypt(apiKey),
    });
    const activeId = getSetting("active_provider_id");
    if (!activeId || activeId === "mock") setSetting("active_provider_id", "custom");
    return true;
  }

  private bootstrap() {
    const count = this.rows().length;
    const envKey = (process.env.ARK_API_KEY || "").trim();

    if (count === 0) {
      if (envKey) {
        const def = PROVIDER_DEFAULTS.ark;
        this.upsert({
          id: "ark",
          kind: "ark",
          baseUrl: (process.env.ARK_BASE_URL || def.baseUrl).replace(/\/$/, ""),
          imageModel: process.env.ARK_IMAGE_MODEL || def.imageModel,
          videoModel: process.env.ARK_VIDEO_MODEL || def.videoModel,
          keyEncrypted: getVault().encrypt(envKey),
        });
        setSetting("active_provider_id", "ark");
      } else if (config.defaultProvider === "mock") {
        const def = PROVIDER_DEFAULTS.mock;
        this.upsert({
          id: "mock",
          kind: "mock",
          baseUrl: def.baseUrl,
          imageModel: def.imageModel,
          videoModel: def.videoModel,
          keyEncrypted: "",
        });
        setSetting("active_provider_id", "mock");
      }
    }

    this.importCustomFromEnv();

    const activeId = getSetting("active_provider_id");
    if (activeId && !this.row(activeId)) setSetting("active_provider_id", null);
    if (!getSetting("active_provider_id")) {
      const configured = this.rows().find((row) => this.isConfigured(row));
      if (configured) setSetting("active_provider_id", configured.id);
    }
  }

  private isConfigured(row: ProviderRow) {
    if (row.kind === "mock") return true;
    return Boolean(row.key_encrypted && row.base_url && row.image_model && row.video_model);
  }

  private decryptKey(row: ProviderRow) {
    if (!row.key_encrypted) return "";
    try {
      return getVault().decrypt(row.key_encrypted);
    } catch (error) {
      console.error(`[providers] cannot decrypt key for ${row.id}:`, (error as Error).message);
      return "";
    }
  }

  private toInfo(row: ProviderRow): ProviderInfo {
    const fallback = PROVIDER_DEFAULTS[row.id];
    const secret = this.decryptKey(row);
    return {
      id: row.id,
      kind: row.kind,
      label: fallback?.label || row.id,
      baseUrl: row.base_url,
      keyMasked: row.kind === "mock" ? "local-only" : maskSecret(secret),
      imageModel: row.image_model,
      videoModel: row.video_model,
      capabilities: PROVIDER_CAPABILITIES[row.kind],
      configured: this.isConfigured(row),
      encrypted: Boolean(row.key_encrypted),
      lastTestedAt: row.last_tested_at,
      lastLatencyMs: row.last_latency_ms,
      updatedAt: row.updated_at,
    };
  }

  list(): ProviderInfo[] {
    const stored = new Map(this.rows().map((row) => [row.id, row]));
    const ids = new Set<string>([...Object.keys(PROVIDER_DEFAULTS), ...stored.keys()]);
    return [...ids].map((id) => {
      const row = stored.get(id);
      if (row) return this.toInfo(row);
      const def = PROVIDER_DEFAULTS[id];
      return {
        id,
        kind: def.kind,
        label: def.label,
        baseUrl: def.baseUrl,
        keyMasked: "",
        imageModel: def.imageModel,
        videoModel: def.videoModel,
        capabilities: PROVIDER_CAPABILITIES[def.kind],
        configured: false,
        encrypted: false,
        lastTestedAt: null,
        lastLatencyMs: null,
        updatedAt: null,
      } satisfies ProviderInfo;
    });
  }

  get(id: string): ProviderInfo | null {
    return this.list().find((provider) => provider.id === id) || null;
  }

  getResolved(id: string): ResolvedProvider | null {
    const row = this.row(id);
    if (row) return { ...this.toInfo(row), apiKey: this.decryptKey(row) };
    const fallback = this.list().find((provider) => provider.id === id);
    if (fallback) return { ...fallback, apiKey: "" };
    return null;
  }

  active(): ProviderInfo | null {
    const id = this.activeId;
    return id ? this.get(id) : null;
  }

  get activeId() {
    return getSetting("active_provider_id");
  }

  setActive(id: string) {
    if (!this.row(id)) throw new Error(`Provider ${id} is not configured`);
    setSetting("active_provider_id", id);
  }

  save(id: string, input: ProviderConfigInput): ProviderInfo {
    if (!/^[a-z0-9_-]{1,32}$/.test(id)) throw new Error("invalid provider id");
    const existing = this.row(id);
    const kind = input.kind;
    const baseUrl = kind === "mock" ? "local://mock" : input.baseUrl.trim().replace(/\/$/, "");
    if (kind !== "mock") {
      let parsed: URL;
      try {
        parsed = new URL(baseUrl);
      } catch {
        throw new Error("Base URL 不是合法 URL");
      }
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Base URL 必须使用 http(s)");
    }
    const imageModel = kind === "mock" ? "lumen-mock-image" : input.imageModel.trim();
    const videoModel = kind === "mock" ? "lumen-mock-video" : input.videoModel.trim();
    if (kind !== "mock" && (!imageModel || !videoModel)) throw new Error("图像模型和视频模型不能为空");

    let keyEncrypted = existing?.key_encrypted || "";
    if (kind !== "mock") {
      if (input.apiKey?.trim()) {
        if (input.apiKey.trim().length < 8) throw new Error("API Key 至少 8 个字符");
        keyEncrypted = getVault().encrypt(input.apiKey.trim());
      }
      if (!keyEncrypted) throw new Error("首次配置必须填写 API Key");
    } else {
      keyEncrypted = "";
    }

    this.upsert({
      id,
      kind,
      baseUrl,
      imageModel,
      videoModel,
      keyEncrypted,
      lastTestedAt: existing?.last_tested_at ?? null,
      lastLatencyMs: existing?.last_latency_ms ?? null,
    });
    setSetting("active_provider_id", id);
    return this.get(id)!;
  }

  markTested(id: string, latencyMs: number) {
    db.prepare("UPDATE providers SET last_tested_at = ?, last_latency_ms = ? WHERE id = ?").run(
      now(),
      Math.round(latencyMs),
      id
    );
  }

  markModelsSynced(id: string, at: string | null, error: string | null) {
    db.prepare("UPDATE providers SET models_synced_at = ?, models_sync_error = ? WHERE id = ?").run(at, error, id);
  }

  clear(id: string) {
    db.prepare("DELETE FROM providers WHERE id = ?").run(id);
    if (this.activeId === id) {
      const next = this.rows().find((row) => this.isConfigured(row));
      setSetting("active_provider_id", next?.id ?? null);
    }
  }

  rawCiphertext(id: string) {
    return this.row(id)?.key_encrypted || "";
  }
}

export const providerStore = new ProviderStore();
