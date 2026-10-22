import { ArrowRight, Plus } from "lucide-react";
import { useStudio } from "./StudioContext";

export function HistoryStrip({ toast }: { toast: (message: string, type?: "default" | "success") => void }) {
  const studio = useStudio();
  return (
    <section className="history" aria-label="最近生成">
      <div className="history-head">
        <span>本次会话 <em>{studio.history.length}</em></span>
        <button className="text-btn" onClick={() => toast("全部作品将在下一阶段接入")}>全部作品 <ArrowRight size={12} /></button>
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
        <button className="history-new" onClick={() => toast("已新建空白创作")}>
          <Plus size={15} /><span>新建创作</span>
        </button>
      </div>
    </section>
  );
}
