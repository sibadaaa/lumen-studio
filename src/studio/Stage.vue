<script setup lang="ts">
import { computed, ref } from "vue";
import { Download, Expand, MoreHorizontal, Pause, Play } from "lucide-vue-next";
import type { CSSProperties } from "vue";
import { IMG, MODES } from "../data/mock";
import { formatTokens, ratioValue } from "../lib/tokens";
import StoryboardTable from "./StoryboardTable.vue";
import { useStudioStore } from "../stores/studio";
import { useT } from "../i18n";

defineOptions({ name: "Stage" });

const studio = useStudioStore();
const t = useT("studio");
const tBase = useT("base");

const split = ref(43);
const selectedShot = ref(0);
const compareRef = ref<HTMLDivElement | null>(null);
const dragging = ref(false);

const boardStyle = computed<CSSProperties>(() => ({
  "--ar": studio.ratio.replace(":", " / "),
  "--ratio": String(ratioValue(studio.ratio)),
  "--split": `${split.value}%`,
}));

const rows = computed(() => studio.board.rows);
const shot = computed(() => rows.value[Math.min(selectedShot.value, Math.max(0, rows.value.length - 1))]);
const total = computed(() => rows.value.reduce((sum, row) => sum + Number(row.dur || 0), 0));
const output = computed(() => studio.activeOutput?.outputs[0]);
const imageOutput = computed(() => (output.value?.kind === "image" ? output.value : undefined));
const videoOutput = computed(() => (output.value?.kind === "video" ? output.value : undefined));
const downloadName = computed(() =>
  output.value
    ? `lumen-${studio.mode}-${studio.activeOutput?.id || "output"}.${output.value.kind === "video" ? "mp4" : "jpg"}`
    : undefined,
);

function setSplitFromEvent(event: PointerEvent) {
  if (!compareRef.value) return;
  const rect = compareRef.value.getBoundingClientRect();
  split.value = Math.min(88, Math.max(12, ((event.clientX - rect.left) / rect.width) * 100));
}

function onCompareDown(event: PointerEvent) {
  if ((event.target as HTMLElement).closest("button")) return;
  dragging.value = true;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  setSplitFromEvent(event);
}

function onCompareMove(event: PointerEvent) {
  if (!dragging.value) return;
  setSplitFromEvent(event);
}

function setVideoProgress(event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  studio.setVideoProgress(((event.clientX - rect.left) / rect.width) * 100);
}
</script>

<template>
  <section class="stage" :aria-label="t('stageLabel')">
    <div class="stage-grid" aria-hidden="true" />
    <StoryboardTable v-if="studio.isBoardView" />
    <div v-else class="panel is-active">
      <div v-if="studio.mode === 't2i'" class="artboard" :style="boardStyle">
        <img class="art-img art-warm" :src="imageOutput?.url || IMG.glass" :alt="t('stage.emptyT2i')" />
        <div class="art-grade" />
        <div class="art-top">
          <span class="status-chip"><i />{{ t("stage.statusDone") }} <span class="dim">· {{ studio.activeOutput ? "BFF" : "12.4s" }}</span></span>
          <div class="art-tools">
            <button class="glass-icon" :title="t('stage.fullscreen')" :aria-label="t('stage.fullscreen')"><Expand :size="16" /></button>
            <a v-if="imageOutput?.url" class="glass-icon" :href="imageOutput.url" :download="downloadName || true" :title="t('stage.download')" :aria-label="t('stage.download')">
              <Download :size="16" />
            </a>
            <button v-else class="glass-icon" :title="t('stage.download')" :aria-label="t('stage.download')"><Download :size="16" /></button>
            <button class="glass-icon" :title="t('stage.more')" :aria-label="t('stage.more')"><MoreHorizontal :size="16" /></button>
          </div>
        </div>
        <div class="art-bottom">
          <div class="art-caption">
            <span class="eyebrow-light">OUTPUT 01</span>
            <p>{{ t("stage.emptyT2i") }}</p>
          </div>
          <div class="art-meta">
            <span>{{ MODES.t2i.model }}</span>
            <span>{{ studio.dimensions.width }} × {{ studio.dimensions.height }}</span>
            <span>Seed {{ studio.seed }}</span>
            <span>{{ formatTokens(studio.estimatedTokens) }} tok</span>
          </div>
        </div>
      </div>

      <div v-if="studio.mode === 't2v'" :class="['artboard', 'video-board', { 'has-live-video': videoOutput }]" :style="boardStyle">
        <video v-if="videoOutput" class="art-img generated-video" :src="videoOutput.url" :poster="videoOutput.thumbnailUrl" controls playsinline preload="metadata" />
        <img v-else class="art-img art-cool" :src="IMG.nebula" :alt="t('stage.emptyT2v')" />
        <div class="art-grade" />
        <div class="art-top">
          <span class="status-chip"><i />{{ t("stage.statusDone") }} <span class="dim">· {{ studio.activeOutput ? "BFF" : "38.2s" }}</span></span>
          <div class="art-tools">
            <span class="glass-tag">{{ studio.activeOutput?.outputs[0]?.durationSec ? `${studio.activeOutput.outputs[0].durationSec.toFixed(1)}s` : "5.0s" }}</span>
            <button class="glass-icon" :title="t('stage.fullscreen')" :aria-label="t('stage.fullscreen')"><Expand :size="16" /></button>
            <a v-if="videoOutput?.url" class="glass-icon" :href="videoOutput.url" :download="downloadName || true" :title="t('stage.download')" :aria-label="t('stage.download')"><Download :size="16" /></a>
            <button v-else class="glass-icon" :title="t('stage.download')" :aria-label="t('stage.download')"><Download :size="16" /></button>
            <button class="glass-icon" :title="t('stage.more')" :aria-label="t('stage.more')"><MoreHorizontal :size="16" /></button>
          </div>
        </div>
        <button v-if="!videoOutput" :class="['play-button', { 'is-playing': studio.isPlaying }]" :aria-label="t('stage.playVideo')" @click="studio.togglePlayback()">
          <Play class="play-icon" :size="24" fill="currentColor" />
          <Pause class="pause-icon" :size="22" fill="currentColor" />
        </button>
        <div v-if="!videoOutput" class="video-timeline">
          <div class="timeline-meta">
            <span>{{ `00:0${Math.floor((studio.videoProgress / 100) * 5)}` }}</span>
            <span class="timeline-title">{{ t("stage.timelineTitle") }}</span>
            <span>00:05</span>
          </div>
          <div class="timeline-track" @click="setVideoProgress">
            <span class="timeline-fill" :style="{ width: `${studio.videoProgress}%` }" />
            <i class="timeline-head" :style="{ left: `${studio.videoProgress}%` }" />
          </div>
        </div>
        <div class="art-bottom video-bottom">
          <div class="art-caption"><span class="eyebrow-light">SEEDANCE 1.0 PRO</span><p>星云缓慢旋转，黑石从星尘中浮现 · 24fps</p></div>
          <div class="art-meta">
            <span>{{ studio.resolution === "custom" ? `${studio.dimensions.width} × ${studio.dimensions.height}` : studio.resolution }}</span>
            <span>{{ studio.bitrateText }}</span>
            <span>Seed 302884</span>
            <span>{{ formatTokens(studio.estimatedTokens) }} tok</span>
          </div>
        </div>
      </div>

      <div
        v-if="studio.mode === 'i2i'"
        ref="compareRef"
        class="artboard compare-board"
        :style="boardStyle"
        @pointerdown="onCompareDown"
        @pointermove="onCompareMove"
        @pointerup="dragging = false"
        @pointercancel="dragging = false"
      >
        <div class="compare-side source-side">
          <img class="art-img art-source" :src="IMG.pastel" :alt="t('stage.refImage')" />
          <span class="side-label">{{ t("stage.sourceSide") }}</span>
          <button class="replace-img">{{ t("stage.replace") }}</button>
        </div>
        <div class="compare-side result-side">
          <img class="art-img art-warm" :src="imageOutput?.url || IMG.tide" :alt="t('stage.emptyI2i')" />
          <span class="side-label result">{{ t("stage.resultSide") }}</span>
        </div>
        <div class="compare-line">
          <span class="compare-handle">
            <svg viewBox="0 0 20 20" fill="none">
              <path d="m7.5 7-3 3 3 3M12.5 7l3 3-3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>
        </div>
        <div class="art-top">
          <span class="status-chip"><i />{{ t("stage.statusDone") }} <span class="dim">· 9.1s</span></span>
          <div class="art-tools">
            <span class="glass-tag">{{ t("stage.strength", { value: studio.strength }) }}</span>
            <button class="glass-icon" :title="t('stage.fullscreen')" :aria-label="t('stage.fullscreen')"><Expand :size="16" /></button>
            <a v-if="imageOutput?.url" class="glass-icon" :href="imageOutput.url" :download="downloadName || true" :title="t('stage.download')" :aria-label="t('stage.download')"><Download :size="16" /></a>
            <button v-else class="glass-icon" :title="t('stage.download')" :aria-label="t('stage.download')"><Download :size="16" /></button>
          </div>
        </div>
        <div class="compare-hint">{{ t("stage.compareHint") }}</div>
      </div>

      <div v-if="studio.mode === 'i2v'" :class="['artboard', 'i2v-board', { 'has-live-video': videoOutput }]" :style="boardStyle">
        <video v-if="videoOutput" class="art-img generated-video" :src="videoOutput.url" :poster="videoOutput.thumbnailUrl" controls playsinline preload="metadata" />
        <img v-else class="art-img art-warm" :src="IMG.dunes" :alt="t('stage.emptyI2v')" />
        <div class="art-grade" />
        <div class="art-top">
          <span class="status-chip"><i />{{ videoOutput ? t("stage.statusVideo") : t("stage.statusFirstFrame") }} <span class="dim">· {{ studio.dimensions.width }} × {{ studio.dimensions.height }}</span></span>
          <div class="art-tools">
            <span v-if="studio.animation !== 'live'" class="glass-tag anim-stage-tag">{{ t("stage.animationTag", { mode: t(`inspector.animationModes.${studio.animation}`) }) }}</span>
            <span class="glass-tag">5.0s · 24fps</span>
            <button class="glass-icon" :title="t('stage.fullscreen')" :aria-label="t('stage.fullscreen')"><Expand :size="16" /></button>
            <a v-if="videoOutput?.url" class="glass-icon" :href="videoOutput.url" :download="downloadName || true" :title="t('stage.download')" :aria-label="t('stage.download')"><Download :size="16" /></a>
            <button v-else class="glass-icon" :title="t('stage.download')" :aria-label="t('stage.download')"><Download :size="16" /></button>
          </div>
        </div>
        <div v-if="!videoOutput" class="motion-path" aria-hidden="true">
          <svg viewBox="0 0 220 130" fill="none">
            <path d="M12 112c36-8 48-40 82-50 32-10 59-4 72-26" stroke="currentColor" stroke-width="1.3" stroke-dasharray="4 5" stroke-linecap="round" />
            <path d="m158 28 10 4-5 9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
            <circle cx="12" cy="112" r="4" fill="currentColor" />
          </svg>
          <span>缓慢推进 · 向右环绕</span>
        </div>
        <div v-if="!videoOutput" class="frame-slots">
          <div class="frame-thumb is-filled"><img :src="IMG.dunes" :alt="t('stage.firstFrame')" /><span>{{ t("stage.firstFrame") }}</span><i>01</i></div>
          <div class="frame-link">
            <svg viewBox="0 0 34 12" fill="none"><path d="M1 6h30M27 2l4 4-4 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </div>
          <button class="frame-thumb is-empty"><span class="plus">+</span><span>{{ t("stage.lastFrame") }}</span><i>{{ t("stage.optional") }}</i></button>
        </div>
        <button v-if="!videoOutput" class="play-button small" :aria-label="t('stage.previewMotion')"><Play :size="18" fill="currentColor" /></button>
        <div class="art-bottom">
          <div class="art-caption"><span class="eyebrow-light">IMAGE TO VIDEO</span><p>云层漫过山脊，晨雾缓慢流动</p></div>
          <div class="art-meta"><span>{{ MODES.i2v.model }}</span><span>{{ studio.bitrateText }}</span><span>Seed 482019</span></div>
        </div>
      </div>

      <div v-if="studio.mode === 'multi'" class="storyboard">
        <div class="storyboard-head">
          <div>
            <span class="eyebrow-light">SEQUENCE 01</span>
            <h2>{{ t("storyboard.boardTitle") }} <span>{{ t("stage.shotCount", { count: rows.length, seconds: total.toFixed(1) }) }}</span></h2>
          </div>
          <div class="storyboard-actions">
            <button class="soft-btn"><Play :size="13" />{{ t("stage.previewBoard") }}</button>
            <button class="glass-icon" :title="t('stage.fullscreen')" :aria-label="t('stage.fullscreen')"><Expand :size="15" /></button>
          </div>
        </div>
        <div class="storyboard-body">
          <div class="sequence-preview">
            <video v-if="videoOutput" class="generated-video" :src="videoOutput.url" :poster="videoOutput.thumbnailUrl" controls playsinline preload="metadata" />
            <img v-else-if="shot?.img" :src="shot.img" :alt="t('stage.previewBoard')" />
            <div v-else class="board-thumb is-empty">{{ t("stage.awaiting") }}</div>
            <div class="preview-grade" />
            <span class="preview-tag">
              {{ videoOutput ? "FINAL CUT" : `SHOT ${String(Math.min(selectedShot + 1, rows.length)).padStart(2, "0")}` }} ·
              {{ shot?.dur.toFixed(1) }}s
            </span>
            <button v-if="!videoOutput" class="play-button preview-play" :aria-label="t('stage.previewShot')"><Play :size="20" fill="currentColor" /></button>
            <div class="preview-caption">
              <div><p>{{ shot?.desc || t("stage.waitingDesc") }}</p><span>{{ shot?.motion }} · 35mm</span></div>
              <span class="preview-pager">{{ String(Math.min(selectedShot + 1, rows.length)).padStart(2, "0") }} / {{ String(rows.length).padStart(2, "0") }}</span>
            </div>
          </div>
          <div class="shot-list">
            <article
              v-for="(row, index) in rows"
              :key="row.id"
              :class="['shot-item', { 'is-active': index === selectedShot }]"
              @click="selectedShot = index"
            >
              <div class="shot-item-thumb">
                <img v-if="row.img" :src="row.img" :alt="t('storyboard.boardAlt', { index: index + 1 })" />
                <div v-else class="board-thumb is-empty">{{ t("stage.awaiting") }}</div>
                <span class="shot-index">{{ String(index + 1).padStart(2, "0") }}</span>
                <span class="shot-duration">{{ row.dur.toFixed(1) }}s</span>
              </div>
              <div class="shot-item-copy"><p>{{ row.desc || t("stage.shotOf", { index: index + 1 }) }}</p><span>{{ row.motion }} · {{ row.dur.toFixed(1) }}s</span></div>
              <span class="shot-grip" aria-hidden="true">⠿</span>
            </article>
            <button class="add-shot" @click="studio.addBoardRow()"><span>+ {{ t("stage.addShot") }}</span><small>{{ t("stage.addShotHint") }}</small></button>
          </div>
        </div>
        <div class="sequence-timeline">
          <div class="sequence-top">
            <span>{{ t("stage.composeTimeline") }}</span>
            <span>{{ t("stage.totalDuration", { value: total.toFixed(1) }) }} · {{ studio.dimensions.width }}×{{ studio.dimensions.height }} · {{ studio.bitrateText }}</span>
          </div>
          <div class="sequence-track">
            <span v-for="(row, index) in rows" :key="row.id" :class="`seq-seg seg-${index + 1}`" :style="{ flex: Math.max(row.dur, 1) }">{{ String(index + 1).padStart(2, "0") }}</span>
            <i class="seq-playhead" />
          </div>
          <div class="sequence-foot">
            <span><i class="legend-dot" />{{ t("stage.aiDissolve") }}</span>
            <button class="text-btn" @click="void studio.generate()">{{ t("stage.generateAll") }}</button>
          </div>
        </div>
      </div>
    </div>

    <div :class="['generation-overlay', { 'is-visible': studio.isGenerating }]" :aria-hidden="!studio.isGenerating">
      <div class="gen-orb"><span /></div>
      <div class="gen-copy">
        <span class="gen-stage">{{ studio.genStage }}</span>
        <strong>{{ studio.progress }}%</strong>
      </div>
      <div class="gen-bar"><i :style="{ width: `${studio.progress}%` }" /></div>
      <p>{{ t("inspector.estimate") }} {{ formatTokens(studio.estimatedTokens) }} tokens · {{ t("inspector.queueBody") }}</p>
      <button v-if="studio.isGenerating" class="gen-cancel" @click="studio.cancelGeneration()">{{ tBase("cancel") }}</button>
    </div>
  </section>
</template>
