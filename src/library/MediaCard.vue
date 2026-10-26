<script setup lang="ts">
import { Star } from "lucide-vue-next";
import { useT } from "../i18n";
import { formatClock } from "./format";

withDefaults(
  defineProps<{
    kind: "image" | "video";
    url: string;
    thumbnailUrl?: string;
    title: string;
    favorite?: boolean;
    selected?: boolean;
    durationSec?: number;
    selectable?: boolean;
    favoritable?: boolean;
  }>(),
  {
    thumbnailUrl: undefined,
    favorite: false,
    selected: false,
    durationSec: undefined,
    selectable: false,
    favoritable: false,
  }
);

const emit = defineEmits<{ open: []; toggleFavorite: []; toggleSelect: [] }>();
const t = useT("base");
</script>

<template>
  <article :class="['media-card', { 'is-selected': selected }]">
    <button class="media-card-thumb" :aria-label="t('openDetail', { title })" @click="emit('open')">
      <img :src="thumbnailUrl || url" :alt="title" loading="lazy" decoding="async" />
      <span v-if="kind === 'video'" class="media-card-duration">
        <i aria-hidden="true">▶</i>
        {{ formatClock(durationSec) || "视频" }}
      </span>
      <span v-if="$slots.badges" class="media-card-badges"><slot name="badges" /></span>
    </button>
    <div v-if="selectable || favoritable" class="media-card-actions">
      <button
        v-if="selectable"
        :class="['media-card-select', { 'is-active': selected }]"
        :aria-pressed="selected"
        :aria-label="selected ? t('unselect') : t('toggleSelect')"
        @click="emit('toggleSelect')"
      >
        {{ selected ? "✓" : "" }}
      </button>
      <button
        v-if="favoritable"
        :class="['media-card-fav', { 'is-active': favorite }]"
        :aria-pressed="favorite"
        :aria-label="favorite ? t('unfavoriteAria') : t('toggleFavorite')"
        @click="emit('toggleFavorite')"
      >
        <Star :size="13" :stroke-width="1.6" />
      </button>
    </div>
    <div class="media-card-body">
      <strong>{{ title }}</strong>
      <span class="media-card-meta"><slot name="meta" /></span>
    </div>
  </article>
</template>
