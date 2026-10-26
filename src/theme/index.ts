import { computed, ref, watch } from "vue";

export type ThemePref = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "lumen.theme";

function readStoredPref(): ThemePref {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    /* storage unavailable */
  }
  return "system";
}

function systemPrefersDark() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(pref: ThemePref): ResolvedTheme {
  if (pref === "system") return systemPrefersDark() ? "dark" : "light";
  return pref;
}

function applyTheme(theme: ResolvedTheme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", theme);
}

const pref = ref<ThemePref>(readStoredPref());
const resolved = computed<ResolvedTheme>(() => resolve(pref.value));

watch(
  resolved,
  (value) => applyTheme(value),
  { immediate: true }
);

if (typeof window !== "undefined") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (pref.value === "system") applyTheme(resolve("system"));
  });
}

export function useTheme() {
  const setTheme = (next: ThemePref) => {
    pref.value = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode: session-only */
    }
  };

  const cycleTheme = () => {
    const next: ThemePref = pref.value === "light" ? "dark" : pref.value === "dark" ? "system" : "light";
    setTheme(next);
  };

  return { pref, resolved, setTheme, cycleTheme };
}
