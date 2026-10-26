<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { X } from "lucide-vue-next";
import { useT } from "../i18n";

const props = withDefaults(defineProps<{ open: boolean; title: string; wide?: boolean }>(), {
  wide: false,
});
const emit = defineEmits<{ close: [] }>();
const t = useT("base");
const refEl = ref<HTMLElement | null>(null);

function onKey(event: KeyboardEvent) {
  if (event.key === "Escape") emit("close");
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      window.removeEventListener("keydown", onKey);
      return;
    }
    window.addEventListener("keydown", onKey);
    void nextTick(() => {
      refEl.value
        ?.querySelector<HTMLElement>("button, [href], input, select, textarea")
        ?.focus();
    });
  }
);

onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <aside
    v-if="open"
    ref="refEl"
    :class="['library-drawer', { 'is-wide': wide }]"
    role="dialog"
    aria-modal="true"
    :aria-label="title"
  >
    <header class="library-drawer-head">
      <strong>{{ title }}</strong>
      <button class="library-drawer-close" :aria-label="t('close')" @click="emit('close')">
        <X :size="14" />
      </button>
    </header>
    <div class="library-drawer-body">
      <slot />
    </div>
  </aside>
</template>
