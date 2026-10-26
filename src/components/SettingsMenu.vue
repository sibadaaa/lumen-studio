<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { Monitor, Moon, Settings2, Sun } from "lucide-vue-next";
import { useTheme, type ThemePref } from "../theme";
import { locale, setLocale, SUPPORTED_LANGUAGES, useT } from "../i18n";

const t = useT("base");
const { pref, resolved, setTheme, cycleTheme } = useTheme();
const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

function close() {
  open.value = false;
}

function onPointerDown(event: MouseEvent) {
  if (rootRef.value && !rootRef.value.contains(event.target as Node)) close();
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape") close();
}

watch(open, (value) => {
  if (value) {
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
  } else {
    document.removeEventListener("mousedown", onPointerDown);
    document.removeEventListener("keydown", onKeyDown);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onPointerDown);
  document.removeEventListener("keydown", onKeyDown);
});

const themeLabel = () =>
  t(pref.value === "system" ? "themeSystem" : pref.value === "light" ? "themeLight" : "themeDark");

const themes: Array<{ value: ThemePref; label: string; hint: string }> = [
  { value: "system", label: "themeSystem", hint: "themeSystemHint" },
  { value: "light", label: "themeLight", hint: "" },
  { value: "dark", label: "themeDark", hint: "" },
];
</script>

<template>
  <div ref="rootRef" class="settings-root">
    <button
      class="icon-btn"
      :title="t('themeAria', { value: themeLabel() })"
      :aria-label="t('themeAria', { value: themeLabel() })"
      @click="cycleTheme"
    >
      <Monitor v-if="pref === 'system'" :size="17" :stroke-width="1.4" />
      <Sun v-else-if="resolved === 'light'" :size="17" :stroke-width="1.4" />
      <Moon v-else :size="17" :stroke-width="1.4" />
    </button>
    <button
      :class="['icon-btn', { 'is-active': open }]"
      :aria-label="t('settingsTitle')"
      aria-haspopup="dialog"
      :aria-expanded="open"
      @click="open = !open"
    >
      <Settings2 :size="17" :stroke-width="1.4" />
    </button>
    <div v-if="open" class="settings-pop" role="dialog" aria-modal="false" :aria-label="t('settingsTitle')">
      <header>{{ t("settingsTitle") }}</header>
      <fieldset>
        <legend>{{ t("appearance") }}</legend>
        <label v-for="item in themes" :key="item.value" class="settings-option">
          <input
            type="radio"
            name="lumen-theme"
            :checked="pref === item.value"
            @change="setTheme(item.value)"
          />
          <span>
            <strong>{{ t(item.label) }}</strong>
            <small v-if="item.hint">{{ t(item.hint) }}</small>
          </span>
        </label>
      </fieldset>
      <fieldset>
        <legend>{{ t("language") }}</legend>
        <label v-for="language in SUPPORTED_LANGUAGES" :key="language.code" class="settings-option">
          <input
            type="radio"
            name="lumen-lang"
            :checked="locale === language.code"
            @change="setLocale(language.code)"
          />
          <span><strong>{{ language.label }}</strong></span>
        </label>
      </fieldset>
      <footer>{{ t("storedLocally") }}</footer>
    </div>
  </div>
</template>
