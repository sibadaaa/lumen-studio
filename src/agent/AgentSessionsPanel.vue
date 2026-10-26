<script setup lang="ts">
import { ArrowRight, ChevronDown, Pencil, Plus, Search, Settings2, Trash2 } from "lucide-vue-next";
import type { AgentSession, ProjectWithStats } from "../../shared/contracts";
import ActionMenu from "../components/ActionMenu.vue";
import { SHORTCUTS_ENABLED } from "../lib/features";
import { compact, relative } from "./helpers";
import { useT } from "../i18n";
import type { ActionMenuItem } from "../components/action-menu";

defineOptions({ name: "AgentSessionsPanel" });

const props = defineProps<{
  project: ProjectWithStats | null;
  online: boolean;
  sessions: AgentSession[];
  filtered: AgentSession[];
  query: string;
  activeId: string | null;
  running: boolean;
}>();

const emit = defineEmits<{
  queryChange: [value: string];
  openSession: [id: string];
  newSession: [];
  rename: [session: AgentSession];
  remove: [session: AgentSession];
  openApi: [];
}>();

const t = useT("agent");
const tBase = useT("base");

function menuItems(session: AgentSession): ActionMenuItem[] {
  return [
    { key: "rename", label: tBase("rename"), icon: Pencil, onSelect: () => emit("rename", session) },
    {
      key: "delete",
      label: tBase("delete"),
      icon: Trash2,
      danger: true,
      disabled: session.status === "running" || (props.running && props.activeId === session.id),
      onSelect: () => emit("remove", session),
    },
  ];
}
</script>

<template>
  <aside class="ws-sessions chat-sessions" :aria-label="t('sessionsLabel')">
    <div class="ws-brand">
      <div><span class="eyebrow">WORKSPACE</span><h2>{{ project?.name || t("localProject") }}</h2></div>
      <button class="ws-new" :title="t('newSession')" :aria-label="t('newSessionAria')" @click="emit('newSession')">
        <Plus :size="15" />
      </button>
    </div>
    <div class="ws-workspace-switch">
      <span class="ws-workspace-mark">P</span>
      <div>
        <strong>{{ project?.name || t("localProject") }}</strong>
        <small>{{ online ? t("storageOnline") : t("storageOffline") }} · {{ t("sessionCount", { count: sessions.length }) }}</small>
      </div>
      <ChevronDown :size="13" />
    </div>
    <label class="ws-search">
      <Search :size="13" />
      <input :value="query" :placeholder="t('searchPlaceholder')" :aria-label="t('searchAria')" @input="emit('queryChange', ($event.target as HTMLInputElement).value)" />
      <kbd v-if="SHORTCUTS_ENABLED">⌘K</kbd>
    </label>

    <div class="ws-session-scroll">
      <div class="ws-section-label"><span>{{ t("sessions") }}</span><em>{{ filtered.length }}</em></div>
      <div
        v-for="item in filtered"
        :key="item.id"
        :class="['ws-session', { 'is-active': activeId === item.id }]"
        role="button"
        tabindex="0"
        :aria-label="t('openSession', { title: item.title })"
        @click="emit('openSession', item.id)"
        @keydown.enter.prevent="emit('openSession', item.id)"
        @keydown.space.prevent="emit('openSession', item.id)"
      >
        <span :class="['ws-session-dot', { 'is-running': item.status === 'running' }]" />
        <span class="ws-session-body">
          <strong :title="item.title">{{ item.title }}</strong>
          <small>
            {{ item.status === "running" ? t("running") : t("messages", { count: item.messageCount }) }} ·
            {{ compact(item.tokens) }} tokens
          </small>
        </span>
        <time>{{ relative(item.updatedAt) }}</time>
        <ActionMenu
          class="ws-session-menu"
          :label="t('sessionActions', { title: item.title })"
          :icon-size="13"
          :items="menuItems(item)"
        />
      </div>
      <div v-if="filtered.length === 0" class="ws-session-empty">
        <p>{{ online ? t("emptyOnline") : t("emptyOffline") }}</p>
        <button v-if="online" class="text-btn" @click="emit('newSession')">
          {{ t("createFirst") }} <ArrowRight :size="12" />
        </button>
      </div>
    </div>

    <div class="ws-sessions-foot">
      <div class="ws-usage">
        <span>{{ t("workspaceTokens") }}</span>
        <strong>{{ compact(sessions.reduce((sum, item) => sum + item.tokens, 0)) }} <small>tokens</small></strong>
      </div>
      <button class="ws-settings-btn" @click="emit('openApi')"><Settings2 :size="13" />{{ t("apiSettings") }}</button>
    </div>
  </aside>
</template>
