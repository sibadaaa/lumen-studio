<script setup lang="ts">
import { computed, ref } from "vue";
import { Copy, Download, Sparkles, Trash2 } from "lucide-vue-next";
import { MOTIONS, SHOT_SIZES } from "../data/mock";
import { formatTokens } from "../lib/tokens";
import { useStudioStore } from "../stores/studio";
import { useT } from "../i18n";

defineOptions({ name: "StoryboardTable" });

const studio = useStudioStore();
const t = useT("studio");
const fileRef = ref<HTMLInputElement | null>(null);
const pendingRow = ref<number | null>(null);

const rows = computed(() => studio.board.rows);
const total = computed(() => rows.value.reduce((sum, row) => sum + Number(row.dur || 0), 0));

function chooseImage(index: number) {
  pendingRow.value = index;
  fileRef.value?.click();
}

function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file && pendingRow.value !== null) studio.replaceBoardImageFile(pendingRow.value, file);
  input.value = "";
  pendingRow.value = null;
}

function setDuration(index: number, event: Event) {
  const value = Number((event.target as HTMLInputElement).value) || 1;
  studio.updateBoardRow(index, { dur: Math.min(8, Math.max(1, value)) });
}
</script>

<template>
  <div class="storyboard-view">
    <div class="board-shell">
      <header class="board-head">
        <div class="board-title">
          <span class="eyebrow-light">STORYBOARD / SHOT LIST</span>
          <h2>
            {{ t("storyboard.boardTitle") }}
            <span>{{ t("storyboard.rows", { count: rows.length, seconds: total.toFixed(1) }) }}</span>
          </h2>
        </div>
        <div class="board-actions">
          <button class="soft-btn" @click="studio.resetBoard()"><Sparkles :size="13" />{{ t("storyboard.aiSplit") }}</button>
          <button class="soft-btn" @click="studio.exportBoard()"><Download :size="13" />{{ t("storyboard.exportCsv") }}</button>
          <button class="board-add-btn" @click="studio.addBoardRow()"><span>+</span>{{ t("storyboard.add") }}</button>
        </div>
      </header>

      <div class="board-table">
        <div class="board-thead">
          <span class="c-num">{{ t("storyboard.shot") }}</span><span class="c-frame">{{ t("storyboard.frame") }}</span
          ><span class="c-shot">{{ t("storyboard.size") }}</span> <span class="c-motion">{{ t("storyboard.motion") }}</span
          ><span class="c-desc">{{ t("storyboard.desc") }}</span><span class="c-audio">{{ t("storyboard.audio") }}</span>
          <span class="c-dur">{{ t("storyboard.duration") }}</span><span class="c-ops">{{ t("storyboard.ops") }}</span>
        </div>
        <div class="board-rows">
          <div v-for="(row, index) in rows" :key="row.id" class="board-row">
            <div class="board-num">
              <span class="grip">⠿</span><span class="idx">{{ String(index + 1).padStart(2, "0") }}</span>
            </div>
            <div v-if="row.img" class="board-thumb" @click="chooseImage(index)">
              <img :src="row.img" :alt="t('storyboard.shotAlt', { index: index + 1 })" />
              <div class="thumb-replace"><span>{{ t("storyboard.replace") }}</span></div>
            </div>
            <button v-else class="board-thumb is-empty" @click="chooseImage(index)">
              {{ t("storyboard.emptyFirstFrame") }}
            </button>
            <select
              class="board-cell-select"
              :value="row.shot"
              @change="studio.updateBoardRow(index, { shot: ($event.target as HTMLSelectElement).value })"
            >
              <option v-for="item in SHOT_SIZES" :key="item">{{ item }}</option>
            </select>
            <select
              class="board-cell-select"
              :value="row.motion"
              @change="studio.updateBoardRow(index, { motion: ($event.target as HTMLSelectElement).value })"
            >
              <option v-for="item in MOTIONS" :key="item">{{ item }}</option>
            </select>
            <textarea
              class="board-cell-desc"
              rows="2"
              :value="row.desc"
              @input="studio.updateBoardRow(index, { desc: ($event.target as HTMLTextAreaElement).value })"
            />
            <input
              class="board-cell-input"
              :value="row.audio"
              @input="studio.updateBoardRow(index, { audio: ($event.target as HTMLInputElement).value })"
            />
            <div class="board-duration">
              <input type="number" min="1" max="8" step="0.5" :value="row.dur" @change="setDuration(index, $event)" />
              <span>s</span>
            </div>
            <div class="board-ops">
              <button class="board-op" :title="t('storyboard.duplicateShot')" @click="studio.duplicateBoardRow(index)">
                <Copy :size="12" />
              </button>
              <button class="board-op is-danger" :title="t('storyboard.deleteShot')" @click="studio.deleteBoardRow(index)">
                <Trash2 :size="12" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <footer class="board-foot">
        <div class="board-summary">
          <span>{{ t("storyboard.summaryDuration") }} <strong>{{ total.toFixed(1) }}s</strong></span>
          <span>{{ t("storyboard.summaryShots") }} <strong>{{ rows.length }}</strong></span>
          <span>{{ t("storyboard.summaryEstimate") }} <strong>{{ formatTokens(studio.estimatedTokens) }}</strong> tokens</span>
        </div>
        <div class="board-timeline">
          <span v-for="row in rows" :key="row.id" :style="{ flex: Math.max(1, row.dur) }" />
        </div>
      </footer>
    </div>
    <input ref="fileRef" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="onFile" />
  </div>
</template>
