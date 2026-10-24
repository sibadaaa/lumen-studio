import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Plus, SlidersHorizontal, Wand2 } from "lucide-react";
import { MODES } from "../data/mock";
import { SHORTCUTS_ENABLED } from "../lib/features";
import { formatTokens } from "../lib/tokens";
import { AssetPickerDialog } from "../assets/AssetPickerDialog";
import type { AssetRole } from "../../shared/contracts";
import { useStudio } from "./StudioContext";

export function PromptComposer({ onOpenInspector }: { onOpenInspector: () => void }) {
  const studio = useStudio();
  const { t } = useTranslation("studio");
  const { t: tBase } = useTranslation("base");
  const fileRef = useRef<HTMLInputElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const config = MODES[studio.mode];
  const eta = studio.isBoardView
    ? t(studio.mode === "multi" ? "boardEta.multi" : "boardEta.t2v")
    : t(`eta.${studio.mode}`);
  const pickerRole: AssetRole = studio.mode === "i2v" ? "first_frame" : studio.mode === "multi" ? "shot" : "reference";

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
