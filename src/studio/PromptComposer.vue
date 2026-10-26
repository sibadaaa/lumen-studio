<script setup lang="ts">
import { computed, ref } from "vue";
import { FolderOpen, Plus, SlidersHorizontal, Wand2 } from "lucide-vue-next";
import { MODES } from "../data/mock";
import { SHORTCUTS_ENABLED } from "../lib/features";
import { formatTokens } from "../lib/tokens";
import AssetPickerDialog from "../library/AssetPickerDialog.vue";
import type { AssetRole } from "../../shared/contracts";
import { useStudioStore } from "../stores/studio";
import { useAppStore } from "../stores/app";
import { useT } from "../i18n";

defineOptions({ name: "PromptComposer" });

const emit = defineEmits<{ openInspector: [] }>();
const studio = useStudioStore();
const app = useAppStore();
const t = useT("studio");
const tBase = useT("base");
const fileRef = ref<HTMLInputElement | null>(null);
const pickerOpen = ref(false);

const config = computed(() => MODES[studio.mode]);
const eta = computed(() =>
  studio.isBoardView
    ? t(studio.mode === "multi" ? "boardEta.multi" : "boardEta.t2v")
    : t(`eta.${studio.mode}`),
);
const pickerRole = computed<AssetRole>(() =>
  studio.mode === "i2v" ? "first_frame" : studio.mode === "multi" ? "shot" : "reference",
);

function enhance() {
  if (studio.prompt.includes("体积光")) {
    studio.setPrompt(`${studio.prompt}，电影级构图，35mm 胶片颗粒`);
    return;
  }
  studio.setPrompt(`${studio.prompt.replace(/[，。,\s]+$/, "")}，电影级构图，体积光，35mm 胶片颗粒`);
}

function onFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  Array.from(input.files || []).forEach((file) => studio.addAttachment(file));
  input.value = "";
}
</script>

<template>
  <section class="composer" :aria-label="t('composer.label')">
    <div class="composer-head">
      <label class="prompt-label" for="prompt">
        <span class="prompt-spark">✦</span> {{ t("composer.label") }}
        <span class="lang-tag">{{ t("composer.langTag") }}</span>
      </label>
      <div class="composer-tools">
        <button class="text-tool" @click="enhance">
          <Wand2 :size="12" :stroke-width="1.4" /> {{ t("composer.enhance") }}
        </button>
        <span class="char-count">{{ studio.prompt.length }} / 1000</span>
      </div>
    </div>
    <textarea
      id="prompt"
      :value="studio.prompt"
      rows="2"
      maxlength="1000"
      spellcheck="false"
      :placeholder="t('composer.placeholder')"
      @input="studio.setPrompt(($event.target as HTMLTextAreaElement).value)"
    />
    <div class="composer-foot">
      <div class="attach-area">
        <template v-if="config.attach">
          <button class="attach-btn" @click="fileRef?.click()">
            <Plus :size="13" /> {{ t(`composer.attach.${studio.mode}`) }}
          </button>
          <button class="attach-btn is-ghost" @click="pickerOpen = true">
            <FolderOpen :size="13" /> {{ t("composer.fromLibrary") }}
          </button>
        </template>
        <input
          ref="fileRef"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          @change="onFiles"
        />
        <div class="attachments">
          <div
            v-for="attachment in studio.attachments"
            :key="attachment.id"
            :class="['attachment-chip', { 'is-uploading': attachment.uploading, 'is-uploaded': attachment.assetId }]"
            :title="attachment.name"
          >
            <img :src="attachment.url" :alt="attachment.name" />
            <span v-if="attachment.uploading" class="attachment-progress">{{ attachment.progress || 0 }}%</span>
            <span v-if="attachment.assetId" class="attachment-ok">✓</span>
            <button type="button" :aria-label="tBase('delete')" @click="studio.removeAttachment(attachment.id)">×</button>
          </div>
        </div>
        <span v-if="SHORTCUTS_ENABLED" class="kbd-hint">{{ t("composer.kbd") }}</span>
      </div>
      <div class="estimate-inline">
        <span class="estimate-dot" />
        <span class="est-approx">≈</span>
        <span>{{ formatTokens(studio.estimatedTokens) }}</span>
        <span class="token-unit">tokens</span>
        <span class="sep">·</span>
        <span>{{ eta }}</span>
      </div>
      <div class="mobile-actions">
        <button class="mobile-params" aria-controls="inspector" @click="emit('openInspector')">
          <SlidersHorizontal :size="14" /> {{ t("inspector.title") }}
        </button>
        <button class="mobile-generate" @click="void studio.generate()">{{ t("cta.generate") }}</button>
      </div>
    </div>
    <AssetPickerDialog
      :open="pickerOpen"
      :project-id="app.projectId"
      @close="pickerOpen = false"
      @pick="(asset) => studio.attachAsset(asset, pickerRole)"
    />
  </section>
</template>
