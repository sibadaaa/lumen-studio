import type { TokenUsage } from "../../shared/contracts.js";

export class ProviderError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    options: { code?: string; status?: number | null; retryable?: boolean; details?: Record<string, unknown> } = {}
  ) {
    super(message);
    this.name = "ProviderError";
    this.code = options.code || "PROVIDER_ERROR";
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function joinUrl(baseUrl: string, pathname: string) {
  return `${baseUrl.replace(/\/$/, "")}/${pathname.replace(/^\//, "")}`;
}

function retryAfterMs(headers: Headers, attempt: number) {
  const header = Number(headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.min(30_000, header * 1000);
  return Math.min(20_000, 2000 * 2 ** attempt + Math.floor(Math.random() * 400));
}

function mapHttpError(status: number, body: string, providerLabel: string) {
  let message = body.slice(0, 600);
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; code?: string } | string;
      message?: string;
    };
    if (typeof parsed.error === "string") message = parsed.error;
    else if (parsed.error?.message) message = parsed.error.message;
    else if (parsed.message) message = parsed.message;
  } catch {
    /* keep raw snippet */
  }
  if (status === 401 || status === 403) {
    return new ProviderError(`${providerLabel} 鉴权失败：请检查 API Key 与模型权限`, {
      code: "PROVIDER_AUTH_FAILED",
      status,
      retryable: false,
      details: { upstreamMessage: message },
    });
  }
  if (status === 429) {
    return new ProviderError(`${providerLabel} 触发限流，稍后自动重试`, {
      code: "PROVIDER_RATE_LIMITED",
      status,
      retryable: true,
      details: { upstreamMessage: message },
    });
  }
  if (status >= 500) {
    return new ProviderError(`${providerLabel} 服务暂时不可用 (HTTP ${status})`, {
      code: "PROVIDER_UNAVAILABLE",
      status,
      retryable: true,
      details: { upstreamMessage: message },
    });
  }
  if (status === 400 || status === 422) {
    return new ProviderError(`${providerLabel} 拒绝了请求：${message || "参数不合法"}`, {
      code: "PROVIDER_BAD_REQUEST",
      status,
      retryable: false,
      details: { upstreamMessage: message },
    });
  }
  return new ProviderError(`${providerLabel} 返回 HTTP ${status}：${message || "未知错误"}`, {
    code: "PROVIDER_HTTP_ERROR",
    status,
    retryable: status >= 500,
    details: { upstreamMessage: message },
  });
}

export interface FetchOptions extends RequestInit {
  timeoutMs?: number;
  providerLabel?: string;
  maxRetries?: number;
}

export async function requestText(url: string, options: FetchOptions = {}): Promise<{ status: number; body: string; headers: Headers }> {
  const { timeoutMs = 60_000, providerLabel = "Provider", maxRetries = 2, ...init } = options;
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      const body = await response.text();
      if (!response.ok) {
        const mapped = mapHttpError(response.status, body, providerLabel);
        if (mapped.retryable && attempt < maxRetries) {
          await sleep(retryAfterMs(response.headers, attempt));
          lastError = mapped;
          continue;
        }
        throw mapped;
      }
      return { status: response.status, body, headers: response.headers };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      lastError = new ProviderError(`${providerLabel} 网络请求失败：${(error as Error).message}`, {
        code: "PROVIDER_NETWORK_ERROR",
        retryable: true,
      });
      if (attempt < maxRetries) {
        await sleep(Math.min(20_000, 1500 * 2 ** attempt + Math.floor(Math.random() * 300)));
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new ProviderError("Provider 请求失败");
}

export async function requestJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const result = await requestText(url, options);
  if (!result.body) return {} as T;
  try {
    return JSON.parse(result.body) as T;
  } catch {
    throw new ProviderError("Provider 返回了非 JSON 响应", {
      code: "PROVIDER_BAD_RESPONSE",
      retryable: false,
      details: { snippet: result.body.slice(0, 300) },
    });
  }
}

export function usageFrom(
  input: unknown,
  output: unknown,
  total?: unknown
): TokenUsage | undefined {
  const inputTokens = Number(input || 0);
  const outputTokens = Number(output || 0);
  const totalTokens = Number(total || inputTokens + outputTokens);
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return undefined;
  return {
    inputTokens: Math.max(0, Math.round(inputTokens)),
    outputTokens: Math.max(0, Math.round(outputTokens)),
    totalTokens: Math.max(0, Math.round(totalTokens)),
    estimated: false,
    source: "provider",
  };
}

export function heuristicUsage(prompt: string, factor = 1): TokenUsage {
  const chinese = (prompt.match(/[\u4e00-\u9fa5]/g) || []).length;
  const other = Math.max(0, prompt.length - chinese);
  const inputTokens = Math.max(1, Math.round((chinese + other / 4) * 1.15));
  const outputTokens = Math.round(1200 * factor);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimated: true,
    source: "heuristic",
  };
}
