import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import type {
  AgentEvent,
  AgentMessage,
  AgentMessageData,
  AgentSession,
  AgentSessionStatus,
  TokenUsage,
} from "../../shared/contracts.js";
import { db } from "../db.js";

interface SessionRow {
  id: string;
  project_id: string | null;
  title: string;
  status: AgentSessionStatus;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  session_id: string;
  seq: number;
  role: "user" | "assistant";
  text: string;
  data_json: string | null;
  created_at: string;
}

const now = () => new Date().toISOString();
const parse = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

function toMessage(row: MessageRow): AgentMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    seq: row.seq,
    role: row.role,
    text: row.text,
    data: parse<AgentMessageData | undefined>(row.data_json, undefined),
    createdAt: row.created_at,
  };
}

export class AgentSessionStore {
  readonly events = new EventEmitter();

  constructor() {
    this.events.setMaxListeners(50);
    // An agent run lives in memory; after a restart no run can resume, so do
    // not leave sessions stuck in "running".
    db.prepare("UPDATE agent_sessions SET status = 'idle' WHERE status = 'running'").run();
  }

  newId(prefix: string) {
    return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
  }

  tokensFor(sessionId: string): number {
    const rows = db
      .prepare("SELECT usage_json FROM generations WHERE session_id = ? AND usage_json IS NOT NULL")
      .all(sessionId) as unknown as Array<{ usage_json: string }>;
    let tokens = 0;
    for (const row of rows) {
      const usage = parse<TokenUsage | null>(row.usage_json, null);
      if (usage) tokens += usage.totalTokens;
    }
    return tokens;
  }

  private messageCount(sessionId: string): number {
    const row = db.prepare("SELECT COUNT(*) AS count FROM agent_messages WHERE session_id = ?").get(sessionId) as {
      count: number;
    };
    return row.count;
  }

  private lastMessage(sessionId: string): string {
    const row = db
      .prepare("SELECT text FROM agent_messages WHERE session_id = ? ORDER BY seq DESC LIMIT 1")
      .get(sessionId) as { text: string } | undefined;
    return row?.text || "";
  }

  private counts = new Map<string, number>();

  private toSession(row: SessionRow): AgentSession {
    const tokens = this.tokensFor(row.id);
    let messageCount = this.counts.get(row.id);
    if (messageCount === undefined) {
      messageCount = this.messageCount(row.id);
      this.counts.set(row.id, messageCount);
    }
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      status: row.status,
      tokens,
      messageCount,
      lastMessage: this.lastMessage(row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  list(projectId?: string | null, query = ""): AgentSession[] {
    const rows = (projectId
      ? db.prepare("SELECT * FROM agent_sessions WHERE project_id = ? ORDER BY updated_at DESC LIMIT 60").all(projectId)
      : db.prepare("SELECT * FROM agent_sessions ORDER BY updated_at DESC LIMIT 60").all()) as unknown as SessionRow[];
    const needle = query.trim().toLowerCase();
    return rows
      .map((row) => this.toSession(row))
      .filter((session) => !needle || session.title.toLowerCase().includes(needle));
  }

  get(id: string): AgentSession | null {
    const row = db.prepare("SELECT * FROM agent_sessions WHERE id = ?").get(id) as SessionRow | undefined;
    return row ? this.toSession(row) : null;
  }

  create(input: { projectId?: string | null; title?: string }): AgentSession {
    const id = this.newId("sess");
    const timestamp = now();
    db.prepare(
      "INSERT INTO agent_sessions (id, project_id, title, status, created_at, updated_at) VALUES (?, ?, ?, 'idle', ?, ?)"
    ).run(id, input.projectId ?? null, (input.title || "新会话").slice(0, 120), timestamp, timestamp);
    return this.get(id)!;
  }

  update(
    id: string,
    patch: { title?: string; status?: AgentSessionStatus; projectId?: string | null }
  ): AgentSession | null {
    const session = this.get(id);
    if (!session) return null;
    db.prepare("UPDATE agent_sessions SET title = ?, status = ?, project_id = ?, updated_at = ? WHERE id = ?").run(
      patch.title !== undefined ? patch.title.slice(0, 120) : session.title,
      patch.status || session.status,
      patch.projectId !== undefined ? patch.projectId : session.projectId,
      now(),
      id
    );
    return this.get(id);
  }

  touch(id: string) {
    db.prepare("UPDATE agent_sessions SET updated_at = ? WHERE id = ?").run(now(), id);
  }

  remove(id: string): boolean {
    const session = this.get(id);
    if (!session) return false;
    db.prepare("DELETE FROM agent_messages WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM agent_sessions WHERE id = ?").run(id);
    this.counts.delete(id);
    return true;
  }

  messages(sessionId: string): AgentMessage[] {
    const rows = db
      .prepare("SELECT * FROM agent_messages WHERE session_id = ? ORDER BY seq ASC")
      .all(sessionId) as unknown as MessageRow[];
    return rows.map(toMessage);
  }

  addMessage(sessionId: string, role: "user" | "assistant", text: string, data?: AgentMessageData): AgentMessage {
    const row = db
      .prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM agent_messages WHERE session_id = ?")
      .get(sessionId) as { seq: number };
    const seq = row.seq + 1;
    const message: AgentMessage = {
      id: this.newId("msg"),
      sessionId,
      seq,
      role,
      text,
      data,
      createdAt: now(),
    };
    db.prepare(
      "INSERT INTO agent_messages (id, session_id, seq, role, text, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(message.id, sessionId, seq, role, text, data ? JSON.stringify(data) : null, message.createdAt);
    this.counts.set(sessionId, seq);
    db.prepare("UPDATE agent_sessions SET updated_at = ? WHERE id = ?").run(message.createdAt, sessionId);
    const session = this.get(sessionId);
    // The message event must go to the session channel, otherwise live
    // subscribers see tool/plan events but never the final assistant message.
    if (session) this.emit({ type: "message", message }, sessionId);
    return message;
  }

  emit(event: AgentEvent, sessionId?: string) {
    if (sessionId) this.events.emit(sessionId, event);
    this.events.emit("any", event);
  }
}

export const agentStore = new AgentSessionStore();
