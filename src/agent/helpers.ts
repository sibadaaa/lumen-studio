import { Film, Sparkles, Wrench, type LucideIcon } from "lucide-vue-next";
import { i18n } from "../i18n";

export const compact = (value: number) =>
  value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(2)}m`
    : value >= 1000
      ? `${(value / 1000).toFixed(1)}k`
      : String(Math.round(value));

export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });

export const relative = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const translate = i18n.t as (key: string, options?: Record<string, unknown>) => string;
  if (diff < 60_000) return translate("justNow", { ns: "base" });
  if (diff < 3_600_000) return translate("minutesAgo", { ns: "base", count: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return translate("hoursAgo", { ns: "base", count: Math.floor(diff / 3_600_000) });
  return new Date(iso).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
};

export const TOOL_ICONS: Record<string, LucideIcon> = {
  "workspace.inspect": Wrench,
  "storyboard.plan": Sparkles,
  "intent.resolve": Sparkles,
  "media.generate": Film,
  "ffmpeg.compose": Film,
};
