import fs from "node:fs";
import path from "node:path";
import type {
  GenerationError,
  GenerationTask,
  MediaAsset,
  StoryboardRow,
  TokenUsage,
} from "../../shared/contracts.js";
import { config, mediaUrl, paths } from "../config.js";
import {
  composeImageSlideshow,
  composeVideoClips,
  createThumbnail,
  extensionMime,
  fileSize,
  mimeExtension,
  probeMedia,
} from "../media/ffmpeg.js";
import { readMediaBytes, resolveLocalMedia, safeFetch } from "../media/local.js";
import { createAdapter } from "../providers/index.js";
import { ProviderError } from "../providers/http.js";
import type { ProviderAdapter, ProviderOutput, ProviderRequest, ProviderTask } from "../providers/types.js";
import { dimensionsFor } from "./estimate.js";
import { isTerminal, jobStore, type StoredJob } from "./store.js";
import { providerStore } from "../storage/providers.js";
import { assetStore } from "../storage/assets.js";

class JobCanceledError extends Error {
  constructor() {
    super("任务已取消");
    this.name = "JobCanceledError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => new Date().toISOString();
const isImageMode = (mode: string) => mode === "text-to-image" || mode === "image-to-image";
const isVideoMode = (mode: string) => !isImageMode(mode);

export class JobRunner {
  private readonly concurrency: number;
  private active = new Map<string, Promise<void>>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(concurrency = config.concurrency) {
    this.concurrency = Math.max(1, Math.min(4, concurrency));
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 500);
    this.timer.unref?.();
    jobStore.events.on("any", () => void this.tick());
    void this.tick();
    console.log(`[jobs] runner started · concurrency=${this.concurrency}`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      while (this.active.size < this.concurrency) {
        const next = jobStore.queued(1)[0];
        if (!next) break;
        this.launch(next);
      }
    } finally {
      this.ticking = false;
    }
  }

  private launch(job: StoredJob) {
    const promise = this.run(job.id)
      .catch((error) => {
        console.error(`[jobs] unhandled error for ${job.id}:`, error);
      })
      .finally(() => {
        this.active.delete(job.id);
        void this.tick();
      });
    this.active.set(job.id, promise);
  }

  stats() {
    return { active: this.active.size, concurrency: this.concurrency };
  }

  private async run(jobId: string) {
    const job = jobStore.raw(jobId);
    if (!job || isTerminal(job.status)) return;
    if (job.internal.canceled) {
      this.finishCanceled(job);
      return;
    }

    const provider = providerStore.getResolved(job.providerId);
    if (!provider) {
      this.fail(job, {
        code: "PROVIDER_NOT_CONFIGURED",
        message: "未找到 Provider 配置，请先在 API 设置中保存密钥",
        retryable: false,
      });
      return;
    }
    if (!provider.configured) {
      this.fail(job, {
        code: "PROVIDER_NOT_CONFIGURED",
        message: `${provider.label} 尚未配置 API Key`,
        retryable: false,
      });
      return;
    }

    const adapter = createAdapter(provider);
    jobStore.update(job.id, {
      status: "running",
      progress: 2,
      stage: "正在准备生成任务",
      startedAt: now(),
      error: null,
    });
    jobStore.appendLog(job.id, `worker picked job via ${provider.label} (${provider.kind})`);

    try {
      if (job.mode === "text-to-image" || job.mode === "image-to-image") {
        await this.runImage(job, adapter);
      } else if (job.mode === "image-to-video") {
        await this.runImageToVideo(job, adapter);
      } else if (job.mode === "text-to-video") {
        if (job.generationType === "storyboard" && job.storyboard.length > 1) {
          await this.runStoryboardVideos(job, adapter);
        } else {
          await this.runSingleVideo(job, adapter);
        }
      } else if (job.mode === "multi-image-to-video") {
        await this.runMultiImageVideo(job, adapter);
      } else {
        throw new Error(`unsupported mode ${job.mode}`);
      }
    } catch (error) {
      if (error instanceof JobCanceledError || jobStore.raw(job.id)?.internal.canceled) {
        this.finishCanceled(job);
      } else {
        this.fail(job, this.toGenerationError(error, job));
      }
    }
  }

  private finishCanceled(job: StoredJob) {
    const fresh = jobStore.raw(job.id) || job;
    if (fresh.internal.providerTaskId && fresh.providerId) {
      const provider = providerStore.getResolved(fresh.providerId);
      if (provider) {
        const adapter = createAdapter(provider);
        void adapter.cancel?.(fresh.internal.providerTaskId).catch(() => undefined);
      }
    }
    jobStore.update(job.id, {
      status: "canceled",
      stage: "已取消",
      finishedAt: now(),
      shots: job.shots.map((shot) => ({
        ...shot,
        status: shot.status === "succeeded" ? "succeeded" : "canceled",
      })),
    });
    jobStore.appendLog(job.id, "job canceled");
  }

  private fail(job: StoredJob, error: GenerationError) {
    jobStore.update(job.id, {
      status: "failed",
      progress: Math.max(job.progress, 1),
      stage: "生成失败",
      error,
      finishedAt: now(),
      shots: job.shots.map((shot) => ({
        ...shot,
        status: shot.status === "succeeded" ? "succeeded" : "failed",
        error: shot.status === "succeeded" ? shot.error : error,
      })),
    });
    jobStore.appendLog(job.id, `failed: ${error.code} ${error.message}`);
  }

  private toGenerationError(error: unknown, job: StoredJob): GenerationError {
    if (error instanceof ProviderError) {
      return {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        details: error.details,
        traceId: job.id,
        tokensUsed: job.usage?.totalTokens,
      };
    }
    return {
      code: "GENERATION_FAILED",
      message: (error as Error)?.message || "生成失败",
      retryable: false,
      traceId: job.id,
      tokensUsed: job.usage?.totalTokens,
    };
  }

  private buildRequest(job: StoredJob, prompt = job.prompt, storyboardRow?: StoryboardRow): ProviderRequest {
    const provider = providerStore.getResolved(job.providerId);
    const dims = dimensionsFor(job.mode, job.params);
    const model =
      job.modelId ||
      (isImageMode(job.mode) ? provider?.imageModel || "image-model" : provider?.videoModel || "video-model");
    return {
      mode: job.mode,
      model,
      prompt,
      negativePrompt: job.params.negativePrompt,
      images: this.resolveImages(job, storyboardRow),
      ratio: job.params.aspectRatio || "16:9",
      resolution: job.params.resolution || (isVideoMode(job.mode) ? "1080p" : "2K"),
      width: dims.width,
      height: dims.height,
      bitrateKbps: job.params.bitrateKbps,
      animationMode: job.params.animationMode,
      durationSec: storyboardRow?.durationSec || job.params.durationSec || 5,
      fps: job.params.fps || 24,
      seed: job.params.seed,
      strength: job.params.strength,
      motion: storyboardRow?.motion || job.params.motion,
    };
  }

  private resolveImages(job: StoredJob, storyboardRow?: StoryboardRow) {
    const images: ProviderRequest["images"] = [];
    const add = (url: string | null | undefined, role: ProviderRequest["images"][number]["role"], order: number) => {
      if (url) images.push({ url, role, order });
    };
    for (const input of job.inputs) {
      const asset = input.assetId ? assetStore.get(input.assetId) : null;
      add(input.url || asset?.url, input.role, input.order);
    }
    if (storyboardRow) {
      const asset = storyboardRow.assetId ? assetStore.get(storyboardRow.assetId) : null;
      add(storyboardRow.imageUrl || asset?.url, "shot", storyboardRow.order);
    }
    return images.sort((a, b) => a.order - b.order);
  }

  private resolveRowImage(row: StoryboardRow): string | null {
    if (row.imageUrl) return row.imageUrl;
    if (row.assetId) return assetStore.get(row.assetId)?.url || null;
    return null;
  }

  private imageRequest(job: StoredJob, prompt: string): ProviderRequest {
    const provider = providerStore.getResolved(job.providerId);
    const dims = dimensionsFor(job.mode, job.params);
    return {
      mode: "text-to-image",
      model: provider?.imageModel || "image-model",
      prompt,
      negativePrompt: job.params.negativePrompt,
      images: [],
      ratio: job.params.aspectRatio || "16:9",
      resolution: job.params.resolution || "2K",
      width: dims.width,
      height: dims.height,
      durationSec: 5,
      fps: job.params.fps || 24,
      seed: job.params.seed,
      strength: job.params.strength,
    };
  }

  /**
   * Cancellation is requested through JobStore.cancel() from another request,
   * so the StoredJob captured at the start of run() is a stale snapshot. Always
   * re-read the row, otherwise cancel appears to succeed but the worker keeps
   * generating and composing.
   */
  private checkCanceled(jobId: string) {
    if (jobStore.raw(jobId)?.internal.canceled) throw new JobCanceledError();
  }

  private async awaitProvider(
    job: StoredJob,
    adapter: ProviderAdapter,
    initial: ProviderTask,
    options: { label: string; timeoutMs: number; progressFrom: number; progressTo: number; shotOrder?: number }
  ): Promise<ProviderTask> {
    let task = initial;
    if (task.status === "succeeded") return task;
    if (task.status === "failed") {
      throw new ProviderError(task.error?.message || `${options.label}失败`, {
        code: task.error?.code || "PROVIDER_TASK_FAILED",
        retryable: task.error?.retryable ?? false,
      });
    }
    const started = Date.now();
    let lastProgress = options.progressFrom;
    while (Date.now() - started < options.timeoutMs) {
      this.checkCanceled(job.id);
      if (task.providerTaskId) {
        jobStore.update(job.id, {
          internal: {
            providerTaskId: options.shotOrder === undefined ? task.providerTaskId : job.internal.providerTaskId,
            ...(options.shotOrder !== undefined
              ? { shotProviderTaskIds: { ...job.internal.shotProviderTaskIds, [String(options.shotOrder)]: task.providerTaskId } }
              : {}),
          },
        });
      }
      await sleep(config.pollIntervalMs);
      this.checkCanceled(job.id);
      const polled = await adapter.poll(task.providerTaskId);
      task = polled;
      if (task.usage) {
        // Provider usage is cumulative for a task; never add it on every poll.
        jobStore.update(job.id, { usage: task.usage });
      }
      if (task.status === "failed") {
        throw new ProviderError(task.error?.message || `${options.label}失败`, {
          code: task.error?.code || "PROVIDER_TASK_FAILED",
          retryable: task.error?.retryable ?? false,
        });
      }
      if (task.status === "succeeded") return task;
      const pct =
        typeof task.progress === "number" && task.progress > 0
          ? task.progress
          : Math.min(92, 10 + ((Date.now() - started) / options.timeoutMs) * 80);
      const mapped = Math.round(options.progressFrom + (pct / 100) * (options.progressTo - options.progressFrom));
      if (mapped > lastProgress) {
        lastProgress = mapped;
        jobStore.update(job.id, { progress: mapped, stage: this.stageFor(job, options.label) });
      }
    }
    throw new ProviderError(`${options.label}轮询超时，可稍后重试`, {
      code: "PROVIDER_TIMEOUT",
      retryable: true,
      details: { timeoutMs: options.timeoutMs },
    });
  }

  private stageFor(job: StoredJob, label: string) {
    if (job.mode === "text-to-video" || job.mode === "multi-image-to-video") {
      const activeShot = job.shots.find((shot) => shot.status === "running");
      if (activeShot) return `正在生成第 ${activeShot.order + 1} / ${job.shots.length} 镜`;
    }
    return label;
  }

  private async runImage(job: StoredJob, adapter: ProviderAdapter) {
    this.checkCanceled(job.id);
    if (job.mode === "image-to-image" && !job.inputs.length) {
      throw new ProviderError("图生图需要至少一张参考图", { code: "IMAGE_REQUIRED", retryable: false });
    }
    jobStore.update(job.id, { status: "running", progress: 12, stage: "正在提交图像任务" });
    const task = await adapter.submit(this.buildRequest(job));
    const final = await this.awaitProvider(job, adapter, task, {
      label: "正在渲染图像",
      timeoutMs: config.imageTimeoutMs,
      progressFrom: 20,
      progressTo: 92,
    });
    if (!final.outputs?.length) {
      throw new ProviderError("Provider 未返回图像", { code: "PROVIDER_EMPTY_RESULT", retryable: false });
    }
    jobStore.update(job.id, { status: "postprocessing", progress: 94, stage: "正在转存图像" });
    const { file: _imageFile, ...asset } = await this.persistOutput(job, final.outputs[0], "image");
    this.complete(job, [asset], final.usage, "图像生成完成");
  }

  private async runSingleVideo(job: StoredJob, adapter: ProviderAdapter) {
    this.checkCanceled(job.id);
    jobStore.update(job.id, { status: "running", progress: 8, stage: "正在提交视频任务" });
    const task = await adapter.submit(this.buildRequest(job));
    const final = await this.awaitProvider(job, adapter, task, {
      label: "正在生成视频",
      timeoutMs: config.videoTimeoutMs,
      progressFrom: 14,
      progressTo: 90,
    });
    if (!final.outputs?.length) {
      throw new ProviderError("Provider 未返回视频", { code: "PROVIDER_EMPTY_RESULT", retryable: false });
    }
    jobStore.update(job.id, { status: "postprocessing", progress: 94, stage: "正在转码与转存视频" });
    const { file: _videoFile, ...asset } = await this.persistOutput(job, final.outputs[0], "video");
    this.complete(job, [asset], final.usage, "视频生成完成");
  }

  private async runImageToVideo(job: StoredJob, adapter: ProviderAdapter) {
    this.checkCanceled(job.id);
    if (!this.resolveImages(job).length) {
      throw new ProviderError("图生视频需要一张首帧图片", { code: "IMAGE_REQUIRED", retryable: false });
    }
    jobStore.update(job.id, {
      status: "running",
      progress: 8,
      stage: job.params.animationMode && job.params.animationMode !== "live" ? "正在重绘动画风格" : "正在解析首帧",
    });
    const request = this.buildRequest(job);
    if (!request.images.length && job.storyboard[0]) {
      const fallback = this.resolveRowImage(job.storyboard[0]);
      if (fallback) request.images.push({ url: fallback, role: "first_frame", order: 0 });
    }
    const task = await adapter.submit(request);
    const final = await this.awaitProvider(job, adapter, task, {
      label: "正在驱动画面运动",
      timeoutMs: config.videoTimeoutMs,
      progressFrom: 16,
      progressTo: 90,
    });
    if (!final.outputs?.length) {
      throw new ProviderError("Provider 未返回视频", { code: "PROVIDER_EMPTY_RESULT", retryable: false });
    }
    jobStore.update(job.id, { status: "postprocessing", progress: 94, stage: "正在转码与转存视频" });
    const { file: _animFile, ...asset } = await this.persistOutput(job, final.outputs[0], "video");
    this.complete(job, [asset], final.usage, "动画视频生成完成");
  }

  private async runStoryboardVideos(job: StoredJob, adapter: ProviderAdapter) {
    const rows = job.storyboard;
    const clips: string[] = [];
    const usages: TokenUsage[] = [];
    const durations: number[] = [];
    for (const [index, row] of rows.entries()) {
      this.checkCanceled(job.id);
      jobStore.update(job.id, {
        progress: Math.round(5 + (index / rows.length) * 72),
        stage: `正在生成第 ${index + 1} / ${rows.length} 镜`,
        shots: job.shots.map((shot) =>
          shot.order === index ? { ...shot, status: "running", progress: 5 } : shot
        ),
      });
      const prompt = [job.prompt, row.description, row.shotSize, row.motion, row.audio ? `声音：${row.audio}` : ""]
        .filter(Boolean)
        .join("，");
      const task = await adapter.submit(this.buildRequest(job, prompt, row));
      const final = await this.awaitProvider(job, adapter, task, {
        label: `正在生成第 ${index + 1} 镜`,
        timeoutMs: config.videoTimeoutMs,
        progressFrom: Math.round(5 + (index / rows.length) * 72),
        progressTo: Math.round(5 + ((index + 1) / rows.length) * 72),
        shotOrder: index,
      });
      if (!final.outputs?.length) {
        throw new ProviderError(`第 ${index + 1} 镜没有返回视频`, {
          code: "PROVIDER_EMPTY_RESULT",
          retryable: false,
        });
      }
      const clip = await this.persistTempClip(job, final.outputs[0], `shot-${index}`);
      clips.push(clip.file);
      durations.push(Math.max(1, row.durationSec || job.params.shotDurationSec || 3));
      if (final.usage) usages.push(final.usage);
      jobStore.update(job.id, {
        progress: Math.round(5 + ((index + 1) / rows.length) * 72),
        shots: job.shots.map((shot) =>
          shot.order === index ? { ...shot, status: "succeeded", progress: 100 } : shot
        ),
      });
    }
    this.checkCanceled(job.id);
    jobStore.update(job.id, { status: "postprocessing", progress: 82, stage: "FFmpeg 正在统一规格并合成" });
    const dims = dimensionsFor(job.mode, job.params);
    const finalPath = path.join(paths.outputs, `${job.id}-final.mp4`);
    await composeVideoClips(clips, {
      output: finalPath,
      width: dims.width,
      height: dims.height,
      fps: job.params.fps || 24,
      durations,
      transition: job.params.transition || "dissolve",
      bitrateKbps: job.params.bitrateKbps,
    });
    const asset = await this.recordOutputFile(job, finalPath, "video", "final");
    this.cleanupFiles(clips);
    const usage = usages.length
      ? mergeManyUsage(usages)
      : fallbackUsage(job, "ffmpeg");
    this.complete(job, [asset], usage, "分镜视频合成完成");
  }

  private async runMultiImageVideo(job: StoredJob, adapter: ProviderAdapter) {
    const rows = job.storyboard;
    if (!rows.length) throw new ProviderError("图组视频需要 2–9 个分镜", { code: "STORYBOARD_REQUIRED", retryable: false });
    const frames: string[] = [];
    const tempFiles: string[] = [];
    const durations: number[] = [];
    const motions: string[] = [];
    let imageUsage: TokenUsage[] = [];

    for (const [index, row] of rows.entries()) {
      this.checkCanceled(job.id);
      jobStore.update(job.id, {
        progress: Math.round(5 + (index / rows.length) * 65),
        stage: `正在准备第 ${index + 1} / ${rows.length} 镜画面`,
        shots: job.shots.map((shot) =>
          shot.order === row.order ? { ...shot, status: "running", progress: 20 } : shot
        ),
      });
      const source = this.resolveRowImage(row);
      let frame: string;
      let generated = false;
      if (source) {
        const local = await this.materializeImage(job, source, `frame-${index}`);
        frame = local.file;
        if (local.temp) tempFiles.push(local.file);
      } else {
        const stillPrompt = [job.prompt, row.description, row.shotSize, row.motion].filter(Boolean).join("，");
        const task = await adapter.submit(this.imageRequest(job, stillPrompt));
        const final = await this.awaitProvider(job, adapter, task, {
          label: `正在生成第 ${index + 1} 镜画面`,
          timeoutMs: config.imageTimeoutMs,
          progressFrom: Math.round(5 + (index / rows.length) * 65),
          progressTo: Math.round(5 + ((index + 1) / rows.length) * 65),
          shotOrder: index,
        });
        if (!final.outputs?.length) {
          throw new ProviderError(`第 ${index + 1} 镜没有返回画面`, {
            code: "PROVIDER_EMPTY_RESULT",
            retryable: false,
          });
        }
        const still = await this.persistTempClip(job, final.outputs[0], `still-${index}`);
        frame = still.file;
        tempFiles.push(still.file);
        generated = true;
        if (final.usage) imageUsage.push(final.usage);
        jobStore.update(job.id, {
          shots: job.shots.map((shot) =>
            shot.order === row.order ? { ...shot, status: "running", progress: 65 } : shot
          ),
        });
      }
      if (!generated) {
        jobStore.update(job.id, {
          shots: job.shots.map((shot) =>
            shot.order === row.order ? { ...shot, status: "running", progress: 65 } : shot
          ),
        });
      }
      frames.push(frame);
      durations.push(Math.max(1, row.durationSec || job.params.shotDurationSec || 5));
      motions.push(row.motion || "缓慢推进");
    }

    this.checkCanceled(job.id);
    jobStore.update(job.id, { status: "postprocessing", progress: 78, stage: "FFmpeg 正在编排镜头与转场" });
    const dims = dimensionsFor(job.mode, job.params);
    const finalPath = path.join(paths.outputs, `${job.id}-final.mp4`);
    await composeImageSlideshow(frames, {
      output: finalPath,
      width: dims.width,
      height: dims.height,
      fps: job.params.fps || 24,
      durations,
      motion: motions,
      transition: job.params.transition || "dissolve",
      bitrateKbps: job.params.bitrateKbps,
    });
    const asset = await this.recordOutputFile(job, finalPath, "video", "final");
    this.cleanupFiles(tempFiles);
    const usage = imageUsage.length ? mergeManyUsage(imageUsage) : fallbackUsage(job, "ffmpeg");
    this.complete(job, [asset], usage, "图组视频合成完成");
  }

  private complete(job: StoredJob, outputs: MediaAsset[], usage: TokenUsage | undefined, stage: string) {
    const finalUsage = usage || fallbackUsage(job, "heuristic");
    jobStore.update(job.id, {
      status: "succeeded",
      progress: 100,
      stage,
      outputs,
      usage: finalUsage,
      finishedAt: now(),
      shots: job.shots.map((shot) => ({ ...shot, status: "succeeded", progress: 100 })),
    });
    jobStore.appendLog(job.id, `succeeded · ${finalUsage.totalTokens} tokens (${finalUsage.source})`);
  }

  private async persistOutput(
    job: StoredJob,
    output: ProviderOutput,
    suffix: string,
    keepFile = false
  ): Promise<MediaAsset & { file: string }> {
    const ext = mimeExtension(output.mime);
    const file = path.join(paths.outputs, `${job.id}-${suffix}.${ext}`);
    if (output.data) {
      fs.writeFileSync(file, output.data);
    } else if (output.url) {
      const response = await safeFetch(output.url, {
        headers: output.headers,
        signal: AbortSignal.timeout(30 * 60_000),
      });
      if (!response.ok || !response.body) throw new Error(`下载生成结果失败：HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(file, buffer);
      if (!output.mime || output.mime === "application/octet-stream") {
        output.mime = response.headers.get("content-type")?.split(";")[0] || output.mime;
      }
    } else {
      throw new Error("Provider 输出既没有 URL 也没有数据");
    }
    const asset = await this.recordOutputFile(job, file, output.kind, suffix);
    if (!keepFile) {
      // The output file stays; only temporary still frames are cleaned later.
    }
    return { ...asset, file };
  }

  private async recordOutputFile(
    job: StoredJob,
    file: string,
    kind: "image" | "video",
    suffix: string
  ): Promise<MediaAsset> {
    const probe = await probeMedia(file).catch(() => null);
    const assetId = `out_${job.id.replace(/[^a-z0-9]/gi, "")}_${suffix}`;
    let thumbnailUrl: string | undefined;
    const thumb = path.join(paths.outputs, `${job.id}-${suffix}_thumb.jpg`);
    try {
      await createThumbnail(file, thumb);
      thumbnailUrl = mediaUrl("outputs", path.basename(thumb));
    } catch {
      thumbnailUrl = undefined;
    }
    return {
      id: assetId,
      kind,
      mime: extensionMime(file),
      size: fileSize(file),
      width: probe?.width,
      height: probe?.height,
      durationSec: kind === "video" ? probe?.durationSec : undefined,
      url: mediaUrl("outputs", path.basename(file)),
      thumbnailUrl,
      createdAt: now(),
    };
  }

  private async persistTempClip(job: StoredJob, output: ProviderOutput, suffix: string) {
    const ext = output.kind === "video" ? "mp4" : mimeExtension(output.mime);
    const file = path.join(paths.tmp, `${job.id}-${suffix}.${ext}`);
    if (output.data) fs.writeFileSync(file, output.data);
    else if (output.url) {
      const response = await safeFetch(output.url, {
        headers: output.headers,
        signal: AbortSignal.timeout(30 * 60_000),
      });
      if (!response.ok || !response.body) throw new Error(`下载分镜视频失败：HTTP ${response.status}`);
      fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    } else throw new Error("分镜输出为空");
    const probe = await probeMedia(file).catch(() => null);
    return { file, probe };
  }

  private async materializeImage(job: StoredJob, url: string, suffix: string) {
    const local = resolveLocalMedia(url);
    if (local?.file) return { file: local.file, temp: false };
    const media = await readMediaBytes(url, 40 * 1024 * 1024);
    if (!media.mime.startsWith("image/")) throw new Error("分镜素材必须是图片");
    const ext = media.mime.includes("png") ? "png" : media.mime.includes("webp") ? "webp" : "jpg";
    const file = path.join(paths.tmp, `${job.id}-${suffix}.${ext}`);
    fs.writeFileSync(file, media.buffer);
    return { file, temp: true };
  }

  private cleanupFiles(files: string[]) {
    for (const file of files) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

function mergeUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    estimated: a.estimated || b.estimated,
    source: a.estimated || b.estimated ? "heuristic" : "provider",
  };
}

function mergeManyUsage(items: TokenUsage[]): TokenUsage {
  return items.reduce(
    (acc, item) => mergeUsage(acc, item),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimated: false, source: "provider" }
  );
}

function fallbackUsage(job: StoredJob, source: TokenUsage["source"]): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: job.estimatedTokens,
    totalTokens: job.estimatedTokens,
    estimated: true,
    source,
  };
}

export const jobRunner = new JobRunner();
