import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { composeImageSlideshow, ffmpegAvailable, probeMedia } from "../media/ffmpeg.js";

test("FFmpeg composes two stills into a normalized MP4", async (t) => {
  if (!(await ffmpegAvailable())) {
    t.skip("ffmpeg not installed");
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lumen-ffmpeg-"));
  const output = path.join(dir, "out.mp4");
  const images = [
    path.join(process.cwd(), "public/assets/1470071459604-3b5ec3a7fe05.jpg"),
    path.join(process.cwd(), "public/assets/1618005198919-d3d4b5a92ead.jpg"),
  ];
  await composeImageSlideshow(images, {
    output,
    width: 640,
    height: 360,
    fps: 24,
    durations: [1.5, 1.5],
    motion: ["缓慢推进", "缓慢拉远"],
    transition: "dissolve",
    bitrateKbps: 2000,
  });
  assert.ok(fs.existsSync(output));
  const probe = await probeMedia(output);
  assert.equal(probe.width, 640);
  assert.equal(probe.height, 360);
  assert.ok((probe.durationSec || 0) > 2);
  assert.ok(fs.statSync(output).size > 10_000);
  fs.rmSync(dir, { recursive: true, force: true });
});
