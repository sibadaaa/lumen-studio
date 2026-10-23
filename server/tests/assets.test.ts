import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { GenerationTask } from "../../shared/contracts.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lumen-assets-"));
process.env.DATA_DIR = dir;
process.env.DEFAULT_PROVIDER = "mock";
process.env.APP_SECRET = "assets-test-secret";

const asset = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  kind: "image" as const,
  mime: "image/jpeg",
  size: 2048,
  width: 512,
  height: 512,
  url: `/media/assets/2026/10/${id}.jpg`,
  createdAt: new Date().toISOString(),
  ...overrides,
});

function job(id: string, assetIds: string[]): GenerationTask {
  return {
    id,
    clientRequestId: `req_${id}`,
    mode: "image-to-image",
    generationType: "single",
    providerId: "mock",
    modelId: "lumen-mock-image",
    status: "running",
    progress: 10,
    stage: "生成中",
    prompt: "test",
    params: {},
    inputs: assetIds.map((assetId, index) => ({ assetId, role: "reference" as const, order: index })),
    storyboard: [],
    outputs: [],
    shots: [],
    estimatedTokens: 100,
    usage: null,
    estimatedSeconds: 10,
    error: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    updatedAt: new Date().toISOString(),
  };
}

test("assets: addWithMeta, tags, search and soft delete", async () => {
  const { assetStore, normalizeTags } = await import("../storage/assets.js");

  const first = assetStore.addWithMeta(asset("ast_a"), { projectId: "proj_a", source: "upload", sha256: "hash-a" });
  assert.equal(first.source, "upload");
  assert.equal(first.sha256, "hash-a");
  assert.equal(first.projectId, "proj_a");

  assetStore.addWithMeta(asset("ast_b"), { source: "work", sourceRef: "wrk_1", sha256: "hash-b" });
  assetStore.addWithMeta(asset("ast_c"), { projectId: "proj_a", source: "upload", sha256: "hash-a" });

  // duplicate detection by hash
  assert.equal(assetStore.findBySha256("hash-a")?.id, "ast_a");
  assert.equal(assetStore.findBySource("work", "wrk_1")?.id, "ast_b");

  // tag normalization: dedupe, fold spaces, 8 max
  assert.deepEqual(normalizeTags([" 产品 ", "product", "产品", "  深色  背景 "]), ["产品", "product", "深色 背景"]);
  assetStore.setTags("ast_a", ["产品", "场景", "深色背景"]);
  assetStore.addTags("ast_a", Array.from({ length: 10 }, (_, index) => `tag${index}`));
  assert.equal(assetStore.getDetail("ast_a")!.tags.length, 8);

  const tagged = assetStore.search({ tag: ["产品"] });
  assert.equal(tagged.total, 1);
  assert.equal(tagged.items[0].id, "ast_a");

  const byProject = assetStore.search({ projectId: "proj_a" });
  assert.equal(byProject.total, 2); // ast_a + ast_c

  // usage recording makes "unused" filter work (generation row must exist,
  // mirroring the real flow where jobStore.create writes it first)
  const { db } = await import("../db.js");
  db.prepare(
    `INSERT INTO generations
      (id, client_request_id, mode, generation_type, provider_id, model_id, status, progress, stage, prompt,
       params_json, inputs_json, storyboard_json, outputs_json, shots_json, estimated_tokens, estimated_seconds,
       internal_json, created_at, updated_at)
     VALUES (?, ?, 'image-to-image', 'single', 'mock', 'lumen-mock-image', 'running', 10, '生成中', 'test',
       '{}', '[]', '[]', '[]', '[]', 100, 10, '{}', ?, ?)`
  ).run("gen_u1", "req_gen_u1", new Date().toISOString(), new Date().toISOString());
  const { assetUsageStore } = await import("../storage/asset-usage.js");
  assetUsageStore.recordForJob(job("gen_u1", ["ast_a"]));
  assert.equal(assetUsageStore.countForAsset("ast_a"), 1);
  assert.equal(assetStore.search({ unused: true }).items.every((item) => item.id !== "ast_a"), true);
  const usage = assetUsageStore.listForAsset("ast_a");
  assert.equal(usage[0].role, "reference");

  // soft delete hides from lists but keeps the row
  assert.equal(assetStore.softDelete("ast_c"), true);
  assert.equal(assetStore.get("ast_c"), null);
  assert.equal(assetStore.search({ projectId: "proj_a" }).total, 1);
  assert.equal(assetStore.count("proj_a"), 1);

  // running-task guard data path: status check uses generations table
  assert.equal(assetUsageStore.countRunning("ast_a"), 1); // gen_u1 status=running

  fs.rmSync(dir, { recursive: true, force: true });
});
