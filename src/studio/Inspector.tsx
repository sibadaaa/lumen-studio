import { useEffect, useState } from "react";
import { ChevronDown, Link2, Lock, RotateCcw, X } from "lucide-react";
import { ANIMATION_LABELS, BITRATE_LABELS, MODES, MOTIONS } from "../data/mock";
import { formatTokens } from "../lib/tokens";
import type { AnimationMode, Bitrate, Resolution } from "../types";
import { useStudio } from "./StudioContext";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenAgent: () => void;
  toast: (message: string, type?: "default" | "success") => void;
}

export function Inspector({ open, onClose, toast }: Props) {
  const studio = useStudio();
  const [widthInput, setWidthInput] = useState(String(studio.customSize.width));
  const [heightInput, setHeightInput] = useState(String(studio.customSize.height));

  useEffect(() => {
    setWidthInput(String(studio.customSize.width));
    setHeightInput(String(studio.customSize.height));
  }, [studio.customSize.width, studio.customSize.height, studio.mode, studio.resolution]);

  const isCustom = studio.resolution === "custom";
  const showDuration = studio.isVideo && !studio.isBoardView;
  const showMotion = (studio.mode === "t2v" || studio.mode === "i2v") && !studio.isBoardView;
  const showAnimation = studio.mode === "i2v";
  const showStrength = studio.mode === "i2i";
  const showMulti = studio.mode === "multi";
  const presets = studio.isVideo
    ? [[1920, 1080, "1080p"], [3840, 2160, "4K"], [1080, 1920, "竖屏"]] as const
    : [[2048, 1152, "2K"], [3840, 2160, "4K"], [1080, 1920, "竖屏"]] as const;

  const commitDimension = (axis: "width" | "height", raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      setWidthInput(String(studio.customSize.width));
      setHeightInput(String(studio.customSize.height));
      return;
    }
    studio.setCustomSize(axis, value);
  };

  return (
    <aside className={`inspector ${open ? "is-open" : ""}`} id="inspector" aria-label="生成设置">
      <div className="inspector-head">
        <div>
          <span className="eyebrow">SETTINGS</span>
          <h2>生成设置</h2>
        </div>
        <div className="inspector-head-actions">
          <button className="ghost-icon" title="重置参数" aria-label="重置参数" onClick={studio.resetParams}>
            <RotateCcw size={14} />
          </button>
          <button className="mobile-close" onClick={onClose} aria-label="关闭生成设置"><X size={13} /></button>
        </div>
      </div>

      <div className="inspector-scroll">
        <div className="field-group">
          <div className="field-label">模型 <span className="recommend">推荐</span></div>
          <button className="model-select" onClick={() => toast("模型选择将在下一阶段接入")}>
            <span className="model-glyph">
              <svg viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="7.6" stroke="currentColor" strokeWidth="1.2" /><path d="M11 3.4a7.6 7.6 0 0 0 0 15.2 7.6 7.6 0 0 0 0-15.2Z" fill="currentColor" opacity=".28" /></svg>
            </span>
            <span className="model-info"><strong>{MODES[studio.mode].model}</strong><small>{MODES[studio.mode].modelDesc}</small></span>
            <ChevronDown className="chevron" size={14} />
          </button>
          <div className="model-tags">
            {MODES[studio.mode].tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        </div>

        <div className="divider" />

        <div className="field-group">
          <div className="field-label">画面比例 <span className="field-value">{studio.ratio}</span></div>
          <div className="ratio-row" role="group" aria-label="画面比例">
            {["1:1", "4:3", "16:9", "9:16", "3:2"].map((ratio) => (
              <button key={ratio} className={studio.ratio === ratio ? "is-active" : ""} onClick={() => studio.setRatio(ratio)}>
                <i className={`ratio-shape r-${ratio.replace(":", "-")}`} /><span>{ratio}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field-group">
          <div className="field-label">清晰度 <span className="field-value">{studio.resolution === "custom" ? "自定义" : studio.resolution}</span></div>
          <div className="segmented" role="group" aria-label="清晰度">
            {studio.resolutionOptions.map((value) => (
              <button key={value} className={studio.resolution === value ? "is-active" : ""} onClick={() => studio.setResolution(value)}>
                {value === "custom" ? "自定义" : value}
              </button>
            ))}
          </div>
          {isCustom && (
            <div className="custom-res">
              <div className="dim-row">
                <label className="dim-input"><span>宽</span><input value={widthInput} inputMode="numeric" onChange={(event) => setWidthInput(event.target.value)} onBlur={() => commitDimension("width", widthInput)} /><em>px</em></label>
                <button className={`lock-btn ${studio.ratioLocked ? "is-active" : ""}`} onClick={studio.toggleRatioLock} aria-pressed={studio.ratioLocked} title="锁定画面比例"><Link2 size={14} /></button>
                <label className="dim-input"><span>高</span><input value={heightInput} inputMode="numeric" onChange={(event) => setHeightInput(event.target.value)} onBlur={() => commitDimension("height", heightInput)} /><em>px</em></label>
              </div>
              <div className="dim-meta">
                <span>{((studio.customSize.width * studio.customSize.height) / 1_000_000).toFixed(2)} MP</span>
                <span>建议 8px 对齐</span>
              </div>
              <div className="res-presets">
                {presets.map(([w, h, label]) => (
                  <button key={label} onClick={() => { studio.setCustomDimensions(w, h); setWidthInput(String(w)); setHeightInput(String(h)); }}>{label}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        {studio.isVideo && (
          <div className="field-group">
            <div className="field-label">码率 <span className="field-value">{studio.bitrateText}</span></div>
            <div className="segmented" role="group" aria-label="视频码率">
              {(["auto", "8", "16", "custom"] as Bitrate[]).map((value) => (
                <button key={value} className={studio.bitrate === value ? "is-active" : ""} onClick={() => studio.setBitrate(value)}>
                  {value === "auto" ? "自动" : value === "custom" ? "自定义" : `${value}M`}
                </button>
              ))}
            </div>
            {studio.bitrate === "custom" && (
              <div className="custom-bitrate">
                <input type="number" min={2} max={80} value={studio.customBitrate} onChange={(event) => studio.setCustomBitrate(Number(event.target.value))} />
                <span>Mbps</span><small>仅影响编码质量</small>
              </div>
            )}
          </div>
        )}

        {showDuration && (
          <div className="field-group">
            <div className="field-label">时长 <span className="field-value">{studio.duration} 秒</span></div>
            <div className="segmented" role="group" aria-label="视频时长">
              {[5, 10, 15].map((value) => <button key={value} className={studio.duration === value ? "is-active" : ""} onClick={() => studio.setDuration(value)}>{value}s</button>)}
            </div>
          </div>
        )}

        {showMotion && (
          <div className="field-group">
            <div className="field-label">镜头运动</div>
            <button className="select-like" onClick={() => toast("镜头运动预设将在下一阶段接入")}><span>{MOTIONS[1]}</span><ChevronDown size={13} /></button>
          </div>
        )}

        {showAnimation && (
          <div className="field-group">
            <div className="field-label">动画模式 <span className="field-value">{studio.animationText}</span></div>
            <div className="segmented anim-seg" role="group" aria-label="动画模式">
              {(["live", "2d", "3d", "stop"] as AnimationMode[]).map((value) => (
                <button key={value} className={studio.animation === value ? "is-active" : ""} onClick={() => studio.setAnimation(value)}>
                  {ANIMATION_LABELS[value].replace(" 动画", "").replace("动画", "")}
                </button>
              ))}
            </div>
            <div className="anim-hint">{studio.animationHint}</div>
          </div>
        )}

        {showStrength && (
          <div className="field-group">
            <div className="field-label">参考强度 <span className="field-value">{studio.strength}%</span></div>
            <input className="range" type="range" min={0} max={100} value={studio.strength} style={{ ["--range-fill" as string]: `${studio.strength}%` }} onChange={(event) => studio.setStrength(Number(event.target.value))} />
            <div className="range-scale"><span>更自由</span><span>更贴近原图</span></div>
          </div>
        )}

        {studio.mode === "i2v" && (
          <div className="field-group">
            <div className="field-label">尾帧 <span className="field-value muted">可选</span></div>
            <button className="upload-slot" onClick={() => toast("尾帧上传将在下一阶段接入")}>
              <span>添加尾帧图片</span><small>可选，用于控制结束画面</small>
            </button>
          </div>
        )}

        {showMulti && (
          <div className="field-group">
            <div className="field-label">合成方式</div>
            <div className="segmented"><button className="is-active">AI 分镜</button><button onClick={() => toast("快剪模板将在下一阶段接入")}>快剪模板</button></div>
            <div className="field-label spaced">转场</div>
            <button className="select-like" onClick={() => toast("转场设置将在下一阶段接入")}><span>柔和溶解</span><ChevronDown size={13} /></button>
          </div>
        )}

        <div className="field-group">
          <div className="field-label">负向提示词 <span className="field-value muted">可选</span></div>
          <textarea className="mini-textarea" rows={2} maxLength={300} value={studio.negativePrompt} onChange={(event) => studio.setNegativePrompt(event.target.value)} />
        </div>

        <details className="advanced">
          <summary>高级设置 <ChevronDown size={13} /></summary>
          <div className="advanced-body">
            <div className="inline-field">
              <span>Seed</span>
              <input value={studio.seed} onChange={(event) => studio.setSeed(event.target.value)} inputMode="numeric" />
              <button onClick={() => studio.setSeed(String(Math.floor(Math.random() * 900000) + 100000))}>随机</button>
            </div>
            <div className="inline-field">
              <span>提示词权重</span>
              <input className="range" type="range" min={1} max={10} defaultValue={7} />
              <em>7</em>
            </div>
            <label className="switch-row"><span>生成后自动下载</span><span className="switch"><input type="checkbox" /><i /></span></label>
          </div>
        </details>

        <div className="queue-card">
          <div className="queue-top"><span className="queue-live"><i />当前队列</span><strong>0</strong></div>
          <p>任务在后台生成，切换页面或关闭标签页都不会中断。</p>
        </div>
      </div>

      <div className="inspector-foot">
        <div className="estimate">
          <span className="estimate-label">本次预计 <em className="estimate-flag">估算</em></span>
          <strong>{formatTokens(studio.estimatedTokens)} <small>tokens</small></strong>
        </div>
        <button className={`cta ${studio.isGenerating ? "is-loading" : ""}`} onClick={studio.generate}>
          <span className="cta-label">{studio.ctaLabel}</span>
          <svg viewBox="0 0 20 20" fill="none"><path d="M4 10h11M11 5.5 15.5 10 11 14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div className="secure-note"><Lock size={10} />密钥仅存于服务端 · 不暴露浏览器</div>
      </div>
    </aside>
  );
}
