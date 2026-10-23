import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import type { LibraryAsset } from "../../shared/contracts";
import { api } from "../lib/api";
import { buildQuery } from "../library/hooks";
import { relativeTime } from "../library/ui";

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (asset: LibraryAsset) => void;
  projectId?: string;
}

/** Modal picker that fills a library asset into the studio without re-upload. */
export function AssetPickerDialog({ open, onClose, onPick, projectId }: Props) {
  const { t } = useTranslation("assets");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setItems([]);
    setLoading(true);
    api
      .assets(buildQuery({ projectId: projectId || undefined, q: search || undefined, limit: 30 }))
      .then((page) => {
        if (active) setItems(page.items);
      })
      .catch(() => {
        if (active) setItems([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, search, projectId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const grid = useMemo(() => items, [items]);
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal asset-picker" role="dialog" aria-modal="true" aria-label="从素材库选择">
        <header className="modal-head">
          <div>
            <span className="eyebrow">ASSETS</span>
            <h2>{t("picker.title")}</h2>
            <p>{t("picker.desc")}</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="关闭"><X size={15} /></button>
        </header>
        <div className="asset-picker-search">
          <Search size={13} />
          <input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
          />
        </div>
        {projectId && <p className="asset-picker-scope">{t("picker.scope")}</p>}
        <div className="asset-picker-grid">
          {loading && <p className="library-loading">{t("picker.loading")}</p>}
          {!loading && grid.length === 0 && <p className="library-loading">{t("picker.empty")}</p>}
          {grid.map((asset) => (
            <button key={asset.id} className="asset-picker-item" onClick={() => { onPick(asset); onClose(); }}>
              <img src={asset.thumbnailUrl || asset.url} alt={asset.originalName || asset.id} loading="lazy" />
              <span className="asset-picker-name">{asset.originalName || asset.id}</span>
              <small>{relativeTime(asset.createdAt)}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
