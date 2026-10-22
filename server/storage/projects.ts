import crypto from "node:crypto";
import type { Project } from "../../shared/contracts.js";
import { db } from "../db.js";

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  cover_url: string | null;
  status: Project["status"];
  created_at: string;
  updated_at: string;
}

const now = () => new Date().toISOString();

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    coverUrl: row.cover_url ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ProjectStats {
  sessions: number;
  assets: number;
  generations: number;
  tokens: number;
  lastActivityAt: string | null;
}

export class ProjectStore {
  newId() {
    return `proj_${crypto.randomBytes(5).toString("hex")}`;
  }

  list(): Project[] {
    return (db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as unknown as ProjectRow[]).map(toProject);
  }

  get(id: string): Project | null {
    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
    return row ? toProject(row) : null;
  }

  create(input: { name: string; description?: string; coverUrl?: string; status?: Project["status"] }): Project {
    const id = this.newId();
    const timestamp = now();
    db.prepare(
      "INSERT INTO projects (id, name, description, cover_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      id,
      input.name.trim().slice(0, 80) || "未命名项目",
      (input.description || "").trim().slice(0, 240),
      input.coverUrl || null,
      input.status || "active",
      timestamp,
      timestamp
    );
    return this.get(id)!;
  }

  update(
    id: string,
    patch: { name?: string; description?: string; coverUrl?: string; status?: Project["status"] }
  ): Project | null {
    const current = this.get(id);
    if (!current) return null;
    db.prepare("UPDATE projects SET name = ?, description = ?, cover_url = ?, status = ?, updated_at = ? WHERE id = ?").run(
      patch.name?.trim().slice(0, 80) || current.name,
      patch.description !== undefined ? patch.description.trim().slice(0, 240) : current.description,
      patch.coverUrl !== undefined ? patch.coverUrl : current.coverUrl ?? null,
      patch.status || current.status,
      now(),
      id
    );
    return this.get(id);
  }

  remove(id: string): boolean {
    const exists = this.get(id);
    if (!exists) return false;
    db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    db.prepare("UPDATE assets SET project_id = NULL WHERE project_id = ?").run(id);
    db.prepare("UPDATE agent_sessions SET project_id = NULL WHERE project_id = ?").run(id);
    db.prepare("UPDATE generations SET project_id = NULL WHERE project_id = ?").run(id);
    return true;
  }

  touch(id: string) {
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now(), id);
  }

  stats(id: string): ProjectStats {
    const sessions = db.prepare("SELECT COUNT(*) AS count FROM agent_sessions WHERE project_id = ?").get(id) as {
      count: number;
    };
    const assets = db.prepare("SELECT COUNT(*) AS count FROM assets WHERE project_id = ?").get(id) as {
      count: number;
    };
    const generations = db
      .prepare("SELECT COUNT(*) AS count FROM generations WHERE project_id = ?")
      .get(id) as { count: number };
    const usageRows = db
      .prepare("SELECT usage_json FROM generations WHERE project_id = ? AND usage_json IS NOT NULL")
      .all(id) as unknown as Array<{ usage_json: string }>;
    let tokens = 0;
    for (const row of usageRows) {
      try {
        tokens += Number(JSON.parse(row.usage_json).totalTokens || 0);
      } catch {
        /* ignore */
      }
    }
    const latestSession = db
      .prepare("SELECT updated_at FROM agent_sessions WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1")
      .get(id) as { updated_at: string } | undefined;
    const latestGeneration = db
      .prepare("SELECT updated_at FROM generations WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1")
      .get(id) as { updated_at: string } | undefined;
    const dates = [latestSession?.updated_at, latestGeneration?.updated_at].filter(Boolean) as string[];
    return {
      sessions: sessions.count,
      assets: assets.count,
      generations: generations.count,
      tokens,
      lastActivityAt: dates.sort().at(-1) || null,
    };
  }
}

export const projectStore = new ProjectStore();
