import type { TokenUsage } from "../../shared/contracts.js";
import { PROVIDER_CAPABILITIES } from "../../shared/contracts.js";
import { readImageDataUrl, readMediaBytes } from "../media/local.js";
import { heuristicUsage, joinUrl, ProviderError, requestJson, usageFrom } from "./http.js";
import type {
  ProviderAdapter,
  ProviderOutput,
  ProviderRequest,
  ProviderTask,
  ProviderTestResult,
  ResolvedProviderConfig,
} from "./types.js";

interface OpenAIImageResponse {
  data?: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { image_tokens?: number; text_tokens?: number };
  };
  error?: { message?: string; code?: string; type?: string };
}

interface OpenAIVideoResponse {
  id?: string;
  object?: string;
  status?: string;
  progress?: number;
  model?: string;
  seconds?: string | number;
  size?: string;
  error?: { message?: string; code?: string } | string;
  url?: string;
  output?: string | { url?: string };
  data?: Array<{ url?: string; b64_json?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
}

const ANIMATION_PROMPT: Record<string, string> = {
  live: "Natural cinematic motion, realistic physics and camera movement.",
  "2d": "Render as hand-drawn 2D animation with a consistent cel-shaded look.",
  "3d": "Render as a 3D animated film still with stylized volumetric light.",
  stop: "Stop-motion animation at 12fps, tactile miniature set, subtle frame jitter.",
};

export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly id = "openai_compatible";
  readonly capabilities = PROVIDER_CAPABILITIES.openai_compatible;
  private readonly config: ResolvedProviderConfig;
  private readonly officialOpenAI: boolean;

  constructor(config: ResolvedProviderConfig) {
    this.config = config;
    try {
      this.officialOpenAI = new URL(config.baseUrl).hostname === "api.openai.com";
    } catch {
      this.officialOpenAI = false;
    }
  }

  private headers(json = true) {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      ...(json ? { "Content-Type": "application/json" } : {}),
    };
  }

  async testConnection(): Promise<ProviderTestResult> {
    const started = Date.now();
    try {
      const response = await requestJson<{ data?: Array<{ id?: string }> }>(joinUrl(this.config.baseUrl, "/models"), {
        headers: this.headers(),
        timeoutMs: 12_000,
        maxRetries: 1,
        providerLabel: "OpenAI 兼容网关",
      });
      const models = (response.data || []).map((item) => item.id).filter(Boolean) as string[];
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
        return { ok: false, latencyMs: Date.now() - started, message: error.message };
      }
      throw error;
    }
  }

  async submit(request: ProviderRequest): Promise<ProviderTask> {
    if (request.mode === "text-to-image" || request.mode === "image-to-image") {
      return this.generateImage(request);
    }
    return this.createVideo(request);
  }

  private sizeForImage(request: ProviderRequest) {
    if (!this.officialOpenAI) return `${Math.round(request.width)}x${Math.round(request.height)}`;
    const ratio = request.width / request.height;
    if (ratio > 1.2) return "1536x1024";
    if (ratio < 0.83) return "1024x1536";
    return "1024x1024";
  }

  private async generateImage(request: ProviderRequest): Promise<ProviderTask> {
    const prompt = request.negativePrompt
      ? `${request.prompt}\n\nAvoid: ${request.negativePrompt}`
      : request.prompt;
    let response: OpenAIImageResponse;
    if (request.mode === "image-to-image" && request.images.length) {
      const form = new FormData();
      form.append("model", this.config.imageModel);
      form.append("prompt", prompt);
      form.append("size", this.sizeForImage(request));
      form.append("n", "1");
      const max = this.capabilities.maxImageCount;
      for (const [index, image] of request.images.slice(0, max).entries()) {
        const media = await readMediaBytes(image.url, 20 * 1024 * 1024);
        const extension = media.mime.split("/")[1] || "png";
        const blob = new Blob([new Uint8Array(media.buffer)], { type: media.mime });
        form.append(request.images.length > 1 ? "image[]" : "image", blob, `reference-${index}.${extension}`);
      }
      response = await requestJson<OpenAIImageResponse>(joinUrl(this.config.baseUrl, "/images/edits"), {
        method: "POST",
        headers: this.headers(false),
        body: form,
        timeoutMs: 180_000,
        providerLabel: "OpenAI 兼容网关",
        maxRetries: 1,
      });
    } else {
      const body: Record<string, unknown> = {
        model: this.config.imageModel,
        prompt,
        size: this.sizeForImage(request),
        n: 1,
      };
      if (!this.config.imageModel.startsWith("gpt-image")) body.response_format = "b64_json";
      if (typeof request.seed === "number") body.seed = request.seed;
      response = await requestJson<OpenAIImageResponse>(joinUrl(this.config.baseUrl, "/images/generations"), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        timeoutMs: 180_000,
        providerLabel: "OpenAI 兼容网关",
        maxRetries: 2,
      });
    }
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
      throw new ProviderError("网关未返回图像结果", { code: "PROVIDER_EMPTY_RESULT", retryable: false });
    }
    const usage =
      usageFrom(response.usage?.input_tokens, response.usage?.output_tokens, response.usage?.total_tokens) ||
      heuristicUsage(request.prompt, 1);
    return {
      providerTaskId: `openai_img_${Date.now()}`,
      status: "succeeded",
      progress: 100,
      outputs,
      usage,
    };
  }

  private videoSize(request: ProviderRequest) {
    if (!this.officialOpenAI) return `${Math.round(request.width)}x${Math.round(request.height)}`;
    return request.width >= request.height ? "1280x720" : "720x1280";
  }

  private videoSeconds(request: ProviderRequest) {
    if (!this.officialOpenAI) return String(Math.max(1, Math.round(request.durationSec)));
    if (request.durationSec <= 4) return "4";
    if (request.durationSec <= 8) return "8";
    return "12";
  }

  private async createVideo(request: ProviderRequest): Promise<ProviderTask> {
    const prompt = `${request.prompt}\n${ANIMATION_PROMPT[request.animationMode || "live"] || ""}`.trim();
    const form = new FormData();
    form.append("model", this.config.videoModel);
    form.append("prompt", prompt);
    form.append("size", this.videoSize(request));
    form.append("seconds", this.videoSeconds(request));
    if (request.mode === "image-to-video" && request.images.length) {
      const image = await readMediaBytes(request.images[0].url, 20 * 1024 * 1024);
      const extension = image.mime.split("/")[1] || "png";
      form.append(
        "input_reference",
        new Blob([new Uint8Array(image.buffer)], { type: image.mime }),
        `reference.${extension}`
      );
    }

    let response: OpenAIVideoResponse;
    try {
      response = await requestJson<OpenAIVideoResponse>(joinUrl(this.config.baseUrl, "/videos"), {
        method: "POST",
        headers: this.headers(false),
        body: form,
        timeoutMs: 120_000,
        providerLabel: "OpenAI 兼容网关",
        maxRetries: 0,
      });
    } catch (error) {
      if (!(error instanceof ProviderError) || ![404, 405, 415].includes(error.status || 0)) throw error;
      const body: Record<string, unknown> = {
        model: this.config.videoModel,
        prompt,
        size: this.videoSize(request),
        seconds: Number(this.videoSeconds(request)),
      };
      if (request.mode === "image-to-video" && request.images.length) {
        body.image_url = await readImageDataUrl(request.images[0].url);
      }
      response = await requestJson<OpenAIVideoResponse>(joinUrl(this.config.baseUrl, "/videos"), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        timeoutMs: 120_000,
        providerLabel: "OpenAI 兼容网关",
        maxRetries: 1,
      });
    }
    if (!response.id) {
      const direct = extractVideoOutput(response, this.config.baseUrl);
      if (direct) {
        return { providerTaskId: `openai_video_${Date.now()}`, status: "succeeded", progress: 100, outputs: [direct], usage: heuristicUsage(request.prompt, 2) };
      }
      throw new ProviderError(errorMessage(response) || "网关未返回视频任务 ID", {
        code: "PROVIDER_BAD_RESPONSE",
        retryable: false,
      });
    }
    const status = normalizeStatus(response.status);
    return {
      providerTaskId: response.id,
      status,
      progress: response.progress,
      outputs: status === "succeeded" ? [videoOutput(response, this.config.baseUrl, this.headers())].filter(Boolean) as ProviderOutput[] : undefined,
      usage: usageFrom(response.usage?.input_tokens, response.usage?.output_tokens, response.usage?.total_tokens),
    };
  }

  async poll(providerTaskId: string): Promise<ProviderTask> {
    const response = await requestJson<OpenAIVideoResponse>(
      joinUrl(this.config.baseUrl, `/videos/${encodeURIComponent(providerTaskId)}`),
      { headers: this.headers(), timeoutMs: 45_000, providerLabel: "OpenAI 兼容网关", maxRetries: 2 }
    );
    const status = normalizeStatus(response.status);
    const usage = usageFrom(response.usage?.input_tokens, response.usage?.output_tokens, response.usage?.total_tokens);
    if (response.status === "failed") {
      return {
        providerTaskId,
        status: "failed",
        progress: 100,
        usage,
        error: {
          code: "PROVIDER_TASK_FAILED",
          message: errorMessage(response) || "OpenAI 视频任务失败",
          retryable: false,
        },
      };
    }
    if (status === "succeeded") {
      const direct = extractVideoOutput(response, this.config.baseUrl);
      const output = direct || videoOutput(response, this.config.baseUrl, this.headers());
      if (!output) {
        return {
          providerTaskId,
          status: "failed",
          progress: 100,
          usage,
          error: { code: "PROVIDER_EMPTY_RESULT", message: "任务完成但没有视频地址", retryable: false },
        };
      }
      return { providerTaskId, status: "succeeded", progress: 100, outputs: [output], usage };
    }
    return {
      providerTaskId,
      status,
      progress: typeof response.progress === "number" ? Math.max(0, Math.min(99, response.progress)) : undefined,
      usage,
    };
  }

  async cancel(providerTaskId: string): Promise<void> {
    await fetch(joinUrl(this.config.baseUrl, `/videos/${encodeURIComponent(providerTaskId)}`), {
      method: "DELETE",
      headers: this.headers(),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => undefined);
  }
}

function normalizeStatus(status?: string): ProviderTask["status"] {
  if (status === "completed" || status === "succeeded" || status === "success") return "succeeded";
  if (status === "failed" || status === "error" || status === "cancelled" || status === "canceled") return "failed";
  if (status === "in_progress" || status === "processing" || status === "running") return "running";
  return "queued";
}

function errorMessage(response: OpenAIVideoResponse) {
  if (typeof response.error === "string") return response.error;
  return response.error?.message;
}

function extractVideoOutput(response: OpenAIVideoResponse, baseUrl: string): ProviderOutput | null {
  if (response.url) return { kind: "video", url: response.url, mime: "video/mp4" };
  if (typeof response.output === "string") return { kind: "video", url: response.output, mime: "video/mp4" };
  if (response.output?.url) return { kind: "video", url: response.output.url, mime: "video/mp4" };
  for (const item of response.data || []) {
    if (item.url) return { kind: "video", url: item.url, mime: "video/mp4" };
    if (item.b64_json) return { kind: "video", data: Buffer.from(item.b64_json, "base64"), mime: "video/mp4" };
  }
  return null;
}

function videoOutput(
  response: OpenAIVideoResponse,
  baseUrl: string,
  headers: Record<string, string>
): ProviderOutput | null {
  const direct = extractVideoOutput(response, baseUrl);
  if (direct) return direct;
  if (!response.id) return null;
  return {
    kind: "video",
    url: joinUrl(baseUrl, `/videos/${encodeURIComponent(response.id)}/content`),
    mime: "video/mp4",
    headers: { Authorization: headers.Authorization },
  };
}
