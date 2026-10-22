import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PROVIDER_CAPABILITIES } from "../../shared/contracts.js";
import { config, paths } from "../config.js";
import { composeSingleImage, ffmpegAvailable, normalizeImage, probeMedia } from "../media/ffmpeg.js";
import { readMediaBytes } from "../media/local.js";
import { heuristicUsage } from "./http.js";
import type {
  ProviderAdapter,
  ProviderOutput,
  ProviderRequest,
  ProviderTask,
  ProviderTestResult,
  ResolvedProviderConfig,
} from "./types.js";

const DEMO_ASSETS = [
  "1470071459604-3b5ec3a7fe05.jpg",
  "1541701494587-cb58502866ab.jpg",
  "1462331940025-496dfbfc7564.jpg",
  "1618005198919-d3d4b5a92ead.jpg",
  "1634017839464-5c339ebe3cb4.jpg",
];

interface MockTask {
  request: ProviderRequest;
  startedAt: number;
  imageFile?: string;
  result?: ProviderOutput;
  usage?: ReturnType<typeof heuristicUsage>;
  working?: Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class MockAdapter implements ProviderAdapter {
  readonly id = "mock";
  readonly capabilities = PROVIDER_CAPABILITIES.mock;
  private readonly tasks = new Map<string, MockTask>();
  private readonly config: ResolvedProviderConfig;

  constructor(config: ResolvedProviderConfig) {
    this.config = config;
  }

  async testConnection(): Promise<ProviderTestResult> {
    const start = Date.now();
    const available = await ffmpegAvailable();
    await sleep(180);
    return {
      ok: available,
      latencyMs: Date.now() - start,
      message: available ? "本地演示引擎就绪 · FFmpeg 可用" : "FFmpeg 不可用，视频合成将失败",
      models: ["lumen-mock-image", "lumen-mock-video"],
    };
  }

  private pickAsset(request: ProviderRequest) {
    const hash = crypto.createHash("sha1").update(request.prompt).digest()[0];
    return path.join(config.rootDir, "public", "assets", DEMO_ASSETS[hash % DEMO_ASSETS.length]);
  }

  private usage(request: ProviderRequest, factor = 1) {
    const durationFactor = request.mode.includes("video") ? Math.max(1, request.durationSec / 5) : 1;
    const resolutionFactor = Math.max(0.5, (request.width * request.height) / (1920 * 1080));
    return heuristicUsage(request.prompt, factor * durationFactor * Math.max(0.7, Math.min(2.4, resolutionFactor)));
  }

  async submit(request: ProviderRequest): Promise<ProviderTask> {
    if (request.mode === "text-to-image" || request.mode === "image-to-image") {
      return this.generateImage(request);
    }
    if (!(await ffmpegAvailable())) {
      throw new Error("FFmpeg 不可用，无法生成演示视频");
    }
    const id = `mock_task_${crypto.randomBytes(6).toString("hex")}`;
    this.tasks.set(id, { request, startedAt: Date.now(), usage: this.usage(request) });
    return { providerTaskId: id, status: "queued", progress: 0 };
  }

  private async generateImage(request: ProviderRequest): Promise<ProviderTask> {
    const source =
      request.mode === "image-to-image" && request.images.length
        ? await this.materializeSource(request.images[0].url)
        : { file: this.pickAsset(request) };
    // A dedicated temp directory per generation call keeps concurrent stills
    // (multi-shot jobs) from ever clobbering or deleting each other's files.
    const workDir = fs.mkdtempSync(path.join(paths.tmp, "mock-img-"));
    const output = path.join(workDir, "out.jpg");
    try {
      await normalizeImage(source.file, output, request.width, request.height);
      const buffer = fs.readFileSync(output);
      const probe = await probeMedia(output).catch(() => null);
      return {
        providerTaskId: `mock_img_${crypto.randomBytes(6).toString("hex")}`,
        status: "succeeded",
        progress: 100,
        outputs: [
          {
            kind: "image",
            data: buffer,
            mime: "image/jpeg",
            width: probe?.width || request.width,
            height: probe?.height || request.height,
          },
        ],
        usage: this.usage(request),
      };
    } finally {
      if (source.cleanup) source.cleanup();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }

  private async materializeSource(url: string): Promise<{ file: string; cleanup?: () => void }> {
    const media = await readMediaBytes(url, 40 * 1024 * 1024);
    if (media.file) return { file: media.file };
    const temp = path.join(paths.tmp, `mock-src-${crypto.randomBytes(6).toString("hex")}.img`);
    fs.mkdirSync(paths.tmp, { recursive: true });
    fs.writeFileSync(temp, media.buffer);
    return { file: temp, cleanup: () => fs.rmSync(temp, { force: true }) };
  }

  async poll(providerTaskId: string): Promise<ProviderTask> {
    const task = this.tasks.get(providerTaskId);
    if (!task) {
      return {
        providerTaskId,
        status: "failed",
        progress: 100,
        error: { code: "MOCK_TASK_NOT_FOUND", message: "演示任务不存在或已过期", retryable: false },
      };
    }
    if (task.result) {
      this.tasks.delete(providerTaskId);
      return { providerTaskId, status: "succeeded", progress: 100, outputs: [task.result], usage: task.usage };
    }
    const elapsed = Date.now() - task.startedAt;
    if (elapsed < 900) return { providerTaskId, status: "queued", progress: 5 };
    if (!task.imageFile) {
      const source =
        task.request.images.length > 0
          ? await this.materializeSource(task.request.images[0].url)
          : { file: this.pickAsset(task.request) };
      const normalized = path.join(paths.tmp, `mock-frame-${crypto.randomBytes(6).toString("hex")}.jpg`);
      try {
        await normalizeImage(source.file, normalized, task.request.width, task.request.height);
        task.imageFile = normalized;
      } finally {
        source.cleanup?.();
      }
    }
    if (elapsed < 2600) return { providerTaskId, status: "running", progress: Math.min(80, Math.round((elapsed / 2600) * 80)) };
    if (!task.working) {
      task.working = (async () => {
        const output = path.join(paths.tmp, `mock-video-${crypto.randomBytes(6).toString("hex")}.mp4`);
        await composeSingleImage(task.imageFile!, output, {
          width: task.request.width,
          height: task.request.height,
          fps: task.request.fps || 24,
          duration: Math.max(1, task.request.durationSec),
          bitrateKbps: task.request.bitrateKbps,
          motion: task.request.motion,
        });
        const probe = await probeMedia(output).catch(() => null);
        task.result = {
          kind: "video",
          data: fs.readFileSync(output),
          mime: "video/mp4",
          width: probe?.width,
          height: probe?.height,
          durationSec: probe?.durationSec,
        };
        fs.rmSync(output, { force: true });
        if (task.imageFile) fs.rmSync(task.imageFile, { force: true });
        task.imageFile = undefined;
      })();
    }
    try {
      await task.working;
    } catch (error) {
      this.tasks.delete(providerTaskId);
      return {
        providerTaskId,
        status: "failed",
        progress: 100,
        error: { code: "MOCK_RENDER_FAILED", message: (error as Error).message, retryable: false },
      };
    }
    this.tasks.delete(providerTaskId);
    return {
      providerTaskId,
      status: "succeeded",
      progress: 100,
      outputs: task.result ? [task.result] : [],
      usage: task.usage,
    };
  }

  async cancel(providerTaskId: string): Promise<void> {
    const task = this.tasks.get(providerTaskId);
    if (task?.imageFile) fs.rmSync(task.imageFile, { force: true });
    this.tasks.delete(providerTaskId);
  }

  get modelConfig() {
    return this.config;
  }
}
