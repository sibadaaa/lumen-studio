import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type {
  AgentEvent,
  AgentMessage,
  AgentPlanStep,
  AgentSession,
  AgentToolState,
  MediaAsset,
  ProjectWithStats,
  SystemInfo,
} from "../../shared/contracts";
import { api, subscribeAgentEvents } from "../lib/api";
import { useT } from "../i18n";
import { useAppStore } from "../stores/app";
import { useStudioStore } from "../stores/studio";

const compactNumber = (value: number) =>
  value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(2)}m`
    : value >= 1000
      ? `${(value / 1000).toFixed(1)}k`
      : String(Math.round(value));

export function useAgent() {
  const app = useAppStore();
  const studio = useStudioStore();
  const router = useRouter();
  const t = useT("agent");
  const tBase = useT("base");

  const sessions = ref<AgentSession[]>([]);
  const activeId = ref<string | null>(null);
  const messages = ref<AgentMessage[]>([]);
  const session = ref<AgentSession | null>(null);
  const query = ref("");
  const input = ref("");
  const running = ref(false);
  const stage = ref(t("statusReady"));
  const plan = ref<AgentPlanStep[]>([]);
  const tools = ref<AgentToolState[]>([]);
  const progress = ref<{ progress: number; stage: string } | null>(null);
  const error = ref<string | null>(null);
  const system = ref<SystemInfo | null>(null);
  const project = ref<ProjectWithStats | null>(null);
  const assets = ref<MediaAsset[]>([]);
  const online = ref(true);
  const renameTarget = ref<AgentSession | null>(null);
  const renaming = ref(false);
  const loading = ref(true);

  let closeStream: (() => void) | null = null;

  function close() {
    closeStream?.();
    closeStream = null;
  }

  function subscribe(sessionId: string) {
    close();
    running.value = true;
    error.value = null;
    closeStream = subscribeAgentEvents(
      sessionId,
      (event: AgentEvent) => {
        switch (event.type) {
          case "snapshot":
            session.value = event.session;
            messages.value = event.messages;
            break;
          case "status":
            running.value = event.status === "running";
            stage.value = event.stage;
            break;
          case "plan":
            plan.value = event.steps;
            break;
          case "tool":
            tools.value = tools.value.some((item) => item.id === event.tool.id)
              ? tools.value.map((item) => (item.id === event.tool.id ? event.tool : item))
              : [...tools.value, event.tool];
            break;
          case "progress":
            progress.value = { progress: event.progress, stage: event.stage };
            break;
          case "message":
            if (!messages.value.some((item) => item.id === event.message.id)) {
              messages.value = [...messages.value, event.message];
            }
            if (event.message.role === "assistant") {
              plan.value = [];
              tools.value = [];
              progress.value = null;
              void api
                .agentSessions(app.projectId)
                .then((list) => {
                  sessions.value = list.items;
                })
                .catch(() => undefined);
            }
            break;
          case "tokens":
            if (session.value) session.value = { ...session.value, tokens: event.tokens };
            break;
          case "error":
            error.value = event.message;
            break;
          case "done":
            session.value = event.session;
            running.value = false;
            stage.value = t("statusReady");
            close();
            void api
              .agentSessions(app.projectId)
              .then((list) => {
                sessions.value = list.items;
              })
              .catch(() => undefined);
            void api
              .agentSession(sessionId)
              .then((detail) => {
                session.value = detail.session;
                messages.value = detail.messages;
              })
              .catch(() => undefined);
            break;
          default:
            break;
        }
      },
      () => {
        running.value = false;
        closeStream = null;
      }
    );
  }

  async function loadSession(id: string) {
    try {
      const detail = await api.agentSession(id);
      session.value = detail.session;
      messages.value = detail.messages;
      running.value = detail.session.status === "running";
      stage.value = detail.session.status === "running" ? t("statusRunning") : t("statusReady");
      if (detail.session.status === "running") subscribe(id);
      else close();
    } catch (err) {
      app.toast((err as Error).message);
    }
  }

  async function loadSessions(selectId?: string | null) {
    loading.value = true;
    try {
      const [list, info, detail] = await Promise.all([
        api.agentSessions(app.projectId),
        api.system(),
        api.project(app.projectId),
      ]);
      sessions.value = list.items;
      system.value = info;
      project.value = { ...detail.project, stats: detail.stats };
      assets.value = detail.assets;
      online.value = true;
      const target =
        (selectId && list.items.find((item) => item.id === selectId)) ||
        (app.agentSessionId && list.items.find((item) => item.id === app.agentSessionId)) ||
        (activeId.value && list.items.find((item) => item.id === activeId.value)) ||
        list.items[0];
      if (target) {
        activeId.value = target.id;
        await loadSession(target.id);
      } else {
        activeId.value = null;
        session.value = null;
        messages.value = [];
      }
    } catch {
      online.value = false;
      sessions.value = [];
      session.value = null;
      messages.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function send() {
    const text = input.value.trim();
    if (!text || !activeId.value || running.value) return;
    input.value = "";
    error.value = null;
    tools.value = [];
    plan.value = [];
    progress.value = null;
    running.value = true;
    stage.value = t("statusThinking");
    const optimistic: AgentMessage = {
      id: `temp_${Date.now()}`,
      sessionId: activeId.value,
      seq: (messages.value.at(-1)?.seq || 0) + 1,
      role: "user",
      text,
      createdAt: new Date().toISOString(),
    };
    messages.value = [...messages.value, optimistic];
    try {
      const response = await api.sendAgentMessage(activeId.value, text);
      messages.value = messages.value.some((item) => item.id === response.message.id)
        ? messages.value
        : messages.value.map((item) => (item.id === optimistic.id ? response.message : item));
      session.value = response.session;
      sessions.value = sessions.value.map((item) =>
        item.id === response.session.id ? response.session : item
      );
      subscribe(activeId.value);
    } catch (err) {
      running.value = false;
      stage.value = t("statusReady");
      error.value = (err as Error).message;
      app.toast((err as Error).message);
    }
  }

  async function cancel() {
    if (!activeId.value) return;
    stage.value = t("statusCanceling");
    try {
      await api.cancelAgent(activeId.value);
    } catch (err) {
      app.toast((err as Error).message);
    }
  }

  async function newSession() {
    try {
      const created = await api.createAgentSession(app.projectId);
      sessions.value = [created, ...sessions.value];
      activeId.value = created.id;
      session.value = created;
      messages.value = [];
      plan.value = [];
      tools.value = [];
      progress.value = null;
      error.value = null;
      running.value = false;
      close();
    } catch (err) {
      app.toast((err as Error).message);
    }
  }

  async function openSession(id: string) {
    if (running.value) {
      app.toast(tBase("error"));
      return;
    }
    activeId.value = id;
    plan.value = [];
    tools.value = [];
    progress.value = null;
    error.value = null;
    await loadSession(id);
  }

  async function renameSession(title: string) {
    if (!renameTarget.value || renaming.value) return;
    renaming.value = true;
    try {
      const updated = await api.updateAgentSession(renameTarget.value.id, { title });
      sessions.value = sessions.value.map((item) => (item.id === updated.id ? updated : item));
      if (session.value && session.value.id === updated.id) {
        session.value = { ...session.value, title: updated.title, updatedAt: updated.updatedAt };
      }
      renameTarget.value = null;
      app.toast(t("sessionRenamed"), "success");
    } catch (err) {
      app.toast((err as Error).message);
    } finally {
      renaming.value = false;
    }
  }

  async function removeSession(item: AgentSession) {
    if (item.status === "running" || (running.value && activeId.value === item.id)) {
      app.toast(t("sessionRunningBlock"));
      return;
    }
    if (!window.confirm(t("sessionDeleteConfirm", { title: item.title }))) return;
    try {
      await api.deleteAgentSession(item.id);
      const remaining = sessions.value.filter((entry) => entry.id !== item.id);
      sessions.value = remaining;
      app.toast(t("sessionDeleted"), "success");
      if (activeId.value !== item.id) return;
      close();
      plan.value = [];
      tools.value = [];
      progress.value = null;
      error.value = null;
      running.value = false;
      stage.value = t("statusReady");
      const next = remaining[0];
      if (next) {
        activeId.value = next.id;
        await loadSession(next.id);
      } else {
        activeId.value = null;
        session.value = null;
        messages.value = [];
      }
    } catch (err) {
      app.toast((err as Error).message);
    }
  }

  function openStoryboard() {
    studio.openStoryboard();
    router.push(`/projects/${app.projectId}/studio`);
    app.toast(t("storyboardOpened"), "success");
  }

  function openStudio() {
    router.push(`/projects/${app.projectId}/studio`);
  }

  const filtered = computed(() =>
    sessions.value.filter(
      (item) => !query.value || item.title.toLowerCase().includes(query.value.toLowerCase())
    )
  );
  const lastAssistant = computed(() =>
    [...messages.value].reverse().find((message) => message.role === "assistant")
  );
  const effectivePlan = computed(() => (plan.value.length ? plan.value : lastAssistant.value?.data?.plan || []));
  const effectiveTools = computed(() =>
    tools.value.length ? tools.value : lastAssistant.value?.data?.tools || []
  );
  const usagePercent = computed(() =>
    Math.min(100, Math.round(((session.value?.tokens || 0) / 128_000) * 100))
  );
  const latestOutputs = computed(() => lastAssistant.value?.data?.outputs || []);
  const title = computed(() => session.value?.title || tBase("create"));
  const totalTokens = computed(() => sessions.value.reduce((sum, item) => sum + item.tokens, 0));

  watch(
    () => app.projectId,
    () => {
      activeId.value = null;
      void loadSessions(app.agentSessionId);
    }
  );

  onMounted(() => {
    const requested = app.agentSessionId;
    if (requested) app.agentSessionId = null;
    void loadSessions(requested);
  });

  watch(
    () => app.agentSessionId,
    (id) => {
      if (id) {
        app.agentSessionId = null;
        void openSession(id);
      }
    }
  );

  onBeforeUnmount(close);

  return {
    // state
    sessions,
    activeId,
    messages,
    session,
    query,
    input,
    running,
    stage,
    plan,
    tools,
    progress,
    error,
    system,
    project,
    assets,
    online,
    renameTarget,
    renaming,
    loading,
    // derived
    filtered,
    lastAssistant,
    effectivePlan,
    effectiveTools,
    usagePercent,
    latestOutputs,
    title,
    totalTokens,
    compact: compactNumber,
    // actions
    loadSessions,
    loadSession,
    send,
    cancel,
    newSession,
    openSession,
    renameSession,
    removeSession,
    openStoryboard,
    openStudio,
    close,
    formatTokens: compactNumber,
  };
}

export type AgentState = ReturnType<typeof useAgent>;
