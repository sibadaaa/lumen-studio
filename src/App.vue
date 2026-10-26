<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  FolderOpen,
  HelpCircle,
  Keyboard,
  LayoutDashboard,
  LayoutGrid,
  Plug,
} from "lucide-vue-next";
import ApiModal from "./components/ApiModal.vue";
import SettingsMenu from "./components/SettingsMenu.vue";
import ToastHost from "./components/ToastHost.vue";
import { useAppStore } from "./stores/app";
import { useT } from "./i18n";
import { api } from "./lib/api";
import { SHORTCUTS_ENABLED } from "./lib/features";
import { compactTokens, formatTokens } from "./lib/tokens";
import type { PageName } from "./router";

defineOptions({ name: "AppShell" });

const app = useAppStore();
const route = useRoute();
const router = useRouter();
const t = useT("base");

const page = computed<PageName>(() => (route.meta.page as PageName | undefined) || "workspace");

const navItems = computed(() => [
  { target: "workspace" as const, label: t("workspace"), icon: LayoutDashboard },
  { target: "works" as const, label: t("works"), icon: LayoutGrid },
  { target: "assets" as const, label: t("assets"), icon: FolderOpen },
  { target: "models" as const, label: t("models"), icon: Plug },
]);

const pageLabel = (target: PageName) =>
  target === "works"
    ? t("works")
    : target === "assets"
      ? t("assets")
      : target === "models"
        ? t("models")
        : t("workspace");

const crumbs = computed<Array<{ label: string; to?: string }>>(() => {
  const items: Array<{ label: string; to?: string }> = [
    { label: t("workspace"), to: page.value === "workspace" ? undefined : "/" },
  ];
  if (page.value === "workspace") items.push({ label: t("allProjects") });
  if (page.value === "project") items.push({ label: app.projectName });
  if (page.value === "studio")
    items.push(
      { label: app.projectName, to: `/projects/${app.projectId}` },
      { label: t("studio") },
    );
  if (page.value === "agent")
    items.push(
      { label: app.projectName, to: `/projects/${app.projectId}` },
      { label: t("studio"), to: `/projects/${app.projectId}/studio` },
      { label: t("agent") },
    );
  if (page.value === "works") items.push({ label: t("works") });
  if (page.value === "assets") items.push({ label: t("assets") });
  if (page.value === "models") items.push({ label: t("models") });
  return items;
});

const jump = computed(() => {
  if (page.value === "project") return { label: t("workspace"), to: "/" };
  if (page.value === "studio") return { label: t("project"), to: `/projects/${app.projectId}` };
  if (page.value === "agent") return { label: t("studio"), to: `/projects/${app.projectId}/studio` };
  if (page.value === "works" || page.value === "assets" || page.value === "models")
    return { label: t("workspace"), to: "/" };
  return null;
});

function go(to: string) {
  if (route.path !== to) void router.push(to);
}

function onKey(event: KeyboardEvent) {
  if (SHORTCUTS_ENABLED && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j" && page.value === "studio") {
    event.preventDefault();
    go(`/projects/${app.projectId}/agent`);
  }
  if (event.key === "Escape" && app.apiOpen) app.closeApi();
}

watch(
  page,
  (value) => {
    document.body.dataset.page = value;
  },
  { immediate: true },
);

/** Direct URL entry needs the project name for breadcrumbs / agent context. */
watch(
  () => app.projectId,
  async (id) => {
    if (!id) return;
    try {
      const detail = await api.project(id);
      if (app.projectId === id) app.projectName = detail.project.name;
    } catch {
      /* keep the last known name when the project is unavailable */
    }
  },
  { immediate: true },
);

let refreshTimer = 0;

onMounted(() => {
  void app.refreshRuntime();
  refreshTimer = window.setInterval(() => void app.refreshRuntime(), 30_000);
  window.addEventListener("keydown", onKey);
});

onBeforeUnmount(() => {
  window.clearInterval(refreshTimer);
  window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div class="app">
    <aside class="rail">
      <button class="rail-logo" aria-label="LUMEN 流明" @click="go('/')">
        <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <circle cx="16" cy="16" r="11.2" stroke="currentColor" stroke-width="1.2" opacity=".55" />
          <path d="M16 4.8a11.2 11.2 0 0 0 0 22.4 11.2 11.2 0 0 0 0-22.4Z" fill="currentColor" opacity=".16" />
          <circle cx="20.4" cy="11.6" r="2.3" fill="currentColor" />
        </svg>
      </button>

      <nav class="rail-nav" :aria-label="t('mainNav')">
        <button
          v-for="item in navItems"
          :key="item.target"
          :class="['rail-item', { 'is-active': page === item.target }]"
          :data-tip="pageLabel(item.target)"
          :aria-label="pageLabel(item.target)"
          :aria-current="page === item.target ? 'page' : undefined"
          @click="go(item.target === 'workspace' ? '/' : `/${item.target}`)"
        >
          <component :is="item.icon" :size="21" :stroke-width="1.4" />
          <span v-if="item.target === 'workspace'" class="rail-indicator" />
        </button>
      </nav>

      <div class="rail-bottom">
        <button
          v-if="SHORTCUTS_ENABLED"
          class="rail-item"
          :data-tip="t('shortcuts')"
          :aria-label="t('shortcuts')"
          @click="app.toast(t('shortcutsToast'))"
        >
          <Keyboard :size="21" :stroke-width="1.4" />
        </button>
      </div>
    </aside>

    <div class="shell">
      <header class="topbar">
        <div class="topbar-left">
          <span class="wordmark">LUMEN</span>
          <span class="wordmark-cn">流明</span>
          <span class="crumb-sep">/</span>
          <nav class="breadcrumbs" :aria-label="t('breadcrumb')">
            <template v-for="(crumb, index) in crumbs" :key="`${crumb.label}-${index}`">
              <span v-if="index > 0" class="crumb-sep">/</span>
              <button v-if="crumb.to" class="crumb-link" @click="go(crumb.to)">{{ crumb.label }}</button>
              <span v-else class="crumb-current">{{ crumb.label }}</span>
            </template>
          </nav>
          <span class="autosave"><i />{{ t("autosave") }}</span>
        </div>
        <div class="topbar-right">
          <button
            :class="['api-pill', { 'is-online': app.runtime.online }]"
            aria-haspopup="dialog"
            :title="t('models')"
            @click="go('/models')"
          >
            <span class="live-dot" />
            <span>
              {{
                app.runtime.online
                  ? app.runtime.provider?.kind === "mock"
                    ? app.runtime.provider?.label || t("workspace")
                    : app.runtime.provider?.label || t("models")
                  : t("mockFallback")
              }}
            </span>
            <span class="pill-divider" />
            <span class="api-provider">{{ app.providerLabel }}</span>
          </button>
          <button class="token-chip" :title="t('tokenTitle', { count: formatTokens(app.sessionTokens) })">
            <svg class="token-ring" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <circle cx="9" cy="9" r="6.4" stroke="currentColor" stroke-width="1.1" opacity=".22" />
              <path d="M9 2.6a6.4 6.4 0 0 1 6.2 4.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
              <path d="M9 5.2v3.9l2.6 1.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span class="token-value">{{ compactTokens(app.sessionTokens) }}</span>
            <span class="token-unit">tokens</span>
          </button>
          <span class="local-badge" :title="t('localTitle')"><i />LOCAL</span>
          <button v-if="jump" class="page-jump" @click="go(jump.to)">{{ jump.label }}</button>
          <SettingsMenu />
          <button class="icon-btn" :title="t('help')" :aria-label="t('help')" @click="app.toast(t('helpToast'))">
            <HelpCircle :size="18" :stroke-width="1.4" />
          </button>
        </div>
      </header>

      <router-view v-slot="{ Component }">
        <keep-alive :include="['StudioPage', 'AgentPage']">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </div>
  </div>

  <ApiModal :open="app.apiOpen" @close="app.closeApi()" />
  <ToastHost :items="app.toasts" />
</template>
