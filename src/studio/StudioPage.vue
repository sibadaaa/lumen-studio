<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Bot, Clapperboard, Film, Image as ImageIcon, Images, SquarePlay } from "lucide-vue-next";
import { SHORTCUTS_ENABLED } from "../lib/features";
import type { Mode } from "../types";
import HistoryStrip from "./HistoryStrip.vue";
import Inspector from "./Inspector.vue";
import PromptComposer from "./PromptComposer.vue";
import Stage from "./Stage.vue";
import { useStudioStore } from "../stores/studio";
import { useAppStore } from "../stores/app";
import { useT } from "../i18n";

defineOptions({ name: "StudioPage" });

const MODE_ICONS = { t2i: ImageIcon, t2v: Film, i2i: Images, i2v: SquarePlay, multi: Clapperboard };
const MODES_ORDER: Mode[] = ["t2i", "t2v", "i2i", "i2v", "multi"];

const studio = useStudioStore();
const app = useAppStore();
const route = useRoute();
const router = useRouter();
const t = useT("studio");
const inspectorOpen = ref(false);

const active = computed(() => route.name === "studio");

function applyIntent() {
  if (!app.studioIntent) return;
  studio.applyIntent(app.studioIntent);
  app.setStudioIntent(null);
}

watch(
  () => [active.value, studio.mode] as const,
  () => {
    if (active.value) document.body.dataset.mode = studio.mode;
  },
  { immediate: true },
);

watch(
  () => app.studioIntent,
  () => {
    if (active.value) applyIntent();
  },
);

watch(active, (value) => {
  if (value) applyIntent();
});

function onKey(event: KeyboardEvent) {
  if (!active.value || !SHORTCUTS_ENABLED) return;
  const target = event.target as HTMLElement | null;
  const typing = target && ["INPUT", "TEXTAREA"].includes(target.tagName);
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    void studio.generate();
  }
  if (!typing && /^[1-5]$/.test(event.key)) {
    studio.switchMode(MODES_ORDER[Number(event.key) - 1]);
  }
}

onMounted(() => {
  applyIntent();
  window.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <main class="studio">
    <section class="center">
      <div class="modebar">
        <div class="modebar-main">
          <div class="mode-tabs" role="tablist" :aria-label="t('modesAria')">
            <button
              v-for="mode in MODES_ORDER"
              :key="mode"
              :class="['mode-tab', { 'is-active': studio.mode === mode }]"
              role="tab"
              :aria-selected="studio.mode === mode"
              @click="studio.switchMode(mode)"
            >
              <component :is="MODE_ICONS[mode]" :size="16" :stroke-width="1.4" />
              <span>{{ t(`modes.${mode}`) }}</span>
            </button>
          </div>
          <div
            class="view-switch"
            :hidden="!studio.isVideo || (studio.mode !== 't2v' && studio.mode !== 'multi')"
            role="group"
            :aria-label="t('viewAria')"
          >
            <button :class="{ 'is-active': studio.view === 'preview' }" @click="studio.switchView('preview')">
              {{ t("view.preview") }}
            </button>
            <button :class="{ 'is-active': studio.view === 'storyboard' }" @click="studio.switchView('storyboard')">
              {{ t("view.storyboard") }}
            </button>
          </div>
          <button class="agent-entry" @click="router.push(`/projects/${app.projectId}/agent`)">
            <Bot :size="13" :stroke-width="1.4" />
            {{ t("agentEntry") }}
            <kbd v-if="SHORTCUTS_ENABLED">⌘J</kbd>
          </button>
        </div>
        <div class="modebar-end">
          <span class="draft-state"><i />{{ t("draftSaved") }}</span>
          <button v-if="SHORTCUTS_ENABLED" class="shortcut-hint" @click="app.toast(t('shortcutHint'))">
            <kbd>1</kbd><span>–</span><kbd>5</kbd><span>{{ t("switch") }}</span>
          </button>
        </div>
      </div>

      <Stage />
      <PromptComposer @open-inspector="inspectorOpen = true" />
      <HistoryStrip />
    </section>

    <Inspector
      :open="inspectorOpen"
      @close="inspectorOpen = false"
      @open-agent="router.push(`/projects/${app.projectId}/agent`)"
    />
    <div v-if="inspectorOpen" class="inspector-backdrop" @click="inspectorOpen = false" />
  </main>
</template>
