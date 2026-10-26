<script setup lang="ts">
import type { MediaAsset } from "../../shared/contracts";
import { useT } from "../i18n";

defineOptions({ name: "Outputs" });

defineProps<{ outputs: MediaAsset[] }>();
const t = useT("agent");
</script>

<template>
  <div v-if="outputs.length" class="ws-outputs">
    <template v-for="output in outputs" :key="output.id">
      <div v-if="output.kind === 'video'" class="ws-output-video">
        <video :src="output.url" :poster="output.thumbnailUrl" controls playsinline preload="metadata" />
        <div class="ws-output-meta">
          <span>{{ output.width }}×{{ output.height }} · {{ (output.durationSec || 0).toFixed(1) }}s</span>
          <a :href="output.url" download>{{ t("tool.downloadMp4") }}</a>
        </div>
      </div>
      <a v-else class="ws-output-image" :href="output.url" target="_blank" rel="noreferrer">
        <img :src="output.url" :alt="t('tool.outputs')" />
        <span>{{ output.width }}×{{ output.height }} · {{ t("tool.download") }}</span>
      </a>
    </template>
  </div>
</template>
