import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { ModelInfo, ModelRoute, ProviderInfo } from "../../shared/contracts";
import { api } from "../lib/api";
import type { StudioIntent, StudioRuntime } from "../types";

export interface ToastItem {
  id: number;
  message: string;
  type: "default" | "success";
}

const OFFLINE_RUNTIME: StudioRuntime = {
  online: false,
  activeProviderId: null,
  provider: null,
  providers: [],
  models: [],
  routes: [],
  ffmpeg: false,
  version: "0.2.0",
  loading: true,
};

export const useAppStore = defineStore("app", () => {
  const projectId = ref("proj_product");
  const projectName = ref("产品短片");
  const sessionTokens = ref(128420);
  const runtime = ref<StudioRuntime>({ ...OFFLINE_RUNTIME });
  const toasts = ref<ToastItem[]>([]);
  const apiOpen = ref(false);
  const agentSessionId = ref<string | null>(null);
  const libraryProjectId = ref<string | null>(null);
  const studioIntent = ref<StudioIntent | null>(null);
  const routeName = ref("workspace");

  const providerLabel = computed(() => {
    if (!runtime.value.online) return "OFFLINE";
    const provider = runtime.value.provider;
    if (!provider) return "SETUP";
    if (provider.kind === "mock") return "MOCK";
    return provider.configured ? "LIVE" : "SETUP";
  });

  function toast(message: string, type: "default" | "success" = "default") {
    const id = Date.now() + Math.random();
    toasts.value = [...toasts.value, { id, message, type }];
    window.setTimeout(() => {
      toasts.value = toasts.value.filter((item) => item.id !== id);
    }, 2800);
  }

  function openApi() {
    apiOpen.value = true;
  }

  function closeApi() {
    apiOpen.value = false;
  }

  function setProject(id: string, name: string) {
    projectId.value = id;
    projectName.value = name;
    agentSessionId.value = null;
    libraryProjectId.value = null;
    studioIntent.value = null;
  }

  function setLibraryProject(id: string | null) {
    libraryProjectId.value = id;
  }

  function setStudioIntent(intent: StudioIntent | null) {
    studioIntent.value = intent;
  }

  function addTokens(tokens: number) {
    sessionTokens.value += tokens;
  }

  async function refreshRuntime() {
    runtime.value = { ...runtime.value, loading: true };
    try {
      const data = await api.providers();
      const provider = data.items.find((item) => item.id === data.activeProviderId) || null;
      let models: ModelInfo[] = [];
      let routes: ModelRoute[] = [];
      try {
        const [modelData, routeData] = await Promise.all([api.models("?enabled=0"), api.modelRoutes()]);
        models = modelData.items;
        routes = routeData.items;
      } catch {
        /* catalog is optional */
      }
      runtime.value = {
        online: true,
        activeProviderId: data.activeProviderId,
        provider,
        providers: data.items,
        models,
        routes,
        ffmpeg: data.backend.ffmpeg,
        version: data.backend.version,
        loading: false,
      };
    } catch {
      runtime.value = {
        ...runtime.value,
        online: false,
        loading: false,
        provider: null,
        activeProviderId: null,
        models: [],
        routes: [],
      };
    }
  }

  return {
    projectId,
    projectName,
    sessionTokens,
    runtime,
    toasts,
    apiOpen,
    agentSessionId,
    libraryProjectId,
    studioIntent,
    routeName,
    providerLabel,
    toast,
    openApi,
    closeApi,
    setProject,
    setLibraryProject,
    setStudioIntent,
    addTokens,
    refreshRuntime,
  };
});

export type AppStore = ReturnType<typeof useAppStore>;
export type { ProviderInfo };
