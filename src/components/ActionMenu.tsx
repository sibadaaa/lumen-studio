import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";

export interface ActionMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

interface Props {
  /** Accessible label for the trigger, e.g. "项目操作". */
  label: string;
  items: ActionMenuItem[];
  align?: "start" | "end";
  className?: string;
  iconSize?: number;
}

const POP_WIDTH = 148;
const ITEM_HEIGHT = 32;
const GAP = 6;

/**
 * Compact "..." row action menu. The popover is portaled to the body with
 * fixed positioning so it is never clipped by scroll containers or cards.
 * It stops click propagation so it can sit inside clickable rows.
 */
export function ActionMenu({ label, items, align = "end", className = "", iconSize = 14 }: Props) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [open]);

  const toggle = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const height = items.length * ITEM_HEIGHT + 10;
    const left = Math.max(8, Math.min(
      align === "start" ? rect.left : rect.right - POP_WIDTH,
      window.innerWidth - POP_WIDTH - 8
    ));
    const below = rect.bottom + GAP;
    const top = below + height > window.innerHeight ? Math.max(8, rect.top - height - GAP) : below;
    setPosition({ top, left });
    setOpen(true);
  };

  return (
    <div
      ref={rootRef}
      className={`action-menu ${open ? "is-open" : ""} ${className}`.trim()}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="action-menu-trigger"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <MoreHorizontal size={iconSize} />
      </button>
      {open && position &&
        createPortal(
          <div
            ref={popRef}
            className={`action-menu-pop ${align === "start" ? "align-start" : ""}`.trim()}
            role="menu"
            style={{ top: position.top, left: position.left }}
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                className={item.danger ? "is-danger" : undefined}
                onClick={(event) => {
                  event.stopPropagation();
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
