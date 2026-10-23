import { useEffect, useRef, type ReactNode } from "react";
import { Star, X } from "lucide-react";

export const relativeTime = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(iso).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
};

export const compactBytes = (bytes: number) =>
  bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export const formatClock = (seconds?: number) => {
  if (!seconds || seconds <= 0) return null;
  const total = Math.round(seconds);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

export function LibraryShell({
  eyebrow,
  title,
  description,
  stats,
  actions,
  toolbar,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  stats?: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="library-page">
      <section className="library-main">
        <header className="library-head">
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          <div className="library-head-side">
            {stats && <div className="library-stats">{stats}</div>}
            {actions && <div className="library-actions">{actions}</div>}
          </div>
        </header>
        {toolbar && <div className="library-toolbar">{toolbar}</div>}
        <div className="library-content">{children}</div>
      </section>
    </main>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="library-empty">
      <div className="library-empty-art" aria-hidden="true">
        <svg viewBox="0 0 64 48" fill="none">
          <rect x="6" y="6" width="52" height="36" rx="6" stroke="currentColor" strokeWidth="1.2" opacity=".5" />
          <circle cx="44" cy="16" r="3" fill="currentColor" opacity=".8" />
          <path d="M12 34 24 22l8 7 7-6 13 11" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" opacity=".7" />
        </svg>
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="library-error" role="alert">
      <span>{message}</span>
      <button onClick={onRetry}>重试</button>
    </div>
  );
}

export function MediaCard({
  kind,
  url,
  thumbnailUrl,
  title,
  meta,
  badges,
  favorite,
  selected,
  durationSec,
  onOpen,
  onToggleFavorite,
  onToggleSelect,
}: {
  kind: "image" | "video";
  url: string;
  thumbnailUrl?: string;
  title: string;
  meta: ReactNode;
  badges?: ReactNode;
  favorite?: boolean;
  selected?: boolean;
  durationSec?: number;
  onOpen: () => void;
  onToggleFavorite?: () => void;
  onToggleSelect?: () => void;
}) {
  return (
    <article className={`media-card ${selected ? "is-selected" : ""}`}>
      <button className="media-card-thumb" onClick={onOpen} aria-label={`打开 ${title}`}>
        <img src={thumbnailUrl || url} alt={title} loading="lazy" decoding="async" />
        {kind === "video" && (
          <span className="media-card-duration">
            <i aria-hidden="true">▶</i>
            {formatClock(durationSec) || "视频"}
          </span>
        )}
        {badges && <span className="media-card-badges">{badges}</span>}
      </button>
      {(onToggleFavorite || onToggleSelect) && (
        <div className="media-card-actions">
          {onToggleSelect && (
            <button
              className={`media-card-select ${selected ? "is-active" : ""}`}
              aria-pressed={selected}
              aria-label={selected ? "取消选择" : "选择"}
              onClick={onToggleSelect}
            >
              {selected ? "✓" : ""}
            </button>
          )}
          {onToggleFavorite && (
            <button
              className={`media-card-fav ${favorite ? "is-active" : ""}`}
              aria-pressed={favorite}
              aria-label={favorite ? "取消收藏" : "收藏"}
              onClick={onToggleFavorite}
            >
              <Star size={13} strokeWidth={1.6} />
            </button>
          )}
        </div>
      )}
      <div className="media-card-body">
        <strong>{title}</strong>
        <span className="media-card-meta">{meta}</span>
      </div>
    </article>
  );
}

export function DetailDrawer({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const node = ref.current;
    const focusable = node?.querySelector<HTMLElement>("button, [href], input, select, textarea");
    focusable?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <aside ref={ref} className={`library-drawer ${wide ? "is-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="library-drawer-head">
        <strong>{title}</strong>
        <button className="library-drawer-close" onClick={onClose} aria-label="关闭详情">
          <X size={14} />
        </button>
      </header>
      <div className="library-drawer-body">{children}</div>
    </aside>
  );
}

export function SelectionBar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="library-selection-bar" role="region" aria-live="polite" aria-label={label}>
      <span className="library-selection-label">{label}</span>
      <div className="library-selection-actions">{children}</div>
    </div>
  );
}

export function SkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="library-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="media-card is-skeleton">
          <div className="media-card-thumb" />
          <div className="media-card-body">
            <span />
            <span />
          </div>
        </div>
      ))}
    </div>
  );
}
