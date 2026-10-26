<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { LoaderCircle, RefreshCw } from "lucide-vue-next";
import type { GenerationMode, ModelInfo, ModelRoute, ModelSyncResult } from "../../shared/contracts";
import { MODE_LABELS } from "../../shared/contracts";
import { api } from "../lib/api";
import { relativeTime } from "../library/format";
import { useT } from "../i18n";
import { useAppStore } from "../stores/app";
import ModelsConnections from "./ModelsConnections.vue";

defineOptions({ name: "ModelsPage" });

const MODE_ORDER: GenerationMode[] = [
  "text-to-image",
  "text-to-video",
  "image-to-image",
  "image-to-video",
  "multi-image-to-video",
];

const app = useAppStore();
const t = useT("models");

const tab = ref<"connections" | "catalog" | "routes">(
  app.runtime.online && app.runtime.activeProviderId ? "catalog" : "connections",
);
const providerId = ref(app.runtime.activeProviderId || "");
const models = ref<ModelInfo[]>([]);
const routes = ref<ModelRoute[]>(app.runtime.routes);
const loading = ref(false);
const syncing = ref(false);
const syncResult = ref<ModelSyncResult | null>(null);
const search = ref("");
const kindFilter = ref<"all" | "image" | "video" | "unknown">("all");
const adding = ref(false);
const newModelId = ref("");
const newModelKind = ref<"image" | "video">("image");

const provider = computed(() => app.runtime.providers.find((item) => item.id === providerId.value) || null);

async function loadCatalog() {
  loading.value = true;
  try {
    const [detail, routeList] = await Promise.all([api.providerModels(providerId.value), api.modelRoutes()]);
    models.value = detail.items;
    routes.value = routeList.items;
  } catch (err) {
    app.toast((err as Error).message);
  } finally {
    loading.value = false;
  }
}

const filtered = computed(() => {
  const keyword = search.value.trim().toLowerCase();
  return models.value.filter((model) => {
    if (kindFilter.value !== "all" && model.kind !== kindFilter.value) return false;
    if (keyword && !model.id.toLowerCase().includes(keyword) && !model.label.toLowerCase().includes(keyword))
      return false;
    return true;
  });
});

async function sync() {
  if (syncing.value) return;
  syncing.value = true;
  syncResult.value = null;
  try {
    const result = await api.syncModels(providerId.value);
    syncResult.value = result;
    models.value = result.items;
    app.toast(result.message, result.supported ? "success" : "default");
    await app.refreshRuntime();
  } catch (err) {
    app.toast((err as Error).message);
  } finally {
    syncing.value = false;
  }
}

async function toggleEnabled(model: ModelInfo) {
  try {
    const result = await api.enableModels(providerId.value, [model.id], !model.enabled);
    models.value = result.items;
    await app.refreshRuntime();
  } catch (err) {
    app.toast((err as Error).message);
  }
}

async function enableSuggested() {
  if (!syncResult.value?.suggestedEnabled.length) return;
  try {
    const result = await api.enableModels(providerId.value, syncResult.value.suggestedEnabled, true);
    models.value = result.items;
    syncResult.value = { ...syncResult.value, suggestedEnabled: [] };
    app.toast(t("catalog.enabledSuggested", { count: result.changed }), "success");
    await app.refreshRuntime();
  } catch (err) {
    app.toast((err as Error).message);
  }
}

async function changeKind(model: ModelInfo, kind: "image" | "video" | "unknown") {
  try {
    const updated = await api.updateModel(providerId.value, model.id, { kind });
    models.value = models.value.map((item) => (item.id === model.id ? updated : item));
  } catch (err) {
    app.toast((err as Error).message);
  }
}

async function removeModel(model: ModelInfo) {
  try {
    await api.deleteModel(providerId.value, model.id);
    models.value = models.value.filter((item) => item.id !== model.id);
    app.toast(t("catalog.deleted"), "success");
  } catch (err) {
    app.toast((err as Error).message);
  }
}

async function addManual() {
  const id = newModelId.value.trim();
  if (!id) return;
  try {
    const created = await api.addModel(providerId.value, {
      id,
      kind: newModelKind.value,
      modes: newModelKind.value === "image" ? ["text-to-image", "image-to-image"] : ["text-to-video", "image-to-video"],
    });
    models.value = [...models.value, created];
    newModelId.value = "";
    adding.value = false;
    app.toast(t("catalog.added"), "success");
    await app.refreshRuntime();
  } catch (err) {
    app.toast((err as Error).message);
  }
}

async function saveRoute(mode: GenerationMode, model: ModelInfo) {
  try {
    const route = await api.updateModelRoute(mode, { providerId: model.providerId, modelId: model.id });
    routes.value = routes.value.map((item) => (item.mode === mode ? route : item));
    app.toast(t("routes.saved", { mode: MODE_LABELS[mode] }), "success");
  } catch (err) {
    const message = (err as Error).message;
    app.toast(message);
    if (/未启用|不支持|disabled|unsupported|invalid/i.test(message)) {
      try {
        const route = await api.updateModelRoute(mode, { providerId: model.providerId, modelId: model.id }, true);
        routes.value = routes.value.map((item) => (item.mode === mode ? route : item));
        app.toast(t("routes.savedWithWarning"));
      } catch {
        /* ignore */
      }
    }
  }
}

async function autoMatch() {
  const active = app.runtime.activeProviderId;
  let changed = 0;
  for (const mode of MODE_ORDER) {
    const candidates = models.value.filter(
      (model) => model.enabled && model.status !== "missing" && model.modes.includes(mode),
    );
    if (candidates.length === 0) continue;
    const preferred =
      candidates.find((model) => model.providerId === active && model.source === "seed") ||
      candidates.find((model) => model.providerId === active) ||
      candidates[0];
    try {
      await api.updateModelRoute(mode, { providerId: preferred.providerId, modelId: preferred.id });
      changed += 1;
    } catch {
      /* keep going */
    }
  }
  const routeList = await api.modelRoutes();
  routes.value = routeList.items;
  app.toast(
    changed > 0 ? t("routes.matched", { count: changed }) : t("routes.unmatched"),
    changed > 0 ? "success" : "default",
  );
}

function onRouteSelect(mode: GenerationMode, event: Event) {
  const [pid, mid] = (event.target as HTMLSelectElement).value.split("::");
  const model = models.value.find((item) => item.providerId === pid && item.id === mid);
  if (model) void saveRoute(mode, model);
}

function routeKey(mode: GenerationMode) {
  const route = routes.value.find((item) => item.mode === mode);
  return route ? `${route.providerId}::${route.modelId}` : "";
}

function routeCandidates(mode: GenerationMode) {
  return models.value.filter((model) => model.enabled && model.status !== "missing" && model.modes.includes(mode));
}

function modeLabel(mode: GenerationMode) {
  return MODE_LABELS[mode];
}

function modelModes(model: ModelInfo) {
  return model.modes.length === 0 ? "—" : model.modes.map((mode) => MODE_LABELS[mode]).join(" / ");
}

watch(
  () => app.runtime.activeProviderId,
  (id) => {
    if (!id || id === providerId.value) return;
    providerId.value = id;
    void loadCatalog();
  },
  { immediate: true },
);

onMounted(() => {
  if (providerId.value) void loadCatalog();
});
</script>

<template>
  <main class="models-page">
    <section class="library-main">
      <header class="library-head">
        <div>
          <span class="eyebrow">API &amp; MODELS</span>
          <h1>{{ t("title") }}</h1>
          <p>
            {{ t("desc") }}
            <strong v-if="!app.runtime.online" class="models-offline">{{ t("descOfflineSuffix") }}</strong>
          </p>
        </div>
        <div class="library-head-side">
          <div class="library-stats">
            <span>{{ t("statsModels", { count: models.length }) }}</span>
            <span>{{ t("statsEnabled", { count: models.filter((model) => model.enabled).length }) }}</span>
          </div>
        </div>
      </header>

      <div class="models-tabs" role="tablist" :aria-label="t('title')">
        <button
          v-for="item in [
            ['connections', t('tabs.connections')],
            ['catalog', `${t('tabs.catalog')}${models.length ? ` ${models.length}` : ''}`],
            ['routes', t('tabs.routes')],
          ]"
          :key="item[0]"
          role="tab"
          :aria-selected="tab === item[0]"
          :class="{ 'is-active': tab === item[0] }"
          @click="tab = item[0] as typeof tab"
        >
          {{ item[1] }}
        </button>
      </div>

      <div class="library-content">
        <ModelsConnections
          v-if="tab === 'connections'"
          :providers="app.runtime.providers"
          :active-id="app.runtime.activeProviderId"
        />

        <template v-if="tab === 'catalog'">
          <div class="library-toolbar models-toolbar">
            <input
              v-model="search"
              class="library-search"
              :placeholder="t('catalog.searchPlaceholder')"
              :aria-label="t('catalog.searchAria')"
            />
            <div class="library-chips" role="group" :aria-label="t('catalog.kindLabel')">
              <button
                v-for="kind in ['all', 'image', 'video', 'unknown'] as const"
                :key="kind"
                :aria-pressed="kindFilter === kind"
                :class="{ 'is-active': kindFilter === kind }"
                @click="kindFilter = kind"
              >
                {{ kind === "all" ? t("catalog.all") : t(`catalog.kind.${kind}`) }}
              </button>
            </div>
            <div class="library-actions">
              <button class="soft-btn" @click="adding = !adding">{{ t("catalog.manual") }}</button>
              <button class="ws-primary" :disabled="syncing || !app.runtime.online" @click="void sync()">
                <template v-if="syncing"><LoaderCircle :size="13" class="spin" /> {{ t("catalog.fetching") }}</template>
                <template v-else><RefreshCw :size="13" /> {{ t("catalog.fetch") }}</template>
              </button>
            </div>
          </div>

          <div v-if="syncResult" :class="['models-sync-banner', { 'is-warning': !syncResult.supported }]">
            <span>{{ syncResult.message }}</span>
            <button v-if="syncResult.suggestedEnabled.length > 0" @click="void enableSuggested()">
              {{ t("catalog.enableSuggested", { count: syncResult.suggestedEnabled.length }) }}
            </button>
          </div>

          <div v-if="adding" class="models-add-row">
            <input v-model="newModelId" autofocus :placeholder="t('catalog.addPlaceholder')" />
            <div class="library-chips">
              <button
                v-for="kind in ['image', 'video'] as const"
                :key="kind"
                :aria-pressed="newModelKind === kind"
                :class="{ 'is-active': newModelKind === kind }"
                @click="newModelKind = kind"
              >
                {{ t(`catalog.kind.${kind}`) }}
              </button>
            </div>
            <button class="ws-primary" @click="void addManual()">{{ t("catalog.add") }}</button>
          </div>

          <p v-if="loading" class="library-loading">{{ t("catalog.loading") }}</p>
          <div v-else-if="filtered.length === 0" class="library-empty">
            <h3>{{ t("catalog.emptyTitle") }}</h3>
            <p>{{ t("catalog.emptyBody", { provider: provider?.label || "" }) }}</p>
          </div>
          <div v-else class="model-table" role="table" :aria-label="t('tabs.catalog')">
            <div class="model-table-head" role="row">
              <span>{{ t("catalog.table.enabled") }}</span>
              <span>{{ t("catalog.table.model") }}</span>
              <span>{{ t("catalog.table.kind") }}</span>
              <span>{{ t("catalog.table.modes") }}</span>
              <span>{{ t("catalog.table.status") }}</span>
              <span>{{ t("catalog.table.lastUsed") }}</span>
              <span />
            </div>
            <div v-for="model in filtered" :key="model.id" :class="['model-row', { 'is-enabled': model.enabled }]" role="row">
              <span>
                <input
                  type="checkbox"
                  :checked="model.enabled"
                  :disabled="model.kind === 'unknown'"
                  :aria-label="t('catalog.enableAria', { id: model.id })"
                  @change="void toggleEnabled(model)"
                />
              </span>
              <span class="model-id" :title="model.id">
                <strong>{{ model.label !== model.id ? model.label : model.id }}</strong>
                <small v-if="model.label !== model.id">{{ model.id }}</small>
              </span>
              <span>
                <select
                  :value="model.kind"
                  :aria-label="t('catalog.kindLabel')"
                  @change="void changeKind(model, ($event.target as HTMLSelectElement).value as 'image' | 'video' | 'unknown')"
                >
                  <option v-for="kind in ['image', 'video', 'unknown'] as const" :key="kind" :value="kind">
                    {{ t(`catalog.kind.${kind}`) }}
                  </option>
                </select>
              </span>
              <span class="model-modes">{{ modelModes(model) }}</span>
              <span :class="`model-status is-${model.status}`">{{ t(`catalog.status.${model.status}`) }}</span>
              <span>{{ model.lastUsedAt ? relativeTime(model.lastUsedAt) : t("catalog.neverUsed") }}</span>
              <span class="model-row-actions">
                <button :title="t('catalog.deleteTitle')" :aria-label="t('catalog.table.deleteAria', { id: model.id })" @click="void removeModel(model)">
                  ✕
                </button>
              </span>
            </div>
          </div>
          <p class="library-footnote">{{ t("catalog.footnote", { provider: provider?.label || "" }) }}</p>
        </template>

        <template v-if="tab === 'routes'">
          <div class="library-toolbar">
            <p class="library-hint">{{ t("routes.hint") }}</p>
            <div class="library-actions">
              <button class="ws-primary" @click="void autoMatch()">{{ t("routes.auto") }}</button>
            </div>
          </div>
          <div class="model-routes">
            <div v-for="mode in MODE_ORDER" :key="mode" class="model-route-row">
              <strong>{{ modeLabel(mode) }}</strong>
              <select
                :value="routeKey(mode)"
                :aria-label="t('routes.selectAria', { mode: modeLabel(mode) })"
                @change="onRouteSelect(mode, $event)"
              >
                <option value="">{{ t("routes.unset") }}</option>
                <option v-for="model in routeCandidates(mode)" :key="`${model.providerId}::${model.id}`" :value="`${model.providerId}::${model.id}`">
                  {{ model.label }} · {{ model.providerId }}
                </option>
              </select>
              <em v-if="routes.find((item) => item.mode === mode)?.warning" class="model-route-warning">
                ⚠ {{ routes.find((item) => item.mode === mode)?.warning }}
              </em>
            </div>
          </div>
        </template>
      </div>
    </section>
  </main>
</template>
