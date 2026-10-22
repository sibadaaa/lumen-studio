import assert from "node:assert/strict";
import test from "node:test";
import { dimensionsFor, estimateGenerationTokens, resolutionFactor } from "../jobs/estimate.js";

test("image token estimate scales with custom megapixels", () => {
  const twoK = estimateGenerationTokens("text-to-image", { resolution: "2K", width: 2048, height: 1152 }, [], "single");
  const fourK = estimateGenerationTokens("text-to-image", { resolution: "custom", width: 3840, height: 2160 }, [], "single");
  assert.ok(fourK > twoK * 2);
  assert.equal(twoK, 3240);
});

test("video duration and animation mode affect tokens", () => {
  const five = estimateGenerationTokens("image-to-video", { resolution: "1080p", width: 1920, height: 1080, durationSec: 5, animationMode: "live" }, [], "single");
  const ten = estimateGenerationTokens("image-to-video", { resolution: "1080p", width: 1920, height: 1080, durationSec: 10, animationMode: "live" }, [], "single");
  const threeD = estimateGenerationTokens("image-to-video", { resolution: "1080p", width: 1920, height: 1080, durationSec: 5, animationMode: "3d" }, [], "single");
  assert.ok(Math.abs(ten - five * 2) <= 10);
  assert.ok(threeD > five);
});

test("storyboard estimate uses total duration and per-shot overhead", () => {
  const rows = [0, 1, 2].map((order) => ({
    id: `r${order}`,
    order,
    shotSize: "中景",
    motion: "推进",
    description: "shot",
    durationSec: 3,
  }));
  const storyboard = estimateGenerationTokens("multi-image-to-video", { resolution: "1080p" }, rows, "storyboard");
  assert.equal(storyboard, (9 * 2800 + 3 * 800) / 10 * 10);
});

test("bitrate does not affect token estimate while resolution does", () => {
  const base = estimateGenerationTokens("text-to-video", { resolution: "1080p", durationSec: 5 }, [], "single");
  const bitrate = estimateGenerationTokens("text-to-video", { resolution: "1080p", durationSec: 5, bitrateKbps: 80000 }, [], "single");
  const hd = estimateGenerationTokens("text-to-video", { resolution: "720p", durationSec: 5 }, [], "single");
  assert.equal(base, bitrate);
  assert.ok(base > hd);
  assert.ok(resolutionFactor("text-to-video", { resolution: "4K" }) > 1);
});

test("preset resolution ignores redundant exact dimensions for token scaling", () => {
  const preset = estimateGenerationTokens(
    "text-to-video",
    { resolution: "720p", width: 1280, height: 720, durationSec: 5 },
    [],
    "single"
  );
  const withoutDims = estimateGenerationTokens("text-to-video", { resolution: "720p", durationSec: 5 }, [], "single");
  assert.equal(preset, withoutDims);
});

test("custom dimensions are resolved for wide and portrait video", () => {
  assert.deepEqual(dimensionsFor("text-to-video", { width: 1600, height: 900 }), { width: 1600, height: 900 });
  assert.deepEqual(dimensionsFor("text-to-image", { resolution: "4K" }), { width: 3840, height: 2160 });
  assert.deepEqual(dimensionsFor("text-to-video", { resolution: "720p", aspectRatio: "9:16" }), { width: 720, height: 1280 });
  assert.deepEqual(dimensionsFor("text-to-image", { resolution: "2K", aspectRatio: "1:1" }), { width: 2048, height: 2048 });
});
