import { useRef } from "react";
import { Plus, SlidersHorizontal, Sparkles, Wand2 } from "lucide-react";
import { MODES } from "../data/mock";
import { formatTokens } from "../lib/tokens";
import { useStudio } from "./StudioContext";

export function PromptComposer({ onOpenInspector }: { onOpenInspector: () => void }) {
  const studio = useStudio();
  const fileRef = useRef<HTMLInputElement>(null);
  const config = MODES[studio.mode];
  const eta = studio.isBoardView
    ? studio.mode === "multi" ? "约 3–4 分钟" : "约 90 秒"
    : config.eta;

  const enhance = () => {
    if (studio.prompt.includes("体积光")) {
      studio.setPrompt(`${studio.prompt}，电影级构图，35mm 胶片颗粒`);
      return;
    }
    studio.setPrompt(`${studio.prompt.replace(/[，。,\s]+$/, "")}，电影级构图，体积光，35mm 胶片颗粒`);
  };

  return (
    <section className="composer" aria-label="提示词">
      <div className="composer-head">
        <label className="prompt-label" htmlFor="prompt">
          <span className="prompt-spark">✦</span> 提示词 <span className="lang-tag">中文</span>
        </label>
        <div className="composer-tools">
          <button className="text-tool" onClick={enhance}>
            <Wand2 size={12} strokeWidth={1.4} /> 智能优化
          </button>
          <span className="char-count">{studio.prompt.length} / 1000</span>
        </div>
      </div>
      <textarea
        id="prompt"
        rows={2}
        maxLength={1000}
        value={studio.prompt}
        spellCheck={false}
        placeholder="描述你想生成的画面…"
        onChange={(event) => studio.setPrompt(event.target.value)}
      />
      <div className="composer-foot">
        <div className="attach-area">
          {config.attach && (
            <button className="attach-btn" onClick={() => fileRef.current?.click()}>
              <Plus size={13} /> {config.attachLabel}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            hidden
            onChange={(event) => {
              Array.from(event.target.files || []).forEach((file) => studio.addAttachment(file));
              event.target.value = "";
            }}
          />
          <div className="attachments">
            {studio.attachments.map((attachment) => (
              <div key={attachment.id} className={`attachment-chip ${attachment.uploading ? "is-uploading" : ""} ${attachment.assetId ? "is-uploaded" : ""}`} title={attachment.name}>
                <img src={attachment.url} alt={attachment.name} />
                {attachment.uploading && <span className="attachment-progress">{attachment.progress || 0}%</span>}
                {attachment.assetId && <span className="attachment-ok">✓</span>}
                <button type="button" aria-label="移除图片" onClick={() => studio.removeAttachment(attachment.id)}>×</button>
              </div>
            ))}
          </div>
          <span className="kbd-hint">按 <kbd>⌘</kbd><kbd>↵</kbd> 快速生成</span>
        </div>
        <div className="estimate-inline">
          <span className="estimate-dot" />
          <span className="est-approx">≈</span>
          <span>{formatTokens(studio.estimatedTokens)}</span>
          <span className="token-unit">tokens</span>
          <span className="sep">·</span>
          <span>{eta}</span>
        </div>
        <div className="mobile-actions">
          <button className="mobile-params" onClick={onOpenInspector} aria-controls="inspector">
            <SlidersHorizontal size={14} /> 参数
          </button>
          <button className="mobile-generate" onClick={studio.generate}>生成</button>
        </div>
      </div>
    </section>
  );
}
