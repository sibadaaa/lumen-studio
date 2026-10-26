<script setup lang="ts">
import { ArrowRight, Plus } from "lucide-vue-next";
import { useStudioStore } from "../stores/studio";
import { useAppStore } from "../stores/app";
import { useT } from "../i18n";

defineOptions({ name: "HistoryStrip" });

const studio = useStudioStore();
const app = useAppStore();
const t = useT("studio");
</script>

<template>
  <section class="history" :aria-label="t('historyLabel')">
    <div class="history-head">
      <span>{{ t("history.session") }} <em>{{ studio.history.length }}</em></span>
      <button class="text-btn" @click="app.toast(t('history.allWorksToast'))">
        {{ t("history.allWorks") }} <ArrowRight :size="12" />
      </button>
    </div>
    <div class="history-row">
      <button
        v-for="item in studio.history"
        :key="item.id"
        :class="['history-card', { 'is-active': studio.activeHistory === item.id }]"
        @click="studio.selectHistory(item.id)"
      >
        <img :src="item.img" alt="" />
        <span class="history-badge">{{ item.badge }}</span>
        <span class="history-tip">{{ item.time }}{{ item.tokens ? ` · ${item.tokens} tok` : "" }}</span>
        <span v-if="item.kind === 'video' || item.mode === 't2v' || item.mode === 'i2v'" class="history-play">
          <svg viewBox="0 0 14 14" fill="none"><path d="M5.5 4.2v5.6l4.6-2.8-4.6-2.8Z" fill="currentColor" /></svg>
        </span>
      </button>
      <button class="history-new" @click="app.toast(t('history.newToast'))">
        <Plus :size="15" /><span>{{ t("history.new") }}</span>
      </button>
    </div>
  </section>
</template>
