import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lumen-cancel-"));
process.env.DATA_DIR = dir;
process.env.DEFAULT_PROVIDER = "mock";
process.env.APP_SECRET = "cancel-test-secret";
process.env.PROVIDER_POLL_MS = "200";

const waitFor = async (fn: () => Promise<boolean> | boolean, timeoutMs = 20_000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
};

test("canceling an agent run terminates cleanly without recursive cancel events", async () => {
  const { agentRuntime } = await import("../agent/runtime.js");
  const { agentStore } = await import("../storage/sessions.js");
  const { jobStore } = await import("../jobs/store.js");
  const { jobRunner } = await import("../jobs/runner.js");
  const { projectStore } = await import("../storage/projects.js");

  jobRunner.start();
  const project = projectStore.list()[0];
  const session = agentStore.create({ projectId: project.id, title: "取消测试" });

  // Video storyboards run long enough that cancellation lands mid-job.
  await agentRuntime.send(session.id, "文生视频：星云旋转，2 个分镜，每镜 3 秒，720p");
  assert.ok(await waitFor(() => agentStore.get(session.id)?.status === "running"));
  // Wait until the tool has enqueued the generation job so cancellation has a
  // real task to stop (otherwise the agent stops between plan and generate).
  assert.ok(await waitFor(() => jobStore.list({ sessionId: session.id, limit: 5 }).length > 0, 10_000));
  assert.ok(await waitFor(() => jobStore.list({ sessionId: session.id, limit: 5 })[0]?.status === "running", 10_000));

  // Cancellation must be idempotent; calling it repeatedly used to recurse
  // between JobStore.cancel -> emit -> agent listener -> JobStore.cancel.
  assert.equal(agentRuntime.cancel(session.id), true);
  // A second cancel may arrive after the run already unwound; it must not
  // throw or recurse, only report whether a run was still active.
  assert.equal(typeof agentRuntime.cancel(session.id), "boolean");

  assert.ok(
    await waitFor(async () => {
      const current = agentStore.get(session.id);
      return current?.status !== "running";
    }, 25_000),
    "agent session should leave running state"
  );

  const messages = agentStore.messages(session.id);
  const assistant = messages.filter((message) => message.role === "assistant").at(-1);
  assert.ok(assistant, "a cancellation message should be persisted");
  assert.match(assistant.text, /取消/);

  const jobs = jobStore.list({ sessionId: session.id, limit: 5 });
  assert.ok(jobs.length >= 1);
  assert.equal(jobs[0].status, "canceled");

  jobRunner.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});
