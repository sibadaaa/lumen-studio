import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { GenerationTask, MediaAsset } from "../../shared/contracts.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lumen-works-"));
process.env.DATA_DIR = dir;
process.env.DEFAULT_PROVIDER = "mock";
process.env.APP_SECRET = "works-test-secret";

const output = (index: number): MediaAsset => ({
  id: `out_${index}`,
  kind: index === 0 ? "image" : "video",
  mime: index === 0 ? "image/jpeg" : "video/mp4",
  size: 1024 * (index + 1),
  width: 1920,
  height: 1080,
  url: `/media/outputs/gen_test-${index}.mp4`,
  createdAt: new Date().toISOString(),
});

function job(
  overrides: Partial<GenerationTask> & { internal?: { attempts: number } } = {}
): GenerationTask & { internal: { attempts: number } } {
  return {
    id: "gen_test",
    clientRequestId: "req_test",
    mode: "text-to-image",
    generationType: "single",
    providerId: "mock",
    modelId: "lumen-mock-image",
    status: "succeeded",
    progress: 100,
    stage: "完成",
    prompt: "深海与熔融玻璃的交界，琥珀色发光体",
    params: { resolution: "2K", aspectRatio: "16:9" },
    inputs: [],
    storyboard: [],
    outputs: [output(0), output(1)],
    shots: [],
    estimatedTokens: 3240,
    usage: { inputTokens: 40, outputTokens: 3200, totalTokens: 3240, estimated: false, source: "provider" },
    estimatedSeconds: 18,
    error: null,
    projectId: "proj_a",
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    internal: { attempts: 0 },
    ...overrides,
  };
}

test("works: materialize is per-output, idempotent and attempt-aware", async () => {
  const { workStore } = await import("../storage/works.js");

  const created = workStore.materialize(job());
  assert.equal(created, 2);

  // same job again → no duplicates
  assert.equal(workStore.materialize(job()), 0);

  // retry (attempt 1) produces fresh works rows
  assert.equal(workStore.materialize(job({ internal: { attempts: 1 } })), 2);
  assert.equal(workStore.list({ projectId: "proj_a" }).total, 4);

  const page = workStore.list({ projectId: "proj_a" });
  assert.equal(page.items.length, 4);
  assert.ok(page.items.every((work) => work.id.startsWith("wrk_gen")));
  const multiTitles = page.items.filter((work) => work.attempt === 0).map((work) => work.title);
  assert.ok(multiTitles.some((title) => title.endsWith("01")));
  assert.ok(page.items.every((work) => work.usage.totalTokens === 3240));
});

test("works: filters, cursor pagination, update and soft delete", async () => {
  const { workStore } = await import("../storage/works.js");

  const videos = workStore.list({ kind: "video", projectId: "proj_a" });
  assert.equal(videos.total, 2);
  assert.ok(videos.items.every((work) => work.kind === "video"));

  const search = workStore.list({ q: "琥珀" });
  assert.ok(search.total >= 2);

  // small page + cursor
  const first = workStore.list({ limit: 2, projectId: "proj_a" });
  assert.equal(first.items.length, 2);
  assert.ok(first.nextCursor);
  const second = workStore.list({ limit: 2, projectId: "proj_a", cursor: first.nextCursor! });
  assert.equal(second.items.length, 2);
  assert.ok(!first.items.some((work) => second.items.some((item) => item.id === work.id)));

  // favorite + move + rename
  const target = first.items[0];
  const updated = workStore.update(target.id, { favorite: true, title: "琥珀潮汐", projectId: null })!;
  assert.equal(updated.favorite, true);
  assert.equal(updated.title, "琥珀潮汐");
  assert.equal(updated.projectId, undefined);

  const favorites = workStore.list({ favorite: true });
  assert.equal(favorites.total, 1);

  // bulk favorite + delete
  const bulk = workStore.bulk("unfavorite", [target.id]);
  assert.equal(bulk.updated, 1);
  assert.equal(workStore.list({ favorite: true }).total, 0);

  assert.equal(workStore.softDelete(target.id), true);
  assert.equal(workStore.get(target.id), null);
  assert.equal(workStore.list({ projectId: "proj_a" }).total, 3);

  const facets = workStore.facets();
  assert.equal(facets.total, 3);
  assert.ok(facets.kinds.some((kind) => kind.value === "video"));

  fs.rmSync(dir, { recursive: true, force: true });
});
