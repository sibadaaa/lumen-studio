import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lumen-models-"));
process.env.DATA_DIR = dir;
process.env.DEFAULT_PROVIDER = "mock";
process.env.APP_SECRET = "models-test-secret";

test("model classification, modes and capabilities", async () => {
  const { inferModelKind, modesFor, capabilitiesFor } = await import("../storage/models.js");

  assert.equal(inferModelKind("doubao-seedream-4-0-250828", "ark").kind, "image");
  assert.equal(inferModelKind("doubao-seedance-1-0-pro-250528", "ark").kind, "video");
  assert.equal(inferModelKind("gpt-image-1", "openai_compatible").kind, "image");
  assert.equal(inferModelKind("sora-2", "openai_compatible").kind, "video");
  assert.equal(inferModelKind("ep-20261022-12345", "ark").kind, "unknown");
  assert.equal(inferModelKind("lumen-mock-image", "mock").kind, "image");
  assert.equal(inferModelKind("lumen-mock-video", "mock").kind, "video");

  assert.deepEqual(modesFor("image", "ark"), ["text-to-image", "image-to-image"]);
  assert.deepEqual(modesFor("video", "ark"), ["text-to-video", "image-to-video", "multi-image-to-video"]);
  assert.deepEqual(modesFor("video", "openai_compatible"), ["text-to-video", "image-to-video"]);
  assert.deepEqual(modesFor("unknown", "ark"), []);

  const imageCaps = capabilitiesFor("image", "ark");
  assert.equal(imageCaps.textToImage, true);
  assert.equal(imageCaps.textToVideo, false);
  assert.equal(imageCaps.firstLastFrame, false);
  const videoCaps = capabilitiesFor("video", "ark");
  assert.equal(videoCaps.textToVideo, true);
  assert.equal(videoCaps.multiImageToVideo, true);
});

test("model store: seed, enable, user-edited and routes", async () => {
  const { modelStore } = await import("../storage/models.js");
  const { providerStore } = await import("../storage/providers.js");

  // mock provider is configured by bootstrap; seeds image + video models
  const provider = providerStore.list().find((item) => item.configured)!;
  modelStore.seedFromProvider(provider);
  assert.ok(modelStore.count(provider.id) >= 2);

  const image = modelStore.find(provider.id, provider.imageModel)!;
  assert.equal(image.kind, "image");
  assert.equal(image.enabled, true);
  assert.equal(image.source, "seed");

  // disable then verify the route warning surface
  modelStore.setEnabled(provider.id, [provider.imageModel], false);
  const disabled = modelStore.find(provider.id, provider.imageModel)!;
  assert.equal(disabled.enabled, false);

  modelStore.setRoute("text-to-image", provider.id, provider.imageModel);
  const route = modelStore.resolveRoute("text-to-image");
  assert.equal(route.warning, "路由模型已停用");

  modelStore.setEnabled(provider.id, [provider.imageModel], true);
  assert.equal(modelStore.resolveRoute("text-to-image").warning, null);

  // user edits are preserved: update kind then re-upsert as sync would
  const updated = modelStore.update(provider.id, provider.imageModel, { label: "我的图像模型" })!;
  assert.equal(updated.label, "我的图像模型");
  modelStore.upsert({
    providerId: provider.id,
    modelId: provider.imageModel,
    label: provider.imageModel,
    kind: updated.kind,
    modes: updated.modes,
    capabilities: updated.capabilities,
    source: "discovered",
    enabled: updated.enabled,
    userEdited: false,
    status: "ready",
  });
  assert.equal(modelStore.find(provider.id, provider.imageModel)!.label, "我的图像模型");

  // unknown models cannot be enabled into the picker
  const unknown = modelStore.upsert({
    providerId: provider.id,
    modelId: "ep-2026-test",
    label: "ep-2026-test",
    kind: "unknown",
    modes: [],
    capabilities: {
      textToImage: false,
      imageToImage: false,
      textToVideo: false,
      imageToVideo: false,
      multiImageToVideo: false,
      firstLastFrame: false,
      audio: false,
      customResolution: false,
      bitrateControl: false,
      animationModes: [],
      maxImageCount: 0,
      maxDurationSec: 0,
    },
    source: "discovered",
    enabled: false,
    userEdited: false,
    status: "unverified",
  });
  assert.equal(unknown.modes.length, 0);

  // missing detection and removal guard for routed models
  modelStore.markMissing(provider.id, "ep-2026-test", new Date().toISOString());
  assert.equal(modelStore.find(provider.id, "ep-2026-test")!.status, "missing");
  assert.throws(() => modelStore.remove(provider.id, provider.imageModel), /MODEL|默认模型|route/i);

  fs.rmSync(dir, { recursive: true, force: true });
});
