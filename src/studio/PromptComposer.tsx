import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Plus, SlidersHorizontal, Wand2 } from "lucide-react";
import { MODES } from "../data/mock";
import { SHORTCUTS_ENABLED } from "../lib/features";
import { formatTokens } from "../lib/tokens";
import { AssetPickerDialog } from "../assets/AssetPickerDialog";
import type { AssetRole } from "../../shared/contracts";
import { useStudio } from "./StudioContext";
import type { PromptComposerProps } from "./types/components";

/**
 * 提示词、附件、token 估算，以及移动端生成按钮。
 * @param props - 用来打开检查器。生成本身走 `useStudio`。
 * @returns 提示词栏。
 */
export function PromptComposer({ onOpenInspector }: PromptComposerProps) {
  const studio = useStudio();
  const { t } = useTranslation("studio");
  const { t: tBase } = useTranslation("base");
  /** 隐藏的文件输入。附件按钮点击它。 */
  const fileRef = useRef<HTMLInputElement>(null);
  /** 素材库选择器是否打开。 */
  const [pickerOpen, setPickerOpen] = useState(false);
  /** 当前模式的文案和附件规则。 */
  const config = MODES[studio.mode];
  /** 预计耗时句子。分镜模式用的文案键和单段不同。 */
  const eta = studio.isBoardView
    ? t(studio.mode === "multi" ? "boardEta.multi" : "boardEta.t2v")
    : t(`eta.${studio.mode}`);
  /** 传给素材库选择器的角色：首帧、镜头或参考图。 */
  const pickerRole: AssetRole = studio.mode === "i2v" ? "first_frame" : studio.mode === "multi" ? "shot" : "reference";

  /**
   * 往提示词末尾补一句固定的电影感措辞。
   * @returns 无返回值。提示词里已有「体积光」时不再重复这段。
   */
  const enhance = () => {
    if (studio.prompt.includes("体积光")) {
      studio.setPrompt(`${studio.prompt}，电影级构图，35mm 胶片颗粒`);
      return;
    }
    studio.setPrompt(`${studio.prompt.replace(/[，。,\s]+$/, "")}，电影级构图，体积光，35mm 胶片颗粒`);
  };

  return (
    <section className="composer" aria-label={t("composer.label")}>
      <div className="composer-head">
        <label className="prompt-label" htmlFor="prompt">
          <span className="prompt-spark">✦</span> {t("composer.label")} <span className="lang-tag">{t("composer.langTag")}</span>
        </label>
        <div className="composer-tools">
          <button className="text-tool" onClick={enhance}>
            <Wand2 size={12} strokeWidth={1.4} /> {t("composer.enhance")}
          </button>
          <span className="char-count">{studio.prompt.length} / 1000</span>
        </div>
      </div>
      {/* 提示词最多 1000 个字符。 */}
      <textarea
        id="prompt"
        rows={2}
        maxLength={1000}
        value={studio.prompt}
        spellCheck={false}
        placeholder={t("composer.placeholder")}
        onChange={(event) => studio.setPrompt(event.target.value)}
      />
      <div className="composer-foot">
        <div className="attach-area">
          {config.attach && (
            <>
              <button className="attach-btn" onClick={() => fileRef.current?.click()}>
                <Plus size={13} /> {t(`composer.attach.${studio.mode}`)}
              </button>
              <button className="attach-btn is-ghost" onClick={() => setPickerOpen(true)}>
                <FolderOpen size={13} /> {t("composer.fromLibrary")}
              </button>
            </>
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
                <button type="button" aria-label={tBase("delete")} onClick={() => studio.removeAttachment(attachment.id)}>×</button>
              </div>
            ))}
          </div>
          {SHORTCUTS_ENABLED && <span className="kbd-hint">{t("composer.kbd")}</span>}
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
            <SlidersHorizontal size={14} /> {t("inspector.title")}
          </button>
          <button className="mobile-generate" onClick={studio.generate}>{t("cta.generate")}</button>
        </div>
      </div>
      <AssetPickerDialog
        open={pickerOpen}
        projectId={studio.projectId}
        onClose={() => setPickerOpen(false)}
        onPick={(asset) => studio.attachAsset(asset, pickerRole)}
      />
    </section>
  );
}
