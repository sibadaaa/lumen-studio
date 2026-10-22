import { useRef, useState } from "react";
import { Copy, Download, Plus, Sparkles, Trash2 } from "lucide-react";
import { MOTIONS, SHOT_SIZES } from "../data/mock";
import { formatTokens } from "../lib/tokens";
import { useStudio } from "./StudioContext";

export function StoryboardTable() {
  const studio = useStudio();
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
            <h2>{studio.board.title} <span>{rows.length} 镜 · {total.toFixed(1)}s</span></h2>
          </div>
          <div className="board-actions">
            <button className="soft-btn" onClick={studio.resetBoard}><Sparkles size={13} />AI 拆镜</button>
            <button className="soft-btn" onClick={studio.exportBoard}><Download size={13} />导出 CSV</button>
            <button className="board-add-btn" onClick={studio.addBoardRow}><span>+</span>添加镜头</button>
          </div>
        </header>

        <div className="board-table">
          <div className="board-thead">
            <span className="c-num">镜号</span><span className="c-frame">画面</span><span className="c-shot">景别</span>
            <span className="c-motion">运镜</span><span className="c-desc">画面描述</span><span className="c-audio">台词 / 音效</span>
            <span className="c-dur">时长</span><span className="c-ops">操作</span>
          </div>
          <div className="board-rows">
            {rows.map((row, index) => (
              <div className="board-row" key={row.id}>
                <div className="board-num"><span className="grip">⠿</span><span className="idx">{String(index + 1).padStart(2, "0")}</span></div>
                {row.img ? (
                  <div className="board-thumb" onClick={() => { setPendingRow(index); fileRef.current?.click(); }}>
                    <img src={row.img} alt={`镜头 ${index + 1}`} />
                    <div className="thumb-replace"><span>替换</span></div>
                  </div>
                ) : (
                  <button className="board-thumb is-empty" onClick={() => { setPendingRow(index); fileRef.current?.click(); }}>+ 首帧</button>
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
                  <button className="board-op" title="复制镜头" onClick={() => studio.duplicateBoardRow(index)}><Copy size={12} /></button>
                  <button className="board-op is-danger" title="删除镜头" onClick={() => studio.deleteBoardRow(index)}><Trash2 size={12} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <footer className="board-foot">
          <div className="board-summary">
            <span>总时长 <strong>{total.toFixed(1)}s</strong></span>
            <span>镜头 <strong>{rows.length}</strong></span>
            <span>预计 <strong>{formatTokens(studio.estimatedTokens)}</strong> tokens</span>
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
