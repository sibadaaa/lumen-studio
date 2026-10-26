<script setup lang="ts">
import { computed } from "vue";
import { RefreshCw } from "lucide-vue-next";
import type {
  AgentMessage,
  AgentPlanStep,
  AgentSession,
  AgentToolState,
  MediaAsset,
  SystemInfo,
} from "../../shared/contracts";
import { compact } from "./helpers";
import { useT } from "../i18n";

defineOptions({ name: "AgentContextPanel" });

const props = defineProps<{
  session: AgentSession | null;
  sessions: AgentSession[];
  messages: AgentMessage[];
  running: boolean;
  title: string;
  usagePercent: number;
  effectivePlan: AgentPlanStep[];
  effectiveTools: AgentToolState[];
  latestOutputs: MediaAsset[];
  assets: MediaAsset[];
  system: SystemInfo | null;
  hasAssistant: boolean;
}>();

const emit = defineEmits<{ refresh: []; openApi: [] }>();
const t = useT("agent");

const doneSteps = computed(() => props.effectivePlan.filter((step) => step.status === "done").length);
const toolList = computed<AgentToolState[]>(() =>
  props.effectiveTools.length
    ? props.effectiveTools
    : [
        { id: "t1", name: "workspace.inspect", status: "pending", detail: "" },
        { id: "t2", name: "storyboard.plan", status: "pending", detail: "" },
        { id: "t3", name: "media.generate", status: "pending", detail: "" },
        { id: "t4", name: "ffmpeg.compose", status: "pending", detail: "" },
      ],
);
</script>

<template>
  <aside class="ws-context chat-context" :aria-label="t('contextLabel')">
    <div class="ws-context-head">
      <div><span class="eyebrow">CONTEXT</span><h2>{{ t("contextTitle") }}</h2></div>
      <button class="ghost-icon" :title="t('refreshAria')" @click="emit('refresh')"><RefreshCw :size="14" /></button>
    </div>
    <div class="ws-context-scroll">
      <section class="ws-context-card ws-context-usage">
        <div class="ws-ring" :style="{ '--p': usagePercent }"><span>{{ usagePercent }}%</span></div>
        <div class="ws-usage-copy">
          <strong>{{ compact(session?.tokens || 0) }} <small>/ 128k tokens</small></strong><span>{{ t("sessionTokens") }}</span>
          <div class="ws-usage-bar"><i :style="{ width: `${usagePercent}%` }" /></div>
          <div class="ws-usage-split">
            <span>{{ t("contextSplit", { messages: session?.messageCount || messages.length, sessions: sessions.length }) }}</span>
          </div>
        </div>
      </section>
      <section class="ws-context-section">
        <div class="ws-context-section-head"><h3>{{ t("goal") }}</h3></div>
        <div class="ws-goal">
          <div class="ws-goal-top"><span class="ws-goal-dot" /><strong>{{ title }}</strong></div>
          <p>
            {{
              effectivePlan.length
                ? t("stepsDone", { done: doneSteps, total: effectivePlan.length })
                : t("goalEmpty")
            }}
          </p>
          <div class="ws-goal-bar">
            <i :style="{ width: `${effectivePlan.length ? Math.round((doneSteps / effectivePlan.length) * 100) : 0}%` }" />
          </div>
          <div class="ws-goal-meta">
            <span>{{ running ? t("state.running") : hasAssistant ? t("state.done") : t("state.pending") }}</span>
            <span>{{ effectivePlan.length ? `${Math.round((doneSteps / effectivePlan.length) * 100)}%` : "0%" }}</span>
          </div>
        </div>
      </section>
      <section class="ws-context-section">
        <div class="ws-context-section-head"><h3>{{ t("toolsTitle") }}</h3><span class="ws-auto"><i />{{ t("autoApprove") }}</span></div>
        <div class="ws-tool-list">
          <div v-for="tool in toolList" :key="tool.id">
            <span :class="['ws-tool-dot', tool.status === 'done' ? 'done' : tool.status === 'running' ? 'running' : '']" />
            <code>{{ tool.name }}</code>
            <em>{{ tool.tokens ? compact(tool.tokens) : tool.status === "done" ? "✓" : "—" }}</em>
          </div>
        </div>
      </section>
      <section class="ws-context-section">
        <div class="ws-context-section-head"><h3>{{ t("workspaceFiles") }}</h3><span>{{ assets.length + latestOutputs.length }}</span></div>
        <div class="ws-file-list">
          <div v-for="asset in assets.slice(0, 3)" :key="asset.id">
            <span class="ws-file-icon img" />
            <span>{{ asset.originalName || asset.id }}</span>
            <em>{{ Math.round(asset.size / 1024) }} KB</em>
          </div>
          <div v-for="output in latestOutputs.slice(0, 2)" :key="output.id">
            <span :class="['ws-file-icon', output.kind === 'video' ? 'video' : 'img']" />
            <span>{{ output.kind === "video" ? "final.mp4" : "output.jpg" }}</span>
            <em>{{ Math.round(output.size / 1024) }} KB</em>
          </div>
          <div v-if="assets.length === 0 && latestOutputs.length === 0">
            <span class="ws-file-icon img" /><span>{{ t("noFiles") }}</span><em>—</em>
          </div>
        </div>
      </section>
      <section class="ws-context-section">
        <div class="ws-context-section-head"><h3>{{ t("runtime") }}</h3></div>
        <div class="ws-env">
          <div><span>Provider</span><code>{{ system?.activeProviderId || "—" }}</code></div>
          <div><span>{{ t("ffmpeg") }}</span><code>{{ system?.ffmpeg?.available ? t("ffmpegOk") : t("ffmpegMissing") }}</code></div>
          <div><span>{{ t("storageLabel") }}</span><code>sqlite · ./data</code></div>
        </div>
      </section>
    </div>
    <div class="ws-context-foot"><span><i />{{ t("localFoot") }}</span><button @click="emit('openApi')">{{ t("apiSettings") }}</button></div>
  </aside>
</template>
