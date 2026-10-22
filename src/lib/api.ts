import type {
  AgentSendResponse,
  AgentSession,
  AgentSessionDetail,
  ApiErrorBody,
  GenerationRequest,
  GenerationTask,
  MediaAsset,
  ProjectCreateInput,
  ProjectWithStats,
  ProviderConfigInput,
  ProviderInfo,
  ProviderTestResult,
  ProvidersResponse,
  SystemInfo,
  UsageSummary,
} from "../../shared/contracts";

const BASE = "/api/v1";

export class BffError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly traceId?: string;
  constructor(message: string, options: { code?: string; status?: number; retryable?: boolean; traceId?: string } = {}) {
    super(message);
    this.name = "BffError";
    this.code = options.code || "BFF_ERROR";
    this.status = options.status || 0;
    this.retryable = options.retryable || false;
    this.traceId = options.traceId;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new BffError("本机 BFF 未启动，已回退到 Mock 生成", { code: "BFF_OFFLINE" });
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const body = payload as ApiErrorBody | null;
    throw new BffError(body?.error?.message || `BFF 请求失败 (HTTP ${response.status})`, {
      code: body?.error?.code || `HTTP_${response.status}`,
      status: response.status,
      retryable: body?.error?.retryable,
      traceId: body?.error?.traceId,
    });
  }
  return payload as T;
}

export const api = {
  health: () => request<{ ok: boolean; ffmpeg: boolean; version: string }>("/health"),
  system: () => request<SystemInfo>("/system"),
  providers: () => request<ProvidersResponse>("/providers"),
  saveProvider: (id: string, input: ProviderConfigInput) =>
    request<ProviderInfo>(`/providers/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  activateProvider: (id: string) =>
    request<ProviderInfo>(`/providers/${encodeURIComponent(id)}/activate`, { method: "POST" }),
  testProvider: (id: string) =>
    request<ProviderTestResult>(`/providers/${encodeURIComponent(id)}/test`, { method: "POST" }),
  deleteProvider: (id: string) =>
    request<void>(`/providers/${encodeURIComponent(id)}`, { method: "DELETE" }),
  upload: (file: File, onProgress?: (percent: number) => void, projectId?: string) =>
    new Promise<MediaAsset>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BASE}/uploads`);
      xhr.responseType = "text";
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) onProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onerror = () => reject(new BffError("上传失败：无法连接本机 BFF", { code: "UPLOAD_NETWORK" }));
      xhr.onload = () => {
        let payload: unknown = null;
        try {
          payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch {
          payload = null;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(payload as MediaAsset);
          return;
        }
        const body = payload as ApiErrorBody | null;
        reject(
          new BffError(body?.error?.message || `上传失败 (HTTP ${xhr.status})`, {
            code: body?.error?.code || `HTTP_${xhr.status}`,
            status: xhr.status,
            retryable: body?.error?.retryable,
            traceId: body?.error?.traceId,
          })
        );
      };
      const form = new FormData();
      form.append("file", file);
      form.append("purpose", "reference");
      if (projectId) form.append("projectId", projectId);
      xhr.send(form);
    }),
  createGeneration: (input: GenerationRequest) =>
    request<GenerationTask>("/generations", {
      method: "POST",
      headers: { "Idempotency-Key": input.clientRequestId },
      body: JSON.stringify(input),
    }),
  getGeneration: (id: string) => request<GenerationTask>(`/generations/${encodeURIComponent(id)}`),
  listGenerations: (query = "") => request<{ items: GenerationTask[] }>(`/generations${query}`),
  cancelGeneration: (id: string) =>
    request<GenerationTask>(`/generations/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  retryGeneration: (id: string) =>
    request<GenerationTask>(`/generations/${encodeURIComponent(id)}/retry`, { method: "POST" }),
  usage: (projectId?: string) =>
    request<UsageSummary>(`/usage${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),

  projects: () => request<{ items: ProjectWithStats[] }>("/projects"),
  project: (projectId: string) =>
    request<{
      project: ProjectWithStats;
      stats: ProjectWithStats["stats"];
      sessions: AgentSession[];
      assets: MediaAsset[];
    }>(`/projects/${encodeURIComponent(projectId)}`),
  createProject: (input: ProjectCreateInput) =>
    request<ProjectWithStats>("/projects", { method: "POST", body: JSON.stringify(input) }),
  updateProject: (projectId: string, patch: Partial<ProjectCreateInput> & { status?: "active" | "archived" }) =>
    request<ProjectWithStats>(`/projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  agentSessions: (projectId?: string, q?: string) => {
    const params = new URLSearchParams();
    if (projectId) params.set("projectId", projectId);
    if (q) params.set("q", q);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<{ items: AgentSession[] }>(`/agent/sessions${suffix}`);
  },
  createAgentSession: (projectId?: string, title?: string) =>
    request<AgentSession>("/agent/sessions", {
      method: "POST",
      body: JSON.stringify({ projectId, title }),
    }),
  agentSession: (sessionId: string) =>
    request<AgentSessionDetail>(`/agent/sessions/${encodeURIComponent(sessionId)}`),
  sendAgentMessage: (sessionId: string, text: string) =>
    request<AgentSendResponse>(`/agent/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  cancelAgent: (sessionId: string) =>
    request<{ canceled: boolean; session: AgentSession }>(
      `/agent/sessions/${encodeURIComponent(sessionId)}/cancel`,
      { method: "POST" }
    ),
  deleteAgentSession: (sessionId: string) =>
    request<void>(`/agent/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }),
};

export const agentEventsUrl = (sessionId: string) =>
  `${BASE}/agent/sessions/${encodeURIComponent(sessionId)}/events`;

export function subscribeAgentEvents(
  sessionId: string,
  onEvent: (event: import("../../shared/contracts").AgentEvent) => void,
  onError?: () => void
): () => void {
  if (typeof EventSource === "undefined") return () => undefined;
  const source = new EventSource(agentEventsUrl(sessionId));
  const handler = (message: MessageEvent<string>) => {
    try {
      onEvent(JSON.parse(message.data) as import("../../shared/contracts").AgentEvent);
    } catch {
      /* ignore malformed frames */
    }
  };
  source.addEventListener("agent", handler as EventListener);
  source.onerror = () => {
    onError?.();
    source.close();
  };
  return () => {
    source.removeEventListener("agent", handler as EventListener);
    source.close();
  };
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function makeClientRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function providerIsMock(provider: ProviderInfo | null | undefined) {
  return provider?.kind === "mock";
}
