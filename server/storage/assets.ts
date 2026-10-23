import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AssetFacets, AssetSource, LibraryAsset, MediaAsset } from "../../shared/contracts.js";
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
  sha256: string | null;
  source: AssetSource;
  source_ref: string | null;
  updated_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

function baseAsset(row: AssetRow): MediaAsset {
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

function toAsset(row: AssetRow): MediaAsset {
  return baseAsset(row);
}

export function escapeLike(value: string) {
  return value.replace(/([%_\\])/g, "\\$1");
}

/** Normalize user tags: trimmed, folded spaces, max 8, max 24 chars each. */
export function normalizeTags(tags: string[]): string[] {
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.replace(/\s+/g, " ").trim().slice(0, 24);
    if (tag && !result.some((item) => item.toLowerCase() === tag.toLowerCase())) result.push(tag);
  }
  return result.slice(0, 8);
}

export interface AssetMeta {
  projectId?: string | null;
  source?: AssetSource;
  sourceRef?: string | null;
  sha256?: string | null;
}

export class AssetStore {
  newId() {
    return `ast_${crypto.randomBytes(8).toString("hex")}`;
  }

  get(id: string): MediaAsset | null {
    const row = this.row(id);
    return row ? toAsset(row) : null;
  }

  /** Full library view with tags, usage count and dedupe info. */
  getDetail(id: string): LibraryAsset | null {
    const row = this.row(id);
    if (!row) return null;
    return this.toDetail(row);
  }

  private row(id: string): AssetRow | null {
    return (db.prepare("SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL").get(id) as AssetRow | undefined) || null;
  }

  private toDetail(row: AssetRow): LibraryAsset {
    const tags = db
      .prepare("SELECT tag FROM asset_tags WHERE asset_id = ? ORDER BY created_at")
      .all(row.id) as unknown as Array<{ tag: string }>;
    const usage = db.prepare("SELECT COUNT(*) AS count FROM asset_usages WHERE asset_id = ?").get(row.id) as {
      count: number;
    };
    return {
      ...baseAsset(row),
      projectId: row.project_id ?? undefined,
      sha256: row.sha256 ?? undefined,
      source: row.source || "upload",
      sourceRef: row.source_ref ?? undefined,
      tags: tags.map((item) => item.tag),
      usageCount: usage.count,
      updatedAt: row.updated_at || row.created_at,
    };
  }

  add(asset: MediaAsset, projectId?: string | null) {
    return this.addWithMeta(asset, { projectId: projectId ?? null, source: "upload" });
  }

  addWithMeta(asset: MediaAsset, meta: AssetMeta = {}): LibraryAsset {
    db.prepare(
      `INSERT INTO assets
        (id, kind, mime, size, width, height, duration_sec, url, thumbnail_url, original_name, project_id,
         sha256, source, source_ref, updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
         project_id = excluded.project_id,
         updated_at = excluded.updated_at`
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
      meta.projectId ?? null,
      meta.sha256 ?? null,
      meta.source || "upload",
      meta.sourceRef ?? null,
      asset.createdAt,
      asset.createdAt
    );
    return this.getDetail(asset.id)!;
  }

  /** Update only file fields after the background EXIF cleanup re-encode. */
  updateFile(id: string, file: { url: string; mime: string; size: number }) {
    db.prepare("UPDATE assets SET url = ?, mime = ?, size = ?, updated_at = ? WHERE id = ?").run(
      file.url,
      file.mime,
      file.size,
      now(),
      id
    );
  }

  findByUrl(url: string): MediaAsset | null {
    const row = db
      .prepare("SELECT * FROM assets WHERE (url = ? OR thumbnail_url = ?) AND deleted_at IS NULL LIMIT 1")
      .get(url, url) as AssetRow | undefined;
    return row ? toAsset(row) : null;
  }

  findBySha256(sha256: string): LibraryAsset | null {
    const row = db
      .prepare("SELECT * FROM assets WHERE sha256 = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1")
      .get(sha256) as AssetRow | undefined;
    return row ? this.toDetail(row) : null;
  }

  findBySource(source: AssetSource, sourceRef: string): LibraryAsset | null {
    const row = db
      .prepare("SELECT * FROM assets WHERE source = ? AND source_ref = ? AND deleted_at IS NULL LIMIT 1")
      .get(source, sourceRef) as AssetRow | undefined;
    return row ? this.toDetail(row) : null;
  }

  list(options: { projectId?: string | null; limit?: number } = {}): MediaAsset[] {
    const limit = Math.min(200, options.limit || 100);
    const rows = options.projectId
      ? (db
          .prepare("SELECT * FROM assets WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?")
          .all(options.projectId, limit) as unknown as AssetRow[])
      : (db
          .prepare("SELECT * FROM assets WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ?")
          .all(limit) as unknown as AssetRow[]);
    return rows.map(toAsset);
  }

  count(projectId?: string | null): number {
    const row = projectId
      ? (db
          .prepare("SELECT COUNT(*) AS count FROM assets WHERE project_id = ? AND deleted_at IS NULL")
          .get(projectId) as { count: number })
      : (db.prepare("SELECT COUNT(*) AS count FROM assets WHERE deleted_at IS NULL").get() as { count: number });
    return row.count;
  }

  search(query: {
    projectId?: string;
    kind?: string;
    source?: string;
    tag?: string[];
    unused?: boolean;
    duplicate?: boolean;
    q?: string;
    from?: string;
    to?: string;
    cursor?: string;
    limit?: number;
    sort?: "newest" | "oldest" | "size" | "name";
  }): { items: LibraryAsset[]; nextCursor: string | null; total: number } {
    const clauses = ["a.deleted_at IS NULL"];
    const values: Array<string | number> = [];
    if (query.projectId === "none") clauses.push("a.project_id IS NULL");
    else if (query.projectId) {
      clauses.push("a.project_id = ?");
      values.push(query.projectId);
    }
    if (query.kind) {
      clauses.push("a.kind = ?");
      values.push(query.kind);
    }
    if (query.source) {
      clauses.push("a.source = ?");
      values.push(query.source);
    }
    for (const tag of query.tag || []) {
      clauses.push("EXISTS (SELECT 1 FROM asset_tags t WHERE t.asset_id = a.id AND t.tag = ? COLLATE NOCASE)");
      values.push(tag);
    }
    if (query.unused) {
      clauses.push("NOT EXISTS (SELECT 1 FROM asset_usages u WHERE u.asset_id = a.id)");
    }
    if (query.duplicate) {
      clauses.push(
        "a.sha256 IS NOT NULL AND a.sha256 IN (SELECT sha256 FROM assets WHERE deleted_at IS NULL AND sha256 IS NOT NULL GROUP BY sha256 HAVING COUNT(*) > 1)"
      );
    }
    if (query.q) {
      clauses.push(
        "(a.original_name LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM asset_tags t2 WHERE t2.asset_id = a.id AND t2.tag LIKE ? ESCAPE '\\' COLLATE NOCASE))"
      );
      const pattern = `%${escapeLike(query.q)}%`;
      values.push(pattern, pattern);
    }
    if (query.from) {
      clauses.push("a.created_at >= ?");
      values.push(query.from);
    }
    if (query.to) {
      clauses.push("a.created_at <= ?");
      values.push(query.to);
    }

    const where = clauses.join(" AND ");
    const limit = Math.min(100, Math.max(1, query.limit || 24));
    const sortKey = query.sort || "newest";
    const orders: Record<string, string> = {
      newest: "a.created_at DESC, a.id DESC",
      oldest: "a.created_at ASC, a.id ASC",
      size: "a.size DESC, a.id DESC",
      name: "a.original_name ASC, a.id ASC",
    };
    const order = orders[sortKey] || orders.newest;

    let cursorSql = "";
    const cursorValues: Array<string | number> = [];
    if (query.cursor && (sortKey === "newest" || sortKey === "oldest")) {
      try {
        const cursor = JSON.parse(Buffer.from(query.cursor, "base64").toString("utf8")) as { c?: string; i?: string };
        if (cursor.c && cursor.i) {
          cursorSql =
            sortKey === "newest"
              ? " AND (a.created_at < ? OR (a.created_at = ? AND a.id < ?))"
              : " AND (a.created_at > ? OR (a.created_at = ? AND a.id > ?))";
          cursorValues.push(cursor.c, cursor.c, cursor.i);
        }
      } catch {
        /* invalid cursor falls back to the first page */
      }
    }

    const rows = db
      .prepare(`SELECT a.* FROM assets a WHERE ${where}${cursorSql} ORDER BY ${order} LIMIT ?`)
      .all(...values, ...cursorValues, limit + 1) as unknown as AssetRow[];
    const totalRow = db.prepare(`SELECT COUNT(*) AS count FROM assets a WHERE ${where}`).get(...values) as {
      count: number;
    };

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => this.toDetail(row));
    let nextCursor: string | null = null;
    if (hasMore && (sortKey === "newest" || sortKey === "oldest")) {
      const last = rows[limit - 1];
      nextCursor = Buffer.from(JSON.stringify({ c: last.created_at, i: last.id })).toString("base64");
    }
    return { items, nextCursor, total: totalRow.count };
  }

  facets(): AssetFacets {
    const base = "WHERE deleted_at IS NULL";
    const group = (column: string) =>
      (db
        .prepare(`SELECT ${column} AS value, COUNT(*) AS count FROM assets ${base} GROUP BY ${column} ORDER BY count DESC`)
        .all() as unknown as Array<{ value: string | null; count: number }>)
        .filter((row) => row.value !== null)
        .map((row) => ({ value: String(row.value), count: row.count }));
    const tags = db
      .prepare(
        `SELECT t.tag AS value, COUNT(*) AS count FROM asset_tags t
         JOIN assets a ON a.id = t.asset_id AND a.deleted_at IS NULL
         GROUP BY t.tag ORDER BY count DESC LIMIT 50`
      )
      .all() as unknown as Array<{ value: string; count: number }>;
    const totalRow = db.prepare(`SELECT COUNT(*) AS count FROM assets ${base}`).get() as { count: number };
    const usedRow = db
      .prepare(
        "SELECT COUNT(DISTINCT u.asset_id) AS count FROM asset_usages u JOIN assets a ON a.id = u.asset_id AND a.deleted_at IS NULL"
      )
      .get() as { count: number };
    return {
      total: totalRow.count,
      kinds: group("kind"),
      sources: group("source"),
      projects: group("project_id"),
      tags,
      used: usedRow.count,
      unused: totalRow.count - usedRow.count,
    };
  }

  setTags(assetId: string, tags: string[]) {
    const normalized = normalizeTags(tags);
    db.prepare("DELETE FROM asset_tags WHERE asset_id = ?").run(assetId);
    const insert = db.prepare("INSERT OR IGNORE INTO asset_tags (asset_id, tag, created_at) VALUES (?, ?, ?)");
    for (const tag of normalized) insert.run(assetId, tag, now());
    return normalized;
  }

  addTags(assetId: string, tags: string[]): { added: string[]; skipped: number } {
    const current = (
      db.prepare("SELECT tag FROM asset_tags WHERE asset_id = ?").all(assetId) as unknown as Array<{ tag: string }>
    ).map((row) => row.tag);
    const added: string[] = [];
    let skipped = 0;
    for (const raw of tags) {
      const tag = raw.replace(/\s+/g, " ").trim().slice(0, 24);
      if (!tag) continue;
      if (current.some((item) => item.toLowerCase() === tag.toLowerCase())) {
        skipped += 1;
        continue;
      }
      if (current.length >= 8) {
        skipped += 1;
        continue;
      }
      db.prepare("INSERT OR IGNORE INTO asset_tags (asset_id, tag, created_at) VALUES (?, ?, ?)").run(assetId, tag, now());
      current.push(tag);
      added.push(tag);
    }
    return { added, skipped };
  }

  removeTags(assetId: string, tags: string[]): number {
    let removed = 0;
    for (const tag of tags) {
      const result = db.prepare("DELETE FROM asset_tags WHERE asset_id = ? AND tag = ? COLLATE NOCASE").run(assetId, tag);
      removed += Number(result.changes);
    }
    return removed;
  }

  updateMeta(id: string, patch: { originalName?: string; projectId?: string | null }): LibraryAsset | null {
    const row = this.row(id);
    if (!row) return null;
    const name =
      patch.originalName !== undefined ? patch.originalName.trim().slice(0, 160) || row.original_name : row.original_name;
    const projectId = patch.projectId !== undefined ? patch.projectId : row.project_id;
    db.prepare("UPDATE assets SET original_name = ?, project_id = ?, updated_at = ? WHERE id = ?").run(
      name,
      projectId,
      now(),
      id
    );
    return this.getDetail(id);
  }

  softDelete(id: string): boolean {
    const result = db
      .prepare("UPDATE assets SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
      .run(now(), now(), id);
    return Number(result.changes) > 0;
  }

  /** Legacy hard delete, kept for the retention cleaner. */
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

  setProject(id: string, projectId: string | null) {
    db.prepare("UPDATE assets SET project_id = ?, updated_at = ? WHERE id = ?").run(projectId, now(), id);
  }
}

export const assetStore = new AssetStore();

export function buildAssetUrl(relativePath: string) {
  return `/media/assets/${relativePath.split(path.sep).join("/")}`;
}

export function createAssetRecord(input: Omit<MediaAsset, "createdAt">): MediaAsset {
  return { ...input, createdAt: now() };
}
