import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("studio");
  const { t: tBase } = useTranslation("base");
  const [widthInput, setWidthInput] = useState(String(studio.customSize.width));
  const [heightInput, setHeightInput] = useState(String(studio.customSize.height));
  const [modelMenuOpen, setModelMenuOpen] = useState(false);

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
    <aside className={`inspector ${open ? "is-open" : ""}`} id="inspector" aria-label={t("inspector.title")}>
      <div className="inspector-head">
        <div>
          <span className="eyebrow">SETTINGS</span>
          <h2>{t("inspector.title")}</h2>
        </div>
        <div className="inspector-head-actions">
          <button className="ghost-icon" title={t("inspector.reset")} aria-label={t("inspector.reset")} onClick={studio.resetParams}>
            <RotateCcw size={14} />
          </button>
          <button className="mobile-close" onClick={onClose} aria-label={tBase("close")}><X size={13} /></button>
        </div>
      </div>

      <div className="inspector-scroll">
        <div className="field-group">
          <div className="field-label">{t("inspector.model")} <span className="recommend">{t("inspector.recommend")}</span></div>
          <div className="model-picker">
            <button
              className="model-select"
              aria-haspopup="listbox"
              aria-expanded={modelMenuOpen}
              onClick={() => setModelMenuOpen((prev) => !prev)}
            >
              <span className="model-glyph">
                <svg viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="7.6" stroke="currentColor" strokeWidth="1.2" /><path d="M11 3.4a7.6 7.6 0 0 0 0 15.2 7.6 7.6 0 0 0 0-15.2Z" fill="currentColor" opacity=".28" /></svg>
              </span>
              <span className="model-info">
                <strong>{studio.selectedModel?.label || MODES[studio.mode].model}</strong>
                <small>
                  {studio.selectedModel
                    ? t("inspector.providerKind", {
                        provider: studio.selectedModel.providerId,
                        kind: t(`inspector.kind.${studio.selectedModel.kind}`),
                      })
                    : MODES[studio.mode].modelDesc}
                </small>
              </span>
              <ChevronDown className="chevron" size={14} />
            </button>
            {modelMenuOpen && (
              <ul className="model-picker-list" role="listbox" aria-label={t("inspector.model")}>
                {studio.availableModels.length === 0 && (
                  <li className="model-picker-empty">
                    <span>{t("inspector.modelEmpty")}</span>
                    <small>{t("inspector.modelEmptyHint")}</small>
                  </li>
                )}
                {studio.availableModels.map((model) => (
                  <li key={model.id}>
                    <button
                      role="option"
                      aria-selected={studio.selectedModel?.id === model.id}
                      className={studio.selectedModel?.id === model.id ? "is-active" : ""}
                      onClick={() => {
                        studio.setModel(model.id);
                        setModelMenuOpen(false);
                      }}
                    >
                      <span className="model-option-main">
                        <strong>{model.label}</strong>
                        <small>{model.providerId} · {t(`inspector.kind.${model.kind}`)}</small>
                      </span>
                      {model.lastUsedAt && <em>{t("inspector.recentlyUsed")}</em>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="model-tags">
            {(studio.selectedModel
              ? [studio.selectedModel.providerId, t(`inspector.kind.${studio.selectedModel.kind}`)]
              : MODES[studio.mode].tags
            ).map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </div>

        <div className="divider" />

        <div className="field-group">
          <div className="field-label">{t("inspector.aspectRatio")} <span className="field-value">{studio.ratio}</span></div>
          <div className="ratio-row" role="group" aria-label={t("inspector.aspectRatio")}>
            {["1:1", "4:3", "16:9", "9:16", "3:2"].map((ratio) => (
              <button key={ratio} className={studio.ratio === ratio ? "is-active" : ""} onClick={() => studio.setRatio(ratio)}>
                <i className={`ratio-shape r-${ratio.replace(":", "-")}`} /><span>{ratio}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field-group">
          <div className="field-label">{t("inspector.resolution")} <span className="field-value">{studio.resolution === "custom" ? t("inspector.custom") : studio.resolution}</span></div>
          <div className="segmented" role="group" aria-label={t("inspector.resolution")}>
            {studio.resolutionOptions.map((value) => (
              <button key={value} className={studio.resolution === value ? "is-active" : ""} onClick={() => studio.setResolution(value)}>
                {value === "custom" ? t("inspector.custom") : value}
              </button>
            ))}
          </div>
          {isCustom && (
            <div className="custom-res">
              <div className="dim-row">
                <label className="dim-input"><span>{t("inspector.width")}</span><input value={widthInput} inputMode="numeric" onChange={(event) => setWidthInput(event.target.value)} onBlur={() => commitDimension("width", widthInput)} /><em>px</em></label>
                <button className={`lock-btn ${studio.ratioLocked ? "is-active" : ""}`} onClick={studio.toggleRatioLock} aria-pressed={studio.ratioLocked} title={t("inspector.aspectRatio")}><Link2 size={14} /></button>
                <label className="dim-input"><span>{t("inspector.height")}</span><input value={heightInput} inputMode="numeric" onChange={(event) => setHeightInput(event.target.value)} onBlur={() => commitDimension("height", heightInput)} /><em>px</em></label>
              </div>
              <div className="dim-meta">
                <span>{t("inspector.mp", { value: ((studio.customSize.width * studio.customSize.height) / 1_000_000).toFixed(2) })}</span>
                <span>{t("inspector.alignHint")}</span>
              </div>
              <div className="res-presets">
                {presets.map(([w, h, label]) => (
                  <button key={label} onClick={() => { studio.setCustomDimensions(w, h); setWidthInput(String(w)); setHeightInput(String(h)); }}>{label === "竖屏" ? t("inspector.presetPortrait") : label}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        {studio.isVideo && (
          <div className="field-group">
            <div className="field-label">{t("inspector.bitrate")} <span className="field-value">{studio.bitrateText}</span></div>
            <div className="segmented" role="group" aria-label={t("inspector.bitrate")}>
              {(["auto", "8", "16", "custom"] as Bitrate[]).map((value) => (
                <button key={value} className={studio.bitrate === value ? "is-active" : ""} onClick={() => studio.setBitrate(value)}>
                  {value === "auto" ? t("inspector.bitrateAuto") : value === "custom" ? t("inspector.bitrateCustom") : `${value}M`}
                </button>
              ))}
            </div>
            {studio.bitrate === "custom" && (
              <div className="custom-bitrate">
                <input type="number" min={2} max={80} value={studio.customBitrate} onChange={(event) => studio.setCustomBitrate(Number(event.target.value))} />
                <span>{t("inspector.mbps")}</span><small>{t("inspector.bitrateHint")}</small>
              </div>
            )}
          </div>
        )}

        {showDuration && (
          <div className="field-group">
            <div className="field-label">{t("inspector.duration")} <span className="field-value">{studio.duration} {t("inspector.seconds")}</span></div>
            <div className="segmented" role="group" aria-label={t("inspector.duration")}>
              {[5, 10, 15].map((value) => <button key={value} className={studio.duration === value ? "is-active" : ""} onClick={() => studio.setDuration(value)}>{value}s</button>)}
            </div>
          </div>
        )}

        {showMotion && (
          <div className="field-group">
            <div className="field-label">{t("inspector.motion")}</div>
            <button className="select-like" onClick={() => toast(t("inspector.motionToast"))}><span>{MOTIONS[1]}</span><ChevronDown size={13} /></button>
          </div>
        )}

        {showAnimation && (
          <div className="field-group">
            <div className="field-label">{t("inspector.animation")} <span className="field-value">{t(`inspector.animationModes.${studio.animation}`)}</span></div>
            <div className="segmented anim-seg" role="group" aria-label={t("inspector.animation")}>
              {(["live", "2d", "3d", "stop"] as AnimationMode[]).map((value) => (
                <button key={value} className={studio.animation === value ? "is-active" : ""} onClick={() => studio.setAnimation(value)}>
                  {t(`inspector.animationModes.${value}`)}
                </button>
              ))}
            </div>
            <div className="anim-hint">{t(`inspector.animationHints.${studio.animation}`)}</div>
          </div>
        )}

        {showStrength && (
          <div className="field-group">
            <div className="field-label">{t("inspector.strength")} <span className="field-value">{studio.strength}%</span></div>
            <input className="range" type="range" min={0} max={100} value={studio.strength} style={{ ["--range-fill" as string]: `${studio.strength}%` }} onChange={(event) => studio.setStrength(Number(event.target.value))} />
            <div className="range-scale"><span>{t("inspector.freer")}</span><span>{t("inspector.closer")}</span></div>
          </div>
        )}

        {studio.mode === "i2v" && (
          <div className="field-group">
            <div className="field-label">{t("inspector.lastFrame")} <span className="field-value muted">{t("inspector.optional")}</span></div>
            <button className="upload-slot" onClick={() => toast(t("inspector.lastFrameToast"))}>
              <span>{t("inspector.addLastFrame")}</span><small>{t("inspector.addLastFrameHint")}</small>
            </button>
          </div>
        )}

        {showMulti && (
          <div className="field-group">
            <div className="field-label">{t("inspector.compose")}</div>
            <div className="segmented"><button className="is-active">{t("inspector.aiStoryboard")}</button><button onClick={() => toast(t("inspector.quickToast"))}>{t("inspector.quickTemplate")}</button></div>
            <div className="field-label spaced">{t("inspector.transition")}</div>
            <button className="select-like" onClick={() => toast(t("inspector.transitionToast"))}><span>{t("inspector.dissolve")}</span><ChevronDown size={13} /></button>
          </div>
        )}

        <div className="field-group">
          <div className="field-label">{t("inspector.negative")} <span className="field-value muted">{t("inspector.optional")}</span></div>
          <textarea className="mini-textarea" rows={2} maxLength={300} value={studio.negativePrompt} onChange={(event) => studio.setNegativePrompt(event.target.value)} />
        </div>

        <details className="advanced">
          <summary>{t("inspector.advanced")} <ChevronDown size={13} /></summary>
          <div className="advanced-body">
            <div className="inline-field">
              <span>{t("inspector.seed")}</span>
              <input value={studio.seed} onChange={(event) => studio.setSeed(event.target.value)} inputMode="numeric" />
              <button onClick={() => studio.setSeed(String(Math.floor(Math.random() * 900000) + 100000))}>{t("inspector.random")}</button>
            </div>
            <div className="inline-field">
              <span>{t("inspector.weight")}</span>
              <input className="range" type="range" min={1} max={10} defaultValue={7} />
              <em>7</em>
            </div>
            <label className="switch-row"><span>{t("inspector.autoDownload")}</span><span className="switch"><input type="checkbox" /><i /></span></label>
          </div>
        </details>

        <div className="queue-card">
          <div className="queue-top"><span className="queue-live"><i />{t("inspector.queueTitle")}</span><strong>0</strong></div>
          <p>{t("inspector.queueBody")}</p>
        </div>
      </div>

      <div className="inspector-foot">
        <div className="estimate">
          <span className="estimate-label">{t("inspector.estimate")} <em className="estimate-flag">{t("inspector.estimated")}</em></span>
          <strong>{formatTokens(studio.estimatedTokens)} <small>tokens</small></strong>
        </div>
        <button className={`cta ${studio.isGenerating ? "is-loading" : ""}`} onClick={studio.generate}>
          <span className="cta-label">{t(`cta.${studio.mode}`)}</span>
          <svg viewBox="0 0 20 20" fill="none"><path d="M4 10h11M11 5.5 15.5 10 11 14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div className="secure-note"><Lock size={10} />{t("inspector.secure")}</div>
      </div>
    </aside>
  );
}
