import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lumen-agent-"));
process.env.DATA_DIR = dir;
process.env.DEFAULT_PROVIDER = "mock";
process.env.APP_SECRET = "agent-test-secret";

test("agent intent parser maps modes, aspect, bitrate and animation", async () => {
  const { parseIntent } = await import("../agent/runtime.js");

  const multi = parseIntent("用这 2 张图做 3 镜图组视频，竖屏，每镜 2 秒，720p，10 Mbps", 2);
  assert.equal(multi.mode, "multi-image-to-video");
  assert.equal(multi.shots, 3);
  assert.equal(multi.aspectRatio, "9:16");
  assert.equal(multi.resolution, "720p");
  assert.equal(multi.bitrateKbps, 10000);
  assert.equal(multi.durationSec, 6);

  const i2v = parseIntent("让这张图动起来，做成 3D 动画，5 秒", 1);
  assert.equal(i2v.mode, "image-to-video");
  assert.equal(i2v.animationMode, "3d");

  const t2i = parseIntent("生成一张雾中玻璃的电影静帧", 0);
  assert.equal(t2i.mode, "text-to-image");
  assert.equal(t2i.storyboard, false);

  const t2v = parseIntent("文生视频：星云旋转，4 个分镜，每镜 3 秒，1080p", 0);
  assert.equal(t2v.mode, "text-to-video");
  assert.equal(t2v.storyboard, true);
  assert.equal(t2v.shots, 4);
  assert.equal(t2v.resolution, "1080p");

  const portrait = parseIntent("生成一张竖屏 2K 海报", 0);
  assert.equal(portrait.aspectRatio, "9:16");
  fs.rmSync(dir, { recursive: true, force: true });
});
