import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Download, Expand, MoreHorizontal, Pause, Play } from "lucide-react";
import { IMG, MODES } from "../data/mock";
import { formatTokens, ratioValue } from "../lib/tokens";
import { StoryboardTable } from "./StoryboardTable";
import { useStudio } from "./StudioContext";

function StageTools({ downloadUrl, filename }: { downloadUrl?: string; filename?: string }) {
  return (
    <div className="art-tools">
      <button className="glass-icon" title="全屏" aria-label="全屏"><Expand size={16} /></button>
      {downloadUrl ? (
        <a className="glass-icon" href={downloadUrl} download={filename || true} title="下载" aria-label="下载"><Download size={16} /></a>
      ) : (
        <button className="glass-icon" title="下载" aria-label="下载"><Download size={16} /></button>
      )}
      <button className="glass-icon" title="更多" aria-label="更多"><MoreHorizontal size={16} /></button>
    </div>
  );
}

function GenerationOverlay() {
  const studio = useStudio();
  return (
    <div className={`generation-overlay ${studio.isGenerating ? "is-visible" : ""}`} aria-hidden={!studio.isGenerating}>
      <div className="gen-orb"><span /></div>
      <div className="gen-copy">
        <span className="gen-stage">{studio.genStage}</span>
        <strong>{studio.progress}%</strong>
      </div>
      <div className="gen-bar"><i style={{ width: `${studio.progress}%` }} /></div>
      <p>预计 {formatTokens(studio.estimatedTokens)} tokens · 可在后台继续运行</p>
      {studio.isGenerating && (
        <button className="gen-cancel" onClick={studio.cancelGeneration}>取消生成</button>
      )}
    </div>
  );
}

export function Stage() {
  const studio = useStudio();
  const [split, setSplit] = useState(43);
  const [selectedShot, setSelectedShot] = useState(0);
  const compareRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const boardStyle = {
    "--ar": studio.ratio.replace(":", " / "),
    "--ratio": String(ratioValue(studio.ratio)),
    "--split": `${split}%`,
  } as CSSProperties;

  const moveSplit = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !compareRef.current) return;
    const rect = compareRef.current.getBoundingClientRect();
    const percent = Math.min(88, Math.max(12, ((event.clientX - rect.left) / rect.width) * 100));
    setSplit(percent);
  };

  const rows = studio.board.rows;
  const shot = rows[Math.min(selectedShot, Math.max(0, rows.length - 1))];
  const total = rows.reduce((sum, row) => sum + Number(row.dur || 0), 0);
  const output = studio.activeOutput?.outputs[0];
  const imageOutput = output?.kind === "image" ? output : undefined;
  const videoOutput = output?.kind === "video" ? output : undefined;
  const downloadName = output ? `lumen-${studio.mode}-${studio.activeOutput?.id || "output"}.${output.kind === "video" ? "mp4" : "jpg"}` : undefined;

  return (
    <section className="stage" aria-label="预览画布">
      <div className="stage-grid" aria-hidden="true" />
      {studio.isBoardView ? (
        <StoryboardTable />
      ) : (
        <div className="panel is-active">
          {studio.mode === "t2i" && (
            <div className="artboard" style={boardStyle}>
              <img className="art-img art-warm" src={imageOutput?.url || IMG.glass} alt="生成的抽象影像：玻璃沙丘" />
              <div className="art-grade" />
              <div className="art-top">
                <span className="status-chip"><i />生成完成 <span className="dim">· {studio.activeOutput ? "BFF" : "12.4s"}</span></span>
                <StageTools downloadUrl={imageOutput?.url} filename={downloadName} />
              </div>
              <div className="art-bottom">
                <div className="art-caption">
                  <span className="eyebrow-light">OUTPUT 01</span>
                  <p>深海与熔融玻璃的交界，潮汐中浮起琥珀色光体</p>
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
                <img className="art-img art-cool" src={IMG.nebula} alt="生成的视频画面：深空星云" />
              )}
              <div className="art-grade" />
              <div className="art-top">
                <span className="status-chip"><i />生成完成 <span className="dim">· {studio.activeOutput ? "BFF" : "38.2s"}</span></span>
                <div className="art-tools">
                  <span className="glass-tag">{studio.activeOutput?.outputs[0]?.durationSec ? `${studio.activeOutput.outputs[0].durationSec.toFixed(1)}s` : "5.0s"}</span>
                  <StageTools downloadUrl={videoOutput?.url} filename={downloadName} />
                </div>
              </div>
              {!videoOutput && (
                <button className={`play-button ${studio.isPlaying ? "is-playing" : ""}`} onClick={studio.togglePlayback} aria-label="播放视频">
                  <Play className="play-icon" size={24} fill="currentColor" />
                  <Pause className="pause-icon" size={22} fill="currentColor" />
                </button>
              )}
              {!videoOutput && <div className="video-timeline">
                <div className="timeline-meta">
                  <span>{`00:0${Math.floor((studio.videoProgress / 100) * 5)}`}</span>
                  <span className="timeline-title">星云 · Shot 01</span>
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
                <img className="art-img art-source" src={IMG.pastel} alt="参考图" />
                <span className="side-label">参考图 01</span>
                <button className="replace-img">替换</button>
              </div>
              <div className="compare-side result-side">
                <img className="art-img art-warm" src={imageOutput?.url || IMG.tide} alt="图生图结果" />
                <span className="side-label result">生成结果</span>
              </div>
              <div className="compare-line"><span className="compare-handle"><svg viewBox="0 0 20 20" fill="none"><path d="m7.5 7-3 3 3 3M12.5 7l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg></span></div>
              <div className="art-top">
                <span className="status-chip"><i />生成完成 <span className="dim">· 9.1s</span></span>
                <div className="art-tools"><span className="glass-tag">强度 {studio.strength}%</span><StageTools downloadUrl={imageOutput?.url} filename={downloadName} /></div>
              </div>
              <div className="compare-hint">拖动中线对比</div>
            </div>
          )}

          {studio.mode === "i2v" && (
            <div className={`artboard i2v-board ${videoOutput ? "has-live-video" : ""}`} style={boardStyle}>
              {videoOutput ? (
                <video className="art-img generated-video" src={videoOutput.url} poster={videoOutput.thumbnailUrl} controls playsInline preload="metadata" />
              ) : (
                <img className="art-img art-warm" src={IMG.dunes} alt="图生视频首帧：雾中山脊" />
              )}
              <div className="art-grade" />
              <div className="art-top">
                <span className="status-chip"><i />{videoOutput ? "视频已生成" : "首帧已锁定"} <span className="dim">· {studio.dimensions.width} × {studio.dimensions.height}</span></span>
                <div className="art-tools">
                  {studio.animation !== "live" && <span className="glass-tag anim-stage-tag">动画 · {{ "2d": "2D", "3d": "3D", stop: "定格" }[studio.animation]}</span>}
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
                <div className="frame-thumb is-filled"><img src={IMG.dunes} alt="首帧" /><span>首帧</span><i>01</i></div>
                <div className="frame-link"><svg viewBox="0 0 34 12" fill="none"><path d="M1 6h30M27 2l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
                <button className="frame-thumb is-empty"><span className="plus">+</span><span>尾帧</span><i>可选</i></button>
              </div>}
              {!videoOutput && <button className="play-button small" aria-label="预览运动"><Play size={18} fill="currentColor" /></button>}
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
                  <h2>{studio.board.title} <span>{rows.length} 镜 · {total.toFixed(1)} 秒</span></h2>
                </div>
                <div className="storyboard-actions">
                  <button className="soft-btn"><Play size={13} />预览成片</button>
                  <button className="glass-icon" title="全屏" aria-label="全屏"><Expand size={15} /></button>
                </div>
              </div>
              <div className="storyboard-body">
                <div className="sequence-preview">
                  {videoOutput ? (
                    <video className="generated-video" src={videoOutput.url} poster={videoOutput.thumbnailUrl} controls playsInline preload="metadata" />
                  ) : shot?.img ? (
                    <img src={shot.img} alt="当前分镜预览" />
                  ) : (
                    <div className="board-thumb is-empty">待生成</div>
                  )}
                  <div className="preview-grade" />
                  <span className="preview-tag">{videoOutput ? "FINAL CUT" : `SHOT ${String(Math.min(selectedShot + 1, rows.length)).padStart(2, "0")}`} · {shot?.dur.toFixed(1)}s</span>
                  {!videoOutput && <button className="play-button preview-play" aria-label="预览当前分镜"><Play size={20} fill="currentColor" /></button>}
                  <div className="preview-caption">
                    <div><p>{shot?.desc || "等待生成"}</p><span>{shot?.motion} · 35mm 胶片质感</span></div>
                    <span className="preview-pager">{String(Math.min(selectedShot + 1, rows.length)).padStart(2, "0")} / {String(rows.length).padStart(2, "0")}</span>
                  </div>
                </div>
                <div className="shot-list">
                  {rows.map((row, index) => (
                    <article key={row.id} className={`shot-item ${index === selectedShot ? "is-active" : ""}`} onClick={() => setSelectedShot(index)}>
                      <div className="shot-item-thumb">
                        {row.img ? <img src={row.img} alt={`分镜${index + 1}`} /> : <div className="board-thumb is-empty">待生成</div>}
                        <span className="shot-index">{String(index + 1).padStart(2, "0")}</span>
                        <span className="shot-duration">{row.dur.toFixed(1)}s</span>
                      </div>
                      <div className="shot-item-copy"><p>{row.desc || `镜头 ${index + 1}`}</p><span>{row.motion} · {row.dur.toFixed(1)}s</span></div>
                      <span className="shot-grip" aria-hidden="true">⠿</span>
                    </article>
                  ))}
                  <button className="add-shot" onClick={studio.addBoardRow}><span>+ 添加镜头</span><small>2–9 张图片</small></button>
                </div>
              </div>
              <div className="sequence-timeline">
                <div className="sequence-top"><span>合成时间线</span><span>总时长 {total.toFixed(1)}s · {studio.dimensions.width}×{studio.dimensions.height} · {studio.bitrateText}</span></div>
                <div className="sequence-track">
                  {rows.map((row, index) => <span key={row.id} className={`seq-seg seg-${index + 1}`} style={{ flex: Math.max(row.dur, 1) }}>{String(index + 1).padStart(2, "0")}</span>)}
                  <i className="seq-playhead" />
                </div>
                <div className="sequence-foot"><span><i className="legend-dot" />AI 分镜 · 柔和溶解</span><button className="text-btn" onClick={studio.generate}>生成全部分镜</button></div>
              </div>
            </div>
          )}
        </div>
      )}
      <GenerationOverlay />
    </section>
  );
}
