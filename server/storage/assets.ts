import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { MediaAsset } from "../../shared/contracts.js";
import { paths } from "../config.js";
import { db } from "../db.js";

const now = () => new Date().toISOString();

interface AssetRow {
  id: string;
  kind: MediaAsset["kind"];
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  duration_sec: number | null;
  url: string;
  thumbnail_url: string | null;
  original_name: string | null;
  project_id: string | null;
  created_at: string;
}

function toAsset(row: AssetRow): MediaAsset {
  return {
    id: row.id,
    kind: row.kind,
    mime: row.mime,
    size: row.size,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    durationSec: row.duration_sec ?? undefined,
    url: row.url,
    thumbnailUrl: row.thumbnail_url ?? undefined,
    originalName: row.original_name ?? undefined,
    createdAt: row.created_at,
  };
}

export class AssetStore {
  newId() {
    return `ast_${crypto.randomBytes(8).toString("hex")}`;
  }

  get(id: string): MediaAsset | null {
    const row = db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as AssetRow | undefined;
    return row ? toAsset(row) : null;
  }

  add(asset: MediaAsset, projectId?: string | null) {
    db.prepare(
      `INSERT INTO assets
        (id, kind, mime, size, width, height, duration_sec, url, thumbnail_url, original_name, project_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind,
         mime = excluded.mime,
         size = excluded.size,
         width = excluded.width,
         height = excluded.height,
         duration_sec = excluded.duration_sec,
         url = excluded.url,
         thumbnail_url = excluded.thumbnail_url,
         original_name = excluded.original_name,
         project_id = excluded.project_id`
    ).run(
      asset.id,
      asset.kind,
      asset.mime,
      asset.size,
      asset.width ?? null,
      asset.height ?? null,
      asset.durationSec ?? null,
      asset.url,
      asset.thumbnailUrl ?? null,
      asset.originalName ?? null,
      projectId ?? null,
      asset.createdAt
    );
    return asset;
  }

  list(options: { projectId?: string | null; limit?: number } = {}): MediaAsset[] {
    const limit = Math.min(200, options.limit || 100);
    const rows = options.projectId
      ? (db
          .prepare("SELECT * FROM assets WHERE project_id = ? ORDER BY created_at DESC LIMIT ?")
          .all(options.projectId, limit) as unknown as AssetRow[])
      : (db.prepare("SELECT * FROM assets ORDER BY created_at DESC LIMIT ?").all(limit) as unknown as AssetRow[]);
    return rows.map(toAsset);
  }

  count(projectId?: string | null): number {
    const row = projectId
      ? (db.prepare("SELECT COUNT(*) AS count FROM assets WHERE project_id = ?").get(projectId) as { count: number })
      : (db.prepare("SELECT COUNT(*) AS count FROM assets").get() as { count: number });
    return row.count;
  }

  remove(id: string): boolean {
    const asset = this.get(id);
    if (!asset) return false;
    for (const url of [asset.url, asset.thumbnailUrl]) {
      if (!url) continue;
      const relative = url.replace(/^\/media\/assets\//, "");
      const file = path.resolve(paths.assets, decodeURIComponent(relative));
      if (file.startsWith(paths.assets) && fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
        } catch {
          /* ignore */
        }
      }
    }
    db.prepare("DELETE FROM assets WHERE id = ?").run(id);
    return true;
  }

  findByUrl(url: string): MediaAsset | null {
    const row = db
      .prepare("SELECT * FROM assets WHERE url = ? OR thumbnail_url = ? LIMIT 1")
      .get(url, url) as AssetRow | undefined;
    return row ? toAsset(row) : null;
  }

  setProject(id: string, projectId: string | null) {
    db.prepare("UPDATE assets SET project_id = ? WHERE id = ?").run(projectId, id);
  }
}

export const assetStore = new AssetStore();

export function buildAssetUrl(relativePath: string) {
  return `/media/assets/${relativePath.split(path.sep).join("/")}`;
}

export function createAssetRecord(input: Omit<MediaAsset, "createdAt">): MediaAsset {
  return { ...input, createdAt: now() };
}
