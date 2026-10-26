<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { Download, LoaderCircle, Plus, RefreshCw, Sparkles } from "lucide-vue-next";
import type { GenerationMode, ProjectWithStats, Work } from "../../shared/contracts";
import { MODE_LABELS } from "../../shared/contracts";
import { api } from "../lib/api";
import { compactTokens } from "../lib/tokens";
import { buildQuery, useCursorQuery, useDebouncedValue } from "../library/query";
import LibraryShell from "../library/LibraryShell.vue";
import MediaCard from "../library/MediaCard.vue";
import SelectionBar from "../library/SelectionBar.vue";
import EmptyState from "../library/EmptyState.vue";
import ErrorBanner from "../library/ErrorBanner.vue";
import SkeletonGrid from "../library/SkeletonGrid.vue";
import DetailDrawer from "../library/DetailDrawer.vue";
import { compactBytes, relativeTime } from "../library/format";
import { formatDateTime } from "../i18n/format";
import { useT } from "../i18n";
import { useAppStore } from "../stores/app";

defineOptions({ name: "WorksLibrary" });

const MODE_OPTIONS: GenerationMode[] = [
  "text-to-image",
  "text-to-video",
  "image-to-image",
  "image-to-video",
  "multi-image-to-video",
];

const app = useAppStore();
const router = useRouter();
const t = useT("works");
const tBase = useT("base");

const projects = ref<ProjectWithStats[]>([]);
const projectFilter = ref(app.libraryProjectId || "");
const searchInput = ref("");
const search = useDebouncedValue(searchInput, 300);
const kind = ref<"" | "image" | "video">("");
const mode = ref<"" | GenerationMode>("");
const favorite = ref(false);
const sort = ref<"newest" | "oldest" | "tokens" | "duration">("newest");
const selected = ref(new Set<string>());
const active = ref<Work | null>(null);
const renaming = ref("");
const busy = ref(false);

const fetcher = (cursor: string | null) =>
  api.works(
    buildQuery({
      projectId: projectFilter.value || undefined,
      kind: kind.value || undefined,
      mode: mode.value || undefined,
      favorite: favorite.value,
      q: search.value || undefined,
      sort: sort.value,
      limit: 24,
      cursor: cursor || undefined,
    }),
  );

const { items, nextCursor, total, loading, loadingMore, error, refresh, loadMore, setItems } =
  useCursorQuery<Work>(fetcher);

const projectName = (id?: string | null) =>
  id ? projects.value.find((project) => project.id === id)?.name || id : tBase("unfiled");

function toggleSelect(id: string) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

function patchLocal(id: string, patch: Partial<Work>) {
  setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
}

async function toggleFavorite(work: Work) {
  patchLocal(work.id, { favorite: !work.favorite });
  if (active.value?.id === work.id) active.value = { ...active.value, favorite: !work.favorite };
  try {
    await api.updateWork(work.id, { favorite: !work.favorite });
  } catch (err) {
    patchLocal(work.id, { favorite: work.favorite });
    app.toast((err as Error).message);
  }
}

async function rename(work: Work) {
  const title = renaming.value.trim();
  if (!title) return;
  try {
    const updated = await api.updateWork(work.id, { title });
    patchLocal(work.id, { title: updated.title });
    active.value = updated;
    renaming.value = "";
    app.toast(t("drawer.renamed"), "success");
  } catch (err) {
    app.toast((err as Error).message);
  }
}

async function moveTo(work: Work, target: string | null) {
  try {
    const updated = await api.updateWork(work.id, { projectId: target });
    patchLocal(work.id, { projectId: updated.projectId });
    active.value = updated;
    app.toast(t("drawer.moved"), "success");
  } catch (err) {
    app.toast((err as Error).message);
  }
}

async function remove(work: Work) {
  if (!window.confirm(t("drawer.deleteConfirm", { title: work.title }))) return;
  try {
    await api.deleteWork(work.id);
    setItems((current) => current.filter((item) => item.id !== work.id));
    active.value = null;
    app.toast(t("drawer.deleted"), "success");
  } catch (err) {
    app.toast((err as Error).message);
  }
}

async function saveToAssets(work: Work) {
  busy.value = true;
  try {
    const result = await api.saveWorkToAssets(work.id);
    app.toast(result.created ? t("drawer.savedToAssets") : t("drawer.alreadySaved"), "success");
  } catch (err) {
    app.toast((err as Error).message);
  } finally {
    busy.value = false;
  }
}

async function bulk(
  action: "favorite" | "unfavorite" | "delete" | "save_to_assets" | "move_project",
  target?: string | null,
) {
  const ids = [...selected.value];
  if (ids.length === 0) return;
  if (action === "delete" && !window.confirm(t("bulk.deleteConfirm", { count: ids.length }))) return;
  busy.value = true;
  try {
    const result = await api.bulkWorks({ action, ids, projectId: target });
    if (result.failed.length > 0) {
      app.toast(
        t("bulk.partial", { updated: result.updated, failed: result.failed.length, message: result.failed[0].message }),
      );
    } else {
      app.toast(
        action === "save_to_assets"
          ? t("bulk.saved", { count: result.created || 0 })
          : t("bulk.done", { count: result.updated }),
        "success",
      );
    }
    selected.value = new Set();
    await refresh();
  } catch (err) {
    app.toast((err as Error).message);
  } finally {
    busy.value = false;
  }
}

function reuse(work: Work, variant = false) {
  app.setStudioIntent({ work: variant ? { ...work, params: { ...work.params, seed: undefined } } : work });
  void router.push(`/projects/${app.projectId}/studio`);
}

const hasFilters = computed(
  () => Boolean(projectFilter.value || kind.value || mode.value || favorite.value || search.value),
);

function copyPrompt() {
  if (active.value?.prompt) void navigator.clipboard.writeText(active.value.prompt);
}

function clearFilters() {
  projectFilter.value = "";
  kind.value = "";
  mode.value = "";
  favorite.value = false;
  searchInput.value = "";
}

function onBulkMove(event: Event) {
  const select = event.target as HTMLSelectElement;
  if (!select.value) return;
  void bulk("move_project", select.value === "none" ? null : select.value);
  select.value = "";
}

watch([projectFilter, kind, mode, favorite, search, sort], () => void refresh());
watch(
  () => app.libraryProjectId,
  (id) => {
    projectFilter.value = id || "";
  },
);

onMounted(() => {
  api
    .projects()
    .then((data) => (projects.value = data.items))
    .catch(() => (projects.value = []));
  void refresh();
});
</script>

<template>
  <LibraryShell eyebrow="WORKS" :title="t('title')" :description="t('desc')">
    <template #stats>
      <span>{{ t("stats", { count: total }) }}</span>
      <span v-if="!loading" class="library-stats-sub">
        {{ t("statsTokens", { count: compactTokens(items.reduce((sum, item) => sum + item.usage.totalTokens, 0)) }) }}
      </span>
    </template>
    <template #actions>
      <button class="soft-btn" :aria-label="tBase('refresh')" @click="void refresh()">
        <RefreshCw :size="13" /> {{ tBase("refresh") }}
      </button>
    </template>
    <template #toolbar>
      <div class="library-toolbar">
        <input
          v-model="searchInput"
          class="library-search"
          :placeholder="t('searchPlaceholder')"
          :aria-label="t('searchPlaceholder')"
        />
        <select v-model="projectFilter" :aria-label="t('filterProject')">
          <option value="">{{ tBase("all") }}</option>
          <option value="none">{{ tBase("unfiled") }}</option>
          <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
        </select>
        <select v-model="kind" :aria-label="t('filterKind')">
          <option value="">{{ t("kind.all") }}</option>
          <option value="image">{{ t("kind.image") }}</option>
          <option value="video">{{ t("kind.video") }}</option>
        </select>
        <select v-model="mode" :aria-label="t('filterMode')">
          <option value="">{{ t("modeAll") }}</option>
          <option v-for="item in MODE_OPTIONS" :key="item" :value="item">{{ MODE_LABELS[item] }}</option>
        </select>
        <button :class="['library-chip', { 'is-active': favorite }]" :aria-pressed="favorite" @click="favorite = !favorite">
          {{ t("favorite") }}
        </button>
        <select v-model="sort" :aria-label="t('sortLabel')">
          <option value="newest">{{ t("sort.newest") }}</option>
          <option value="oldest">{{ t("sort.oldest") }}</option>
          <option value="tokens">{{ t("sort.tokens") }}</option>
          <option value="duration">{{ t("sort.duration") }}</option>
        </select>
        <button v-if="hasFilters" class="text-btn" @click="clearFilters">{{ tBase("clearFilters") }}</button>
      </div>
    </template>

    <ErrorBanner v-if="error" :message="t('errorRead', { message: error })" @retry="void refresh()" />

    <SkeletonGrid v-if="loading" />
    <EmptyState
      v-else-if="items.length === 0"
      :title="hasFilters ? t('emptyFilteredTitle') : t('emptyTitle')"
      :description="hasFilters ? t('emptyFilteredBody') : t('emptyBody')"
    />
    <template v-else>
      <div class="library-grid">
        <MediaCard
          v-for="work in items"
          :key="work.id"
          :kind="work.kind"
          :url="work.url"
          :thumbnail-url="work.thumbnailUrl"
          :title="work.title"
          :duration-sec="work.durationSec"
          :favorite="work.favorite"
          :selected="selected.has(work.id)"
          selectable
          favoritable
          @open="active = work; renaming = ''"
          @toggle-favorite="void toggleFavorite(work)"
          @toggle-select="toggleSelect(work.id)"
        >
          <template #meta>
            <em>{{ MODE_LABELS[work.mode] }}</em>
            <span>{{ work.modelId.split("/").pop() || work.modelId }}</span>
            <span>{{ compactTokens(work.usage.totalTokens) }} tokens</span>
            <time>{{ relativeTime(work.createdAt) }}</time>
          </template>
          <template #badges>
            <span :class="`badge badge-${work.source}`">{{ work.source === "agent" ? "Agent" : "Studio" }}</span>
          </template>
        </MediaCard>
      </div>
      <button v-if="nextCursor" class="library-more" :disabled="loadingMore" @click="void loadMore()">
        <template v-if="loadingMore"><LoaderCircle :size="13" class="spin" /> {{ tBase("loadingMore") }}</template>
        <template v-else><Plus :size="13" /> {{ t("loadMore", { count: total }) }}</template>
      </button>
      <SelectionBar v-if="selected.size > 0" :label="tBase('selected', { count: selected.size })">
        <button :disabled="busy" @click="void bulk('favorite')">{{ tBase("favorite") }}</button>
        <button :disabled="busy" @click="void bulk('unfavorite')">{{ tBase("unfavorite") }}</button>
        <button :disabled="busy" @click="void bulk('save_to_assets')">{{ t("bulk.save") }}</button>
        <select default-value="" :disabled="busy" aria-label="批量移动项目" @change="onBulkMove">
          <option value="" disabled>{{ t("bulk.movePlaceholder") }}</option>
          <option value="none">{{ tBase("unfiled") }}</option>
          <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
        </select>
        <button class="is-danger" :disabled="busy" @click="void bulk('delete')">{{ tBase("delete") }}</button>
        <button class="text-btn" @click="selected = new Set()">{{ tBase("cancel") }}</button>
      </SelectionBar>
    </template>

    <DetailDrawer :open="Boolean(active)" :title="t('drawer.title')" wide @close="active = null">
      <template v-if="active">
        <div class="library-preview">
          <video v-if="active.kind === 'video'" :src="active.url" controls preload="metadata" :aria-label="active.title" />
          <img v-else :src="active.url" :alt="active.title" />
        </div>
        <div class="library-actions-row">
          <a class="soft-btn" :href="active.url" :download="`${active.title || active.id}`">
            <Download :size="13" /> {{ tBase("download") }}
          </a>
          <button class="ws-primary" @click="reuse(active)"><Sparkles :size="13" /> {{ t("drawer.reuse") }}</button>
          <button class="soft-btn" @click="reuse(active, true)">{{ t("drawer.variant") }}</button>
          <button class="soft-btn" :disabled="busy" @click="void saveToAssets(active)">{{ t("drawer.saveToAssets") }}</button>
        </div>
        <dl class="library-detail-list">
          <div><dt>{{ t("drawer.model") }}</dt><dd>{{ active.providerId }} · {{ active.modelId }}</dd></div>
          <div>
            <dt>{{ t("drawer.spec") }}</dt>
            <dd>
              {{ active.params.resolution || "—" }} · {{ active.params.aspectRatio || "—"
              }}{{ active.durationSec ? ` · ${Math.round(active.durationSec)}s` : "" }}
            </dd>
          </div>
          <div>
            <dt>{{ t("drawer.usage") }}</dt>
            <dd>
              {{ active.usage.totalTokens.toLocaleString() }} tokens{{
                active.usage.estimated ? t("drawer.usageEstimated") : t("drawer.usageActual")
              }}
            </dd>
          </div>
          <div><dt>{{ t("drawer.project") }}</dt><dd>{{ projectName(active.projectId) }}</dd></div>
          <div>
            <dt>{{ t("drawer.source") }}</dt>
            <dd>
              {{ active.source === "agent" ? t("drawer.sourceAgent") : t("drawer.sourceStudio") }} · {{ active.generationId }}
            </dd>
          </div>
          <div><dt>{{ t("drawer.time") }}</dt><dd>{{ formatDateTime(active.createdAt) }}</dd></div>
        </dl>
        <section class="library-detail-section">
          <h4>
            {{ t("drawer.prompt") }}
            <button class="text-btn" @click="copyPrompt()">{{ tBase("copy") }}</button>
          </h4>
          <p>{{ active.prompt || "（无提示词）" }}</p>
        </section>
        <section v-if="active.inputs.length > 0" class="library-detail-section">
          <h4>{{ t("drawer.inputs", { count: active.inputs.length }) }}</h4>
          <div class="library-mini-thumbs">
            <span v-for="(input, index) in active.inputs" :key="`${input.assetId || input.url}-${index}`" :title="input.role">
              <img v-if="input.url" :src="input.url" :alt="input.role" />
              <i v-else>{{ input.role }}</i>
            </span>
          </div>
        </section>
        <section class="library-detail-section">
          <h4>{{ t("drawer.manage") }}</h4>
          <div class="library-manage-row">
            <input
              v-model="renaming"
              :placeholder="active.title"
              :aria-label="t('drawer.newTitle')"
              @keydown.enter.prevent="void rename(active)"
            />
            <button class="soft-btn" @click="void rename(active)">{{ tBase("rename") }}</button>
          </div>
          <div class="library-manage-row">
            <select
              :value="active.projectId || ''"
              :aria-label="t('drawer.moveLabel')"
              @change="void moveTo(active, ($event.target as HTMLSelectElement).value || null)"
            >
              <option value="">{{ tBase("unfiled") }}</option>
              <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
            </select>
            <button class="soft-btn is-danger" @click="void remove(active)">{{ t("drawer.delete") }}</button>
          </div>
          <p class="library-footnote">
            {{ t("drawer.file", { size: compactBytes(active.size) }) }} · {{ t("drawer.deleteNote") }}
          </p>
        </section>
      </template>
    </DetailDrawer>
  </LibraryShell>
</template>
