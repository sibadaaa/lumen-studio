import type {
  GenerationInput,
  GenerationMode,
  GenerationParams,
  GenerationTask,
  MediaAsset,
  StoryboardRow,
  TokenUsage,
  Work,
  WorkBulkResult,
  WorkFacets,
  WorkUpdateInput,
} from "../../shared/contracts.js";
import { db, withTransaction } from "../db.js";

const now = () => new Date().toISOString();

export interface WorkJobInput {
  id: string;
  mode: GenerationMode;
  providerId: string;
  modelId: string;
  prompt: string;
  params: GenerationParams;
  inputs: GenerationInput[];
  storyboard: StoryboardRow[];
  outputs: MediaAsset[];
  usage: TokenUsage | null;
  projectId?: string;
  sessionId?: string;
  finishedAt: string | null;
  createdAt: string;
  internal: { attempts: number };
}

interface WorkRow {
  id: string;
  generation_id: string;
  attempt: number;
  output_index: number;
  output_id: string | null;
  kind: Work["kind"];
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  duration_sec: number | null;
  url: string;
  thumbnail_url: string | null;
  title: string;
  prompt: string;
  mode: string;
  provider_id: string;
  model_id: string;
  params_json: string;
  inputs_json: string;
  storyboard_json: string;
  usage_tokens: number;
  usage_estimated: number;
  project_id: string | null;
  session_id: string | null;
  source: Work["source"];
  favorite: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

const parse = <T,>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

function toWork(row: WorkRow): Work {
  return {
    id: row.id,
    generationId: row.generation_id,
    attempt: row.attempt,
    outputIndex: row.output_index,
    kind: row.kind,
    mime: row.mime,
    size: row.size,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    durationSec: row.duration_sec ?? undefined,
    url: row.url,
    thumbnailUrl: row.thumbnail_url ?? undefined,
    title: row.title,
    prompt: row.prompt,
    mode: row.mode as GenerationMode,
    providerId: row.provider_id,
    modelId: row.model_id,
    params: parse(row.params_json, {}),
    inputs: parse(row.inputs_json, []),
    storyboard: parse(row.storyboard_json, []),
    usage: { totalTokens: row.usage_tokens, estimated: Boolean(row.usage_estimated) },
    projectId: row.project_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    source: row.source,
    favorite: Boolean(row.favorite),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function workId(jobId: string, attempt: number, index: number) {
  return `wrk_${jobId.replace(/[^a-z0-9]/gi, "")}_${attempt}_${index}`;
}

function deriveTitle(prompt: string, index: number, total: number) {
  const base = prompt.replace(/\s+/g, " ").trim().slice(0, 24) || "未命名作品";
  return total > 1 ? `${base} ${String(index + 1).padStart(2, "0")}` : base;
}

function escapeLike(value: string) {
  return value.replace(/([%_\\])/g, "\\$1");
}

export interface WorkQuery {
  projectId?: string;
  mode?: string;
  kind?: string;
  providerId?: string;
  modelId?: string;
  favorite?: boolean;
  q?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
  sort?: "newest" | "oldest" | "tokens" | "duration";
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
}

function decodeCursor(cursor: string | undefined): { c?: string; i?: string; v?: number } | null {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

const SORTS: Record<string, { sql: string; next: string }> = {
  newest: { sql: "created_at DESC, id DESC", next: "created_at < ? OR (created_at = ? AND id < ?)" },
  oldest: { sql: "created_at ASC, id ASC", next: "created_at > ? OR (created_at = ? AND id > ?)" },
  tokens: { sql: "usage_tokens DESC, id DESC", next: "usage_tokens < ? OR (usage_tokens = ? AND id < ?)" },
  duration: { sql: "duration_sec DESC, id DESC", next: "duration_sec < ? OR (duration_sec = ? AND id < ?)" },
};

export class WorkStore {
  /** Deterministic insert; never overwrites user-edited rows (INSERT OR IGNORE). */
  materialize(job: WorkJobInput): number {
    if (job.outputs.length === 0) return 0;
    const attempt = job.internal?.attempts ?? 0;
    const timestamp = job.finishedAt || job.createdAt || now();
    const total = job.outputs.length;
    return withTransaction(() => {
      const insert = db.prepare(
        `INSERT OR IGNORE INTO works
          (id, generation_id, attempt, output_index, output_id, kind, mime, size, width, height, duration_sec,
           url, thumbnail_url, title, prompt, mode, provider_id, model_id, params_json, inputs_json, storyboard_json,
           usage_tokens, usage_estimated, project_id, session_id, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      let created = 0;
      for (const [index, output] of job.outputs.entries()) {
        const result = insert.run(
          workId(job.id, attempt, index),
          job.id,
          attempt,
          index,
          output.id ?? null,
          output.kind === "video" ? "video" : "image",
          output.mime,
          output.size || 0,
          output.width ?? null,
          output.height ?? null,
          output.durationSec ?? null,
          output.url,
          output.thumbnailUrl ?? null,
          deriveTitle(job.prompt, index, total),
          job.prompt,
          job.mode,
          job.providerId,
          job.modelId,
          JSON.stringify(job.params || {}),
          JSON.stringify(job.inputs || []),
          JSON.stringify(job.storyboard || []),
          job.usage?.totalTokens || 0,
          job.usage?.estimated ? 1 : 0,
          job.projectId ?? null,
          job.sessionId ?? null,
          job.sessionId ? "agent" : "studio",
          timestamp,
          timestamp
        );
        created += Number(result.changes);
      }
      return created;
    });
  }

  /** One-time import of historical succeeded generations. */
  backfill(jobs: WorkJobInput[]): number {
    let created = 0;
    for (const job of jobs) {
      try {
        created += this.materialize(job);
      } catch (error) {
        console.error(`[works] backfill failed for ${job.id}:`, (error as Error).message);
      }
    }
    return created;
  }

  /** Startup reconciliation for jobs that succeeded between materialize failures. */
  reconcile(jobs: WorkJobInput[]): number {
    return this.backfill(jobs);
  }

  get(id: string): Work | null {
    const row = db.prepare("SELECT * FROM works WHERE id = ? AND deleted_at IS NULL").get(id) as WorkRow | undefined;
    return row ? toWork(row) : null;
  }

  private buildWhere(query: WorkQuery): { clauses: string[]; values: Array<string | number> } {
    const clauses = ["deleted_at IS NULL"];
    const values: Array<string | number> = [];
    if (query.projectId === "none") clauses.push("project_id IS NULL");
    else if (query.projectId) {
      clauses.push("project_id = ?");
      values.push(query.projectId);
    }
    if (query.mode) {
      clauses.push("mode = ?");
      values.push(query.mode);
    }
    if (query.kind) {
      clauses.push("kind = ?");
      values.push(query.kind);
    }
    if (query.providerId) {
      clauses.push("provider_id = ?");
      values.push(query.providerId);
    }
    if (query.modelId) {
      clauses.push("model_id = ?");
      values.push(query.modelId);
    }
    if (query.favorite) clauses.push("favorite = 1");
    if (query.from) {
      clauses.push("created_at >= ?");
      values.push(query.from);
    }
    if (query.to) {
      clauses.push("created_at <= ?");
      values.push(query.to);
    }
    if (query.q) {
      clauses.push("(title LIKE ? ESCAPE '\\' OR prompt LIKE ? ESCAPE '\\')");
      const pattern = `%${escapeLike(query.q)}%`;
      values.push(pattern, pattern);
    }
    return { clauses, values };
  }

  list(query: WorkQuery = {}): CursorPage<Work> {
    const { clauses, values } = this.buildWhere(query);
    const where = clauses.join(" AND ");
    const limit = Math.min(100, Math.max(1, query.limit || 24));
    const sortKey = query.sort && SORTS[query.sort] ? query.sort : "newest";
    const sort = SORTS[sortKey];
    const cursor = decodeCursor(query.cursor);

    const cursorClauses: string[] = [];
    const cursorValues: Array<string | number> = [];
    if (cursor) {
      if (sortKey === "tokens" || sortKey === "duration") {
        const value = cursor.v ?? 0;
        cursorClauses.push(`(${sort.next})`);
        cursorValues.push(value, value, cursor.i ?? "");
      } else {
        const stamp = cursor.c ?? "";
        cursorClauses.push(`(${sort.next})`);
        cursorValues.push(stamp, stamp, cursor.i ?? "");
      }
    }
    const fullWhere = cursorClauses.length ? `${where} AND (${cursorClauses.join(" AND ")})` : where;
    const rows = db
      .prepare(`SELECT * FROM works WHERE ${fullWhere} ORDER BY ${sort.sql} LIMIT ?`)
      .all(...values, ...cursorValues, limit + 1) as unknown as WorkRow[];
    const totalRow = db.prepare(`SELECT COUNT(*) AS count FROM works WHERE ${where}`).get(...values) as { count: number };

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).map(toWork);
    let nextCursor: string | null = null;
    if (hasMore) {
      const last = rows[limit - 1];
      nextCursor = Buffer.from(
        JSON.stringify(
          sortKey === "tokens"
            ? { v: last.usage_tokens, i: last.id }
            : sortKey === "duration"
              ? { v: last.duration_sec ?? 0, i: last.id }
              : { c: last.created_at, i: last.id }
        )
      ).toString("base64");
    }
    return { items: page, nextCursor, total: totalRow.count };
  }

  facets(): WorkFacets {
    const base = "WHERE deleted_at IS NULL";
    const group = (column: string) =>
      (db
        .prepare(`SELECT ${column} AS value, COUNT(*) AS count FROM works ${base} GROUP BY ${column} ORDER BY count DESC`)
        .all() as unknown as Array<{ value: string | null; count: number }>)
        .filter((row) => row.value)
        .map((row) => ({ value: String(row.value), count: row.count }));
    const totalRow = db.prepare(`SELECT COUNT(*) AS count FROM works ${base}`).get() as { count: number };
    return {
      total: totalRow.count,
      kinds: group("kind"),
      modes: group("mode"),
      projects: group("project_id"),
    };
  }

  update(id: string, patch: WorkUpdateInput): Work | null {
    const current = this.get(id);
    if (!current) return null;
    const title = patch.title !== undefined ? patch.title.trim().slice(0, 80) || current.title : current.title;
    const favorite = patch.favorite !== undefined ? (patch.favorite ? 1 : 0) : current.favorite ? 1 : 0;
    const projectId = patch.projectId !== undefined ? patch.projectId : current.projectId ?? null;
    db.prepare("UPDATE works SET title = ?, favorite = ?, project_id = ?, updated_at = ? WHERE id = ?").run(
      title,
      favorite,
      projectId,
      now(),
      id
    );
    return this.get(id);
  }

  softDelete(id: string): boolean {
    const result = db.prepare("UPDATE works SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL").run(
      now(),
      now(),
      id
    );
    return Number(result.changes) > 0;
  }

  bulk(action: string, ids: string[], projectId?: string | null): WorkBulkResult {
    const result: WorkBulkResult = { updated: 0, failed: [] };
    for (const id of ids) {
      try {
        if (action === "favorite" || action === "unfavorite") {
          if (this.update(id, { favorite: action === "favorite" })) result.updated += 1;
          else result.failed.push({ id, code: "WORK_NOT_FOUND", message: "作品不存在" });
        } else if (action === "move_project") {
          if (this.update(id, { projectId: projectId ?? null })) result.updated += 1;
          else result.failed.push({ id, code: "WORK_NOT_FOUND", message: "作品不存在" });
        } else if (action === "delete") {
          if (this.softDelete(id)) result.updated += 1;
          else result.failed.push({ id, code: "WORK_NOT_FOUND", message: "作品不存在" });
        } else {
          result.failed.push({ id, code: "INVALID_ACTION", message: "不支持的批量操作" });
        }
      } catch (error) {
        result.failed.push({ id, code: "WORK_ACTION_FAILED", message: (error as Error).message });
      }
    }
    return result;
  }
}

export const workStore = new WorkStore();
