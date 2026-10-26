<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Wrench,
} from "lucide-vue-next";
import RenameDialog from "../components/RenameDialog.vue";
import ActionMenu from "../components/ActionMenu.vue";
import AgentSessionsPanel from "./AgentSessionsPanel.vue";
import AgentContextPanel from "./AgentContextPanel.vue";
import ToolCard from "./ToolCard.vue";
import PlanCard from "./PlanCard.vue";
import Outputs from "./Outputs.vue";
import { useAgent } from "./useAgent";
import { clock } from "./helpers";
import { useT } from "../i18n";
import { useAppStore } from "../stores/app";
import type { ActionMenuItem } from "../components/action-menu";

defineOptions({ name: "AgentPage" });

const app = useAppStore();
const t = useT("agent");
const tBase = useT("base");
const agent = useAgent();

const {
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
  filtered,
  lastAssistant,
  effectivePlan,
  effectiveTools,
  usagePercent,
  latestOutputs,
  title,
  compact,
} = agent;

const threadRef = ref<HTMLDivElement | null>(null);

function scrollThread() {
  void nextTick(() => {
    threadRef.value?.scrollTo({ top: threadRef.value.scrollHeight, behavior: "smooth" });
  });
}

watch([messages, tools, plan, running], scrollThread);

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void agent.send();
  }
}

function headMenu(): ActionMenuItem[] {
  return [
    {
      key: "rename",
      label: tBase("rename"),
      icon: Pencil,
      disabled: !session.value,
      onSelect: () => {
        if (session.value) renameTarget.value = session.value;
      },
    },
    {
      key: "delete",
      label: tBase("delete"),
      icon: Trash2,
      danger: true,
      disabled: !session.value || running.value,
      onSelect: () => {
        if (session.value) void agent.removeSession(session.value);
      },
    },
  ];
}

function useExample(key: string) {
  input.value = t(key);
}
</script>

<template>
  <main class="workspace-page chat-page">
    <AgentSessionsPanel
      :project="project"
      :online="online"
      :sessions="sessions"
      :filtered="filtered"
      :query="query"
      :active-id="activeId"
      :running="running"
      @query-change="query = $event"
      @open-session="(id) => void agent.openSession(id)"
      @new-session="void agent.newSession()"
      @rename="(item) => (renameTarget = item)"
      @remove="(item) => void agent.removeSession(item)"
      @open-api="app.openApi()"
    />

    <section class="ws-main chat-main" :aria-label="t('mainLabel')">
      <header class="ws-head chat-head">
        <div class="ws-head-title">
          <span class="eyebrow">SESSION / {{ session ? session.id.slice(-6).toUpperCase() : "NEW" }}</span>
          <div class="ws-title-row">
            <h1 :title="title">{{ title }}</h1>
            <span :class="['ws-agent-status', { 'is-running': running }]"><i />{{ running ? stage : t("statusReady") }}</span>
          </div>
        </div>
        <div class="ws-head-actions">
          <button class="ws-back" @click="agent.openStudio()"><ArrowLeft :size="12" />{{ t("backToStudio") }}</button>
          <span class="ws-model-chip"><span class="ws-model-dot" />local-agent <ChevronDown :size="10" /></span>
          <span class="ws-context-chip" :title="t('contextChipTitle', { count: session?.tokens || 0 })">
            <i :style="{ '--p': usagePercent }" />{{ usagePercent }}%
          </span>
          <ActionMenu class="ws-head-menu" :label="t('moreAria')" :items="headMenu()" />
        </div>
      </header>

      <div ref="threadRef" class="ws-thread chat-thread">
        <div class="ws-date"><span>{{ online ? t("dateLineOnline") : t("dateLineOffline") }}</span></div>

        <div v-if="!activeId" class="ws-empty">
          <span class="ws-empty-mark">✦</span>
          <h3>{{ online ? t("emptyTitleOnline") : t("emptyTitleOffline") }}</h3>
          <p>{{ online ? t("emptyBodyOnline") : t("emptyBodyOffline") }}</p>
          <div v-if="online" class="ws-empty-hints">
            <span @click="void agent.newSession()">{{ t("createFirst") }}</span>
            <span>{{ t("tryPrefix") }}{{ t("exampleMulti") }}</span>
          </div>
        </div>

        <div v-if="activeId && messages.length === 0 && !running" class="ws-empty">
          <span class="ws-empty-mark">✦</span>
          <h3>{{ t("newTitle") }}</h3>
          <p>{{ t("newBody") }}</p>
          <div class="ws-empty-hints">
            <span @click="useExample('example1Full')">{{ t("example1") }}</span>
            <span @click="useExample('example2Full')">{{ t("example2") }}</span>
          </div>
        </div>

        <template v-for="message in messages" :key="message.id">
          <article v-if="message.role === 'user'" class="ws-msg ws-user chat-msg chat-msg-user">
            <div class="ws-msg-meta"><span>{{ t("you") }}</span><time>{{ clock(message.createdAt) }}</time></div>
            <div class="ws-bubble chat-bubble">{{ message.text }}</div>
          </article>
          <article v-else class="ws-msg ws-assistant chat-msg chat-msg-bot">
            <div class="ws-avatar">L</div>
            <div class="ws-msg-body">
              <div class="ws-msg-meta">
                <span>LUMEN Agent</span>
                <span class="ws-msg-model">local-agent</span>
                <time>{{ clock(message.createdAt) }}</time>
                <em v-if="message.data?.tokens">{{ compact(message.data.tokens) }} tokens</em>
              </div>
              <p>{{ message.text }}</p>
              <ToolCard
                v-for="tool in message.data?.tools || []"
                :key="tool.id"
                :tool="tool"
                :on-open-storyboard="agent.openStoryboard"
              />
              <PlanCard :steps="message.data?.plan || []" />
              <Outputs :outputs="message.data?.outputs || []" />
              <div class="ws-msg-actions">
                <button v-if="(message.data?.actions || []).includes('open_storyboard')" class="ws-inline-action" @click="agent.openStoryboard()">
                  {{ t("openStoryboard") }} <ArrowRight :size="12" />
                </button>
                <button v-if="(message.data?.actions || []).includes('open_studio')" class="ws-inline-action" @click="agent.openStudio()">
                  {{ t("viewInStudio") }} <ArrowRight :size="12" />
                </button>
                <button v-if="(message.data?.actions || []).includes('open_api')" class="ws-inline-action" @click="app.openApi()">
                  {{ t("openApi") }} <ArrowRight :size="12" />
                </button>
              </div>
            </div>
          </article>
        </template>

        <article v-if="running" class="ws-msg ws-assistant chat-msg chat-msg-bot">
          <div class="ws-avatar">L</div>
          <div class="ws-msg-body">
            <div class="ws-msg-meta"><span>{{ t("botName") }}</span><time>{{ tBase("justNow") }}</time><em>{{ stage }}</em></div>
            <div v-if="tools.length === 0" class="ws-typing-line"><i /><i /><i /><span>{{ t("checkingAssets") }}</span></div>
            <ToolCard
              v-for="tool in tools"
              :key="tool.id"
              :tool="tool"
              :on-open-storyboard="agent.openStoryboard"
            />
            <PlanCard :steps="plan" />
            <div v-if="progress" class="ws-tool ws-tool-progress">
              <div class="ws-tool-progress-head">
                <span class="ws-tool-icon running"><RefreshCw :size="13" /></span>
                <span class="ws-tool-name"><strong>media.generate</strong><small>{{ progress.stage }}</small></span>
                <span class="ws-tool-status running">{{ progress.progress }}%</span>
                <button class="text-btn" @click="void agent.cancel()">{{ tBase("cancel") }}</button>
              </div>
              <div class="ws-progress"><i :style="{ width: `${progress.progress}%` }" /></div>
              <div class="ws-progress-meta"><span>{{ t("progressNote") }}</span><span>{{ t("progressHint") }}</span></div>
            </div>
            <p v-if="error" class="ws-error-line">{{ error }}</p>
          </div>
        </article>
      </div>

      <div class="ws-composer chat-composer">
        <div class="ws-composer-box chat-composer-box">
          <textarea
            v-model="input"
            rows="2"
            :placeholder="running ? t('composerRunning') : t('composerPlaceholder')"
            @keydown="onKeydown"
          />
          <div class="ws-composer-tools">
            <div class="ws-composer-left">
              <button class="ws-chip" @click="app.toast(t('chipAssetsToast', { count: assets.length }))">
                <Paperclip :size="11" />{{ t("chipAssets", { count: assets.length }) }}
              </button>
              <button class="ws-chip" @click="app.toast(t('chipToolsToast'))"><Wrench :size="11" />{{ t("chipTools") }}</button>
              <button class="ws-chip" @click="void agent.newSession()"><Plus :size="11" />{{ t("newSession") }}</button>
            </div>
            <div class="ws-composer-right">
              <span class="ws-context-hint"><i />{{ compact(session?.tokens || 0) }} / 128k</span>
              <button v-if="running" class="ws-send ws-stop" :aria-label="t('cancelAria')" @click="void agent.cancel()">■</button>
              <button v-else class="ws-send" :aria-label="t('sendAria')" @click="void agent.send()"><ArrowRight :size="15" /></button>
            </div>
          </div>
        </div>
        <div class="ws-composer-hint">{{ t("hint") }}</div>
      </div>

      <footer class="ws-statusbar chat-statusbar">
        <span class="ws-status-left"><i class="ws-status-live" />{{ t("statusLocal") }}</span>
        <span>local-agent</span>
        <span>{{ running ? stage : t("ready") }}</span>
        <span>{{ t("tools", { count: 4 }) }}</span><span>{{ t("autoApprove") }}</span>
        <span class="ws-status-right">LUMEN AGENT · SQLite</span>
      </footer>
    </section>

    <AgentContextPanel
      :session="session"
      :sessions="sessions"
      :messages="messages"
      :running="running"
      :title="title"
      :usage-percent="usagePercent"
      :effective-plan="effectivePlan"
      :effective-tools="effectiveTools"
      :latest-outputs="latestOutputs"
      :assets="assets"
      :system="system"
      :has-assistant="Boolean(lastAssistant)"
      @refresh="void agent.loadSessions(activeId)"
      @open-api="app.openApi()"
    />

    <RenameDialog
      :open="Boolean(renameTarget)"
      :title="t('renameSession')"
      :description="t('renameSessionDesc')"
      :initial-value="renameTarget?.title || ''"
      :label="t('sessionNameLabel')"
      :max-length="120"
      :busy="renaming"
      @close="!renaming && (renameTarget = null)"
      @submit="void agent.renameSession($event)"
    />
  </main>
</template>
