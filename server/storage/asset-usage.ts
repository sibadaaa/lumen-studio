import type { AssetRole, GenerationMode, GenerationTask, MediaAsset } from "../../shared/contracts.js";
import { db } from "../db.js";
import { assetStore } from "./assets.js";

const now = () => new Date().toISOString();

export interface AssetUsageRow {
  assetId: string;
  generationId: string;
  workId?: string;
  mode: GenerationMode;
  role: AssetRole;
  createdAt: string;
  thumbnailUrl?: string;
}

const ACTIVE_STATUSES = ["queued", "submitting", "running", "postprocessing"];

/**
 * Tracks which upload assets a generation task consumed, so the asset library
 * can show references and guard deletes. Insert-only and idempotent.
 */
export class AssetUsageStore {
  recordForJob(job: GenerationTask) {
    const pairs = new Map<string, AssetRole>();
    const add = (assetId: string | undefined, role: AssetRole) => {
      if (!assetId) return;
      if (!pairs.has(assetId)) pairs.set(assetId, role);
    };
    for (const input of job.inputs || []) {
      add(input.assetId, input.role);
    }
    for (const row of job.storyboard || []) {
      if (row.assetId) {
        add(row.assetId, "shot");
        continue;
      }
      if (row.imageUrl) {
        const asset = assetStore.findByUrl(row.imageUrl);
        if (asset) add(asset.id, "shot");
      }
    }
    if (pairs.size === 0) return;
    const insert = db.prepare(
      "INSERT OR IGNORE INTO asset_usages (asset_id, generation_id, role, created_at) VALUES (?, ?, ?, ?)"
    );
    for (const [assetId, role] of pairs) {
      try {
        insert.run(assetId, job.id, role, now());
      } catch {
        /* ignore single failures; startup reconciliation retries */
      }
    }
  }

  countForAsset(assetId: string): number {
    const row = db.prepare("SELECT COUNT(*) AS count FROM asset_usages WHERE asset_id = ?").get(assetId) as {
      count: number;
    };
    return row.count;
  }

  countRunning(assetId: string): number {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count FROM asset_usages u
         JOIN generations g ON g.id = u.generation_id
         WHERE u.asset_id = ? AND g.status IN (${ACTIVE_STATUSES.map(() => "?").join(",")})`
      )
      .get(assetId, ...ACTIVE_STATUSES) as { count: number };
    return row.count;
  }

  listForAsset(assetId: string): AssetUsageRow[] {
    const rows = db
      .prepare(
        `SELECT u.asset_id, u.generation_id, u.role, u.created_at, g.mode,
                w.id AS work_id, w.thumbnail_url AS thumbnail_url
         FROM asset_usages u
         JOIN generations g ON g.id = u.generation_id
         LEFT JOIN works w ON w.generation_id = u.generation_id AND w.deleted_at IS NULL
         WHERE u.asset_id = ?
         ORDER BY u.created_at DESC
         LIMIT 100`
      )
      .all(assetId) as unknown as Array<{
      asset_id: string;
      generation_id: string;
      role: AssetRole;
      created_at: string;
      mode: GenerationMode;
      work_id: string | null;
      thumbnail_url: string | null;
    }>;
    return rows.map((row) => ({
      assetId: row.asset_id,
      generationId: row.generation_id,
      workId: row.work_id ?? undefined,
      mode: row.mode,
      role: row.role,
      createdAt: row.created_at,
      thumbnailUrl: row.thumbnail_url ?? undefined,
    }));
  }

  backfill(jobs: GenerationTask[]) {
    let recorded = 0;
    for (const job of jobs) {
      try {
        this.recordForJob(job);
        recorded += 1;
      } catch {
        /* keep going */
      }
    }
    return recorded;
  }

  listAssetRefsForUrls(urls: string[]): MediaAsset[] {
    const assets: MediaAsset[] = [];
    for (const url of urls) {
      const asset = assetStore.findByUrl(url);
      if (asset) assets.push(asset);
    }
    return assets;
  }
}

export const assetUsageStore = new AssetUsageStore();
