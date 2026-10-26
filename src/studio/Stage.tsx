import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { Download, Expand, MoreHorizontal, Pause, Play } from "lucide-react";
import { IMG, MODES } from "../data/mock";
import { formatTokens, ratioValue } from "../lib/tokens";
import { StoryboardTable } from "./StoryboardTable";
import { useStudio } from "./StudioContext";
import type { StageToolsProps } from "./types/components";

/**
 * 画板上的悬浮工具：全屏、下载和更多。
 * @param props - 下载链接可选的媒体地址和文件名。
 * @returns 工具组。没有 `downloadUrl` 时下载控件只是按钮。
 */
function StageTools({ downloadUrl, filename }: StageToolsProps) {
  const { t } = useTranslation("studio");
  return (
    <div className="art-tools">
      <button className="glass-icon" title={t("stage.fullscreen")} aria-label={t("stage.fullscreen")}><Expand size={16} /></button>
      {downloadUrl ? (
        <a className="glass-icon" href={downloadUrl} download={filename || true} title={t("stage.download")} aria-label={t("stage.download")}><Download size={16} /></a>
      ) : (
        <button className="glass-icon" title={t("stage.download")} aria-label={t("stage.download")}><Download size={16} /></button>
      )}
      <button className="glass-icon" title={t("stage.more")} aria-label={t("stage.more")}><MoreHorizontal size={16} /></button>
    </div>
  );
}

/**
 * 绑定当前生成的进度遮罩。
 * @returns 遮罩。没有生成时对辅助技术隐藏。
 */
function GenerationOverlay() {
  const studio = useStudio();
  const { t } = useTranslation("studio");
  const { t: tBase } = useTranslation("base");
  return (
    <div className={`generation-overlay ${studio.isGenerating ? "is-visible" : ""}`} aria-hidden={!studio.isGenerating}>
      <div className="gen-orb"><span /></div>
      <div className="gen-copy">
        <span className="gen-stage">{studio.genStage}</span>
        <strong>{studio.progress}%</strong>
      </div>
      <div className="gen-bar"><i style={{ width: `${studio.progress}%` }} /></div>
      <p>{t("inspector.estimate")} {formatTokens(studio.estimatedTokens)} tokens · {t("inspector.queueBody")}</p>
      {studio.isGenerating && (
        <button className="gen-cancel" onClick={studio.cancelGeneration}>{tBase("cancel")}</button>
      )}
    </div>
  );
}

/**
 * 当前模式的预览或分镜。
 * @returns 舞台区域。分镜视图交给 `StoryboardTable`。
 */
export function Stage() {
  const studio = useStudio();
  const { t } = useTranslation("studio");
  /** 对比滑块位置，占画板宽度的百分比。 */
  const [split, setSplit] = useState(43);
  /** 胶片预览里选中的分镜镜头下标。 */
  const [selectedShot, setSelectedShot] = useState(0);
  /** 对比画板元素。`moveSplit` 用它量指针位置。 */
  const compareRef = useRef<HTMLDivElement>(null);
  /** 对比手柄从 pointerdown 到 pointerup 之间为 true。 */
  const dragging = useRef(false);

  /** 画幅比例和对比分割用的 CSS 变量。画板样式读取。 */
  const boardStyle = {
    "--ar": studio.ratio.replace(":", " / "),
    "--ratio": String(ratioValue(studio.ratio)),
    "--split": `${split}%`,
  } as CSSProperties;

  /**
   * 按指针移动对比分割。
   * `split` 夹紧到 12–88，保证两边都看得见。
   * @param event - 画板上的指针事件。
   * @returns 无返回值。没有拖动时不生效。
   */
  const moveSplit = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !compareRef.current) return;
    const rect = compareRef.current.getBoundingClientRect();
    const percent = Math.min(88, Math.max(12, ((event.clientX - rect.left) / rect.width) * 100));
    setSplit(percent);
  };

  const rows = studio.board.rows;
  /** 选中的行。夹紧下标，避免删镜头后越界。 */
  const shot = rows[Math.min(selectedShot, Math.max(0, rows.length - 1))];
  const total = rows.reduce((sum, row) => sum + Number(row.dur || 0), 0);
  const output = studio.activeOutput?.outputs[0];
  const imageOutput = output?.kind === "image" ? output : undefined;
  const videoOutput = output?.kind === "video" ? output : undefined;
  const downloadName = output ? `lumen-${studio.mode}-${studio.activeOutput?.id || "output"}.${output.kind === "video" ? "mp4" : "jpg"}` : undefined;

  return (
    <section className="stage" aria-label={t("stageLabel")}>
      <div className="stage-grid" aria-hidden="true" />
      {studio.isBoardView ? (
        <StoryboardTable />
      ) : (
        <div className="panel is-active">
          {studio.mode === "t2i" && (
            <div className="artboard" style={boardStyle}>
              <img className="art-img art-warm" src={imageOutput?.url || IMG.glass} alt={t("stage.emptyT2i")} />
              <div className="art-grade" />
              <div className="art-top">
                <span className="status-chip"><i />{t("stage.statusDone")} <span className="dim">· {studio.activeOutput ? "BFF" : "12.4s"}</span></span>
                <StageTools downloadUrl={imageOutput?.url} filename={downloadName} />
              </div>
              <div className="art-bottom">
                <div className="art-caption">
                  <span className="eyebrow-light">OUTPUT 01</span>
                  <p>{t("stage.emptyT2i")}</p>
                </div>
                <div className="art-meta">
                  <span>{MODES.t2i.model}</span>
                  <span>{studio.dimensions.width} × {studio.dimensions.height}</span>
                  <span>Seed {studio.seed}</span>
                  <span>{formatTokens(studio.estimatedTokens)} tok</span>
                </div>
              </div>
            </div>
          )}

          {studio.mode === "t2v" && (
            <div className={`artboard video-board ${videoOutput ? "has-live-video" : ""}`} style={boardStyle}>
              {videoOutput ? (
                <video className="art-img generated-video" src={videoOutput.url} poster={videoOutput.thumbnailUrl} controls playsInline preload="metadata" />
              ) : (
                <img className="art-img art-cool" src={IMG.nebula} alt={t("stage.emptyT2v")} />
              )}
              <div className="art-grade" />
              <div className="art-top">
                <span className="status-chip"><i />{t("stage.statusDone")} <span className="dim">· {studio.activeOutput ? "BFF" : "38.2s"}</span></span>
                <div className="art-tools">
                  <span className="glass-tag">{studio.activeOutput?.outputs[0]?.durationSec ? `${studio.activeOutput.outputs[0].durationSec.toFixed(1)}s` : "5.0s"}</span>
                  <StageTools downloadUrl={videoOutput?.url} filename={downloadName} />
                </div>
              </div>
              {!videoOutput && (
                <button className={`play-button ${studio.isPlaying ? "is-playing" : ""}`} onClick={studio.togglePlayback} aria-label={t("stage.playVideo")}>
                  <Play className="play-icon" size={24} fill="currentColor" />
                  <Pause className="pause-icon" size={22} fill="currentColor" />
                </button>
              )}
              {!videoOutput && <div className="video-timeline">
                <div className="timeline-meta">
                  <span>{`00:0${Math.floor((studio.videoProgress / 100) * 5)}`}</span>
                  <span className="timeline-title">{t("stage.timelineTitle")}</span>
                  <span>00:05</span>
                </div>
                <div
                  className="timeline-track"
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    studio.setVideoProgress(((event.clientX - rect.left) / rect.width) * 100);
                  }}
                >
                  <span className="timeline-fill" style={{ width: `${studio.videoProgress}%` }} />
                  <i className="timeline-head" style={{ left: `${studio.videoProgress}%` }} />
                </div>
              </div>}
              <div className="art-bottom video-bottom">
                <div className="art-caption"><span className="eyebrow-light">SEEDANCE 1.0 PRO</span><p>星云缓慢旋转，黑石从星尘中浮现 · 24fps</p></div>
                <div className="art-meta">
                  <span>{studio.resolution === "custom" ? `${studio.dimensions.width} × ${studio.dimensions.height}` : studio.resolution}</span>
                  <span>{studio.bitrateText}</span>
                  <span>Seed 302884</span>
                  <span>{formatTokens(studio.estimatedTokens)} tok</span>
                </div>
              </div>
            </div>
          )}

          {studio.mode === "i2i" && (
            <div
              ref={compareRef}
              className="artboard compare-board"
              style={boardStyle}
              onPointerDown={(event) => {
                if ((event.target as HTMLElement).closest("button")) return;
                dragging.current = true;
                event.currentTarget.setPointerCapture(event.pointerId);
                const rect = event.currentTarget.getBoundingClientRect();
                setSplit(Math.min(88, Math.max(12, ((event.clientX - rect.left) / rect.width) * 100)));
              }}
              onPointerMove={moveSplit}
              onPointerUp={() => { dragging.current = false; }}
              onPointerCancel={() => { dragging.current = false; }}
            >
              <div className="compare-side source-side">
                <img className="art-img art-source" src={IMG.pastel} alt={t("stage.refImage")} />
                <span className="side-label">{t("stage.sourceSide")}</span>
                <button className="replace-img">{t("stage.replace")}</button>
              </div>
              <div className="compare-side result-side">
                <img className="art-img art-warm" src={imageOutput?.url || IMG.tide} alt={t("stage.emptyI2i")} />
                <span className="side-label result">{t("stage.resultSide")}</span>
              </div>
              <div className="compare-line"><span className="compare-handle"><svg viewBox="0 0 20 20" fill="none"><path d="m7.5 7-3 3 3 3M12.5 7l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg></span></div>
              <div className="art-top">
                <span className="status-chip"><i />{t("stage.statusDone")} <span className="dim">· 9.1s</span></span>
                <div className="art-tools"><span className="glass-tag">{t("stage.strength", { value: studio.strength })}</span><StageTools downloadUrl={imageOutput?.url} filename={downloadName} /></div>
              </div>
              <div className="compare-hint">{t("stage.compareHint")}</div>
            </div>
          )}

          {studio.mode === "i2v" && (
            <div className={`artboard i2v-board ${videoOutput ? "has-live-video" : ""}`} style={boardStyle}>
              {videoOutput ? (
                <video className="art-img generated-video" src={videoOutput.url} poster={videoOutput.thumbnailUrl} controls playsInline preload="metadata" />
              ) : (
                <img className="art-img art-warm" src={IMG.dunes} alt={t("stage.emptyI2v")} />
              )}
              <div className="art-grade" />
              <div className="art-top">
                <span className="status-chip"><i />{videoOutput ? t("stage.statusVideo") : t("stage.statusFirstFrame")} <span className="dim">· {studio.dimensions.width} × {studio.dimensions.height}</span></span>
                <div className="art-tools">
                  {studio.animation !== "live" && <span className="glass-tag anim-stage-tag">{t("stage.animationTag", { mode: t(`inspector.animationModes.${studio.animation}`) })}</span>}
                  <span className="glass-tag">5.0s · 24fps</span>
                  <StageTools downloadUrl={videoOutput?.url} filename={downloadName} />
                </div>
              </div>
              {!videoOutput && <div className="motion-path" aria-hidden="true">
                <svg viewBox="0 0 220 130" fill="none">
                  <path d="M12 112c36-8 48-40 82-50 32-10 59-4 72-26" stroke="currentColor" strokeWidth="1.3" strokeDasharray="4 5" strokeLinecap="round" />
                  <path d="m158 28 10 4-5 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="12" cy="112" r="4" fill="currentColor" />
                </svg>
                <span>缓慢推进 · 向右环绕</span>
              </div>}
              {!videoOutput && <div className="frame-slots">
                <div className="frame-thumb is-filled"><img src={IMG.dunes} alt={t("stage.firstFrame")} /><span>{t("stage.firstFrame")}</span><i>01</i></div>
                <div className="frame-link"><svg viewBox="0 0 34 12" fill="none"><path d="M1 6h30M27 2l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
                <button className="frame-thumb is-empty"><span className="plus">+</span><span>{t("stage.lastFrame")}</span><i>{t("stage.optional")}</i></button>
              </div>}
              {!videoOutput && <button className="play-button small" aria-label={t("stage.previewMotion")}><Play size={18} fill="currentColor" /></button>}
              <div className="art-bottom">
                <div className="art-caption"><span className="eyebrow-light">IMAGE TO VIDEO</span><p>云层漫过山脊，晨雾缓慢流动</p></div>
                <div className="art-meta"><span>{MODES.i2v.model}</span><span>{studio.bitrateText}</span><span>Seed 482019</span></div>
              </div>
            </div>
          )}

          {studio.mode === "multi" && (
            <div className="storyboard">
              <div className="storyboard-head">
                <div>
                  <span className="eyebrow-light">SEQUENCE 01</span>
                  <h2>{t("storyboard.boardTitle")} <span>{t("stage.shotCount", { count: rows.length, seconds: total.toFixed(1) })}</span></h2>
                </div>
                <div className="storyboard-actions">
                  <button className="soft-btn"><Play size={13} />{t("stage.previewBoard")}</button>
                  <button className="glass-icon" title={t("stage.fullscreen")} aria-label={t("stage.fullscreen")}><Expand size={15} /></button>
                </div>
              </div>
              <div className="storyboard-body">
                <div className="sequence-preview">
                  {videoOutput ? (
                    <video className="generated-video" src={videoOutput.url} poster={videoOutput.thumbnailUrl} controls playsInline preload="metadata" />
                  ) : shot?.img ? (
                    <img src={shot.img} alt={t("stage.previewBoard")} />
                  ) : (
                    <div className="board-thumb is-empty">{t("stage.awaiting")}</div>
                  )}
                  <div className="preview-grade" />
                  <span className="preview-tag">{videoOutput ? "FINAL CUT" : `SHOT ${String(Math.min(selectedShot + 1, rows.length)).padStart(2, "0")}`} · {shot?.dur.toFixed(1)}s</span>
                  {!videoOutput && <button className="play-button preview-play" aria-label={t("stage.previewShot")}><Play size={20} fill="currentColor" /></button>}
                  <div className="preview-caption">
                    <div><p>{shot?.desc || t("stage.waitingDesc")}</p><span>{shot?.motion} · 35mm</span></div>
                    <span className="preview-pager">{String(Math.min(selectedShot + 1, rows.length)).padStart(2, "0")} / {String(rows.length).padStart(2, "0")}</span>
                  </div>
                </div>
                <div className="shot-list">
                  {rows.map((row, index) => (
                    <article key={row.id} className={`shot-item ${index === selectedShot ? "is-active" : ""}`} onClick={() => setSelectedShot(index)}>
                      <div className="shot-item-thumb">
                        {row.img ? <img src={row.img} alt={t("storyboard.boardAlt", { index: index + 1 })} /> : <div className="board-thumb is-empty">{t("stage.awaiting")}</div>}
                        <span className="shot-index">{String(index + 1).padStart(2, "0")}</span>
                        <span className="shot-duration">{row.dur.toFixed(1)}s</span>
                      </div>
                      <div className="shot-item-copy"><p>{row.desc || t("stage.shotOf", { index: index + 1 })}</p><span>{row.motion} · {row.dur.toFixed(1)}s</span></div>
                      <span className="shot-grip" aria-hidden="true">⠿</span>
                    </article>
                  ))}
                  <button className="add-shot" onClick={studio.addBoardRow}><span>+ {t("stage.addShot")}</span><small>{t("stage.addShotHint")}</small></button>
                </div>
              </div>
              <div className="sequence-timeline">
                <div className="sequence-top"><span>{t("stage.composeTimeline")}</span><span>{t("stage.totalDuration", { value: total.toFixed(1) })} · {studio.dimensions.width}×{studio.dimensions.height} · {studio.bitrateText}</span></div>
                <div className="sequence-track">
                  {rows.map((row, index) => <span key={row.id} className={`seq-seg seg-${index + 1}`} style={{ flex: Math.max(row.dur, 1) }}>{String(index + 1).padStart(2, "0")}</span>)}
                  <i className="seq-playhead" />
                </div>
                <div className="sequence-foot"><span><i className="legend-dot" />{t("stage.aiDissolve")}</span><button className="text-btn" onClick={studio.generate}>{t("stage.generateAll")}</button></div>
              </div>
            </div>
          )}
        </div>
      )}
      <GenerationOverlay />
    </section>
  );
}
