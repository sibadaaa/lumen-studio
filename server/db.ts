import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config, paths } from "./config.js";

export const dbPath = path.join(config.dataDir, "lumen.db");

fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });

export const db = new DatabaseSync(dbPath);

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA busy_timeout = 5000;");
db.exec("PRAGMA synchronous = NORMAL;");
try {
  fs.chmodSync(dbPath, 0o600);
} catch {
  /* best effort */
}

const now = () => new Date().toISOString();

function transaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw error;
  }
}

const SCHEMA_VERSION = 4;

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const row = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number | null };
  const current = row?.version || 0;
  if (current >= SCHEMA_VERSION) return;

  transaction(() => {
    if (current < 1) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS providers (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          base_url TEXT NOT NULL,
          image_model TEXT NOT NULL,
          video_model TEXT NOT NULL,
          key_encrypted TEXT NOT NULL DEFAULT '',
          updated_at TEXT,
          last_tested_at TEXT,
          last_latency_ms INTEGER
        );

        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          cover_url TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS assets (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          mime TEXT NOT NULL,
          size INTEGER NOT NULL,
          width INTEGER,
          height INTEGER,
          duration_sec REAL,
          url TEXT NOT NULL,
          thumbnail_url TEXT,
          original_name TEXT,
          project_id TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS generations (
          id TEXT PRIMARY KEY,
          client_request_id TEXT NOT NULL UNIQUE,
          mode TEXT NOT NULL,
          generation_type TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          model_id TEXT NOT NULL,
          status TEXT NOT NULL,
          progress INTEGER NOT NULL DEFAULT 0,
          stage TEXT NOT NULL DEFAULT '',
          prompt TEXT NOT NULL DEFAULT '',
          params_json TEXT NOT NULL DEFAULT '{}',
          inputs_json TEXT NOT NULL DEFAULT '[]',
          storyboard_json TEXT NOT NULL DEFAULT '[]',
          outputs_json TEXT NOT NULL DEFAULT '[]',
          shots_json TEXT NOT NULL DEFAULT '[]',
          estimated_tokens INTEGER NOT NULL DEFAULT 0,
          usage_json TEXT,
          error_json TEXT,
          estimated_seconds INTEGER NOT NULL DEFAULT 0,
          project_id TEXT,
          session_id TEXT,
          internal_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_generations_status ON generations(status, created_at);
        CREATE INDEX IF NOT EXISTS idx_generations_project ON generations(project_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_generations_session ON generations(session_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS agent_sessions (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          title TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'idle',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_project ON agent_sessions(project_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS agent_messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          role TEXT NOT NULL,
          text TEXT NOT NULL DEFAULT '',
          data_json TEXT,
          created_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_seq ON agent_messages(session_id, seq);

        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL,
          session_id TEXT,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(1, now());
    }

    if (current < 2) {
      db.exec(`
        ALTER TABLE providers ADD COLUMN models_synced_at TEXT;
        ALTER TABLE providers ADD COLUMN models_sync_error TEXT;

        CREATE TABLE IF NOT EXISTS provider_models (
          provider_id   TEXT NOT NULL,
          model_id      TEXT NOT NULL,
          label         TEXT NOT NULL DEFAULT '',
          kind          TEXT NOT NULL DEFAULT 'unknown',
          modes_json    TEXT NOT NULL DEFAULT '[]',
          capabilities_json TEXT NOT NULL DEFAULT '{}',
          source        TEXT NOT NULL DEFAULT 'discovered',
          enabled       INTEGER NOT NULL DEFAULT 0,
          user_edited   INTEGER NOT NULL DEFAULT 0,
          status        TEXT NOT NULL DEFAULT 'unverified',
          last_synced_at TEXT,
          last_seen_at  TEXT,
          last_used_at  TEXT,
          last_error    TEXT,
          created_at    TEXT NOT NULL,
          updated_at    TEXT NOT NULL,
          PRIMARY KEY (provider_id, model_id)
        );
        CREATE INDEX IF NOT EXISTS idx_provider_models_provider
          ON provider_models(provider_id, enabled, kind);
        CREATE INDEX IF NOT EXISTS idx_provider_models_status
          ON provider_models(status);

        CREATE TABLE IF NOT EXISTS model_routes (
          mode          TEXT PRIMARY KEY,
          provider_id   TEXT NOT NULL,
          model_id      TEXT NOT NULL,
          updated_at    TEXT NOT NULL
        );
      `);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(2, now());
    }

    if (current < 3) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS works (
          id             TEXT PRIMARY KEY,
          generation_id  TEXT NOT NULL,
          attempt        INTEGER NOT NULL DEFAULT 0,
          output_index   INTEGER NOT NULL DEFAULT 0,
          output_id      TEXT,
          kind           TEXT NOT NULL,
          mime           TEXT NOT NULL,
          size           INTEGER NOT NULL DEFAULT 0,
          width          INTEGER,
          height         INTEGER,
          duration_sec   REAL,
          url            TEXT NOT NULL,
          thumbnail_url  TEXT,
          title          TEXT NOT NULL DEFAULT '',
          prompt         TEXT NOT NULL DEFAULT '',
          mode           TEXT NOT NULL,
          provider_id    TEXT NOT NULL,
          model_id       TEXT NOT NULL,
          params_json    TEXT NOT NULL DEFAULT '{}',
          inputs_json    TEXT NOT NULL DEFAULT '[]',
          storyboard_json TEXT NOT NULL DEFAULT '[]',
          usage_tokens   INTEGER NOT NULL DEFAULT 0,
          usage_estimated INTEGER NOT NULL DEFAULT 0,
          project_id     TEXT,
          session_id     TEXT,
          source         TEXT NOT NULL DEFAULT 'studio',
          favorite       INTEGER NOT NULL DEFAULT 0,
          deleted_at     TEXT,
          created_at     TEXT NOT NULL,
          updated_at     TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_works_generation_attempt_output
          ON works(generation_id, attempt, output_index);
        CREATE INDEX IF NOT EXISTS idx_works_created
          ON works(deleted_at, created_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_works_project
          ON works(project_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_works_mode
          ON works(mode, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_works_model
          ON works(provider_id, model_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_works_favorite
          ON works(favorite, created_at DESC);
      `);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(3, now());
    }

    if (current < 4) {
      db.exec(`
        ALTER TABLE assets ADD COLUMN sha256 TEXT;
        ALTER TABLE assets ADD COLUMN source TEXT NOT NULL DEFAULT 'upload';
        ALTER TABLE assets ADD COLUMN source_ref TEXT;
        ALTER TABLE assets ADD COLUMN updated_at TEXT;
        ALTER TABLE assets ADD COLUMN deleted_at TEXT;

        UPDATE assets SET updated_at = created_at WHERE updated_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_assets_created
          ON assets(deleted_at, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_assets_sha256
          ON assets(sha256);
        CREATE INDEX IF NOT EXISTS idx_assets_source
          ON assets(source, source_ref);

        CREATE TABLE IF NOT EXISTS asset_tags (
          asset_id   TEXT NOT NULL,
          tag        TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (asset_id, tag)
        );
        CREATE INDEX IF NOT EXISTS idx_asset_tags_tag ON asset_tags(tag);

        CREATE TABLE IF NOT EXISTS asset_usages (
          asset_id      TEXT NOT NULL,
          generation_id TEXT NOT NULL,
          role          TEXT NOT NULL,
          created_at    TEXT NOT NULL,
          PRIMARY KEY (asset_id, generation_id, role)
        );
        CREATE INDEX IF NOT EXISTS idx_asset_usages_asset ON asset_usages(asset_id);
        CREATE INDEX IF NOT EXISTS idx_asset_usages_generation ON asset_usages(generation_id);
      `);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(4, now());
    }
  });
}

migrate();

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string | null) {
  if (value === null) {
    db.prepare("DELETE FROM settings WHERE key = ?").run(key);
    return;
  }
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

export function withTransaction<T>(fn: () => T): T {
  return transaction(fn);
}

export function tableCount(table: string): number {
  const allowed = new Set([
    "providers",
    "projects",
    "assets",
    "generations",
    "agent_sessions",
    "agent_messages",
    "provider_models",
    "model_routes",
    "works",
    "asset_tags",
    "asset_usages",
  ]);
  if (!allowed.has(table)) throw new Error(`unknown table ${table}`);
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

export function recordEvent(kind: string, sessionId: string | null, payload: unknown) {
  db.prepare("INSERT INTO events (kind, session_id, payload_json, created_at) VALUES (?, ?, ?, ?)").run(
    kind,
    sessionId,
    JSON.stringify(payload),
    now()
  );
}

export interface ImportReport {
  providers: number;
  assets: number;
  generations: number;
  projects: number;
  sessions: number;
}

/**
 * One-time import of the pre-SQLite JSON stores. Files are renamed with a
 * `.migrated` suffix rather than deleted so a failed import can be inspected.
 */
export function importLegacyJson(): ImportReport {
  const report: ImportReport = { providers: 0, assets: 0, generations: 0, projects: 0, sessions: 0 };

  const renameMigrated = (file: string) => {
    try {
      if (fs.existsSync(file)) fs.renameSync(file, `${file}.migrated`);
    } catch {
      /* ignore */
    }
  };

  if (tableCount("providers") === 0 && fs.existsSync(paths.providers)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(paths.providers, "utf8")) as {
        activeProviderId?: string | null;
        providers?: Record<
          string,
          {
            id: string;
            kind: string;
            baseUrl: string;
            imageModel: string;
            videoModel: string;
            keyEncrypted: string;
            updatedAt?: string;
            lastTestedAt?: string | null;
            lastLatencyMs?: number | null;
          }
        >;
      };
      transaction(() => {
        const insert = db.prepare(`
          INSERT OR REPLACE INTO providers
            (id, kind, base_url, image_model, video_model, key_encrypted, updated_at, last_tested_at, last_latency_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const provider of Object.values(parsed.providers || {})) {
          insert.run(
            provider.id,
            provider.kind,
            provider.baseUrl,
            provider.imageModel,
            provider.videoModel,
            provider.keyEncrypted || "",
            provider.updatedAt || now(),
            provider.lastTestedAt || null,
            provider.lastLatencyMs ?? null
          );
          report.providers += 1;
        }
        if (parsed.activeProviderId) setSetting("active_provider_id", parsed.activeProviderId);
      });
      renameMigrated(paths.providers);
    } catch (error) {
      console.error("[db] providers.json import failed:", (error as Error).message);
    }
  }

  const legacyAssets = path.join(paths.assets, "assets.json");
  if (tableCount("assets") === 0 && fs.existsSync(legacyAssets)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(legacyAssets, "utf8")) as {
        items?: Record<string, Record<string, unknown>>;
      };
      transaction(() => {
        const insert = db.prepare(`
          INSERT OR REPLACE INTO assets
            (id, kind, mime, size, width, height, duration_sec, url, thumbnail_url, original_name, project_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const asset of Object.values(parsed.items || {})) {
          insert.run(
            String(asset.id),
            String(asset.kind || "image"),
            String(asset.mime || "image/jpeg"),
            Number(asset.size || 0),
            asset.width ? Number(asset.width) : null,
            asset.height ? Number(asset.height) : null,
            asset.durationSec ? Number(asset.durationSec) : null,
            String(asset.url || ""),
            asset.thumbnailUrl ? String(asset.thumbnailUrl) : null,
            asset.originalName ? String(asset.originalName) : null,
            null,
            String(asset.createdAt || now())
          );
          report.assets += 1;
        }
      });
      renameMigrated(legacyAssets);
    } catch (error) {
      console.error("[db] assets.json import failed:", (error as Error).message);
    }
  }

  if (tableCount("generations") === 0 && fs.existsSync(paths.jobs)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(paths.jobs, "utf8")) as {
        items?: Record<string, Record<string, unknown>>;
      };
      transaction(() => {
        const insert = db.prepare(`
          INSERT OR REPLACE INTO generations
            (id, client_request_id, mode, generation_type, provider_id, model_id, status, progress, stage, prompt,
             params_json, inputs_json, storyboard_json, outputs_json, shots_json, estimated_tokens, usage_json,
             error_json, estimated_seconds, project_id, session_id, internal_json, created_at, started_at, finished_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const job of Object.values(parsed.items || {})) {
          insert.run(
            String(job.id),
            String(job.clientRequestId),
            String(job.mode),
            String(job.generationType || "single"),
            String(job.providerId),
            String(job.modelId || ""),
            String(job.status || "queued"),
            Number(job.progress || 0),
            String(job.stage || ""),
            String(job.prompt || ""),
            JSON.stringify(job.params || {}),
            JSON.stringify(job.inputs || []),
            JSON.stringify(job.storyboard || []),
            JSON.stringify(job.outputs || []),
            JSON.stringify(job.shots || []),
            Number(job.estimatedTokens || 0),
            job.usage ? JSON.stringify(job.usage) : null,
            job.error ? JSON.stringify(job.error) : null,
            Number(job.estimatedSeconds || 0),
            null,
            null,
            JSON.stringify(job.internal || {}),
            String(job.createdAt || now()),
            (job.startedAt as string) || null,
            (job.finishedAt as string) || null,
            String(job.updatedAt || now())
          );
          report.generations += 1;
        }
      });
      renameMigrated(paths.jobs);
    } catch (error) {
      console.error("[db] jobs.json import failed:", (error as Error).message);
    }
  }

  // Seed a local workspace project when the database is brand new, so the
  // React shell always has something real to open.
  if (tableCount("projects") === 0) {
    const seeds = [
      {
        id: "proj_product",
        name: "产品短片",
        description: "15 秒竖屏产品广告 · 4 个镜头 · 黑场转场",
        cover: "/assets/1470071459604-3b5ec3a7fe05.jpg",
        status: "active",
      },
      {
        id: "proj_glass",
        name: "雾中玻璃仪式",
        description: "分镜实验 · 3 个镜头 · 柔和溶解",
        cover: "/assets/1541701494587-cb58502866ab.jpg",
        status: "active",
      },
      {
        id: "proj_perfume",
        name: "香水瓶场景图",
        description: "4 张电商场景 · 2K",
        cover: "/assets/1618005198919-d3d4b5a92ead.jpg",
        status: "archived",
      },
    ];
    const insert = db.prepare(
      "INSERT INTO projects (id, name, description, cover_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    transaction(() => {
      for (const seed of seeds) {
        insert.run(seed.id, seed.name, seed.description, seed.cover, seed.status, now(), now());
        report.projects += 1;
      }
    });
  }

  return report;
}

export const imported = importLegacyJson();
if (imported.providers || imported.assets || imported.generations || imported.projects) {
  console.log(
    `[db] imported legacy JSON → SQLite (providers=${imported.providers}, assets=${imported.assets}, jobs=${imported.generations}, projects=${imported.projects})`
  );
}

export function dbStats() {
  return {
    path: dbPath,
    providers: tableCount("providers"),
    projects: tableCount("projects"),
    assets: tableCount("assets"),
    generations: tableCount("generations"),
    sessions: tableCount("agent_sessions"),
    messages: tableCount("agent_messages"),
    models: tableCount("provider_models"),
    works: tableCount("works"),
  };
}
