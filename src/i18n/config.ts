import i18next, { type i18n as I18nInstance } from "i18next";
import { zhCN } from "./locales/zh-CN";
import { en } from "./locales/en";

export const SUPPORTED_LANGUAGES = [
  { code: "zh-CN", label: "简体中文" },
  { code: "en", label: "English" },
] as const;

export type Locale = (typeof SUPPORTED_LANGUAGES)[number]["code"];
export const LANGUAGE_STORAGE_KEY = "lumen.lang";

/** One namespace per page; `base` holds shared copy. */
export const NAMESPACES = [
  "base",
  "workspace",
  "project",
  "studio",
  "agent",
  "api",
  "models",
  "works",
  "assets",
] as const;

export type Namespace = (typeof NAMESPACES)[number];

function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "zh-CN" || stored === "en") return stored;
  } catch {
    /* storage unavailable */
  }
  const nav = typeof navigator !== "undefined" ? navigator.language || "zh-CN" : "zh-CN";
  return nav.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export const i18n: I18nInstance = i18next.createInstance();

void i18n.init({
  resources: { "zh-CN": zhCN, en },
  lng: detectLocale(),
  fallbackLng: "zh-CN",
  ns: NAMESPACES,
  defaultNS: "base",
  interpolation: { escapeValue: false },
  returnEmptyString: false,
  saveMissing: import.meta.env.DEV,
  missingKeyHandler: import.meta.env.DEV
    ? (lngs, ns, key) => console.warn(`[i18n] missing ${ns}:${key}`)
    : undefined,
});

export function isLocale(value: string): value is Locale {
  return SUPPORTED_LANGUAGES.some((item) => item.code === value);
}

export function setLocale(locale: Locale) {
  void i18n.changeLanguage(locale);
  document.documentElement.lang = locale;
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  } catch {
    /* private mode: session-only */
  }
}
