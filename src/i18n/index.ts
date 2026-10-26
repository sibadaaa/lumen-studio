import { ref } from "vue";
import { i18n, isLocale, setLocale, SUPPORTED_LANGUAGES, type Locale, type Namespace } from "./config";

export { i18n, SUPPORTED_LANGUAGES, isLocale, setLocale };
export type { Locale, Namespace };

/** Reactive mirror of the active language so templates re-render on change. */
export const locale = ref<Locale>((i18n.language as Locale) || "zh-CN");

i18n.on("languageChanged", (lng) => {
  locale.value = (isLocale(lng) ? lng : "zh-CN") as Locale;
  document.documentElement.lang = lng;
  document.title = i18n.t("meta.title", { ns: "base" }) as string;
});

/**
 * Namespace-bound translator. Reading `locale.value` makes every template
 * expression that calls `t()` reactive to language switches.
 */
export function useT(ns: Namespace) {
  return (key: string, options?: Record<string, unknown>): string => {
    void locale.value;
    const translate = i18n.t as (key: string, options?: Record<string, unknown>) => string;
    return translate(key, { ns, ...options });
  };
}

/**
 * Localize a BFF error by code; anything unknown (or synthetic HTTP codes)
 * falls back to the server-provided message.
 */
export function tError(code: string | undefined, fallback: string): string {
  if (!code) return fallback;
  const translate = i18n.t as (key: string, options?: Record<string, unknown>) => string;
  if (code.startsWith("HTTP_") || code === "BFF_ERROR") {
    return translate("errors.__fallback__", { ns: "base" });
  }
  if (i18n.exists(`errors.${code}`, { ns: "base" })) {
    return translate(`errors.${code}`, { ns: "base" });
  }
  return fallback;
}

/** Read an array-valued key (e.g. storyboard shot sizes). */
export function tList(key: string, ns: Namespace): string[] {
  const translate = i18n.t as (key: string, options?: Record<string, unknown>) => unknown;
  const value = translate(key, { ns, returnObjects: true });
  return Array.isArray(value) ? (value as string[]) : [];
}
