import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lumen-projects-"));
process.env.DATA_DIR = dir;
process.env.DEFAULT_PROVIDER = "mock";
process.env.APP_SECRET = "projects-test-secret";

test("projects: rename is trimmed and persisted", async () => {
  const { projectStore } = await import("../storage/projects.js");

  const project = projectStore.create({ name: "原项目", description: "desc" });
  const renamed = projectStore.update(project.id, { name: "  新项目  " });
  assert.equal(renamed?.name, "新项目");
  assert.equal(projectStore.get(project.id)?.name, "新项目");

  // Empty names keep the previous value instead of wiping the project name.
  const blank = projectStore.update(project.id, { name: "   " });
  assert.equal(blank?.name, "新项目");
});

test("projects: delete detaches sessions and keeps their messages reachable", async () => {
  const { projectStore } = await import("../storage/projects.js");
  const { agentStore } = await import("../storage/sessions.js");

  const project = projectStore.create({ name: "待删除项目" });
  const session = agentStore.create({ projectId: project.id, title: "会话" });
  agentStore.addMessage(session.id, "user", "生成一张静帧");

  assert.equal(projectStore.remove(project.id), true);
  assert.equal(projectStore.get(project.id), null);
  assert.equal(projectStore.remove(project.id), false);

  const detached = agentStore.get(session.id);
  assert.ok(detached);
  assert.equal(detached.projectId, null);
  assert.equal(agentStore.messages(session.id).length, 1);
});

test("sessions: rename and delete remove the conversation", async () => {
  const { agentStore } = await import("../storage/sessions.js");

  const session = agentStore.create({ title: "新会话" });
  const renamed = agentStore.update(session.id, { title: "改过的会话" });
  assert.equal(renamed?.title, "改过的会话");
  assert.equal(agentStore.get(session.id)?.title, "改过的会话");

  agentStore.addMessage(session.id, "user", "你好");
  assert.equal(agentStore.remove(session.id), true);
  assert.equal(agentStore.get(session.id), null);
  assert.equal(agentStore.messages(session.id).length, 0);
  assert.equal(agentStore.remove(session.id), false);
});
