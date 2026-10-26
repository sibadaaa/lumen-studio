import { ArrowRight, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStudio } from "./StudioContext";
import type { HistoryStripProps } from "./types/components";

/**
 * 提示词栏下方的会话历史。
 * @param props - `toast` 给「全部作品」和「新建」用，它们只提示、不跳转。
 * @returns 历史条。选中卡片会恢复对应模式和产物。
 */
export function HistoryStrip({ toast }: HistoryStripProps) {
  const studio = useStudio();
  const { t } = useTranslation("studio");
  return (
    <section className="history" aria-label={t("historyLabel")}>
      <div className="history-head">
        <span>{t("history.session")} <em>{studio.history.length}</em></span>
        <button className="text-btn" onClick={() => toast(t("history.allWorksToast"))}>{t("history.allWorks")} <ArrowRight size={12} /></button>
      </div>
      <div className="history-row">
        {studio.history.map((item) => (
          <button
            key={item.id}
            className={`history-card ${studio.activeHistory === item.id ? "is-active" : ""}`}
            onClick={() => studio.selectHistory(item.id)}
          >
            <img src={item.img} alt="" />
            <span className="history-badge">{item.badge}</span>
            <span className="history-tip">{item.time}{item.tokens ? ` · ${item.tokens} tok` : ""}</span>
            {(item.kind === "video" || item.mode === "t2v" || item.mode === "i2v") && (
              <span className="history-play"><svg viewBox="0 0 14 14" fill="none"><path d="M5.5 4.2v5.6l4.6-2.8-4.6-2.8Z" fill="currentColor" /></svg></span>
            )}
          </button>
        ))}
        <button className="history-new" onClick={() => toast(t("history.newToast"))}>
          <Plus size={15} /><span>{t("history.new")}</span>
        </button>
      </div>
    </section>
  );
}
