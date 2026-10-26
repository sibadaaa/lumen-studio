export const formatClock = (seconds?: number) => {
  if (!seconds || seconds <= 0) return null;
  const total = Math.round(seconds);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

export { relativeTime, formatBytes as compactBytes } from "../i18n/format";
