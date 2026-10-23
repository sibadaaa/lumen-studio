import { i18n } from "./index";

const RTF_BY_LOCALE: Record<string, Intl.RelativeTimeFormat> = {};

function rtf(locale: string) {
  if (!RTF_BY_LOCALE[locale]) {
    RTF_BY_LOCALE[locale] = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  }
  return RTF_BY_LOCALE[locale];
}

/** Human relative time ("3 分钟前" / "3 min ago"), consistent across pages. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60_000);
  const untyped = i18n.t as (key: string, options?: Record<string, unknown>) => string;
  if (minutes < 1) return untyped("justNow", { ns: "base" });
  if (minutes < 60) return rtf(i18n.language).format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf(i18n.language).format(-hours, "hour");
  const days = Math.round(hours / 24);
  return rtf(i18n.language).format(-days, "day");
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(i18n.language, { year: "numeric", month: "numeric", day: "numeric" }).format(
    new Date(iso)
  );
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(i18n.language, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) {
    return `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(bytes / 1_048_576)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
