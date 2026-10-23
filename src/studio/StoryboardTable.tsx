import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Download, Plus, Sparkles, Trash2 } from "lucide-react";
import { MOTIONS, SHOT_SIZES } from "../data/mock";
import { formatTokens } from "../lib/tokens";
import { useStudio } from "./StudioContext";

export function StoryboardTable() {
  const studio = useStudio();
  const { t } = useTranslation("studio");
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingRow, setPendingRow] = useState<number | null>(null);
  const rows = studio.board.rows;
  const total = rows.reduce((sum, row) => sum + Number(row.dur || 0), 0);

  return (
    <div className="storyboard-view">
      <div className="board-shell">
        <header className="board-head">
          <div className="board-title">
            <span className="eyebrow-light">STORYBOARD / SHOT LIST</span>
            <h2>{t("storyboard.boardTitle")} <span>{t("storyboard.rows", { count: rows.length, seconds: total.toFixed(1) })}</span></h2>
          </div>
          <div className="board-actions">
            <button className="soft-btn" onClick={studio.resetBoard}><Sparkles size={13} />{t("storyboard.aiSplit")}</button>
            <button className="soft-btn" onClick={studio.exportBoard}><Download size={13} />{t("storyboard.exportCsv")}</button>
            <button className="board-add-btn" onClick={studio.addBoardRow}><span>+</span>{t("storyboard.add")}</button>
          </div>
        </header>

        <div className="board-table">
          <div className="board-thead">
            <span className="c-num">{t("storyboard.shot")}</span><span className="c-frame">{t("storyboard.frame")}</span><span className="c-shot">{t("storyboard.size")}</span>
            <span className="c-motion">{t("storyboard.motion")}</span><span className="c-desc">{t("storyboard.desc")}</span><span className="c-audio">{t("storyboard.audio")}</span>
            <span className="c-dur">{t("storyboard.duration")}</span><span className="c-ops">{t("storyboard.ops")}</span>
          </div>
          <div className="board-rows">
            {rows.map((row, index) => (
              <div className="board-row" key={row.id}>
                <div className="board-num"><span className="grip">⠿</span><span className="idx">{String(index + 1).padStart(2, "0")}</span></div>
                {row.img ? (
                  <div className="board-thumb" onClick={() => { setPendingRow(index); fileRef.current?.click(); }}>
                    <img src={row.img} alt={t("storyboard.shotAlt", { index: index + 1 })} />
                    <div className="thumb-replace"><span>{t("storyboard.replace")}</span></div>
                  </div>
                ) : (
                  <button className="board-thumb is-empty" onClick={() => { setPendingRow(index); fileRef.current?.click(); }}>{t("storyboard.emptyFirstFrame")}</button>
                )}
                <select className="board-cell-select" value={row.shot} onChange={(event) => studio.updateBoardRow(index, { shot: event.target.value })}>
                  {SHOT_SIZES.map((item) => <option key={item}>{item}</option>)}
                </select>
                <select className="board-cell-select" value={row.motion} onChange={(event) => studio.updateBoardRow(index, { motion: event.target.value })}>
                  {MOTIONS.map((item) => <option key={item}>{item}</option>)}
                </select>
                <textarea className="board-cell-desc" rows={2} value={row.desc} onChange={(event) => studio.updateBoardRow(index, { desc: event.target.value })} />
                <input className="board-cell-input" value={row.audio} onChange={(event) => studio.updateBoardRow(index, { audio: event.target.value })} />
                <div className="board-duration">
                  <input
                    type="number"
                    min={1}
                    max={8}
                    step={0.5}
                    value={row.dur}
                    onChange={(event) => studio.updateBoardRow(index, { dur: Math.min(8, Math.max(1, Number(event.target.value) || 1)) })}
                  />
                  <span>s</span>
                </div>
                <div className="board-ops">
                  <button className="board-op" title={t("storyboard.duplicateShot")} onClick={() => studio.duplicateBoardRow(index)}><Copy size={12} /></button>
                  <button className="board-op is-danger" title={t("storyboard.deleteShot")} onClick={() => studio.deleteBoardRow(index)}><Trash2 size={12} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <footer className="board-foot">
          <div className="board-summary">
            <span>{t("storyboard.summaryDuration")} <strong>{total.toFixed(1)}s</strong></span>
            <span>{t("storyboard.summaryShots")} <strong>{rows.length}</strong></span>
            <span>{t("storyboard.summaryEstimate")} <strong>{formatTokens(studio.estimatedTokens)}</strong> tokens</span>
          </div>
          <div className="board-timeline">
            {rows.map((row) => <span key={row.id} style={{ flex: Math.max(1, row.dur) }} />)}
          </div>
        </footer>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file && pendingRow !== null) {
            studio.replaceBoardImageFile(pendingRow, file);
          }
          event.target.value = "";
          setPendingRow(null);
        }}
      />
    </div>
  );
}
