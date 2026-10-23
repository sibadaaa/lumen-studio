import { useEffect, type ReactNode } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import { i18n, type Namespace } from "./config";

export { i18n, SUPPORTED_LANGUAGES, setLocale, isLocale } from "./config";
export type { Locale, Namespace } from "./config";

/** Wrap the app once; keeps <html lang> and the document title in sync. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const { i18n: instance } = useTranslation();
  useEffect(() => {
    document.documentElement.lang = instance.language;
    document.title = instance.t("meta.title", { ns: "base" });
  }, [instance, instance.language]);
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

/**
 * Localize a BFF error by code; anything unknown (or synthetic HTTP codes)
 * falls back to the server-provided message.
 */
export function tError(code: string | undefined, fallback: string): string {
  const untyped = i18n.t as (key: string, options?: Record<string, unknown>) => string;
  if (!code) return fallback;
  if (code.startsWith("HTTP_") || code === "BFF_ERROR") {
    return untyped("errors.__fallback__", { ns: "base" });
  }
  if (i18n.exists(`errors.${code}`, { ns: "base" })) {
    return untyped(`errors.${code}`, { ns: "base" });
  }
  return fallback;
}

/** Read an array-valued key (e.g. storyboard shot sizes). */
export function tList(key: string, ns: Namespace): string[] {
  const untyped = i18n.t as (key: string, options?: Record<string, unknown>) => unknown;
  const value = untyped(key, { ns, returnObjects: true });
  return Array.isArray(value) ? (value as string[]) : [];
}

export { useTranslation };
