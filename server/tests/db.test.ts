import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lumen-db-"));
process.env.DATA_DIR = dir;
process.env.DEFAULT_PROVIDER = "mock";
process.env.APP_SECRET = "db-test-secret";

test("SQLite schema seeds projects and persists sessions/messages", async () => {
  const { projectStore } = await import("../storage/projects.js");
  const { agentStore } = await import("../storage/sessions.js");
  const { providerStore } = await import("../storage/providers.js");
  const { dbStats } = await import("../db.js");

  const projects = projectStore.list();
  assert.equal(projects.length, 3);
  assert.ok(projects.some((project) => project.id === "proj_product"));

  const project = projectStore.create({ name: "测试项目", description: "sqlite" });
  assert.equal(projectStore.get(project.id)?.name, "测试项目");

  const session = agentStore.create({ projectId: project.id, title: "新会话" });
  agentStore.addMessage(session.id, "user", "生成一张图");
  const assistant = agentStore.addMessage(session.id, "assistant", "完成", { tokens: 1200 });
  assert.equal(assistant.role, "assistant");

  const messages = agentStore.messages(session.id);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].text, "生成一张图");
  assert.deepEqual(agentStore.get(session.id)?.lastMessage, "完成");

  assert.ok(providerStore.activeId === "mock");
  const stats = dbStats();
  assert.ok(stats.projects >= 4);
  assert.equal(stats.sessions, 1);
  assert.equal(stats.messages, 2);
  assert.ok(fs.existsSync(path.join(dir, "lumen.db")));
  fs.rmSync(dir, { recursive: true, force: true });
});
