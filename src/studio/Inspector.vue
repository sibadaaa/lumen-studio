<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ChevronDown, Link2, Lock, RotateCcw, X } from "lucide-vue-next";
import { MODES, MOTIONS } from "../data/mock";
import { formatTokens } from "../lib/tokens";
import type { AnimationMode, Bitrate } from "../types";
import { useStudioStore } from "../stores/studio";
import { useAppStore } from "../stores/app";
import { useT } from "../i18n";

defineOptions({ name: "Inspector" });

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; openAgent: [] }>();
const studio = useStudioStore();
const app = useAppStore();
const t = useT("studio");
const tBase = useT("base");

const widthInput = ref(String(studio.customSize.width));
const heightInput = ref(String(studio.customSize.height));
const modelMenuOpen = ref(false);

watch(
  () => [studio.customSize.width, studio.customSize.height, studio.mode, studio.resolution] as const,
  () => {
    widthInput.value = String(studio.customSize.width);
    heightInput.value = String(studio.customSize.height);
  },
);

const isCustom = computed(() => studio.resolution === "custom");
const showDuration = computed(() => studio.isVideo && !studio.isBoardView);
const showMotion = computed(() => (studio.mode === "t2v" || studio.mode === "i2v") && !studio.isBoardView);
const showAnimation = computed(() => studio.mode === "i2v");
const showStrength = computed(() => studio.mode === "i2i");
const showMulti = computed(() => studio.mode === "multi");
const presets = computed<Array<[number, number, string]>>(() =>
  studio.isVideo
    ? [
        [1920, 1080, "1080p"],
        [3840, 2160, "4K"],
        [1080, 1920, "竖屏"],
      ]
    : [
        [2048, 1152, "2K"],
        [3840, 2160, "4K"],
        [1080, 1920, "竖屏"],
      ],
);

const modelTags = computed(() =>
  studio.selectedModel
    ? [studio.selectedModel.providerId, t(`inspector.kind.${studio.selectedModel.kind}`)]
    : MODES[studio.mode].tags,
);

function commitDimension(axis: "width" | "height", raw: string) {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    widthInput.value = String(studio.customSize.width);
    heightInput.value = String(studio.customSize.height);
    return;
  }
  studio.setCustomSize(axis, value);
}

function setPreset(width: number, height: number) {
  studio.setCustomDimensions(width, height);
  widthInput.value = String(width);
  heightInput.value = String(height);
}

function randomSeed() {
  studio.setSeed(String(Math.floor(Math.random() * 900000) + 100000));
}
</script>

<template>
  <aside :class="['inspector', { 'is-open': props.open }]" id="inspector" :aria-label="t('inspector.title')">
    <div class="inspector-head">
      <div>
        <span class="eyebrow">SETTINGS</span>
        <h2>{{ t("inspector.title") }}</h2>
      </div>
      <div class="inspector-head-actions">
        <button class="ghost-icon" :title="t('inspector.reset')" :aria-label="t('inspector.reset')" @click="studio.resetParams()">
          <RotateCcw :size="14" />
        </button>
        <button class="mobile-close" :aria-label="tBase('close')" @click="emit('close')"><X :size="13" /></button>
      </div>
    </div>

    <div class="inspector-scroll">
      <div class="field-group">
        <div class="field-label">{{ t("inspector.model") }} <span class="recommend">{{ t("inspector.recommend") }}</span></div>
        <div class="model-picker">
          <button class="model-select" aria-haspopup="listbox" :aria-expanded="modelMenuOpen" @click="modelMenuOpen = !modelMenuOpen">
            <span class="model-glyph">
              <svg viewBox="0 0 22 22" fill="none">
                <circle cx="11" cy="11" r="7.6" stroke="currentColor" stroke-width="1.2" />
                <path d="M11 3.4a7.6 7.6 0 0 0 0 15.2 7.6 7.6 0 0 0 0-15.2Z" fill="currentColor" opacity=".28" />
              </svg>
            </span>
            <span class="model-info">
              <strong>{{ studio.selectedModel?.label || MODES[studio.mode].model }}</strong>
              <small>
                {{
                  studio.selectedModel
                    ? t("inspector.providerKind", {
                        provider: studio.selectedModel.providerId,
                        kind: t(`inspector.kind.${studio.selectedModel.kind}`),
                      })
                    : MODES[studio.mode].modelDesc
                }}
              </small>
            </span>
            <ChevronDown class="chevron" :size="14" />
          </button>
          <ul v-if="modelMenuOpen" class="model-picker-list" role="listbox" :aria-label="t('inspector.model')">
            <li v-if="studio.availableModels.length === 0" class="model-picker-empty">
              <span>{{ t("inspector.modelEmpty") }}</span>
              <small>{{ t("inspector.modelEmptyHint") }}</small>
            </li>
            <li v-for="model in studio.availableModels" :key="model.id">
              <button
                role="option"
                :aria-selected="studio.selectedModel?.id === model.id"
                :class="{ 'is-active': studio.selectedModel?.id === model.id }"
                @click="studio.setModel(model.id); modelMenuOpen = false"
              >
                <span class="model-option-main">
                  <strong>{{ model.label }}</strong>
                  <small>{{ model.providerId }} · {{ t(`inspector.kind.${model.kind}`) }}</small>
                </span>
                <em v-if="model.lastUsedAt">{{ t("inspector.recentlyUsed") }}</em>
              </button>
            </li>
          </ul>
        </div>
        <div class="model-tags">
          <span v-for="tag in modelTags" :key="tag">{{ tag }}</span>
        </div>
      </div>

      <div class="divider" />

      <div class="field-group">
        <div class="field-label">{{ t("inspector.aspectRatio") }} <span class="field-value">{{ studio.ratio }}</span></div>
        <div class="ratio-row" role="group" :aria-label="t('inspector.aspectRatio')">
          <button
            v-for="ratio in ['1:1', '4:3', '16:9', '9:16', '3:2']"
            :key="ratio"
            :class="{ 'is-active': studio.ratio === ratio }"
            @click="studio.setRatio(ratio)"
          >
            <i :class="['ratio-shape', `r-${ratio.replace(':', '-')}`]" /><span>{{ ratio }}</span>
          </button>
        </div>
      </div>

      <div class="field-group">
        <div class="field-label">
          {{ t("inspector.resolution") }}
          <span class="field-value">{{ studio.resolution === "custom" ? t("inspector.custom") : studio.resolution }}</span>
        </div>
        <div class="segmented" role="group" :aria-label="t('inspector.resolution')">
          <button
            v-for="value in studio.resolutionOptions"
            :key="value"
            :class="{ 'is-active': studio.resolution === value }"
            @click="studio.setResolution(value)"
          >
            {{ value === "custom" ? t("inspector.custom") : value }}
          </button>
        </div>
        <div v-if="isCustom" class="custom-res">
          <div class="dim-row">
            <label class="dim-input">
              <span>{{ t("inspector.width") }}</span>
              <input v-model="widthInput" inputmode="numeric" @blur="commitDimension('width', widthInput)" />
              <em>px</em>
            </label>
            <button :class="['lock-btn', { 'is-active': studio.ratioLocked }]" :aria-pressed="studio.ratioLocked" :title="t('inspector.aspectRatio')" @click="studio.toggleRatioLock()">
              <Link2 :size="14" />
            </button>
            <label class="dim-input">
              <span>{{ t("inspector.height") }}</span>
              <input v-model="heightInput" inputmode="numeric" @blur="commitDimension('height', heightInput)" />
              <em>px</em>
            </label>
          </div>
          <div class="dim-meta">
            <span>{{ t("inspector.mp", { value: ((studio.customSize.width * studio.customSize.height) / 1_000_000).toFixed(2) }) }}</span>
            <span>{{ t("inspector.alignHint") }}</span>
          </div>
          <div class="res-presets">
            <button v-for="[w, h, label] in presets" :key="label" @click="setPreset(w, h)">
              {{ label === "竖屏" ? t("inspector.presetPortrait") : label }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="studio.isVideo" class="field-group">
        <div class="field-label">{{ t("inspector.bitrate") }} <span class="field-value">{{ studio.bitrateText }}</span></div>
        <div class="segmented" role="group" :aria-label="t('inspector.bitrate')">
          <button
            v-for="value in ['auto', '8', '16', 'custom'] as Bitrate[]"
            :key="value"
            :class="{ 'is-active': studio.bitrate === value }"
            @click="studio.setBitrate(value)"
          >
            {{ value === "auto" ? t("inspector.bitrateAuto") : value === "custom" ? t("inspector.bitrateCustom") : `${value}M` }}
          </button>
        </div>
        <div v-if="studio.bitrate === 'custom'" class="custom-bitrate">
          <input type="number" min="2" max="80" :value="studio.customBitrate" @change="studio.setCustomBitrate(Number(($event.target as HTMLInputElement).value))" />
          <span>{{ t("inspector.mbps") }}</span><small>{{ t("inspector.bitrateHint") }}</small>
        </div>
      </div>

      <div v-if="showDuration" class="field-group">
        <div class="field-label">{{ t("inspector.duration") }} <span class="field-value">{{ studio.duration }} {{ t("inspector.seconds") }}</span></div>
        <div class="segmented" role="group" :aria-label="t('inspector.duration')">
          <button v-for="value in [5, 10, 15]" :key="value" :class="{ 'is-active': studio.duration === value }" @click="studio.setDuration(value)">
            {{ value }}s
          </button>
        </div>
      </div>

      <div v-if="showMotion" class="field-group">
        <div class="field-label">{{ t("inspector.motion") }}</div>
        <button class="select-like" @click="app.toast(t('inspector.motionToast'))"><span>{{ MOTIONS[1] }}</span><ChevronDown :size="13" /></button>
      </div>

      <div v-if="showAnimation" class="field-group">
        <div class="field-label">{{ t("inspector.animation") }} <span class="field-value">{{ t(`inspector.animationModes.${studio.animation}`) }}</span></div>
        <div class="segmented anim-seg" role="group" :aria-label="t('inspector.animation')">
          <button
            v-for="value in ['live', '2d', '3d', 'stop'] as AnimationMode[]"
            :key="value"
            :class="{ 'is-active': studio.animation === value }"
            @click="studio.setAnimation(value)"
          >
            {{ t(`inspector.animationModes.${value}`) }}
          </button>
        </div>
        <div class="anim-hint">{{ t(`inspector.animationHints.${studio.animation}`) }}</div>
      </div>

      <div v-if="showStrength" class="field-group">
        <div class="field-label">{{ t("inspector.strength") }} <span class="field-value">{{ studio.strength }}%</span></div>
        <input
          class="range"
          type="range"
          min="0"
          max="100"
          :value="studio.strength"
          :style="{ '--range-fill': `${studio.strength}%` }"
          @input="studio.setStrength(Number(($event.target as HTMLInputElement).value))"
        />
        <div class="range-scale"><span>{{ t("inspector.freer") }}</span><span>{{ t("inspector.closer") }}</span></div>
      </div>

      <div v-if="studio.mode === 'i2v'" class="field-group">
        <div class="field-label">{{ t("inspector.lastFrame") }} <span class="field-value muted">{{ t("inspector.optional") }}</span></div>
        <button class="upload-slot" @click="app.toast(t('inspector.lastFrameToast'))">
          <span>{{ t("inspector.addLastFrame") }}</span><small>{{ t("inspector.addLastFrameHint") }}</small>
        </button>
      </div>

      <div v-if="showMulti" class="field-group">
        <div class="field-label">{{ t("inspector.compose") }}</div>
        <div class="segmented">
          <button class="is-active">{{ t("inspector.aiStoryboard") }}</button>
          <button @click="app.toast(t('inspector.quickToast'))">{{ t("inspector.quickTemplate") }}</button>
        </div>
        <div class="field-label spaced">{{ t("inspector.transition") }}</div>
        <button class="select-like" @click="app.toast(t('inspector.transitionToast'))"><span>{{ t("inspector.dissolve") }}</span><ChevronDown :size="13" /></button>
      </div>

      <div class="field-group">
        <div class="field-label">{{ t("inspector.negative") }} <span class="field-value muted">{{ t("inspector.optional") }}</span></div>
        <textarea
          class="mini-textarea"
          rows="2"
          maxlength="300"
          :value="studio.negativePrompt"
          @input="studio.setNegativePrompt(($event.target as HTMLTextAreaElement).value)"
        />
      </div>

      <details class="advanced">
        <summary>{{ t("inspector.advanced") }} <ChevronDown :size="13" /></summary>
        <div class="advanced-body">
          <div class="inline-field">
            <span>{{ t("inspector.seed") }}</span>
            <input :value="studio.seed" inputmode="numeric" @input="studio.setSeed(($event.target as HTMLInputElement).value)" />
            <button @click="randomSeed()">{{ t("inspector.random") }}</button>
          </div>
          <div class="inline-field">
            <span>{{ t("inspector.weight") }}</span>
            <input class="range" type="range" min="1" max="10" value="7" />
            <em>7</em>
          </div>
          <label class="switch-row"><span>{{ t("inspector.autoDownload") }}</span><span class="switch"><input type="checkbox" /><i /></span></label>
        </div>
      </details>

      <div class="queue-card">
        <div class="queue-top"><span class="queue-live"><i />{{ t("inspector.queueTitle") }}</span><strong>0</strong></div>
        <p>{{ t("inspector.queueBody") }}</p>
      </div>
    </div>

    <div class="inspector-foot">
      <div class="estimate">
        <span class="estimate-label">{{ t("inspector.estimate") }} <em class="estimate-flag">{{ t("inspector.estimated") }}</em></span>
        <strong>{{ formatTokens(studio.estimatedTokens) }} <small>tokens</small></strong>
      </div>
      <button :class="['cta', { 'is-loading': studio.isGenerating }]" @click="void studio.generate()">
        <span class="cta-label">{{ t(`cta.${studio.mode}`) }}</span>
        <svg viewBox="0 0 20 20" fill="none">
          <path d="M4 10h11M11 5.5 15.5 10 11 14.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <div class="secure-note"><Lock :size="10" />{{ t("inspector.secure") }}</div>
    </div>
  </aside>
</template>
