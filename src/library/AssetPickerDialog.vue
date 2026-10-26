<script setup lang="ts">
import { ref, watch } from "vue";
import { Search, X } from "lucide-vue-next";
import type { LibraryAsset } from "../../shared/contracts";
import { api } from "../lib/api";
import { buildQuery, useDebouncedValue } from "./query";
import { relativeTime } from "./format";
import { useT } from "../i18n";

const props = withDefaults(defineProps<{ open: boolean; projectId?: string | null }>(), {
  projectId: null,
});
const emit = defineEmits<{ close: []; pick: [asset: LibraryAsset] }>();
const t = useT("assets");
const search = ref("");
const debouncedSearch = useDebouncedValue(search, 260);
const items = ref<LibraryAsset[]>([]);
const loading = ref(false);
let active = 0;

async function load() {
  if (!props.open) return;
  const id = ++active;
  loading.value = true;
  try {
    const page = await api.assets(
      buildQuery({
        projectId: props.projectId || undefined,
        q: debouncedSearch.value || undefined,
        limit: 30,
      })
    );
    if (id === active) items.value = page.items;
  } catch {
    if (id === active) items.value = [];
  } finally {
    if (id === active) loading.value = false;
  }
}

watch(
  () => [props.open, debouncedSearch.value, props.projectId] as const,
  ([open]) => {
    if (open) void load();
  },
  { immediate: true }
);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    search.value = "";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") emit("close");
    };
    window.addEventListener("keydown", onKey, { once: true });
  }
);

function pick(asset: LibraryAsset) {
  emit("pick", asset);
  emit("close");
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-backdrop" @click.self="emit('close')">
      <div class="modal asset-picker" role="dialog" aria-modal="true" :aria-label="t('picker.title')">
        <header class="modal-head">
          <div>
            <span class="eyebrow">ASSETS</span>
            <h2>{{ t("picker.title") }}</h2>
            <p>{{ t("picker.desc") }}</p>
          </div>
          <button class="modal-close" :aria-label="t('close', { ns: 'base' })" @click="emit('close')">
            <X :size="15" />
          </button>
        </header>
        <div class="asset-picker-search">
          <Search :size="13" />
          <input
            v-model="search"
            :placeholder="t('searchPlaceholder')"
            :aria-label="t('searchPlaceholder')"
            autofocus
          />
        </div>
        <p v-if="projectId" class="asset-picker-scope">{{ t("picker.scope") }}</p>
        <div class="asset-picker-grid">
          <p v-if="loading" class="library-loading">{{ t("picker.loading") }}</p>
          <p v-else-if="items.length === 0" class="library-loading">{{ t("picker.empty") }}</p>
          <button
            v-for="asset in items"
            :key="asset.id"
            class="asset-picker-item"
            @click="pick(asset)"
          >
            <img :src="asset.thumbnailUrl || asset.url" :alt="asset.originalName || asset.id" loading="lazy" />
            <span class="asset-picker-name">{{ asset.originalName || asset.id }}</span>
            <small>{{ relativeTime(asset.createdAt) }}</small>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
