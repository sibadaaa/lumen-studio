import type { TokenUsage } from "../../shared/contracts.js";
import { PROVIDER_CAPABILITIES } from "../../shared/contracts.js";
import { readImageDataUrl } from "../media/local.js";
import { heuristicUsage, joinUrl, ProviderError, requestJson, usageFrom } from "./http.js";
import type {
  ProviderAdapter,
  ProviderOutput,
  ProviderRequest,
  ProviderTask,
  ProviderTestResult,
  ResolvedProviderConfig,
} from "./types.js";

interface ArkImageResponse {
  data?: Array<{ url?: string; b64_json?: string; size?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  error?: { message?: string };
}

interface ArkTaskResponse {
  id?: string;
  status?: string;
  progress?: number;
  content?: { video_url?: string; last_frame_url?: string };
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  error?: { code?: string; message?: string };
}

const ANIMATION_PROMPT: Record<string, string> = {
  live: "保持实拍电影质感，自然运动与真实运镜。",
  "2d": "将画面处理为二维手绘动画风格，逐帧动画质感，保留原构图。",
  "3d": "将画面处理为三维动画渲染风格，保留主体轮廓与材质细节。",
  stop: "定格动画风格，12fps 抽帧节奏，手工模型质感。",
};

export class ArkAdapter implements ProviderAdapter {
  readonly id = "ark";
  readonly capabilities = PROVIDER_CAPABILITIES.ark;
  private readonly config: ResolvedProviderConfig;

  constructor(config: ResolvedProviderConfig) {
    this.config = config;
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  async testConnection(): Promise<ProviderTestResult> {
    const started = Date.now();
    try {
      const response = await requestJson<{ data?: Array<{ id?: string }>; items?: Array<{ id?: string }> }>(
        joinUrl(this.config.baseUrl, "/models"),
        { headers: this.headers(), timeoutMs: 12_000, maxRetries: 1, providerLabel: "火山方舟" }
      );
      const models = (response.data || response.items || []).map((item) => item.id).filter(Boolean) as string[];
      return {
        ok: true,
        latencyMs: Date.now() - started,
        message: models.length ? `连接正常 · 探测到 ${models.length} 个模型` : "连接正常",
        models,
      };
    } catch (error) {
      if (error instanceof ProviderError) {
        if (error.status === 404) {
          return {
            ok: true,
            latencyMs: Date.now() - started,
            message: "网关可达（该部署未开放 /models，生成接口仍可用）",
          };
        }
        return {
          ok: false,
          latencyMs: Date.now() - started,
          message: error.message,
        };
      }
      throw error;
    }
  }

  async submit(request: ProviderRequest): Promise<ProviderTask> {
    if (request.mode === "text-to-image" || request.mode === "image-to-image") {
      return this.generateImage(request);
    }
    return this.createVideoTask(request);
  }

  private async generateImage(request: ProviderRequest): Promise<ProviderTask> {
    const body: Record<string, unknown> = {
      model: this.config.imageModel,
      prompt: request.negativePrompt
        ? `${request.prompt}\n\n避免出现：${request.negativePrompt}`
        : request.prompt,
      size: `${Math.round(request.width)}x${Math.round(request.height)}`,
      response_format: "b64_json",
      watermark: false,
      sequential_image_generation: "disabled",
      stream: false,
    };
    if (typeof request.seed === "number" && request.seed >= 0) body.seed = request.seed;
    if (request.mode === "image-to-image" && request.images.length) {
      body.image = await readImageDataUrl(request.images[0].url);
    }

    const response = await requestJson<ArkImageResponse>(joinUrl(this.config.baseUrl, "/images/generations"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      timeoutMs: 180_000,
      providerLabel: "火山方舟",
      maxRetries: 2,
    });
    if (response.error?.message) {
      throw new ProviderError(response.error.message, { code: "PROVIDER_BAD_RESPONSE", retryable: false });
    }
    const outputs: ProviderOutput[] = [];
    for (const item of response.data || []) {
      if (item.b64_json) {
        outputs.push({ kind: "image", data: Buffer.from(item.b64_json, "base64"), mime: "image/png" });
      } else if (item.url) {
        outputs.push({ kind: "image", url: item.url, mime: "image/jpeg" });
      }
    }
    if (!outputs.length) {
      throw new ProviderError("火山方舟未返回图像结果", { code: "PROVIDER_EMPTY_RESULT", retryable: false });
    }
    const usage =
      usageFrom(response.usage?.input_tokens, response.usage?.output_tokens, response.usage?.total_tokens) ||
      heuristicUsage(request.prompt, 1);
    return {
      providerTaskId: `ark_img_${Date.now()}`,
      status: "succeeded",
      progress: 100,
      outputs,
      usage,
    };
  }

  private async createVideoTask(request: ProviderRequest): Promise<ProviderTask> {
    const content: Array<Record<string, unknown>> = [
      {
        type: "text",
        text: `${request.prompt}\n${ANIMATION_PROMPT[request.animationMode || "live"] || ""}`.trim(),
      },
    ];
    if (request.mode === "image-to-video" && request.images.length) {
      for (const image of request.images.slice(0, 2)) {
        const role = image.role === "last_frame" ? "last_frame" : "first_frame";
        content.push({
          type: "image_url",
          image_url: { url: await readImageDataUrl(image.url) },
          role,
        });
      }
    }
    const body: Record<string, unknown> = {
      model: this.config.videoModel,
      content,
      ratio: request.ratio || "16:9",
      duration: Math.max(1, Math.round(request.durationSec)),
      resolution: request.resolution === "720p" ? "720p" : request.resolution === "4K" ? "1080p" : "1080p",
      generate_audio: true,
      watermark: false,
    };
    if (typeof request.seed === "number" && request.seed >= 0) body.seed = request.seed;

    const response = await requestJson<ArkTaskResponse>(joinUrl(this.config.baseUrl, "/contents/generations/tasks"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      timeoutMs: 90_000,
      providerLabel: "火山方舟",
      maxRetries: 2,
    });
    if (!response.id) {
      throw new ProviderError(response.error?.message || "火山方舟未返回任务 ID", {
        code: "PROVIDER_BAD_RESPONSE",
        retryable: false,
      });
    }
    return {
      providerTaskId: response.id,
      status: response.status === "succeeded" ? "succeeded" : "queued",
      progress: response.progress,
      outputs: response.content?.video_url
        ? [{ kind: "video", url: response.content.video_url, mime: "video/mp4" }]
        : undefined,
      usage: usageFrom(response.usage?.input_tokens, response.usage?.output_tokens, response.usage?.total_tokens),
    };
  }

  async poll(providerTaskId: string): Promise<ProviderTask> {
    const response = await requestJson<ArkTaskResponse>(
      joinUrl(this.config.baseUrl, `/contents/generations/tasks/${encodeURIComponent(providerTaskId)}`),
      { headers: this.headers(), timeoutMs: 45_000, providerLabel: "火山方舟", maxRetries: 2 }
    );
    const status = String(response.status || "running");
    if (["failed", "expired", "cancelled", "canceled"].includes(status)) {
      return {
        providerTaskId,
        status: "failed",
        progress: 100,
        usage: usageFrom(response.usage?.input_tokens, response.usage?.output_tokens, response.usage?.total_tokens),
        error: {
          code: status === "expired" ? "PROVIDER_TASK_EXPIRED" : "PROVIDER_TASK_FAILED",
          message: response.error?.message || `火山方舟任务${status === "expired" ? "已过期" : "失败"}`,
          retryable: status === "expired",
        },
      };
    }
    const outputs: ProviderOutput[] = [];
    if (response.content?.video_url) {
      outputs.push({ kind: "video", url: response.content.video_url, mime: "video/mp4" });
    }
    const usage: TokenUsage | undefined = usageFrom(
      response.usage?.input_tokens,
      response.usage?.output_tokens,
      response.usage?.total_tokens
    );
    if (status === "succeeded") {
      if (!outputs.length) {
        return {
          providerTaskId,
          status: "failed",
          progress: 100,
          usage,
          error: { code: "PROVIDER_EMPTY_RESULT", message: "任务完成但没有视频地址", retryable: false },
        };
      }
      return { providerTaskId, status: "succeeded", progress: 100, outputs, usage };
    }
    return {
      providerTaskId,
      status: status === "queued" ? "queued" : "running",
      progress: typeof response.progress === "number" ? Math.max(0, Math.min(99, response.progress)) : undefined,
      usage,
    };
  }

  async cancel(providerTaskId: string): Promise<void> {
    await requestTextRaw(
      joinUrl(this.config.baseUrl, `/contents/generations/tasks/${encodeURIComponent(providerTaskId)}`),
      { method: "DELETE", headers: this.headers(), timeoutMs: 15_000 }
    ).catch(() => undefined);
  }
}

async function requestTextRaw(url: string, init: RequestInit & { timeoutMs?: number }) {
  const { timeoutMs = 15_000, ...rest } = init;
  await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
}
