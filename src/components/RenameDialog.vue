<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { X } from "lucide-vue-next";
import { useT } from "../i18n";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    description?: string;
    initialValue: string;
    label: string;
    placeholder?: string;
    maxLength?: number;
    busy?: boolean;
  }>(),
  { description: "", placeholder: "", maxLength: 80, busy: false }
);

const emit = defineEmits<{ close: []; submit: [value: string] }>();
const t = useT("base");
const value = ref(props.initialValue);
const inputRef = ref<HTMLInputElement | null>(null);

watch(
  () => [props.open, props.initialValue] as const,
  ([isOpen]) => {
    if (!isOpen) return;
    value.value = props.initialValue;
    void nextTick(() => {
      inputRef.value?.focus();
      inputRef.value?.select();
    });
  },
  { immediate: true }
);

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") emit("close");
    };
    window.addEventListener("keydown", onKey, { once: true });
  }
);

function submit() {
  const trimmed = value.value.trim();
  if (!trimmed || props.busy) return;
  emit("submit", trimmed);
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-backdrop" @mousedown.self="emit('close')">
      <div class="modal rename-dialog" role="dialog" aria-modal="true" aria-labelledby="renameDialogTitle">
        <header class="modal-head">
          <div>
            <span class="eyebrow">RENAME</span>
            <h2 id="renameDialogTitle">{{ title }}</h2>
            <p v-if="description">{{ description }}</p>
          </div>
          <button class="modal-close" type="button" :aria-label="t('close')" @click="emit('close')">
            <X :size="15" />
          </button>
        </header>
        <div class="modal-body">
          <label class="form-field full">
            <span>{{ label }}</span>
            <input
              ref="inputRef"
              v-model="value"
              :maxlength="maxLength"
              :placeholder="placeholder"
              @keydown.enter.prevent="submit"
            />
            <small>{{ t("renameHint", { max: maxLength }) }}</small>
          </label>
        </div>
        <footer class="modal-foot">
          <span class="test-state">{{ value.trim() ? "" : t("renameRequired") }}</span>
          <div class="modal-foot-right">
            <button class="text-btn" type="button" @click="emit('close')">{{ t("cancel") }}</button>
            <button class="save-btn" type="button" :disabled="!value.trim() || busy" @click="submit">
              {{ busy ? t("saving") : t("save") }}
            </button>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
