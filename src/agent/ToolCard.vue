<script setup lang="ts">
import { computed } from "vue";
import { ArrowRight, Check, ChevronDown, RefreshCw, Wrench, X } from "lucide-vue-next";
import type { AgentToolState, MediaAsset } from "../../shared/contracts";
import { compact, TOOL_ICONS } from "./helpers";
import { useT } from "../i18n";

defineOptions({ name: "ToolCard" });

const props = defineProps<{ tool: AgentToolState; onOpenStoryboard: () => void }>();
const t = useT("agent");

const icon = computed(() => TOOL_ICONS[props.tool.name] || Wrench);
const data = computed<Record<string, unknown>>(() => (props.tool.data || {}) as Record<string, unknown>);
const rows = computed(() =>
  Array.isArray(data.value.rows)
    ? (data.value.rows as Array<{ shot: string; motion: string; desc: string; dur: number }>)
    : [],
);
const outputs = computed(() =>
  Array.isArray(data.value.outputs) ? (data.value.outputs as MediaAsset[]) : [],
);
const inspect = computed(() => props.tool.name === "workspace.inspect");
</script>

<template>
  <details class="ws-tool" :open="tool.status !== 'done' || rows.length > 0">
    <summary>
      <span :class="['ws-tool-icon', tool.status]">
        <Check v-if="tool.status === 'done'" :size="13" />
        <X v-else-if="tool.status === 'failed'" :size="13" />
        <RefreshCw v-else :size="13" />
      </span>
      <span class="ws-tool-name">
        <strong>{{ tool.name }}</strong>
        <small>{{ tool.detail }}</small>
      </span>
      <span :class="['ws-tool-status', tool.status]">
        {{
          tool.status === "done"
            ? t("tool.done")
            : tool.status === "failed"
              ? t("tool.failed")
              : t("tool.runningTool")
        }}
      </span>
      <span class="ws-tool-tokens">{{ tool.tokens ? `${compact(tool.tokens)} tokens` : "—" }}</span>
      <ChevronDown class="ws-chevron" :size="12" />
    </summary>
    <div class="ws-tool-body">
      <template v-if="inspect">
        <div class="ws-kv"><span>{{ t("tool.project") }}</span><code>{{ String(data.project || "—") }}</code></div>
        <div class="ws-kv"><span>{{ t("tool.assets") }}</span><code>{{ String(data.assets ?? 0) }}</code></div>
        <div class="ws-kv"><span>Provider</span><code>{{ String(data.provider || "—") }}</code></div>
        <div class="ws-kv">
          <span>{{ t("tool.codec") }}</span>
          <code>FFmpeg {{ data.ffmpeg ? t("tool.ffmpegOk") : t("tool.ffmpegBad") }} · {{ String(data.database || "sqlite") }}</code>
        </div>
      </template>
      <template v-if="rows.length > 0">
        <div class="ws-mini-table">
          <div class="ws-mini-row head">
            <span>#</span><span>{{ t("tool.size") }}</span><span>{{ t("tool.motion") }}</span><span>{{ t("tool.frame") }}</span
            ><span>{{ t("tool.duration") }}</span>
          </div>
          <div v-for="(row, index) in rows" :key="`${row.shot}-${index}`" class="ws-mini-row">
            <span>{{ String(index + 1).padStart(2, "0") }}</span>
            <span>{{ row.shot }}</span>
            <span>{{ row.motion }}</span>
            <span>{{ row.desc }}</span>
            <span>{{ Number(row.dur).toFixed(1) }}s</span>
          </div>
        </div>
        <button class="ws-inline-action" @click="props.onOpenStoryboard()">
          {{ t("tool.openStoryboard") }} <ArrowRight :size="12" />
        </button>
      </template>
      <div v-if="outputs.length > 0" class="ws-gen-grid">
        <template v-for="output in outputs" :key="output.id">
          <div v-if="output.kind === 'video'" class="ws-gen-video">
            <video :src="output.url" :poster="output.thumbnailUrl" controls playsinline preload="metadata" />
          </div>
          <a v-else class="ws-gen-thumb" :href="output.url" target="_blank" rel="noreferrer">
            <img :src="output.thumbnailUrl || output.url" :alt="t('tool.outputs')" />
            <span>IMG</span>
          </a>
        </template>
      </div>
      <div v-if="!inspect && rows.length === 0 && outputs.length === 0" class="ws-kv">
        <span>{{ t("tool.status") }}</span><code>{{ tool.detail }}</code>
      </div>
      <div v-if="data.jobId" class="ws-kv"><span>{{ t("tool.job") }}</span><code>{{ String(data.jobId) }}</code></div>
    </div>
  </details>
</template>
