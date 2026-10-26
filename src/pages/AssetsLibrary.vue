<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { Download, FolderOpen, ImagePlus, LoaderCircle, RefreshCw, UploadCloud, X } from "lucide-vue-next";
import type { AssetFacets, AssetRole, LibraryAsset } from "../../shared/contracts";
import { api } from "../lib/api";
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

defineOptions({ name: "AssetsLibrary" });

interface UploadTask {
  id: string;
  name: string;
  progress: number;
  status: "uploading" | "done" | "error";
  error?: string;
}

const app = useAppStore();
const router = useRouter();
const t = useT("assets");
const tBase = useT("base");

const projects = ref<Array<{ id: string; name: string }>>([]);
const projectFilter = ref(app.libraryProjectId || "");
const searchInput = ref("");
const search = useDebouncedValue(searchInput, 300);
const kind = ref<"" | "image" | "video">("");
const source = ref<"" | "upload" | "work" | "agent">("");
const tagFilter = ref("");
const unused = ref(false);
const sort = ref<"newest" | "oldest" | "size" | "name">("newest");
const facets = ref<AssetFacets | null>(null);
const selected = ref(new Set<string>());
const active = ref<LibraryAsset | null>(null);
const usage = ref<Array<{ generationId: string; mode: string; role: string; createdAt: string; workId?: string }>>([]);
const tagInput = ref("");
const uploads = ref<UploadTask[]>([]);
const dragOver = ref(false);
const fileRef = ref<HTMLInputElement | null>(null);

const fetcher = (cursor: string | null) =>
  api.assets(
    buildQuery({
      projectId: projectFilter.value || undefined,
      kind: kind.value || undefined,
      source: source.value || undefined,
      tag: tagFilter.value || undefined,
      unused: unused.value,
      q: search.value || undefined,
      sort: sort.value,
      limit: 24,
      cursor: cursor || undefined,
    }),
  );

const { items, nextCursor, total, loading, loadingMore, error, refresh, loadMore, setItems } =
  useCursorQuery<LibraryAsset>(fetcher);

const projectName = (id?: string | null) =>
  id ? projects.value.find((project) => project.id === id)?.name || id : tBase("unfiled");

function patchLocal(id: string, patch: Partial<LibraryAsset>) {
  setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
}

function loadFacets() {
  api
    .assetFacets()
    .then((value) => (facets.value = value))
    .catch(() => (facets.value = null));
}

async function uploadFiles(files: FileList | File[]) {
  const queue = Array.from(files).filter((file) => /\.(png|jpe?g|webp)$/i.test(file.name));
  if (queue.length === 0) {
    app.toast(t("onlyImages"));
    return;
  }
  const tasks: UploadTask[] = queue.map((file, index) => ({
    id: `${Date.now()}-${index}`,
    name: file.name,
    progress: 0,
    status: "uploading",
  }));
  uploads.value = tasks;
  let succeeded = 0;
  for (const [index, file] of queue.entries()) {
    const task = tasks[index];
    try {
      const asset = await api.upload(
        file,
        (percent) => {
          uploads.value = uploads.value.map((item) => (item.id === task.id ? { ...item, progress: percent } : item));
        },
        projectFilter.value || undefined,
      );
      succeeded += 1;
      uploads.value = uploads.value.map((item) =>
        item.id === task.id ? { ...item, status: "done", progress: 100 } : item,
      );
      if (asset.duplicateOf) app.toast(t("duplicate", { name: file.name }));
      setItems((current) => [asset, ...current]);
    } catch (err) {
      uploads.value = uploads.value.map((item) =>
        item.id === task.id ? { ...item, status: "error", error: (err as Error).message } : item,
      );
    }
  }
  if (succeeded > 0) {
    app.toast(t("added", { count: succeeded }), "success");
    loadFacets();
  }
  window.setTimeout(() => {
    uploads.value = uploads.value.filter((item) => item.status === "error");
  }, 1600);
}

async function openDetail(asset: LibraryAsset) {
  active.value = asset;
  tagInput.value = "";
  try {
    const detail = await api.assetUsage(asset.id);
    usage.value = detail.items;
  } catch {
    usage.value = [];
  }
}

async function addTag() {
  if (!active.value || !tagInput.value.trim()) return;
  try {
    const updated = await api.updateAsset(active.value.id, { tags: [...active.value.tags, tagInput.value.trim()] });
    active.value = updated;
    patchLocal(updated.id, { tags: updated.tags });
    tagInput.value = "";
    loadFacets();
  } catch (err) {
    app.toast((err as Error).message);
  }
}

async function removeTag(tag: string) {
  if (!active.value) return;
  try {
    const updated = await api.updateAsset(active.value.id, {
      tags: active.value.tags.filter((item) => item !== tag),
    });
    active.value = updated;
    patchLocal(updated.id, { tags: updated.tags });
    loadFacets();
  } catch (err) {
    app.toast((err as Error).message);
  }
}

async function remove(asset: LibraryAsset, force = false) {
  if (!window.confirm(t("drawer.deleteConfirm", { name: asset.originalName || asset.id }))) return;
  try {
    await api.deleteAsset(asset.id, force);
    setItems((current) => current.filter((item) => item.id !== asset.id));
    active.value = null;
    app.toast(t("drawer.deleted"), "success");
    loadFacets();
  } catch (err) {
    const message = (err as Error).message;
    if ((err as { code?: string }).code === "ASSET_REFERENCED" && !force) {
      if (window.confirm(`${message}\n\n仍要删除吗？`)) await remove(asset, true);
      return;
    }
    app.toast(message);
  }
}

async function bulk(
  action: "move_project" | "add_tags" | "remove_tags" | "delete",
  payload?: { projectId?: string | null; tags?: string[] },
) {
  const ids = [...selected.value];
  if (ids.length === 0) return;
  if (action === "delete" && !window.confirm(t("bulk.deleteConfirm", { count: ids.length }))) return;
  try {
    const result = await api.bulkAssets({ action, ids, ...payload });
    if (result.failed.length > 0) {
      app.toast(
        t("bulk.partial", { updated: result.updated, failed: result.failed.length, message: result.failed[0].message }),
      );
    } else {
      app.toast(t("bulk.done", { count: result.updated }), "success");
    }
    selected.value = new Set();
    await refresh();
    loadFacets();
  } catch (err) {
    app.toast((err as Error).message);
  }
}

const roleForAsset = (asset: LibraryAsset): AssetRole => (asset.kind === "video" ? "reference" : "reference");

const hasFilters = computed(
  () => Boolean(projectFilter.value || kind.value || source.value || tagFilter.value || unused.value || search.value),
);

function clearFilters() {
  projectFilter.value = "";
  kind.value = "";
  source.value = "";
  tagFilter.value = "";
  unused.value = false;
  searchInput.value = "";
}

function onProjectSelect(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  projectFilter.value = value;
  app.setLibraryProject(value || null);
}

function toggleSelected(id: string) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

function onDrop(event: DragEvent) {
  event.preventDefault();
  dragOver.value = false;
  if (event.dataTransfer?.files) void uploadFiles(event.dataTransfer.files);
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files) void uploadFiles(input.files);
  input.value = "";
}

function useInStudio(asset: LibraryAsset) {
  app.setStudioIntent({ asset, role: roleForAsset(asset) });
  void router.push(`/projects/${app.projectId}/studio`);
}

function onBulkMove(event: Event) {
  const select = event.target as HTMLSelectElement;
  if (!select.value) return;
  void bulk("move_project", { projectId: select.value === "none" ? null : select.value });
  select.value = "";
}

function addTagsPrompt() {
  const tag = window.prompt(t("bulk.addTagsPrompt"))?.trim();
  if (tag) void bulk("add_tags", { tags: [tag] });
}

watch([projectFilter, kind, source, tagFilter, unused, search, sort], () => void refresh());
watch(
  () => app.libraryProjectId,
  (id) => {
    projectFilter.value = id || "";
  },
);

onMounted(() => {
  api
    .projects()
    .then((data) => (projects.value = data.items.map((project) => ({ id: project.id, name: project.name }))))
    .catch(() => (projects.value = []));
  loadFacets();
  void refresh();
});
</script>

<template>
  <LibraryShell eyebrow="ASSETS" :title="t('title')" :description="t('desc')">
    <template #stats>
      <span>{{ t("stats", { count: total }) }}</span>
      <span v-if="facets" class="library-stats-sub">{{ t("statsUnused", { count: facets.unused }) }}</span>
    </template>
    <template #actions>
      <button class="soft-btn" :aria-label="t('refreshAria')" @click="void refresh()">
        <RefreshCw :size="13" /> {{ tBase("refresh") }}
      </button>
      <button class="ws-primary" @click="fileRef?.click()"><ImagePlus :size="13" /> {{ t("upload") }}</button>
    </template>
    <template #toolbar>
      <div class="library-toolbar">
        <input
          v-model="searchInput"
          class="library-search"
          :placeholder="t('searchPlaceholder')"
          :aria-label="t('searchPlaceholder')"
        />
        <select :value="projectFilter" :aria-label="t('filterProject')" @change="onProjectSelect">
          <option value="">{{ tBase("all") }}</option>
          <option value="none">{{ tBase("unfiled") }}</option>
          <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
        </select>
        <select v-model="kind" :aria-label="t('filterKind')">
          <option value="">{{ t("kind.all") }}</option>
          <option value="image">{{ t("kind.image") }}</option>
          <option value="video">{{ t("kind.video") }}</option>
        </select>
        <select v-model="source" :aria-label="t('filterSource')">
          <option value="">{{ t("source.all") }}</option>
          <option value="upload">{{ t("source.upload") }}</option>
          <option value="work">{{ t("source.work") }}</option>
          <option value="agent">{{ t("source.agent") }}</option>
        </select>
        <select v-model="tagFilter" :aria-label="t('filterTag')">
          <option value="">{{ t("tagAll") }}</option>
          <option v-for="tag in facets?.tags || []" :key="tag.value" :value="tag.value">
            {{ t("tagWithCount", { tag: tag.value, count: tag.count }) }}
          </option>
        </select>
        <button :class="['library-chip', { 'is-active': unused }]" :aria-pressed="unused" @click="unused = !unused">
          {{ t("unused") }}
        </button>
        <select v-model="sort" :aria-label="t('sortLabel')">
          <option value="newest">{{ t("sort.newest") }}</option>
          <option value="oldest">{{ t("sort.oldest") }}</option>
          <option value="size">{{ t("sort.size") }}</option>
          <option value="name">{{ t("sort.name") }}</option>
        </select>
        <button v-if="hasFilters" class="text-btn" @click="clearFilters">{{ tBase("clearFilters") }}</button>
      </div>
    </template>

    <div
      :class="['library-dropzone', { 'is-dragover': dragOver }]"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop="onDrop"
    >
      <UploadCloud :size="15" />
      <span>{{ t("dropzone") }}</span>
      <input ref="fileRef" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden @change="onFileChange" />
    </div>

    <div v-if="uploads.length > 0" class="upload-queue" role="status">
      <div v-for="task in uploads" :key="task.id" :class="`upload-task is-${task.status}`">
        <span class="upload-task-name">{{ task.name }}</span>
        <span class="upload-task-bar"><i :style="{ width: `${task.progress}%` }" /></span>
        <span class="upload-task-state">
          {{
            task.status === "error"
              ? task.error || t("uploadFailed")
              : task.status === "done"
                ? t("uploadDone")
                : `${task.progress}%`
          }}
        </span>
        <button v-if="task.status === 'error'" :aria-label="tBase('delete')" @click="uploads = uploads.filter((item) => item.id !== task.id)">
          <X :size="11" />
        </button>
      </div>
    </div>

    <ErrorBanner v-if="error" :message="t('errorRead', { message: error })" @retry="void refresh()" />

    <SkeletonGrid v-if="loading" />
    <EmptyState
      v-else-if="items.length === 0"
      :title="hasFilters ? t('emptyFilteredTitle') : t('emptyTitle')"
      :description="hasFilters ? t('emptyFilteredBody') : t('emptyBody')"
    >
      <button v-if="!hasFilters" class="ws-primary" @click="fileRef?.click()"><ImagePlus :size="13" /> {{ t("upload") }}</button>
    </EmptyState>
    <template v-else>
      <div class="library-grid is-square">
        <MediaCard
          v-for="asset in items"
          :key="asset.id"
          :kind="asset.kind === 'video' ? 'video' : 'image'"
          :url="asset.url"
          :thumbnail-url="asset.thumbnailUrl"
          :title="asset.originalName || asset.id"
          :selected="selected.has(asset.id)"
          selectable
          @open="void openDetail(asset)"
          @toggle-select="toggleSelected(asset.id)"
        >
          <template #meta>
            <span>{{ asset.width && asset.height ? `${asset.width}×${asset.height}` : compactBytes(asset.size) }}</span>
            <span>{{ t(`source.${asset.source}`) }}</span>
            <span>{{ projectName(asset.projectId) }}</span>
            <em v-if="asset.tags.length > 0" class="media-card-tags">
              {{ asset.tags.slice(0, 2).join(" · ") }}{{ asset.tags.length > 2 ? ` +${asset.tags.length - 2}` : "" }}
            </em>
          </template>
        </MediaCard>
      </div>
      <button v-if="nextCursor" class="library-more" :disabled="loadingMore" @click="void loadMore()">
        <template v-if="loadingMore"><LoaderCircle :size="13" class="spin" /> {{ tBase("loadingMore") }}</template>
        <template v-else>{{ t("loadMore", { count: total }) }}</template>
      </button>
      <SelectionBar v-if="selected.size > 0" :label="tBase('selected', { count: selected.size })">
        <select default-value="" :aria-label="t('bulk.movePlaceholder')" @change="onBulkMove">
          <option value="" disabled>{{ t("bulk.movePlaceholder") }}</option>
          <option value="none">{{ tBase("unfiled") }}</option>
          <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
        </select>
        <button @click="addTagsPrompt">{{ t("bulk.addTags") }}</button>
        <button class="is-danger" @click="void bulk('delete')">{{ tBase("delete") }}</button>
        <button class="text-btn" @click="selected = new Set()">{{ tBase("cancel") }}</button>
      </SelectionBar>
    </template>

    <DetailDrawer :open="Boolean(active)" :title="t('drawer.title')" @close="active = null">
      <template v-if="active">
        <div class="library-preview">
          <video v-if="active.kind === 'video'" :src="active.url" controls preload="metadata" :aria-label="active.originalName || active.id" />
          <img v-else :src="active.thumbnailUrl || active.url" :alt="active.originalName || active.id" />
        </div>
        <div class="library-actions-row">
          <button class="ws-primary" @click="useInStudio(active)"><FolderOpen :size="13" /> {{ t("drawer.useInStudio") }}</button>
          <a class="soft-btn" :href="active.url" :download="active.originalName || active.id">
            <Download :size="13" /> {{ tBase("download") }}
          </a>
        </div>
        <dl class="library-detail-list">
          <div><dt>{{ t("drawer.file") }}</dt><dd>{{ active.originalName || active.id }}</dd></div>
          <div>
            <dt>{{ t("drawer.spec") }}</dt>
            <dd>
              {{ active.width && active.height ? `${active.width}×${active.height}` : "—" }} · {{ compactBytes(active.size) }} ·
              {{ active.mime }}
            </dd>
          </div>
          <div><dt>{{ t("drawer.project") }}</dt><dd>{{ projectName(active.projectId) }}</dd></div>
          <div>
            <dt>{{ t("drawer.source") }}</dt>
            <dd>{{ t(`source.${active.source}`) }}{{ active.sourceRef ? ` · ${active.sourceRef}` : "" }}</dd>
          </div>
          <div>
            <dt>{{ t("drawer.usage") }}</dt>
            <dd>{{ active.usageCount > 0 ? t("drawer.usedBy", { count: active.usageCount }) : t("drawer.unused") }}</dd>
          </div>
          <div>
            <dt>{{ t("drawer.uploadedAt") }}</dt>
            <dd>{{ formatDateTime(active.createdAt) }} · {{ relativeTime(active.createdAt) }}</dd>
          </div>
        </dl>
        <section class="library-detail-section">
          <h4>{{ t("drawer.tags", { count: active.tags.length }) }}</h4>
          <div class="library-tags">
            <span v-for="tag in active.tags" :key="tag" class="tag-chip">
              {{ tag }}
              <button :aria-label="t('drawer.removeTagAria', { tag })" @click="void removeTag(tag)"><X :size="10" /></button>
            </span>
            <span v-if="active.tags.length < 8" class="tag-input">
              <input
                v-model="tagInput"
                :placeholder="t('drawer.tagPlaceholder')"
                :aria-label="t('drawer.tagPlaceholder')"
                @keydown.enter.prevent="void addTag()"
              />
              <button @click="void addTag()">{{ t("drawer.addTag") }}</button>
            </span>
          </div>
        </section>
        <section v-if="usage.length > 0" class="library-detail-section">
          <h4>{{ t("drawer.usageTitle") }}</h4>
          <ul class="library-usage-list">
            <li v-for="item in usage.slice(0, 8)" :key="`${item.generationId}-${item.role}`">
              <span>{{ item.mode }}</span>
              <small>{{ item.role }} · {{ relativeTime(item.createdAt) }}</small>
            </li>
          </ul>
        </section>
        <section class="library-detail-section">
          <button class="soft-btn is-danger" @click="void remove(active)">{{ t("drawer.delete") }}</button>
          <p class="library-footnote">{{ t("drawer.deleteNote") }}</p>
        </section>
      </template>
    </DetailDrawer>
  </LibraryShell>
</template>
